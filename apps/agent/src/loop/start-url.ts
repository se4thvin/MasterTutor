import { goalSourceUrls, toOrigin } from "@mastertutor/contracts";

/** Where a run with no source starts: a blank page, so nothing from before the run shows. */
export const NEUTRAL_START_URL = "about:blank";

/**
 * Where a fresh run starts: the first goal URL on an allowed origin, else the first allowed origin,
 * else (a goal-only run) the neutral blank page, from which the agent finds its own way.
 */
export function startUrl(goal: string, allowedOrigins: readonly string[]): string {
  let sources: string[] = [];
  try {
    sources = goalSourceUrls(goal);
  } catch {
    /* Older runs may predate source validation. */
  }
  for (const candidate of sources) {
    const origin = toOrigin(candidate);
    if (origin !== null && allowedOrigins.includes(origin)) return candidate;
  }
  const first = allowedOrigins[0];
  return first ? `${first}/` : NEUTRAL_START_URL;
}
