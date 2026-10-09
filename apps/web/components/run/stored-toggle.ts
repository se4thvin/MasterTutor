"use client";

import { useCallback, useEffect, useState } from "react";

/** The run view's per-viewer switches (callouts, the thread pane), kept in localStorage. */
export const STORED_TOGGLES = { callouts: "mt.callouts", thread: "mt.run-thread" } as const;

/**
 * A per-viewer convenience only: storage can be blocked (private mode, a sandboxed preview), so it
 * defaults to on and the in-memory choice still applies when nothing can be saved.
 */
export function useStoredToggle(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      setOn(localStorage.getItem(key) !== "off");
    } catch {
      // Storage blocked: keep the default.
    }
  }, [key]);
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        localStorage.setItem(key, next ? "on" : "off");
      } catch {
        // Not persisted; the in-memory choice still applies.
      }
    },
    [key],
  );
  return [on, set];
}
