import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** One chunk per transcription request (10 minutes, ~19 MB of 16 kHz mono WAV). */
export const CHUNK_SECONDS = 600;
const SAMPLE_RATE = 16_000;
export const BYTES_PER_SECOND = SAMPLE_RATE * 2;

export interface AudioRecording {
  /** Resolves when the first PCM arrives (a fresh stream can take seconds); rejects if parec ends first. */
  readonly ready: Promise<void>;
  /** When the first PCM arrived (ms since the epoch): chunk times count from here. */
  readonly startedAt: number;
  onChunk(callback: (file: string, index: number) => void): void;
  stop(): Promise<void>;
}

/** A canonical 44-byte PCM WAV header: 16 kHz, mono, 16-bit little-endian. */
function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/**
 * parec pulls the slot's output monitor over Pulse TCP as raw PCM; full chunks are written as WAV
 * files as they complete, the remainder on stop. The child gets the slot address and PATH only,
 * never the agent's environment (its secrets).
 */
export function startAudioRecording(options: {
  server: string;
  dir: string;
  parecPath?: string;
  chunkSeconds?: number;
}): AudioRecording {
  const chunkBytes = Math.max(
    2,
    Math.floor((options.chunkSeconds ?? CHUNK_SECONDS) * SAMPLE_RATE) * 2,
  );
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
  let written: Promise<void> = Promise.resolve();
  const flush = (data: Buffer) => {
    const file = join(options.dir, `chunk-${String(index).padStart(3, "0")}.wav`);
    const chunkIndex = index++;
    written = written.then(async () => {
      await writeFile(file, Buffer.concat([wavHeader(data.byteLength), data]));
      for (const callback of callbacks) callback(file, chunkIndex);
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
      // No pid: the spawn failed (a kill then would signal our own process group).
      const running = () =>
        child.pid !== undefined && child.exitCode === null && child.signalCode === null;
      if (running()) child.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (running()) child.kill("SIGKILL");
      }, 10_000);
      const { code, error } = await exited;
      clearTimeout(timer);
      if (error || code !== 0)
        throw new Error(
          `audio recording failed (${error ? "not started" : `exit ${code}`}): ${stderr.trim().split("\n").at(-1) ?? ""}`,
        );
      if (pendingBytes > 0) flush(Buffer.concat(pending));
      pending = [];
      pendingBytes = 0;
      await written;
    },
  };
}
