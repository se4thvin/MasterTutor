import sharp from "sharp";
import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import type { MaskSources } from "../browser/masking.ts";
import { hammingDistance, perceptualHash } from "../browser/phash.ts";
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
export const PHASH_DUPLICATE_DISTANCE = 6;
export const DRM_LUMINANCE = 0.03;
export const DRM_PROBE_FRAMES = 5;

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
  #reference: bigint | null = null;
  #segmentStart = 0;
  #last: { t: number; png: Uint8Array } | null = null;
  readonly #kept: Keyframe[] = [];
  dropped = 0;

  constructor(threshold: number = PHASH_DUPLICATE_DISTANCE) {
    this.#threshold = threshold;
  }

  push(frame: { t: number; hash: bigint; png: Uint8Array }): void {
    if (
      this.#reference !== null &&
      hammingDistance(this.#reference, frame.hash) <= this.#threshold
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
  /** Black frames (DRM) or a video the slot cannot seek: the note continues with the transcript only. */
  drm: boolean;
  unplayable: boolean;
  /** Frames the masker withheld. */
  withheld: number;
}

/** Seeks every 2 s, captures the clipped, masked video region, and restores CC and position afterwards. */
export async function sampleKeyframes(
  ctx: { session: BrowserSession; mask: MaskSources; signal: AbortSignal },
  worlds: Pick<IsolatedWorlds, "call">,
  range: { start: number; end: number },
): Promise<KeyframeResult> {
  const mutate = () => ctx.session.guard.assertAgent(ctx.signal);
  const before = await worlds.call(pageVideoState, []);
  if (!before.found) return { frames: [], dropped: 0, drm: true, unplayable: true, withheld: 0 };
  const captions = await worlds.call(pageCaptionsState, []);
  // Captions would sit on every frame: off while sampling, back on afterwards.
  mutate();
  if (captions.pressed) await worlds.call(pageCaptionsClick, []);
  await worlds.call(pageVideoPause, []);
  const end = Math.min(range.end, before.duration);
  const sampler = new KeyframeSampler();
  let seeked = 0;
  let sampled = 0;
  let dark = 0;
  let withheld = 0;
  try {
    for (let t = range.start; t <= end + 1e-6; t += KEYFRAME_INTERVAL_S) {
      mutate();
      const target = Math.min(t, Math.max(range.start, end - 0.05));
      if (!(await worlds.call(pageVideoSeek, [target]))) continue;
      seeked++;
      const rect = (await worlds.call(pageVideoState, [])).rect;
      if (!rect) break;
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
      if (sampled <= DRM_PROBE_FRAMES && (await meanLuminance(png)) < DRM_LUMINANCE) dark++;
      if (dark === DRM_PROBE_FRAMES)
        return { frames: [], dropped: 0, drm: true, unplayable: false, withheld };
      sampler.push({ t: target, hash: await perceptualHash(png), png });
    }
    if (seeked === 0) return { frames: [], dropped: 0, drm: true, unplayable: true, withheld };
    if (sampled > 0 && dark === sampled)
      return { frames: [], dropped: 0, drm: true, unplayable: false, withheld };
    return {
      frames: sampler.finish(),
      dropped: sampler.dropped,
      drm: false,
      unplayable: false,
      withheld,
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
