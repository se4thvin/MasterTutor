"use client";

import { useEffect, useState, type RefObject } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { IconButton } from "@/components/ui/button.tsx";
import { enterFullscreen, exitFullscreen, keyboardOf } from "./fullscreen.ts";

export function FullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const toast = useToast();
  const [on, setOn] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const active =
        document.fullscreenElement !== null && document.fullscreenElement === target.current;
      setOn(active);
      if (!active) keyboardOf(navigator)?.unlock?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [target]);

  const toggle = async () => {
    const el = target.current;
    if (!el) return;
    if (on) {
      exitFullscreen(document, keyboardOf(navigator));
      return;
    }
    if (await enterFullscreen(el, keyboardOf(navigator)))
      toast({ title: "Hold Esc to leave full screen." });
    else toast({ title: "Full screen isn't available in this browser." });
  };

  return (
    <IconButton
      icon={on ? "minimize" : "maximize"}
      label={on ? "Exit full screen" : "Full screen"}
      aria-pressed={on}
      onClick={() => void toggle()}
    />
  );
}
