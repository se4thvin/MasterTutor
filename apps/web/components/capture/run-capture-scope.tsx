"use client";

import { untrustedText, type CaptureBrief, type CaptureQuestion } from "@mastertutor/contracts";
import { BriefEditor } from "./brief-editor.tsx";

export function CaptureQuestionCard({
  brief,
  question,
  onSave,
}: {
  brief: CaptureBrief;
  question: CaptureQuestion;
  onSave(brief: CaptureBrief): Promise<void>;
}) {
  return (
    <section className="group group-pad capture-scope" aria-label="Capture scope">
      <h2 className="t-title3">{untrustedText(question.question, 160)}</h2>
      <p className="muted">
        Choose once before browsing. These choices become your defaults for{" "}
        {question.domains.length
          ? question.domains.map((d) => untrustedText(d, 253)).join(", ")
          : "the sites in this task"}
        .
      </p>
      <BriefEditor brief={brief} onSave={onSave} submitLabel="Continue" />
    </section>
  );
}
export function RunCaptureBrief({
  brief,
  onSave,
  editable,
}: {
  brief: CaptureBrief;
  onSave(brief: CaptureBrief): Promise<void>;
  editable: boolean;
}) {
  return (
    <details className="group group-pad capture-scope">
      <summary className="tf-label">Capture brief</summary>
      <p className="muted">{untrustedText(brief.scopeNote, 500)}</p>
      {editable ? (
        <BriefEditor brief={brief} onSave={onSave} />
      ) : (
        <>
          <p>Keep: {brief.keep.map((c) => c.replaceAll("_", " ")).join(", ") || "None"}</p>
          <p>Skip: {brief.skip.map((c) => c.replaceAll("_", " ")).join(", ") || "None"}</p>
        </>
      )}
    </details>
  );
}
