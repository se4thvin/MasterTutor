import { SlotName } from "@mastertutor/contracts";
import { z } from "zod";

/**
 * The agent ↔ `audio-capture` service contract (B4 review I7): the service records a slot's
 * PulseAudio output with parec in its own secret-free container; the agent only fetches finished
 * 16 kHz mono WAV chunks, checks them, and keeps them in memory until they are transcribed.
 *
 *   POST   /sessions                    StartRequest → 200 StartAnswer | 503 {error}
 *   GET    /sessions/:id/chunks/:index  200 WAV (deleted once sent) | 202 not yet | 204 no more
 *   POST   /sessions/:id/stop           200 {chunks} once the last chunk is written | 500 {error}
 *   DELETE /sessions/:id                stops and deletes everything left
 *   GET    /healthz
 */

export const AUDIO_CAPTURE_PORT = 5003;
export const SAMPLE_RATE = 16_000;
export const BYTES_PER_SECOND = SAMPLE_RATE * 2;
const WAV_HEADER_BYTES = 44;
/** One chunk per transcription request (10 minutes, ~19 MB). */
export const MAX_CHUNK_SECONDS = 600;
export const MAX_CHUNK_BYTES = WAV_HEADER_BYTES + MAX_CHUNK_SECONDS * BYTES_PER_SECOND;
/** A session's hard wall-clock limit: the longest call (600 s × 1.25 + 30 s) plus the start. */
export const MAX_SESSION_SECONDS = 900;
/** How long a chunk request waits before answering "not yet" (202); the agent asks again. */
export const CHUNK_WAIT_MS = 20_000;
/** How long the service waits for the slot's first audio before refusing (a fresh stream: 1–3 s). */
export const AUDIO_START_LIMIT_MS = 15_000;

export const StartRequest = z
  .object({
    slot: SlotName,
    chunkSeconds: z.number().min(0.25).max(MAX_CHUNK_SECONDS),
    maxSeconds: z.number().positive().max(MAX_SESSION_SECONDS),
  })
  .strict();
export type StartRequest = z.infer<typeof StartRequest>;

export const StartAnswer = z
  .object({
    id: z.uuid(),
    /** Audio already captured when the answer was sent: chunk 0 starts this long before it. */
    bufferedMs: z.number().min(0).max(AUDIO_START_LIMIT_MS),
  })
  .strict();
export type StartAnswer = z.infer<typeof StartAnswer>;

export const AudioErrorCode = z.enum([
  "audio_unavailable",
  "busy",
  "bad_request",
  "unknown_session",
  "recording_failed",
]);
export type AudioErrorCode = z.infer<typeof AudioErrorCode>;

/** A canonical 44-byte PCM WAV header: 16 kHz, mono, 16-bit little-endian. */
export function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
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

/** Seconds of audio in a chunk, when it is exactly the WAV this service writes; null otherwise. */
export function pcmWavSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < WAV_HEADER_BYTES || bytes.byteLength > MAX_CHUNK_BYTES) return null;
  const data = bytes.byteLength - WAV_HEADER_BYTES;
  if (data % 2 !== 0) return null;
  const expected = wavHeader(data);
  return Buffer.from(bytes.subarray(0, WAV_HEADER_BYTES)).equals(expected)
    ? data / BYTES_PER_SECOND
    : null;
}
