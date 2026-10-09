import type { PipSize, PipState } from "./pip-types.ts";

/**
 * Per-state posters (D49), rendered headless from the same scene by scripts/render-pip-posters.ts:
 * the still pose under reduced motion, without a GPU, offscreen and while the scene loads. Each
 * is a literal `new URL(…, import.meta.url)` the bundler hashes; a page downloads only the poster it shows.
 */
export const PIP_POSTERS: Record<PipState, Record<PipSize, string>> = {
  idle: {
    hero: new URL("./posters/pip-idle-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-idle-compact.webp", import.meta.url).href,
  },
  attentive: {
    hero: new URL("./posters/pip-attentive-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-attentive-compact.webp", import.meta.url).href,
  },
  thinking: {
    hero: new URL("./posters/pip-thinking-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-thinking-compact.webp", import.meta.url).href,
  },
  working: {
    hero: new URL("./posters/pip-working-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-working-compact.webp", import.meta.url).href,
  },
  waiting: {
    hero: new URL("./posters/pip-waiting-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-waiting-compact.webp", import.meta.url).href,
  },
  waving: {
    hero: new URL("./posters/pip-waving-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-waving-compact.webp", import.meta.url).href,
  },
  celebrating: {
    hero: new URL("./posters/pip-celebrating-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-celebrating-compact.webp", import.meta.url).href,
  },
  dozing: {
    hero: new URL("./posters/pip-dozing-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-dozing-compact.webp", import.meta.url).href,
  },
  oops: {
    hero: new URL("./posters/pip-oops-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-oops-compact.webp", import.meta.url).href,
  },
  reading: {
    hero: new URL("./posters/pip-reading-hero.webp", import.meta.url).href,
    compact: new URL("./posters/pip-reading-compact.webp", import.meta.url).href,
  },
};

/** Poster pixel sizes: hero covers 360 css px at 2×; compact 64 css px at 2×. */
export const POSTER_PX: Record<PipSize, number> = { hero: 720, compact: 128 };
