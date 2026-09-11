import { z } from "zod";
import {
  AudioErrorCode,
  CHUNK_WAIT_MS,
  MAX_CHUNK_BYTES,
  pcmWavSeconds,
  StartAnswer,
  type StartRequest,
} from "../audio/protocol.ts";
import { readCappedBytes, readCappedText } from "../runtime/read-capped.ts";

export interface AudioChunk {
  index: number;
  /** A 16 kHz mono PCM WAV, checked; held in memory only (nothing is written in the agent). */
  bytes: Uint8Array;
  seconds: number;
}

export interface CaptureSession {
  /** When the start answer arrived; chunk 0 began `bufferedMs` before it. */
  readonly readyAt: number;
  readonly bufferedMs: number;
  /** The next chunk in order, or null once the recording has stopped and every chunk was read. */
  next(signal: AbortSignal): Promise<AudioChunk | null>;
  /** Stops recording; the remaining chunks stay readable through next(). */
  stop(signal: AbortSignal): Promise<void>;
  /** Stops and deletes everything left in the service. Best effort; never throws. */
  discard(): Promise<void>;
}

/** Where a slot's audio is recorded: the audio-capture service, never this process (B4 review I7). */
export interface AudioCapture {
  start(request: StartRequest, signal: AbortSignal): Promise<CaptureSession>;
}

export class AudioCaptureError extends Error {
  readonly code: AudioErrorCode | "bad_chunk" | "capture_failed";
  constructor(code: AudioCaptureError["code"]) {
    super(`audio capture: ${code}`);
    this.name = "AudioCaptureError";
    this.code = code;
  }
}

const ErrorAnswer = z.object({ error: AudioErrorCode });
const REQUEST_SLACK_MS = 10_000;
const timed = (signal: AbortSignal, ms: number) =>
  AbortSignal.any([signal, AbortSignal.timeout(ms)]);

async function failure(response: Response): Promise<AudioCaptureError> {
  const body = await readCappedText(response.body, 4_096).catch(() => "");
  try {
    return new AudioCaptureError(ErrorAnswer.parse(JSON.parse(body)).error);
  } catch {
    return new AudioCaptureError("capture_failed");
  }
}

/**
 * The agent's side of the audio-capture contract. Answers are schema-checked; a chunk must be
 * exactly the WAV the service writes, read under MAX_CHUNK_BYTES, before anything uses it.
 */
export function createAudioCaptureClient(baseUrl: string): AudioCapture {
  const base = new URL(baseUrl);
  return {
    async start(request, signal) {
      const response = await fetch(new URL("/sessions", base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: timed(signal, 30_000),
      });
      if (!response.ok) throw await failure(response);
      const answer = StartAnswer.parse(JSON.parse(await readCappedText(response.body, 4_096)));
      const readyAt = Date.now();
      const session = new URL(`/sessions/${answer.id}/`, base);
      let index = 0;
      return {
        readyAt,
        bufferedMs: answer.bufferedMs,
        async next(nextSignal) {
          for (;;) {
            const response = await fetch(new URL(`chunks/${index}`, session), {
              signal: timed(nextSignal, CHUNK_WAIT_MS + REQUEST_SLACK_MS),
            });
            if (response.status === 202) {
              await response.body?.cancel();
              continue;
            }
            if (response.status === 204) return null;
            if (!response.ok) throw await failure(response);
            const bytes = await readCappedBytes(response.body, MAX_CHUNK_BYTES).catch(() => {
              throw new AudioCaptureError("bad_chunk");
            });
            const seconds = pcmWavSeconds(bytes);
            if (seconds === null) throw new AudioCaptureError("bad_chunk");
            return { index: index++, bytes, seconds };
          }
        },
        async stop(stopSignal) {
          const response = await fetch(new URL("stop", session), {
            method: "POST",
            signal: timed(stopSignal, 20_000),
          });
          if (!response.ok) throw await failure(response);
          await response.body?.cancel();
        },
        async discard() {
          await fetch(session, { method: "DELETE", signal: AbortSignal.timeout(10_000) })
            .then((response) => response.body?.cancel())
            .catch(() => undefined);
        },
      };
    },
  };
}
