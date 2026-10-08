"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { ThoughtLine } from "@/components/bits/thought-line.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { MEDIA } from "@/lib/breakpoints.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import type { ThinkingState, TimelineItem } from "../model/timeline-items.ts";
import { MessageComposer } from "./message-composer.tsx";

interface TimelinePanelProps {
  runId: string;
  items: TimelineItem[];
  summary: string;
  thinking: ThinkingState | null;
  /** The OTP card; on compact widths the view renders it in the stage instead. */
  otp: ReactNode;
  replaySeq: number | null;
  onReplay(seq: number): void;
  canMessage: boolean;
  onSend(text: string): Promise<boolean>;
}

function Row({
  item,
  runId,
  selected,
  onReplay,
}: {
  item: TimelineItem;
  runId: string;
  selected: boolean;
  onReplay(seq: number): void;
}) {
  switch (item.kind) {
    case "step": {
      const shotSeq = item.shotSeq;
      const body = (
        <>
          {shotSeq !== null ? (
            <img
              className="run-tl-thumb"
              src={stepScreenshotPath(runId, shotSeq)}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className="run-tl-thumb" aria-hidden="true" />
          )}
          <span className="run-tl-text">
            <span className="run-tl-verb" data-kind={item.verbKind ?? undefined}>
              {item.verb}
            </span>
            <span className="run-tl-line">
              <StatusMark status={item.status} />
              <bdi>{item.line}</bdi>
            </span>
            {item.credential ? (
              <span className="run-tl-alias">
                <Icon name="password" size="sm" />
                Vault fill
              </span>
            ) : null}
          </span>
          <time className="run-tl-ts" dateTime={item.at}>
            {item.ts}
          </time>
        </>
      );
      return (
        <li
          className="run-tl-row"
          data-current={item.current || undefined}
          data-selected={selected || undefined}
        >
          {shotSeq !== null ? (
            <button
              type="button"
              className="run-tl-body"
              aria-label={`Replay step: ${item.line}`}
              onClick={() => onReplay(shotSeq)}
            >
              {body}
            </button>
          ) : (
            <div className="run-tl-body">{body}</div>
          )}
        </li>
      );
    }
    case "message":
      return (
        <li className="run-tl-row">
          <div className="run-tl-message" data-pending={item.pending || undefined}>
            <span className="run-tl-verb">You</span>
            <p>
              <bdi>{item.text}</bdi>
            </p>
          </div>
        </li>
      );
    case "decision":
      return (
        <li className="run-tl-row">
          <div className="run-tl-body">
            <span className="run-tl-thumb" aria-hidden="true" />
            <span className="run-tl-line">
              <StatusMark status={item.status} />
              <bdi>{item.line}</bdi>
            </span>
            <time className="run-tl-ts" dateTime={item.at}>
              {item.ts}
            </time>
          </div>
        </li>
      );
    case "download":
    case "notice":
      return (
        <li className="run-tl-row" data-tone={item.kind === "notice" ? item.tone : undefined}>
          <div className="run-tl-body">
            <span className="run-tl-thumb" aria-hidden="true">
              <Icon name={item.kind === "download" ? "export" : "info"} size="sm" />
            </span>
            <span className="run-tl-line">
              <bdi>{item.line}</bdi>
            </span>
            <time className="run-tl-ts" dateTime={item.at}>
              {item.ts}
            </time>
          </div>
        </li>
      );
  }
}

function TimelineList(p: TimelinePanelProps) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 160)
      list.scrollTop = list.scrollHeight;
  }, [p.items.length, p.otp]);
  return (
    <ol ref={listRef} className="run-tl-list">
      {p.items.map((item) => (
        <Row
          key={item.key}
          item={item}
          runId={p.runId}
          selected={item.kind === "step" && item.shotSeq !== null && item.shotSeq === p.replaySeq}
          onReplay={p.onReplay}
        />
      ))}
      {p.thinking ? (
        <li className="run-tl-row run-tl-pad">
          <ThoughtLine
            label={p.thinking.label}
            working={p.thinking.working}
            since={p.thinking.since}
            until={p.thinking.until}
          />
        </li>
      ) : null}
      {p.otp ? <li className="run-tl-row">{p.otp}</li> : null}
    </ol>
  );
}

export function TimelinePanel(p: TimelinePanelProps) {
  const id = useId();
  const regular = useMediaQuery(MEDIA.md);
  const [open, setOpen] = useState(false);
  const composer = <MessageComposer disabled={!p.canMessage} onSend={p.onSend} />;
  if (regular) {
    return (
      <aside className="run-tl" aria-labelledby={`${id}-title`} data-qa-obstacle>
        <div className="run-tl-head">
          <h2 id={`${id}-title`} className="run-tl-title">
            Steps
          </h2>
          <span className="run-tl-summary">{p.summary}</span>
        </div>
        <TimelineList {...p} />
        {composer}
      </aside>
    );
  }
  return (
    <>
      <Button
        className="run-tl-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Steps · {p.summary}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Steps">
        <TimelineList {...p} otp={null} />
        {composer}
      </Sheet>
    </>
  );
}
