import { createHash } from "node:crypto";
import type { MaskSources } from "./masking.ts";

/** Screens kept per run: enough for a few frames' regions, never unbounded. */
const MAX_ENTRIES = 64;

/**
 * One run's pixel-screen results, keyed by a SHA-256 of the exact pixels (repeat steps reuse the
 * screen of unchanged regions, ruling on QA-098). Bound to the run's own MaskSources: any other
 * run's sources never read it. Every entry belongs to one version of the run's secret set and the
 * cache empties when that version changes (a new secret or one-time code). In memory only: it
 * lives with the run's loop browser and goes when the run's lease ends.
 */
export interface ScreenCache<T> {
  /** The cached result for `key` under `sources`' current secret set, if any. */
  get(sources: MaskSources, key: string): T | undefined;
  set(sources: MaskSources, key: string, value: T): void;
}

export function createScreenCache<T>(owner: MaskSources, maxEntries = MAX_ENTRIES): ScreenCache<T> {
  const entries = new Map<string, T>();
  let version: number | undefined;
  /** False when nothing may be cached: another run's sources, or no secret-set version. */
  const usable = (sources: MaskSources) => {
    if (sources !== owner) return false;
    const current = sources.secretsVersion?.();
    if (current === undefined) return false;
    if (current !== version) {
      entries.clear();
      version = current;
    }
    return true;
  };
  return {
    get(sources, key) {
      if (!usable(sources)) return undefined;
      const value = entries.get(key);
      if (value === undefined) return undefined;
      // Least recently used goes first.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(sources, key, value) {
      if (!usable(sources)) return;
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
  };
}

/** A key over the exact pixels: their geometry and every byte (SHA-256, no shortcut). */
export function pixelKey(
  kind: string,
  pixels: { width: number; height: number; channels: number },
  bytes: Uint8Array,
): string {
  return createHash("sha256")
    .update(`${kind}\0${pixels.width}x${pixels.height}x${pixels.channels}\0`)
    .update(bytes)
    .digest("hex");
}
