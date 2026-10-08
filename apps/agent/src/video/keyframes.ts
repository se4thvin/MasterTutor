import sharp from "sharp";
import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import type { MaskSources } from "../browser/masking.ts";
import {
  PERCEPTUAL_SAME,
  perceptualDistance,
  perceptualHash,
  type PerceptualHash,
} from "../browser/phash.ts";
import { captureMaskedRegion } from "../browser/region-capture.ts";
import type { BrowserSession } from "../browser/session.ts";
import {
  pageCaptionsClick,
  pageCaptionsState,
  pageVideoPause,
  pageVideoPlay,
  pageVideoSeek,
  pageVideoState,
} from "./page/player.ts";

export const KEYFRAME_INTERVAL_S = 2;
export const DRM_LUMINANCE = 0.03;

export async function meanLuminance(png: Uint8Array): Promise<number> {
  const stats = await sharp(png).greyscale().stats();
  return (stats.channels[0]?.mean ?? 0) / 255;
}

export interface Keyframe {
  t: number;
  segmentStart: number;
  png: Uint8Array;
}

/** spec §8: drop frames within the threshold of the segment's reference; keep the last frame before a change. */
export class KeyframeSampler {
  readonly #threshold: number;
  #reference: PerceptualHash | null = null;
  #segmentStart = 0;
  #last: { t: number; png: Uint8Array } | null = null;
  readonly #kept: Keyframe[] = [];
  dropped = 0;

  constructor(threshold: number = PERCEPTUAL_SAME) {
    this.#threshold = threshold;
  }

  push(frame: { t: number; hash: PerceptualHash; png: Uint8Array }): void {
    if (
      this.#reference !== null &&
      perceptualDistance(this.#reference, frame.hash) <= this.#threshold
    ) {
      this.dropped++;
      this.#last = { t: frame.t, png: frame.png };
      return;
    }
    if (this.#last)
      this.#kept.push({ t: this.#last.t, segmentStart: this.#segmentStart, png: this.#last.png });
    this.#reference = frame.hash;
    this.#segmentStart = frame.t;
    this.#last = { t: frame.t, png: frame.png };
  }

  finish(): Keyframe[] {
    if (this.#last)
      this.#kept.push({ t: this.#last.t, segmentStart: this.#segmentStart, png: this.#last.png });
    this.#last = null;
    return this.#kept;
  }
}

export interface KeyframeResult {
  frames: Keyframe[];
  dropped: number;
  /** Every sampled frame was dark (DRM in the slot): no frames are kept. */
  drm: boolean;
  /** No seek landed: the slot cannot play this video. */
  unplayable: boolean;
  /** Frames the masker withheld. */
  withheld: number;
  /** Sample points with no frame: a seek that did not land, or a player with no box (I1). */
  missed: number;
  /** Frames captured (dark ones included). */
  sampled: number;
}

/**
 * Seeks every 2 s, captures the clipped, masked video region, and restores CC and position
 * afterwards. Nothing is dropped silently: a point without a frame counts as missed or withheld,
 * and a dark stretch is kept unless every frame is dark (B4 review I1, I2).
 */
export async function sampleKeyframes(
  ctx: { session: BrowserSession; mask: MaskSources; signal: AbortSignal },
  worlds: Pick<IsolatedWorlds, "call">,
  range: { start: number; end: number },
): Promise<KeyframeResult> {
  const mutate = () => ctx.session.guard.assertAgent(ctx.signal);
  const before = await worlds.call(pageVideoState, []);
  const none = { frames: [], dropped: 0, drm: true, unplayable: true, withheld: 0, sampled: 0 };
  if (!before.found) return { ...none, missed: 1 };
  const captions = await worlds.call(pageCaptionsState, []);
  // Captions would sit on every frame: off while sampling, back on afterwards.
  mutate();
  if (captions.pressed) await worlds.call(pageCaptionsClick, []);
  await worlds.call(pageVideoPause, []);
  const end = before.duration > 0 ? Math.min(range.end, before.duration) : range.end;
  const sampler = new KeyframeSampler();
  let seeked = 0;
  let sampled = 0;
  let dark = 0;
  let withheld = 0;
  let missed = 0;
  try {
    for (let t = range.start; t <= end + 1e-6; t += KEYFRAME_INTERVAL_S) {
      mutate();
      const target = Math.min(t, Math.max(range.start, end - 0.05));
      if (!(await worlds.call(pageVideoSeek, [target]))) {
        missed++;
        continue;
      }
      seeked++;
      const rect = (await worlds.call(pageVideoState, [])).rect;
      if (!rect) {
        missed++;
        continue;
      }
      const png = await captureMaskedRegion(
        ctx.session,
        ctx.mask,
        { clip: rect, scale: 1 },
        ctx.signal,
      );
      if (!png) {
        withheld++;
        continue;
      }
      sampled++;
      if ((await meanLuminance(png)) < DRM_LUMINANCE) dark++;
      sampler.push({ t: target, hash: await perceptualHash(png), png });
    }
    const counts = { withheld, missed, sampled };
    if (seeked === 0) return { ...none, ...counts };
    if (sampled > 0 && dark === sampled)
      return { frames: [], dropped: 0, drm: true, unplayable: false, ...counts };
    return {
      frames: sampler.finish(),
      dropped: sampler.dropped,
      drm: false,
      unplayable: false,
      ...counts,
    };
  } finally {
    // Put the player back only while the agent still has the page (a takeover must not be undone).
    if (!ctx.session.guard.held && !ctx.signal.aborted) {
      await worlds.call(pageVideoSeek, [before.currentTime]).catch(() => false);
      if (captions.pressed) await worlds.call(pageCaptionsClick, []).catch(() => false);
      if (!before.paused) await worlds.call(pageVideoPlay, []).catch(() => false);
    }
  }
}
