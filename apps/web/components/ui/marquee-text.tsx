"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/lib/cx.ts";

/**
 * A one-line label that never breaks its row. When it does not fit it is cut with a fade; hovering
 * or keyboard-focusing its host glides it to its end and back (reduced motion: a tooltip on
 * keyboard focus instead). The full name is always the text and the `title`; the host carries the
 * accessible name. The behaviour (marquee-behaviour.ts) loads after first paint, off first-load JS.
 */
export function MarqueeText({ text, className }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let live = true;
    let detach: (() => void) | undefined;
    void import("./marquee-behaviour.ts").then(({ attachMarquee }) => {
      if (live && boxRef.current && textRef.current)
        detach = attachMarquee(boxRef.current, textRef.current, text);
    });
    return () => {
      live = false;
      detach?.();
    };
  }, [text]);

  return (
    <span ref={boxRef} className={cx("marquee", className)} title={text} data-qa-allow-clip="">
      <span ref={textRef} className="marquee-text">
        {text}
      </span>
    </span>
  );
}
