import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BYTES_PER_SECOND, SAMPLE_RATE, wavHeader } from "./protocol.ts";

export interface AudioRecording {
  /** Resolves when the first PCM arrives (a fresh stream can take seconds); rejects if parec ends first. */
  readonly ready: Promise<void>;
  /** When the first PCM arrived (ms since the epoch): chunk times count from here. */
  readonly startedAt: number;
  onChunk(callback: (file: string, index: number) => void): void;
  /** Stops parec and writes the remainder; throws when recording or writing a chunk failed. */
  stop(): Promise<void>;
}

/**
 * parec pulls a slot's output monitor over Pulse TCP as raw PCM; full chunks are written as WAV
 * files as they complete, the remainder on stop. The child gets PATH only. Runs in the
 * audio-capture service, never in the agent (B4 review I7).
 */
export function startRecording(options: {
  server: string;
  dir: string;
  chunkSeconds: number;
  parecPath?: string;
}): AudioRecording {
  const chunkBytes = Math.max(2, Math.floor(options.chunkSeconds * SAMPLE_RATE) * 2);
  const child = spawn(
    options.parecPath ?? "parec",
    [
      `--server=${options.server}`,
      "--device=audio_output.monitor",
      "--client-name=mastertutor",
      // Small server fragments: stop() then loses at most this much of the tail.
      "--latency-msec=250",
      "--raw",
      "--format=s16le",
      `--rate=${SAMPLE_RATE}`,
      "--channels=1",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } },
  );
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-1_024);
  });
  const exited = new Promise<{ code: number | null; error: Error | null }>((resolve) => {
    child.on("error", (error) => resolve({ code: null, error }));
    child.on("exit", (code, signal) =>
      resolve({ code: signal === "SIGTERM" ? 0 : code, error: null }),
    );
  });
  // No pid: the spawn failed (a kill then would signal our own process group).
  const running = () =>
    child.pid !== undefined && child.exitCode === null && child.signalCode === null;
  let startedAt = Date.now();
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    void exited.then(() => reject(new Error("audio recording ended before any audio arrived")));
  });
  ready.catch(() => undefined);
  let flowing = false;
  const callbacks: ((file: string, index: number) => void)[] = [];
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let index = 0;
  // Chunk writes run in order; the first failure is kept (never an unhandled rejection, I5), stops
  // the recording and is what stop() throws.
  let written: Promise<void> = Promise.resolve();
  let writeError: Error | null = null;
  const flush = (data: Buffer) => {
    if (writeError) return;
    const file = join(options.dir, `chunk-${String(index).padStart(3, "0")}.wav`);
    const chunkIndex = index++;
    written = written
      .then(async () => {
        if (writeError) return;
        await writeFile(file, Buffer.concat([wavHeader(data.byteLength), data]));
        for (const callback of callbacks) callback(file, chunkIndex);
      })
      .catch((error: unknown) => {
        writeError ??= error instanceof Error ? error : new Error(String(error));
        if (running()) child.kill("SIGTERM");
      });
  };
  child.stdout.on("data", (data: Buffer) => {
    if (!flowing) {
      flowing = true;
      startedAt = Date.now() - (data.byteLength / BYTES_PER_SECOND) * 1_000;
      markReady();
    }
    pending.push(data);
    pendingBytes += data.byteLength;
    if (pendingBytes < chunkBytes) return;
    let all = Buffer.concat(pending);
    while (all.byteLength >= chunkBytes) {
      flush(all.subarray(0, chunkBytes));
      all = all.subarray(chunkBytes);
    }
    pending = [all];
    pendingBytes = all.byteLength;
  });
  return {
    ready,
    get startedAt() {
      return startedAt;
    },
    onChunk(callback) {
      callbacks.push(callback);
    },
    async stop() {
      if (running()) child.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (running()) child.kill("SIGKILL");
      }, 10_000);
      const { code, error } = await exited;
      clearTimeout(timer);
      // A kill mid-sample can leave an odd byte: keep whole samples only.
      const tail = Buffer.concat(pending);
      if (tail.byteLength >= 2) flush(tail.subarray(0, tail.byteLength - (tail.byteLength % 2)));
      pending = [];
      pendingBytes = 0;
      await written;
      if (writeError) throw new Error(`audio chunk could not be written: ${writeError.message}`);
      if (error || code !== 0)
        throw new Error(
          `audio recording failed (${error ? "not started" : `exit ${code}`}): ${stderr.trim().split("\n").at(-1) ?? ""}`,
        );
    },
  };
}
