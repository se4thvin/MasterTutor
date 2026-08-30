import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeParec } from "../testing/fake-parec.ts";
import { BYTES_PER_SECOND, pcmWavSeconds } from "./protocol.ts";
import { startRecording } from "./recorder.ts";

describe("startRecording", () => {
  it("writes full WAV chunks as they complete and the remainder on stop", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mt-rec-"));
    const parec = await fakeParec();
    process.env.MT_RECORDER_CANARY = "a secret the recorder must not inherit";
    const chunks: Array<{ file: string; index: number }> = [];
    const rec = startRecording({
      server: "tcp:10.0.0.5:4713",
      dir,
      parecPath: parec,
      chunkSeconds: 0.25, // 8 000 bytes: one chunk per fake tick
    });
    rec.onChunk((file, index) => chunks.push({ file, index }));
    const launched = Date.now();
    await rec.ready;
    expect(rec.startedAt).toBeGreaterThanOrEqual(launched - 300);
    await new Promise((r) => setTimeout(r, 400));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    await rec.stop();
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    const files = (await readdir(dir)).filter((f) => f.startsWith("chunk-")).sort();
    expect(chunks.map((c) => c.file)).toEqual(files.map((f) => join(dir, f)));
    const first = new Uint8Array(await readFile(chunks[0]!.file));
    expect(pcmWavSeconds(first)).toBe(0.25);
    expect(first.byteLength).toBe(44 + BYTES_PER_SECOND / 4);
    const seen = JSON.parse(await readFile(`${parec}.args.json`, "utf8")) as {
      argv: string[];
      env: Record<string, string>;
    };
    expect(seen.argv).toEqual(
      expect.arrayContaining(["--server=tcp:10.0.0.5:4713", "--device=audio_output.monitor"]),
    );
    expect(seen.env.MT_RECORDER_CANARY).toBeUndefined();
    expect(seen.env.HOME).toBeUndefined();
    expect(seen.env.PATH).toBe(process.env.PATH);
  });

  it("fails on stop when the recorder could not run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mt-rec-"));
    const rec = startRecording({
      server: "tcp:10.0.0.5:4713",
      dir,
      chunkSeconds: 1,
      parecPath: join(dir, "missing-parec"),
    });
    await expect(rec.ready).rejects.toThrow(/before any audio/);
    await expect(rec.stop()).rejects.toThrow(/audio recording failed/);
    expect(existsSync(join(dir, "chunk-000.wav"))).toBe(false);
  });

  it("surfaces a chunk write error from stop and stops recording, never as an unhandled rejection (I5)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mt-rec-"));
    await chmod(dir, 0o500); // unwritable: every chunk write fails (EACCES, as ENOSPC would)
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const rec = startRecording({
        server: "tcp:10.0.0.5:4713",
        dir,
        parecPath: await fakeParec(),
        chunkSeconds: 0.25,
      });
      await rec.ready;
      await new Promise((r) => setTimeout(r, 300));
      await expect(rec.stop()).rejects.toThrow(/could not be written/);
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await chmod(dir, 0o700);
    }
  });
});
