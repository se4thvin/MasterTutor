"use client";

import {
  CAPTURE_CATEGORIES,
  CAPTURE_SCOPE_NOTE_MAX,
  CaptureBrief,
  type CaptureCategory,
} from "@mastertutor/contracts";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";

const labels: Record<CaptureCategory, string> = {
  reading_text: "Reading text",
  definitions: "Definitions",
  figures: "Figures",
  tables: "Tables",
  worked_examples: "Worked examples",
  activities: "Activities",
  due_dates: "Due dates",
  scores: "Scores",
  navigation: "Navigation",
  platform_chrome: "Platform chrome",
};
export function toggleCaptureChoice(
  brief: CaptureBrief,
  side: "keep" | "skip",
  category: CaptureCategory,
): CaptureBrief {
  const other = side === "keep" ? "skip" : "keep";
  return {
    ...brief,
    [side]: brief[side].includes(category)
      ? brief[side].filter((c) => c !== category)
      : [...brief[side], category],
    [other]: brief[other].filter((c) => c !== category),
  };
}
/** A person explicitly saves scope; failed requests keep their choices and free text. */
export function BriefEditor({
  brief,
  onSave,
  submitLabel = "Save scope",
}: {
  brief: CaptureBrief;
  onSave(brief: CaptureBrief): Promise<void>;
  submitLabel?: string;
}) {
  const [draft, setDraft] = useState(brief);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = CaptureBrief.safeParse(draft);
    if (!parsed.success) {
      setError(
        "Choose distinct Keep and Skip categories and use a scope note of at most 500 characters.",
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSave(parsed.data);
    } catch {
      setError("Couldn't save the capture scope. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="capture-editor" onSubmit={save} aria-busy={pending}>
      {(["keep", "skip"] as const).map((side) => (
        <fieldset key={side} disabled={pending}>
          <legend className="tf-label">{side === "keep" ? "Keep" : "Skip"}</legend>
          <div className="capture-choices">
            {CAPTURE_CATEGORIES.map((category) => (
              <Button
                key={category}
                size="lg"
                className="capture-choice"
                aria-pressed={draft[side].includes(category)}
                onClick={() => setDraft((d) => toggleCaptureChoice(d, side, category))}
              >
                {labels[category]}
              </Button>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="tf">
        <label className="tf-label" htmlFor={id}>
          Scope note
        </label>
        <textarea
          className="tf-input"
          id={id}
          maxLength={CAPTURE_SCOPE_NOTE_MAX}
          rows={3}
          value={draft.scopeNote}
          disabled={pending}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setDraft((d) => ({ ...d, scopeNote: e.target.value }))}
        />
        <p className="tf-hint" id={`${id}-hint`}>
          Add any details about what you want to capture. Kept source text stays unchanged.
        </p>
      </div>
      {error ? (
        <p className="tf-error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button variant="primary" size="lg" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
