"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PIP_TIMING, createPipMachine, type PipEvent, type PipMachine } from "./pip-machine.ts";
import type { PipState } from "./pip-types.ts";

/** Input anywhere on the page wakes a dozing Pip. Passive listeners: a timestamp write each. */
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/**
 * Binds pip-machine.ts to React: the shown state and a stable `send`. With `doze`, page input
 * resets the doze clock; with `arrive`, Pip waves on mount.
 */
export function usePipMachine({
  doze = false,
  arrive = false,
}: { doze?: boolean; arrive?: boolean } = {}): [PipState, (event: PipEvent) => void] {
  const [state, setState] = useState<PipState>("idle");
  const machine = useRef<PipMachine | null>(null);
  useEffect(() => {
    const m = createPipMachine({ onChange: setState, doze });
    machine.current = m;
    if (arrive) m.send({ type: "arrive" });
    const onInput = () => m.send({ type: "activity" });
    const options = { passive: true, capture: true };
    if (doze) for (const name of INPUT_EVENTS) window.addEventListener(name, onInput, options);
    return () => {
      machine.current = null;
      m.dispose();
      for (const name of INPUT_EVENTS) window.removeEventListener(name, onInput, options);
    };
  }, [doze, arrive]);
  const send = useCallback((event: PipEvent) => machine.current?.send(event), []);
  return [state, send];
}

/**
 * Start waits this long before opening the run, so its celebration is seen (the run's creation
 * runs alongside). Under reduced motion there is nothing to watch: no wait.
 */
export function pipStartFloor(): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, PIP_TIMING.celebrateMs));
}
