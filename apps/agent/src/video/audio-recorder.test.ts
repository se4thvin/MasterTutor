import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeParec } from "../testing/fake-parec.ts";
import { BYTES_PER_SECOND, startAudioRecording } from "./audio-recorder.ts";

describe("startAudioRecording", () => {
  it("writes full WAV chunks as they complete and the remainder on stop", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mt-rec-"));
    const parec = await fakeParec();
    process.env.MT_RECORDER_CANARY = "a secret the recorder must not inherit";
    const chunks: Array<{ file: string; index: number; bytes: number }> = [];
    const rec = startAudioRecording({
      server: "tcp:10.0.0.5:4713",
      dir,
      parecPath: parec,
      chunkSeconds: 0.25, // 8 000 bytes: one chunk per fake tick
    });
    rec.onChunk((file, index) => chunks.push({ file, index, bytes: 0 }));
    const launched = Date.now();
    await rec.ready;
    expect(rec.startedAt).toBeGreaterThanOrEqual(launched - 300);
    await new Promise((r) => setTimeout(r, 400));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    await rec.stop();
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    const files = (await readdir(dir)).filter((f) => f.startsWith("chunk-")).sort();
    expect(chunks.map((c) => c.file)).toEqual(files.map((f) => join(dir, f)));
    const first = await readFile(chunks[0]!.file);
    expect(first.subarray(0, 4).toString()).toBe("RIFF");
    expect(first.subarray(8, 16).toString()).toBe("WAVEfmt ");
    expect(first.readUInt32LE(24)).toBe(16_000);
    expect(first.readUInt32LE(40)).toBe(BYTES_PER_SECOND / 4);
    expect(first.byteLength).toBe(44 + BYTES_PER_SECOND / 4);
    // The recorder gets the slot's address and nothing from the agent's environment (secrets).
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
    const rec = startAudioRecording({
      server: "tcp:10.0.0.5:4713",
      dir,
      parecPath: join(dir, "missing-parec"),
    });
    await expect(rec.ready).rejects.toThrow(/before any audio/);
    await expect(rec.stop()).rejects.toThrow(/audio recording failed/);
    expect(existsSync(join(dir, "chunk-000.wav"))).toBe(false);
  });
});
