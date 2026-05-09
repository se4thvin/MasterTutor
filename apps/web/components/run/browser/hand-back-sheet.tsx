"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";

/** Hand back with an optional note (spec §10.3). F1's Sheet: bottom sheet compact, panel regular. */
export function HandBackSheet({
  open,
  onOpenChange,
  onHandBack,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onHandBack(note: string | null): void;
}) {
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    onHandBack(note.trim() || null);
    setNote("");
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Hand back to the agent"
      initialFocus={noteRef}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Keep control</Button>
          <Button variant="primary" onClick={submit}>
            Hand back
          </Button>
        </>
      }
    >
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
