import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDIO_CAPTURE_URL } from "../../../../tests/behaviour/constants.ts";
import { pcmWavSeconds } from "../audio/protocol.ts";
import type { BrowserSession } from "../browser/session.ts";
import { StepCollector } from "../loop/step-collector.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { createAudioCaptureClient } from "./audio-capture.ts";
import { pageVideoReveal } from "./page/player.ts";
import { transcribeVideo } from "./transcribe.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
beforeAll(async () => {
  session = await openTestSession();
});
afterAll(async () => {
  await session?.close();
});

/** Root mean square of 16-bit little-endian samples after the 44-byte header, 0..1. */
function rms(wav: Uint8Array): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let sum = 0;
  let n = 0;
  for (let i = 44; i + 1 < wav.byteLength; i += 2, n++)
    sum += (view.getInt16(i, true) / 32_768) ** 2;
  return n === 0 ? 0 : Math.sqrt(sum / n);
}

describe("transcribeVideo with the real audio-capture service (B4 review: remote gap)", () => {
  it("records the slot's audio with parec in its own container and hands over checked WAV chunks", async () => {
    await session.goto(`${FIXTURES}/youtube/watch-nocc.html`, signal);
    const worlds = await session.worlds();
    expect((await worlds.call(pageVideoReveal, [])).found).toBe(true);
    const chunks: Uint8Array[] = [];
    const result = await transcribeVideo(
      {
        capture: createAudioCaptureClient(AUDIO_CAPTURE_URL),
        chunkSeconds: 2,
        transcriber: {
          transcribe: async ({ bytes }) => {
            chunks.push(bytes);
            return [{ start: 0.5, end: 1, text: "tone" }];
          },
        },
      },
      { session, step: new StepCollector(), signal, slotName: "browser-1" },
      worlds,
      { start: 2, end: 6 },
    );
    expect(result.seconds).toBe(4);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const seconds = chunks.map((chunk) => pcmWavSeconds(chunk));
    expect(seconds.every((s) => s !== null)).toBe(true);
    const total = seconds.reduce((a, b) => a! + b!, 0)!;
    // The range plus the lead before play (the stream starts in 1–3 s), never far beyond.
    expect(total).toBeGreaterThan(3.5);
    expect(total).toBeLessThan(4 + 20);
    // The fixture plays a 440 Hz tone: the recording is sound, not silence.
    expect(Math.max(...chunks.map(rms))).toBeGreaterThan(0.01);
    for (const segment of result.segments) expect(segment.start).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
