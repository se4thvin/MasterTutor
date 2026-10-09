"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { useId, useState } from "react";
import { AnimatedItem } from "@/components/bits/animated-list.tsx";
import { CallChip } from "@/components/bits/call-chip.tsx";
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import type { ThreadItem } from "../model/thread-items.ts";

/** A thought longer than this many characters opens clamped, with Show more. */
const LONG_THOUGHT = 240;

type Side = "agent" | "person" | "system";
const SIDE: Record<ThreadItem["kind"], Side> = {
  thought: "agent",
  page: "agent",
  step: "agent",
  approval: "agent",
  message: "person",
  decision: "system",
  download: "system",
  notice: "system",
};

function Time({ item }: { item: ThreadItem }) {
  return (
    <time className="th-ts" dateTime={item.at}>
      {item.ts}
    </time>
  );
}

function Thought({ item }: { item: Extract<ThreadItem, { kind: "thought" }> }) {
  const id = useId();
  const long = item.paragraphs.join("").length > LONG_THOUGHT;
  const [open, setOpen] = useState(false);
  return (
    <div className="th-thought">
      <p className="th-meta">
        <Icon name="agentNote" size="sm" />
        <span>Thought</span>
        <Time item={item} />
      </p>
      {item.title ? (
        <p className="th-thought-title">
          <bdi>{item.title}</bdi>
        </p>
      ) : null}
      <div id={id} className="th-thought-body" data-clamped={(long && !open) || undefined}>
        {item.paragraphs.map((text, i) => (
          <p key={i}>
            <bdi>{text}</bdi>
          </p>
        ))}
      </div>
      {long ? (
        <button
          type="button"
          className="th-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

export function ThreadEntry({
  item,
  runId,
  selected,
  onReplay,
  onReview,
}: {
  item: ThreadItem;
  runId: string;
  selected: boolean;
  onReplay(rowSeq: number, shotSeq: number): void;
  onReview(): void;
}) {
  const row = (body: React.ReactNode) => (
    <AnimatedItem
      className="th-item"
      data-side={SIDE[item.kind]}
      data-kind={item.kind}
      data-selected={selected || undefined}
    >
      {body}
    </AnimatedItem>
  );
  switch (item.kind) {
    case "thought":
      return row(<Thought item={item} />);
    case "page": {
      const shotSeq = item.shotSeq;
      const body = (
        <>
          {shotSeq !== null ? (
            <img
              className="th-thumb"
              src={stepScreenshotPath(runId, shotSeq)}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className="th-thumb" aria-hidden="true">
              <Icon name="web" size="sm" />
            </span>
          )}
          <span className="th-page-text">
            <span className="th-verb">Opened</span>
            <span className="th-page-url">
              <bdi className="th-host">{item.host}</bdi>
              <bdi className="th-path">{item.path}</bdi>
            </span>
          </span>
          <Time item={item} />
        </>
      );
      return row(
        shotSeq !== null ? (
          <button
            type="button"
            className="th-page th-replay"
            aria-label={`Replay page: ${item.host}${item.path}`}
            onClick={() => onReplay(item.seq, shotSeq)}
          >
            {body}
          </button>
        ) : (
          <div className="th-page">{body}</div>
        ),
      );
    }
    case "step": {
      const shotSeq = item.shotSeq;
      const body = (
        <>
          <CallChip glyph={item.glyph} status={item.status}>
            <span className="th-verb" data-kind={item.verbKind ?? undefined}>
              {item.verb}
            </span>
            <bdi className="th-line">{item.line}</bdi>
            {item.credential ? (
              <span className="th-alias">
                <Icon name="password" size="sm" />
                Vault fill
              </span>
            ) : null}
          </CallChip>
          <Time item={item} />
        </>
      );
      return row(
        shotSeq !== null ? (
          <button
            type="button"
            className="th-action th-replay"
            data-current={item.current || undefined}
            aria-label={`Replay step: ${item.line}`}
            onClick={() => onReplay(item.seq, shotSeq)}
          >
            {body}
          </button>
        ) : (
          <div className="th-action" data-current={item.current || undefined}>
            {body}
          </div>
        ),
      );
    }
    case "approval":
      return row(
        <div className="th-approval" role="group" aria-label="Needs your approval">
          <span className="th-approval-icon" aria-hidden="true">
            <Icon name="hand" size="sm" />
          </span>
          <span className="th-approval-text">
            <span className="th-verb" data-kind="sig">
              Needs you
            </span>
            <bdi className="th-line">{item.line}</bdi>
          </span>
          <Button onClick={onReview}>Review</Button>
        </div>,
      );
    case "message":
      return row(
        <div className="th-msg" data-pending={item.pending || undefined}>
          <span className="th-verb">{item.pending ? "You · sending" : "You"}</span>
          <p>
            <bdi>{item.text}</bdi>
          </p>
        </div>,
      );
    case "decision":
      return row(
        <p className="th-system">
          <StatusMark status={item.status} />
          <bdi>{item.line}</bdi>
          <Time item={item} />
        </p>,
      );
    case "download":
    case "notice":
      return row(
        <p className="th-system" data-tone={item.kind === "notice" ? item.tone : undefined}>
          <Icon name={item.kind === "download" ? "export" : "info"} size="sm" />
          <bdi>{item.line}</bdi>
          <Time item={item} />
        </p>,
      );
  }
}
