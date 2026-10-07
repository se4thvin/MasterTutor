"use client";

import type { SourceKind } from "@mastertutor/contracts";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { parseSource, type SourceChip } from "./draft.ts";

const LABEL: Record<SourceKind, string> = {
  web: "Web page address",
  youtube: "YouTube video address",
  pdf: "PDF address",
};
const PLACEHOLDER: Record<SourceKind, string> = {
  web: "https://example.com/article",
  youtube: "https://youtube.com/watch?v=…",
  pdf: "https://example.com/paper.pdf",
};

export function SourceField({
  kind,
  onAdd,
  onCancel,
}: {
  kind: SourceKind;
  onAdd(source: SourceChip): void;
  onCancel(): void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const add = () => {
    const source = parseSource(value);
    if (!source) {
      setInvalid(true);
      return;
    }
    onAdd(source);
  };
  return (
    <div className="nt-field">
      <label htmlFor={id} className="sr-only">
        {LABEL[kind]}
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        autoFocus
        value={value}
        placeholder={PLACEHOLDER[kind]}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            add();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <Button onClick={add}>Add</Button>
      {invalid ? (
        <p id={`${id}-error`} className="nt-error">
          Enter a web address that starts with http or https.
        </p>
      ) : null}
    </div>
  );
}
