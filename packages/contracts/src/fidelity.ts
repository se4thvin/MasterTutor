import type { BlockOrigin, Fidelity } from "./enums.ts";

/** Note coverage at or above this can be `verified` (spec §7.5). */
export const VERIFIED_COVERAGE = 0.98;

/** Origins whose text came from a source. `user` text is never verified against one. */
export const CAPTURED_ORIGINS = [
  "dom",
  "pdf",
  "captions",
  "asr",
  "ocr_model",
] as const satisfies readonly BlockOrigin[];

/**
 * The single fidelity rule, used by the agent when writing and by web on "Mark verified".
 * Any unverified captured block needs a person; lost media or low coverage is partial.
 */
export function noteFidelity(input: {
  coverage: number | null;
  unverifiedCaptured: number;
  missingMedia: number;
}): Fidelity {
  if (input.unverifiedCaptured > 0) return "needs_review";
  if (input.missingMedia > 0) return "partial";
  if (input.coverage !== null && input.coverage < VERIFIED_COVERAGE) return "partial";
  return "verified";
}
