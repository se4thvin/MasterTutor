import { afterEach, describe, expect, it, vi } from "vitest";
import { wavHeader } from "../audio/protocol.ts";
import { ControlGuard } from "../browser/guard.ts";
import { StepCollector } from "../loop/step-collector.ts";
import type { AudioCapture, AudioChunk } from "./audio-capture.ts";
import { pageVideoPlay, pageVideoState } from "./page/player.ts";
import { transcribeVideo, transcriptionBounds } from "./transcribe.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const chunkOf = (index: number, seconds: number): AudioChunk => {
  const data = Math.round(seconds * 32_000);
  return {
    index,
    seconds,
    bytes: new Uint8Array(Buffer.concat([wavHeader(data), Buffer.alloc(data)])),
  };
};

/** An in-memory audio-capture service: hands out `chunks`, then null once stopped. */
function fakeCapture(chunks: AudioChunk[], options: { bufferedMs?: number; fails?: boolean } = {}) {
  const calls = { started: 0, stopped: 0, discarded: 0, served: 0 };
  let stopped = false;
  let wake: () => void = () => undefined;
  const capture: AudioCapture = {
    async start() {
      calls.started++;
      if (options.fails) throw new Error("audio_unavailable");
      const queue = [...chunks];
      return {
        readyAt: Date.now(),
        bufferedMs: options.bufferedMs ?? 0,
        async next() {
          for (;;) {
            const chunk = queue.shift();
            if (chunk) {
              calls.served++;
              return chunk;
            }
            if (stopped) return null;
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
        async stop() {
          calls.stopped++;
          stopped = true;
          wake();
        },
        async discard() {
          calls.discarded++;
          stopped = true;
          wake();
        },
      };
    },
  };
  return { capture, calls };
}

/** A player whose time runs from 0 at `speed`× wall time until `endsAt`; `plays: "hang"` never resolves play(). */
function player(options: { plays?: boolean | "hang"; endsAt?: number; times?: number[] } = {}) {
  const started = Date.now();
  let read = 0;
  return {
    call: async (fn: unknown) => {
      if (fn === pageVideoPlay) {
        if (options.plays === "hang") return new Promise(() => undefined);
        return options.plays ?? true;
      }
      if (fn === pageVideoState) {
        const t = options.times ? (options.times[read++] ?? 0) : (Date.now() - started) / 1_000;
        return {
          found: true,
          duration: 2,
          currentTime: t,
          paused: false,
          muted: false,
          ended: t >= (options.endsAt ?? 0.3),
          ad: false,
          rect: null,
        };
      }
      return true;
    },
  } as never;
}
const context = (step = new StepCollector(), signal = new AbortController().signal) => ({
  session: { guard: new ControlGuard() } as never,
  step,
  signal,
  slotName: "browser-1",
});

describe("transcribeVideo (spec §8 transcribe)", () => {
  it("offsets every chunk by its place in the recording, minus the lead before play", async () => {
    const { capture, calls } = fakeCapture([chunkOf(0, 1), chunkOf(1, 1)], { bufferedMs: 250 });
    const out = await transcribeVideo(
      {
        capture,
        chunkSeconds: 1,
        transcriber: {
          transcribe: async ({ filename }) => [{ start: 0.5, end: 0.75, text: filename }],
        },
      },
      context(),
      player(),
      { start: 30, end: 33 },
    );
    expect(out.seconds).toBe(3);
    const byChunk = Object.fromEntries(out.segments.map((s) => [s.text, s.start]));
    // chunk n starts at range.start + n − lead; the lead is ≥ the 0.25 s buffered before play.
    expect(byChunk["chunk-000.wav"]).toBeGreaterThan(30.5 - 0.35);
    expect(byChunk["chunk-000.wav"]).toBeLessThanOrEqual(30.25);
    expect(byChunk["chunk-001.wav"]! - byChunk["chunk-000.wav"]!).toBeCloseTo(1, 6);
    expect(calls).toMatchObject({ started: 1, stopped: 1, discarded: 1 });
  });

  it("refuses with audio_unavailable when the service cannot record, before pressing play", async () => {
    let played = false;
    const world = {
      call: async (fn: unknown) => ((played ||= fn === pageVideoPlay), true),
    } as never;
    await expect(
      transcribeVideo(
        {
          capture: fakeCapture([], { fails: true }).capture,
          transcriber: { transcribe: async () => [] },
        },
        context(),
        world,
        { start: 0, end: 1 },
      ),
    ).rejects.toMatchObject({ code: "audio_unavailable" });
    expect(played).toBe(false);
  });

  it("discards the recording when playback is blocked", async () => {
    const { capture, calls } = fakeCapture([]);
    await expect(
      transcribeVideo(
        { capture, transcriber: { transcribe: async () => [] } },
        context(),
        player({ plays: false }),
        { start: 0, end: 1 },
      ),
    ).rejects.toMatchObject({ code: "playback_blocked" });
    expect(calls.discarded).toBe(1);
  });

  it("ends at once on abort even while play() never settles (I3)", async () => {
    const { capture, calls } = fakeCapture([]);
    const controller = new AbortController();
    const run = transcribeVideo(
      { capture, transcriber: { transcribe: async () => [] } },
      context(new StepCollector(), controller.signal),
      player({ plays: "hang" }),
      { start: 0, end: 1 },
    );
    setTimeout(() => controller.abort(new Error("cancelled")), 50);
    const began = Date.now();
    await expect(run).rejects.toThrow("cancelled");
    expect(Date.now() - began).toBeLessThan(1_000);
    expect(calls.discarded).toBe(1);
  });
});

describe("transcribeVideo bounds (I4)", () => {
  it("allows the content's length × 1.25 + 30 s and the chunks that fit in it", () => {
    expect(transcriptionBounds({ start: 0, end: 600 }, 600)).toEqual({
      deadlineMs: 780_000,
      maxChunks: 2,
    });
    expect(transcriptionBounds({ start: 10, end: 20 }, 1).maxChunks).toBe(43);
  });

  it("checks the run's budget before sending a chunk", async () => {
    let sent = 0;
    const step = new StepCollector({ usdLeft: 0.000_05 }); // less than one 1 s chunk (0.0001 $)
    await expect(
      transcribeVideo(
        {
          capture: fakeCapture([chunkOf(0, 1)]).capture,
          chunkSeconds: 1,
          transcriber: { transcribe: async () => ((sent += 1), []) },
        },
        context(step),
        player({ endsAt: 5 }),
        { start: 0, end: 3 },
      ),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(sent).toBe(0);
  });

  it("stops a recording that holds more chunks than the video can fill", async () => {
    let sent = 0;
    const many = Array.from({ length: 40 }, (_, i) => chunkOf(i, 1));
    await expect(
      transcribeVideo(
        {
          capture: fakeCapture(many).capture,
          chunkSeconds: 1,
          transcriber: { transcribe: async () => ((sent += 1), []) },
        },
        context(),
        player({ endsAt: 60 }),
        { start: 0, end: 2 }, // 2 × 1.25 + 30 s → 33 chunks at most
      ),
    ).rejects.toMatchObject({ code: "playback_overrun" });
    expect(sent).toBe(33);
  });

  it("stops when the page jumps back (an ad or a loop)", async () => {
    await expect(
      transcribeVideo(
        { capture: fakeCapture([]).capture, transcriber: { transcribe: async () => [] } },
        context(),
        player({ times: [2, 4, 0.5], endsAt: 60 }),
        { start: 0, end: 10 },
      ),
    ).rejects.toMatchObject({ code: "playback_overrun" });
  });

  it("stops at the wall-clock deadline", async () => {
    const realNow = Date.now.bind(Date);
    let shift = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + shift);
    const times = [0.1, 0.2, 0.3];
    const world = {
      call: async (fn: unknown) => {
        if (fn === pageVideoState) {
          shift += 20_000; // each look at the player is 20 s later
          return {
            found: true,
            duration: 2,
            currentTime: times.shift() ?? 0.4,
            ended: false,
            ad: false,
            rect: null,
          };
        }
        return true;
      },
    } as never;
    await expect(
      transcribeVideo(
        { capture: fakeCapture([]).capture, transcriber: { transcribe: async () => [] } },
        context(),
        world,
        { start: 0, end: 1 }, // deadline 31.25 s
      ),
    ).rejects.toMatchObject({ code: "playback_overrun" });
  });
});
