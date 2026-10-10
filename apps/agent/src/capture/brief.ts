import { CaptureBrief, CAPTURE_SCOPE_NOTE_MAX } from "@mastertutor/contracts";

/** Person-authored scope is task data; mask it before any model-facing serialization. */
export function redactBrief(brief: CaptureBrief, redact: (text: string) => string): CaptureBrief {
  return CaptureBrief.parse({
    ...brief,
    scopeNote: redact(brief.scopeNote).slice(0, CAPTURE_SCOPE_NOTE_MAX),
  });
}
