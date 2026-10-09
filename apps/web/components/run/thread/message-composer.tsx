"use client";

import { useId, useState } from "react";
import { IconButton } from "@/components/ui/button.tsx";

export function MessageComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend(text: string): Promise<boolean>;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const send = async () => {
    const value = text.trim();
    if (!value || disabled) return;
    setText("");
    if (!(await onSend(value))) setText(value);
  };
  return (
    <form
      className="run-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Message the agent
      </label>
      <textarea
        id={id}
        rows={1}
        maxLength={4_000}
        value={text}
        disabled={disabled}
        placeholder={disabled ? "This run has ended" : "Message the agent"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <IconButton
        type="submit"
        icon="send"
        label="Send message"
        className="run-send"
        disabled={disabled || !text.trim()}
      />
    </form>
  );
}
