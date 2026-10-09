"use client";

import { useId, useState } from "react";
import { IconButton } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { LiquidGlass } from "@/components/ui/liquid-glass.tsx";
import { Menu } from "@/components/ui/menu.tsx";

/**
 * The thread's message box (run-mode): Send queues the message for the agent's next step (Enter);
 * Send now interrupts what it is doing (⌘/Ctrl+Enter, or the send button's menu). Interrupting
 * never skips an approval: an open card still waits for a person.
 */
export function MessageComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend(text: string, interrupt: boolean): Promise<boolean>;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const empty = !text.trim();
  const send = async (interrupt: boolean) => {
    const value = text.trim();
    if (!value || disabled) return;
    setText("");
    if (!(await onSend(value, interrupt))) setText(value);
  };
  return (
    <div className="run-composer-wrap">
      <form
        className="run-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(false);
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
          aria-describedby={disabled ? undefined : `${id}-hint`}
          aria-keyshortcuts="Enter Meta+Enter Control+Enter"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(e.metaKey || e.ctrlKey);
            }
          }}
        />
        <div className="run-send-split" role="group" aria-label="Send">
          <IconButton
            type="submit"
            icon="send"
            label="Send"
            className="run-send"
            disabled={disabled || empty}
          />
          <Menu.Root>
            <Menu.Trigger
              className="icon-btn run-send-more"
              aria-label="More ways to send"
              disabled={disabled || empty}
            >
              <Icon name="chevronDown" size="sm" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                side="top"
                align="end"
                sideOffset={6}
                collisionPadding={12}
                className="popover-positioner"
              >
                <Menu.Popup className="menu">
                  <LiquidGlass className="menu-glass">
                    <Menu.Item className="menu-item" onClick={() => void send(false)}>
                      <Icon name="send" size="sm" />
                      <span>Send</span>
                      <kbd className="menu-kbd">↵</kbd>
                    </Menu.Item>
                    <Menu.Item className="menu-item" onClick={() => void send(true)}>
                      <Icon name="stop" size="sm" />
                      <span>Send now</span>
                      <kbd className="menu-kbd">⌘↵</kbd>
                    </Menu.Item>
                  </LiquidGlass>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </form>
      {disabled ? null : (
        <p id={`${id}-hint`} className="run-composer-hint">
          ↵ Send after this step · ⌘↵ Send now, interrupting
        </p>
      )}
    </div>
  );
}
