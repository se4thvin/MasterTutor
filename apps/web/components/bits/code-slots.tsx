"use client";
/*
 * Adapted from React Bits "CodeSlots" (TS-TW).
 * Source:  https://reactbits.dev/r/CodeSlots-TS-TW.json
 * sha256:  0373c74030a344f56008cad563f1c410afc0ce3dde2f2c0509fa5053a0ac1273 (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: one real <input> whose value is always "" carries focus, paste and OS one-time-code
 * autofill; the digits live only in this component's state and are cleared before onComplete runs
 * (spec §11.4 #5, enforced by code-slots.security.test.ts); 4–8 digit codes resize the boxes;
 * sealed boxes show dots; digits enter on transitions.spring (MotionConfig turns that into a fade
 * under reduced motion); colours and sizes from tokens (run.css .cslots); the grid is
 * repeat(N, minmax(0, 3rem)), so six boxes fit at 390px (fixes D22's clipped sixth box).
 */
import { m } from "motion/react";
import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { transitions } from "@/lib/motion-tokens.ts";
import {
  slotCount,
  backspace,
  emptySlots,
  isComplete,
  pasteDigits,
  typeDigits,
  type SlotsState,
} from "./code-slots-logic.ts";

interface CodeSlotsProps {
  label: string;
  /** Number of dots to show after submit; null while editable. */
  sealed: number | null;
  disabled?: boolean;
  /** How many digits the code has, 4–8 (M9); six when unknown. */
  digits?: number;
  onComplete(code: string): void;
}

export function CodeSlots({ label, sealed, disabled = false, digits, onComplete }: CodeSlotsProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SlotsState>(() => ({
    slots: emptySlots(slotCount(digits)),
    active: 0,
  }));
  const [focused, setFocused] = useState(false);
  const locked = disabled || sealed !== null;

  const commit = (next: SlotsState) => {
    if (isComplete(next.slots)) {
      const code = next.slots.join("");
      setState({ slots: emptySlots(next.slots.length), active: 0 });
      onComplete(code);
      return;
    }
    setState(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (locked || event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      commit(typeDigits(state, event.key));
    } else if (event.key === "Backspace") {
      event.preventDefault();
      setState(backspace(state));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setState({ ...state, active: Math.max(0, state.active - 1) });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setState({ ...state, active: Math.min(state.slots.length - 1, state.active + 1) });
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (locked) return;
    event.preventDefault();
    commit(pasteDigits(state, event.clipboardData.getData("text")));
  };

  // OS one-time-code autofill and mobile keyboards arrive as input events, not keydowns.
  const onChange = (value: string) => {
    if (locked || !value) return;
    commit(value.length > 1 ? pasteDigits(state, value) : typeDigits(state, value));
  };

  const shown = sealed !== null ? Array.from({ length: sealed }, () => "•") : state.slots;

  return (
    <div
      className="cslots"
      data-sealed={sealed !== null || undefined}
      onMouseDown={(event) => {
        if (locked) return;
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <input
        ref={inputRef}
        id={id}
        className="cslots-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        value=""
        aria-label={label}
        aria-describedby={`${id}-count`}
        disabled={locked}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div
        className="cslots-row"
        style={{ "--n": shown.length } as CSSProperties}
        aria-hidden="true"
      >
        {shown.map((char, i) => (
          <span
            key={i}
            className="cslots-slot"
            data-active={(focused && !locked && i === state.active) || undefined}
            data-filled={char !== "" || undefined}
          >
            {char ? (
              <m.span
                key={`${i}-${char}`}
                className="cslots-digit"
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={transitions.spring}
              >
                {char}
              </m.span>
            ) : null}
          </span>
        ))}
      </div>
      <span id={`${id}-count`} className="sr-only" aria-live="polite">
        {sealed !== null
          ? "Code sent"
          : `${state.slots.filter(Boolean).length} of ${state.slots.length} digits entered`}
      </span>
    </div>
  );
}
