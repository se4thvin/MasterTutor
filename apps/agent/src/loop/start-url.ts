import { toOrigin } from "@mastertutor/contracts";

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** Where a run with no source starts: a blank page, so nothing from before the run shows. */
export const NEUTRAL_START_URL = "about:blank";

/**
 * Where a fresh run starts: the first goal URL on an allowed origin, else the first allowed origin,
 * else (a goal-only run) the neutral blank page, from which the agent finds its own way.
 */
export function startUrl(goal: string, allowedOrigins: readonly string[]): string {
  for (const match of goal.matchAll(URL_IN_TEXT)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, "");
    const origin = toOrigin(candidate);
    if (origin !== null && allowedOrigins.includes(origin)) return new URL(candidate).href;
  }
  const first = allowedOrigins[0];
  return first ? `${first}/` : NEUTRAL_START_URL;
}
