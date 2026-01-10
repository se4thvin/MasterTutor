import { toOrigin } from "@mastertutor/contracts";

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** Where a fresh run starts: the first goal URL on an allowed origin, else the first allowed origin. */
export function startUrl(goal: string, allowedOrigins: readonly string[]): string | null {
  for (const match of goal.matchAll(URL_IN_TEXT)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, "");
    const origin = toOrigin(candidate);
    if (origin !== null && allowedOrigins.includes(origin)) return new URL(candidate).href;
  }
  const first = allowedOrigins[0];
  return first ? `${first}/` : null;
}
