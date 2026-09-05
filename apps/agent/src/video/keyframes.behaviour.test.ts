import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sharedLocalOcr } from "../browser/local-ocr.ts";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import type { BrowserSession } from "../browser/session.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { sampleKeyframes } from "./keyframes.ts";
import { pageCaptionsClick, pageCaptionsState, pageVideoReveal } from "./page/player.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
beforeAll(async () => {
  session = await openTestSession();
});
afterAll(async () => {
  await session?.close();
});

async function open(path: string) {
  await session.goto(`${FIXTURES}/youtube/${path}`, signal);
  const worlds = await session.worlds();
  return { worlds, duration: (await worlds.call(pageVideoReveal, [])).duration };
}
const ctx = () => ({ session, mask: NO_MASK_SOURCES, signal, ocr: sharedLocalOcr() });

describe("sampleKeyframes", () => {
  it("keeps one frame per slide and restores captions", async () => {
    const { worlds, duration } = await open("watch.html");
    await worlds.call(pageCaptionsClick, []);
    const result = await sampleKeyframes(ctx(), worlds, { start: 0, end: duration });
    expect(result).toMatchObject({ drm: false, unplayable: false, withheld: 0 });
    expect(result.frames.map((f) => f.segmentStart)).toEqual([0, 6, 10, 16]);
    expect(result.frames.map((f) => Math.round(f.t))).toEqual([4, 8, 14, 20]);
    expect((await worlds.call(pageCaptionsState, [])).pressed).toBe(true);
  }, 120_000);
  it("flags DRM-black video and keeps nothing", async () => {
    const { worlds, duration } = await open("drm.html");
    expect(await sampleKeyframes(ctx(), worlds, { start: 0, end: duration })).toMatchObject({
      drm: true,
      frames: [],
    });
  });
  it("reports a video the slot cannot play as DRM/unplayable (W9)", async () => {
    const { worlds } = await open("broken.html");
    expect(await sampleKeyframes(ctx(), worlds, { start: 0, end: 10 })).toMatchObject({
      drm: true,
      unplayable: true,
      frames: [],
    });
  }, 60_000);
  it("keeps two same-layout slides that differ only in a bullet (final review I5)", async () => {
    // Slides 1 and 2 share a template (perceptual distance 0.88); slide 3 differs.
    const { worlds, duration } = await open("watch-same-layout.html");
    const result = await sampleKeyframes(ctx(), worlds, { start: 0, end: duration });
    expect(result.frames.map((f) => f.segmentStart)).toEqual([0, 6, 10]);
  }, 120_000);
});
