"use client";

import { useId, useRef, useState } from "react";
import { formatBytes } from "@/components/bits/format.ts";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import type { HeldDownload } from "../model/run-model.ts";
import { untrustedText } from "@mastertutor/contracts";

type Choice = "keep" | "discard";

/**
 * Hand back with an optional note (spec §10.3). F1's Sheet: bottom sheet compact, panel regular.
 * Downloads made while the person held control wait here for a Keep or Discard each (B6 A11):
 * nothing is kept without an explicit Keep, and nothing is handed back until every file has a
 * decision. With nothing held, the sheet and the request are as before.
 */
export function HandBackSheet({
  open,
  onOpenChange,
  held,
  onHandBack,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  held: readonly HeldDownload[];
  onHandBack(note: string | null, keep: readonly string[] | null): void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const [missing, setMissing] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const firstChoiceRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const undecided = held.filter((d) => choices[d.id] === undefined);

  const submit = () => {
    if (undecided.length > 0) {
      setMissing(true);
      // Focus the first file still waiting, so a keyboard or screen-reader user lands on it.
      listRef.current
        ?.querySelector<HTMLInputElement>(`input[data-download="${undecided[0]?.id}"]`)
        ?.focus();
      return;
    }
    const keep = held.length ? held.filter((d) => choices[d.id] === "keep").map((d) => d.id) : null;
    onHandBack(note.trim() || null, keep);
    setNote("");
    setChoices({});
    setMissing(false);
  };
  const choose = (downloadId: string, choice: Choice) => {
    const next = { ...choices, [downloadId]: choice };
    setChoices(next);
    if (held.every((d) => next[d.id] !== undefined)) setMissing(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Hand back to the agent"
      initialFocus={held.length ? firstChoiceRef : noteRef}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Keep control</Button>
          <Button variant="primary" onClick={submit}>
            Hand back
          </Button>
        </>
      }
    >
      {held.length ? (
        <section className="run-held" aria-labelledby={`${id}-held`}>
          <h3 id={`${id}-held`} className="run-held-title">
            Downloads you made
          </h3>
          <p className="run-held-hint">
            Keep saves a file with this run. Discard deletes it. The agent never sees a discarded
            file.
          </p>
          <ul ref={listRef} className="run-held-list">
            {held.map((d, index) => {
              const name = untrustedText(d.filename, 255) || "Unnamed file";
              const nameId = `${id}-${d.id}-name`;
              return (
                <li key={d.id}>
                  <div
                    role="radiogroup"
                    className="run-held-row"
                    aria-labelledby={nameId}
                    data-undecided={(missing && choices[d.id] === undefined) || undefined}
                  >
                    <Icon name="export" size="sm" />
                    <span className="run-held-file">
                      <bdi id={nameId} className="run-held-name">
                        {name}
                      </bdi>
                      <span className="run-held-size">{formatBytes(d.bytes)}</span>
                    </span>
                    <span className="run-held-choices">
                      {(["keep", "discard"] as const).map((choice) => (
                        <label key={choice} className="run-held-choice" data-choice={choice}>
                          <input
                            ref={index === 0 && choice === "keep" ? firstChoiceRef : undefined}
                            type="radio"
                            name={`${id}-${d.id}`}
                            data-download={choice === "keep" ? d.id : undefined}
                            checked={choices[d.id] === choice}
                            onChange={() => choose(d.id, choice)}
                          />
                          {choice === "keep" ? "Keep" : "Discard"}
                        </label>
                      ))}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {missing ? (
            <p className="run-held-error" role="alert">
              Choose Keep or Discard for each download.
            </p>
          ) : null}
        </section>
      ) : null}
      <label className="run-note-label">
        Note to the agent <span className="muted">(optional)</span>
        <textarea
          ref={noteRef}
          className="run-note"
          value={note}
          maxLength={4_000}
          placeholder="I closed the pop-up. Carry on from the quiz page, and don't start it."
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Sheet>
  );
}
