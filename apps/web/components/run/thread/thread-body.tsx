"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatedItem, AnimatedList } from "@/components/bits/animated-list.tsx";
import { ThoughtLine } from "@/components/bits/thought-line.tsx";
import { selectedRowSeq, type ThinkingState, type ThreadItem } from "../model/thread-items.ts";
import { MessageComposer } from "./message-composer.tsx";
import { ThreadEntry } from "./thread-entry.tsx";

/** Within this many px of the end, a new entry keeps the thread pinned to it. */
const PINNED_PX = 160;

export interface ThreadProps {
  runId: string;
  items: ThreadItem[];
  summary: string;
  thinking: ThinkingState | null;
  /** The OTP card; the view renders it in the stage when the thread is a sheet. */
  otp: ReactNode;
  replaySeq: number | null;
  onReplay(seq: number): void;
  /** Moves focus to the approval sheet (the thread's approval card never decides itself). */
  onReview(): void;
  canMessage: boolean;
  /** `interrupt`: Send now (run-mode). */
  onSend(text: string, interrupt: boolean): Promise<boolean>;
  /** Each keystroke in the composer (Pip thinks along). */
  onType(): void;
}

/**
 * The conversation (fe-run-chat): pinned to the newest entry while the reader is at the end, and
 * during replay the shown screenshot's entry is selected and scrolled to the middle (inside the
 * list only: the page itself never scrolls).
 */
function ThreadList(p: ThreadProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const [clickedSeq, setClickedSeq] = useState<number | null>(null);
  const selected = selectedRowSeq(p.items, p.replaySeq, clickedSeq);
  // Opens at the newest entry and stays there until the reader scrolls back through the history.
  const pinned = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const track = () => {
      pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_PX;
    };
    list.addEventListener("scroll", track, { passive: true });
    return () => list.removeEventListener("scroll", track);
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list || p.replaySeq !== null) return undefined;
    const pin = () => {
      if (pinned.current) list.scrollTop = list.scrollHeight;
    };
    pin();
    // The tail can grow after it mounts (the lazily loaded code box): keep the end in view.
    const tail = list.lastElementChild;
    if (!tail) return undefined;
    const observer = new ResizeObserver(pin);
    observer.observe(tail);
    return () => observer.disconnect();
  }, [p.items.length, p.otp, p.thinking, p.replaySeq]);
  useEffect(() => {
    const list = listRef.current;
    const row = selected === null ? null : list?.querySelector<HTMLElement>("[data-selected]");
    if (!list || !row) return;
    // A row already in full view (the one just clicked) stays put; others glide to the middle.
    const top = row.offsetTop - list.scrollTop;
    if (top >= 0 && top + row.offsetHeight <= list.clientHeight) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({
      top: row.offsetTop - (list.clientHeight - row.offsetHeight) / 2,
      behavior: smooth ? "smooth" : "auto",
    });
  }, [selected]);
  return (
    <AnimatedList listRef={listRef} label="Agent activity">
      {p.items.map((item) => (
        <ThreadEntry
          key={item.key}
          item={item}
          runId={p.runId}
          selected={(item.kind === "step" || item.kind === "page") && item.seq === selected}
          onReplay={(rowSeq, shotSeq) => {
            setClickedSeq(rowSeq);
            p.onReplay(shotSeq);
          }}
          onReview={p.onReview}
        />
      ))}
      {p.thinking ? (
        <AnimatedItem className="th-item" data-side="agent" data-kind="thinking">
          <ThoughtLine
            label={p.thinking.label}
            working={p.thinking.working}
            since={p.thinking.since}
            until={p.thinking.until}
          />
        </AnimatedItem>
      ) : null}
      {p.otp ? (
        <AnimatedItem className="th-item" data-side="agent" data-kind="otp">
          {p.otp}
        </AnimatedItem>
      ) : null}
    </AnimatedList>
  );
}

/**
 * The thread's content, loaded off the run page's first load (its shells, the pane and the peek
 * bar, render at once): the conversation, then the message box.
 */
export function ThreadBody(p: ThreadProps) {
  return (
    <>
      <ThreadList {...p} />
      <MessageComposer disabled={!p.canMessage} onSend={p.onSend} onType={p.onType} />
    </>
  );
}
