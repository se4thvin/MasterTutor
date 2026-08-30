import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import { MAX_CHUNK_SECONDS } from "../audio/protocol.ts";
import { transcriptionUsage } from "../llm/pricing.ts";
import { abortable, pause } from "../runtime/abortable.ts";
import { ToolError, type ToolContext } from "../tools/types.ts";
import { type AudioCapture, AudioCaptureError, type CaptureSession } from "./audio-capture.ts";
import type { CaptionSegment } from "./json3.ts";
import { pageVideoPause, pageVideoPlay, pageVideoSeek, pageVideoState } from "./page/player.ts";
import type { Transcriber } from "./transcriber.ts";

const STALL_LIMIT_MS = 30_000;
/** A jump back further than this (an ad, a loop, a seek by the page) is not the content playing. */
const REWIND_LIMIT_S = 1;

export interface TranscribeDeps {
  transcriber: Transcriber;
  capture: AudioCapture;
  chunkSeconds?: number;
}

/**
 * The bounds of one transcribe call (B4 review I4): playback may take the content's length × 1.25
 * plus 30 s, and the recording holds at most the chunks that fit in that time.
 */
export function transcriptionBounds(
  range: { start: number; end: number },
  chunkSeconds: number,
): { deadlineMs: number; maxChunks: number } {
  const deadlineMs = (range.end - range.start) * 1.25 * 1_000 + 30_000;
  return { deadlineMs, maxChunks: Math.ceil(deadlineMs / 1_000 / chunkSeconds) };
}

async function waitForPlayback(
  ctx: Pick<ToolContext, "session" | "signal">,
  worlds: Pick<IsolatedWorlds, "call">,
  end: number,
  deadline: number,
  failed: Promise<never>,
): Promise<void> {
  let lastTime = -1;
  let stalledSince = Date.now();
  for (;;) {
    // A takeover stops the recording: the page is the person's now.
    ctx.session.guard.assertAgent(ctx.signal);
    const state = await abortable(
      Promise.race([worlds.call(pageVideoState, []), failed]),
      ctx.signal,
    );
    if (state.ended || state.currentTime >= end - 0.25) return;
    if (Date.now() > deadline)
      throw new ToolError("playback_overrun", "The video played far longer than its length");
    if (lastTime >= 0 && state.currentTime < lastTime - REWIND_LIMIT_S)
      throw new ToolError("playback_overrun", "The video jumped back (an ad or a loop)");
    if (state.currentTime !== lastTime) {
      lastTime = state.currentTime;
      stalledSince = Date.now();
    } else if (Date.now() - stalledSince > STALL_LIMIT_MS) {
      throw new ToolError("playback_stalled", "The video stopped playing");
    }
    const wait = Math.min(1_000, Math.max(50, (end - state.currentTime) * 1_000));
    await Promise.race([pause(wait, ctx.signal), failed]);
  }
}

/**
 * spec §8 transcribe: play at 1×; the audio-capture service records the slot's output and the
 * chunks are transcribed while the video plays. Chunks live only in memory here (B4 review I7).
 * Bounded (I4): a wall-clock deadline, a chunk limit, and the run's budget checked before each
 * chunk is sent. play() and every wait end at once on abort or takeover (I3).
 */
export async function transcribeVideo(
  deps: TranscribeDeps,
  ctx: Pick<ToolContext, "session" | "step" | "signal" | "slotName">,
  worlds: Pick<IsolatedWorlds, "call">,
  range: { start: number; end: number },
): Promise<{ segments: CaptionSegment[]; seconds: number }> {
  const chunkSeconds = Math.min(deps.chunkSeconds ?? MAX_CHUNK_SECONDS, MAX_CHUNK_SECONDS);
  const { deadlineMs, maxChunks } = transcriptionBounds(range, chunkSeconds);
  ctx.session.guard.assertAgent(ctx.signal);
  await abortable(worlds.call(pageVideoSeek, [range.start]), ctx.signal);
  let recording: CaptureSession;
  try {
    recording = await deps.capture.start(
      { slot: ctx.slotName, chunkSeconds, maxSeconds: Math.ceil(deadlineMs / 1_000) + 15 },
      ctx.signal,
    );
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    throw new ToolError("audio_unavailable", "The browser's audio could not be recorded");
  }
  let lag = 0;
  const transcribeAll = async (): Promise<CaptionSegment[]> => {
    const segments: CaptionSegment[] = [];
    for (;;) {
      const chunk = await recording.next(ctx.signal);
      if (!chunk) return segments;
      if (chunk.index >= maxChunks)
        throw new ToolError("playback_overrun", "The recording ran past the video's length");
      // Checked before the audio is sent: the loop checks the budget only between steps.
      if (ctx.step.usdLeft() < transcriptionUsage(chunk.seconds).usd)
        throw new ToolError("budget_exhausted", "The run's budget cannot cover more transcription");
      const found = await deps.transcriber.transcribe(
        { bytes: chunk.bytes, filename: `chunk-${String(chunk.index).padStart(3, "0")}.wav` },
        { signal: ctx.signal, step: ctx.step },
      );
      const offset = range.start + chunk.index * chunkSeconds - lag;
      for (const s of found)
        segments.push({
          ...s,
          start: Math.max(range.start, s.start + offset),
          end: Math.max(range.start, s.end + offset),
        });
    }
  };
  try {
    let transcribing: Promise<CaptionSegment[]>;
    try {
      ctx.session.guard.assertAgent(ctx.signal);
      if (!(await abortable(worlds.call(pageVideoPlay, []), ctx.signal)))
        throw new ToolError("playback_blocked", "The video would not play");
      lag = recording.bufferedMs / 1_000 + (Date.now() - recording.readyAt) / 1_000;
      transcribing = transcribeAll();
      transcribing.catch(() => undefined);
      // A transcription failure (budget, overrun) ends playback at once.
      const failed = transcribing.then(() => new Promise<never>(() => undefined));
      await waitForPlayback(ctx, worlds, range.end, Date.now() + deadlineMs, failed);
    } finally {
      if (!ctx.session.guard.held)
        await abortable(worlds.call(pageVideoPause, []), ctx.signal).catch(() => undefined);
    }
    await recording.stop(ctx.signal);
    const segments = (await transcribing).filter((s) => s.start < range.end);
    return { segments, seconds: range.end - range.start };
  } catch (error) {
    if (error instanceof AudioCaptureError)
      throw new ToolError("audio_unavailable", "The browser's audio recording failed");
    throw error;
  } finally {
    // Whatever is left in the service goes now; the chunks read here were only ever in memory.
    await recording.discard();
  }
}
