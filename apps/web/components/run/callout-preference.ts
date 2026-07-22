"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "mt.callouts";

/** Per-viewer convenience only; storage can be blocked, so default to on. */
export function useCalloutsPreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      setOn(localStorage.getItem(KEY) !== "off");
    } catch {
      // Storage blocked: keep the default.
    }
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // Not persisted; the in-memory choice still applies.
    }
  }, []);
  return [on, set];
}
