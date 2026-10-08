import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fakeParec } from "../testing/fake-parec.ts";
import { createAudioCaptureClient } from "../video/audio-capture.ts";
import { startAudioCaptureServer } from "./server.ts";

const open: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((close) => close()));
});

async function service(options: { parecPath?: string; root?: string; startLimitMs?: number } = {}) {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "mt-audio-svc-")));
  const resolved: string[] = [];
  const started = await startAudioCaptureServer(0, {
    root,
    parecPath: options.parecPath ?? (await fakeParec()),
    resolveSlot: async (slot) => (resolved.push(slot), "10.0.0.5"),
    ...(options.startLimitMs ? { startLimitMs: options.startLimitMs } : {}),
  });
  open.push(started.close);
  return { root, resolved, url: `http://127.0.0.1:${started.port}` };
}
const signal = new AbortController().signal;
const files = async (root: string) =>
  (await readdir(root, { recursive: true })).filter((f) => f.endsWith(".wav"));

describe("audio-capture service (B4 review I7)", () => {
  it("records a slot, serves each checked chunk once and deletes it, then ends", async () => {
    const { root, resolved, url } = await service();
    const session = await createAudioCaptureClient(url).start(
      { slot: "browser-2", chunkSeconds: 0.25, maxSeconds: 30 },
      signal,
    );
    expect(resolved).toEqual(["browser-2"]);
    const first = await session.next(signal);
    expect(first).toMatchObject({ index: 0, seconds: 0.25 });
    await new Promise((r) => setTimeout(r, 300));
    await session.stop(signal);
    let last = first!;
    for (let chunk = await session.next(signal); chunk; chunk = await session.next(signal))
      last = chunk;
    expect(last.index).toBeGreaterThan(0);
    // Served chunks are gone from the service; nothing is left after the session.
    expect(await files(root)).toEqual([]);
    await session.discard();
  });

  it("deletes what a session left when it is discarded, and everything on start", async () => {
    const root = await mkdtemp(join(tmpdir(), "mt-audio-svc-"));
    await mkdir(join(root, "crashed-session"));
    await writeFile(join(root, "crashed-session", "chunk-000.wav"), "left behind");
    const { url } = await service({ root });
    expect(existsSync(join(root, "crashed-session"))).toBe(false);
    const session = await createAudioCaptureClient(url).start(
      { slot: "browser-1", chunkSeconds: 0.25, maxSeconds: 30 },
      signal,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect((await files(root)).length).toBeGreaterThan(0);
    await session.discard();
    expect(await files(root)).toEqual([]);
  });

  it("refuses when the slot's audio never starts, and anything that is not a slot", async () => {
    const { url } = await service({ parecPath: "/nonexistent/parec" });
    const client = createAudioCaptureClient(url);
    await expect(
      client.start({ slot: "browser-1", chunkSeconds: 1, maxSeconds: 30 }, signal),
    ).rejects.toMatchObject({ code: "audio_unavailable" });
    await expect(
      client.start({ slot: "garage", chunkSeconds: 1, maxSeconds: 30 } as never, signal),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("rejects a chunk that is not the WAV the service writes", async () => {
    const { createServer } = await import("node:http");
    const fake = createServer((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", bufferedMs: 0 }));
        return;
      }
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end("RIFF....not a wav at all");
    });
    await new Promise<void>((resolve) => fake.listen(0, resolve));
    open.push(() => new Promise((resolve) => fake.close(() => resolve())));
    const port = (fake.address() as { port: number }).port;
    const session = await createAudioCaptureClient(`http://127.0.0.1:${port}`).start(
      { slot: "browser-1", chunkSeconds: 1, maxSeconds: 30 },
      signal,
    );
    await expect(session.next(signal)).rejects.toMatchObject({ code: "bad_chunk" });
  });
});
