import { useEffect, useEffectEvent } from "react";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** ⌘/Ctrl+key (meta) or a bare key outside text fields. Never use browser-reserved combos (⌘N/T/W/L). */
export function useHotkey(
  combo: { key: string; meta?: boolean },
  handler: (event: KeyboardEvent) => void,
): void {
  const onKey = useEffectEvent(handler);
  const { key, meta = false } = combo;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key) return;
      if ((event.metaKey || event.ctrlKey) !== meta) return;
      if (!meta && isTyping(event.target)) return;
      event.preventDefault();
      onKey(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [key, meta]);
}
