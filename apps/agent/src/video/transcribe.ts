import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PULSE_TCP_PORT } from "@mastertutor/contracts";
import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import { abortable, pause } from "../runtime/abortable.ts";
import { slotCdpBaseUrl } from "../slots/probe.ts";
import { ToolError, type ToolContext } from "../tools/types.ts";
import { CHUNK_SECONDS, startAudioRecording } from "./audio-recorder.ts";
import type { CaptionSegment } from "./json3.ts";
import { pageVideoPause, pageVideoPlay, pageVideoSeek, pageVideoState } from "./page/player.ts";
import type { Transcriber } from "./transcriber.ts";

const STALL_LIMIT_MS = 30_000;
const AUDIO_START_LIMIT_MS = 15_000;

export interface TranscribeDeps {
  transcriber: Transcriber;
  parecPath?: string;
  chunkSeconds?: number;
  /** Where the slot's PulseAudio listens (agent-only ACL); tests stub it. */
  pulseServer?: (slotName: string) => Promise<string>;
}

const slotPulse = async (slotName: string) =>
  `tcp:${new URL(await slotCdpBaseUrl(slotName)).hostname}:${PULSE_TCP_PORT}`;

async function waitForPlayback(
  ctx: Pick<ToolContext, "session" | "signal">,
  worlds: Pick<IsolatedWorlds, "call">,
  end: number,
): Promise<void> {
  let lastTime = -1;
  let stalledSince = Date.now();
  for (;;) {
    // A takeover stops the recording: the page is the person's now.
    ctx.session.guard.assertAgent(ctx.signal);
    const state = await worlds.call(pageVideoState, []);
    if (state.ended || state.currentTime >= end - 0.25) return;
    if (state.currentTime !== lastTime) {
      lastTime = state.currentTime;
      stalledSince = Date.now();
    } else if (Date.now() - stalledSince > STALL_LIMIT_MS) {
      throw new ToolError("playback_stalled", "The video stopped playing");
    }
    await pause(Math.min(1_000, Math.max(50, (end - state.currentTime) * 1_000)), ctx.signal);
  }
}

/**
 * spec §8 transcribe: play at 1×, record the slot's monitor over Pulse TCP, transcribe the chunks
 * in parallel. Each chunk is deleted as soon as its transcript returns (data policy rule 4); the
 * directory goes after commit, or at once on failure.
 */
export async function transcribeVideo(
  deps: TranscribeDeps,
  ctx: Pick<ToolContext, "session" | "step" | "signal" | "slotName">,
  worlds: Pick<IsolatedWorlds, "call">,
  range: { start: number; end: number },
): Promise<{ segments: CaptionSegment[]; seconds: number }> {
  const server = await (deps.pulseServer ?? slotPulse)(ctx.slotName);
  const chunkSeconds = deps.chunkSeconds ?? CHUNK_SECONDS;
  const dir = await mkdtemp(join(tmpdir(), "mt-audio-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  ctx.step.afterCommit(cleanup);
  try {
    ctx.session.guard.assertAgent(ctx.signal);
    await worlds.call(pageVideoSeek, [range.start]);
    const recording = startAudioRecording({
      server,
      dir,
      chunkSeconds,
      ...(deps.parecPath ? { parecPath: deps.parecPath } : {}),
    });
    const pending: Promise<CaptionSegment[]>[] = [];
    let lag = 0;
    recording.onChunk((file, index) => {
      const transcribed = deps.transcriber
        .transcribe(file, { signal: ctx.signal, step: ctx.step })
        .then((segments) =>
          segments.map((s) => {
            const offset = range.start + index * chunkSeconds - lag;
            return {
              ...s,
              start: Math.max(range.start, s.start + offset),
              end: Math.max(range.start, s.end + offset),
            };
          }),
        )
        .finally(() => unlink(file).catch(() => undefined));
      // Observed at once: a failure while playback continues must not go unhandled.
      transcribed.catch(() => undefined);
      pending.push(transcribed);
    });
    let failed = false;
    try {
      // Play only once audio flows, so the opening is recorded and offsets hold.
      const startLimit = AbortSignal.any([ctx.signal, AbortSignal.timeout(AUDIO_START_LIMIT_MS)]);
      await abortable(recording.ready, startLimit).catch((error: unknown) => {
        if (ctx.signal.aborted) throw error;
        throw new ToolError("audio_unavailable", "The browser's audio could not be recorded");
      });
      ctx.session.guard.assertAgent(ctx.signal);
      if (!(await worlds.call(pageVideoPlay, [])))
        throw new ToolError("playback_blocked", "The video would not play");
      lag = (Date.now() - recording.startedAt) / 1_000;
      await waitForPlayback(ctx, worlds, range.end);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!ctx.session.guard.held) await worlds.call(pageVideoPause, []).catch(() => undefined);
      // A recorder failure is the error only when nothing else failed first.
      await recording.stop().catch((error: unknown) => {
        if (!failed) throw error;
      });
    }
    const segments = (await Promise.all(pending)).flat().filter((s) => s.start < range.end);
    return { segments, seconds: range.end - range.start };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
