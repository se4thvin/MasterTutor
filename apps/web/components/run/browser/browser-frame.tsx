"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { useId, useRef, type ReactNode } from "react";
import { AgentCursor } from "../cursor/agent-cursor.tsx";
import { toViewport, type Point } from "../cursor/cursor-path.ts";
import { canTakeOver, type BrowserState } from "../model/browser-state.ts";
import {
  STATE_PILL,
  actNumber,
  captionFor,
  hostAndPath,
  pausedCopy,
  stepLabel,
} from "../model/copy.ts";
import {
  latestPointerStep,
  latestScreenshotSeq,
  originOf,
  type RunModel,
  type StepRow,
} from "../model/run-model.ts";
import type { TakeoverState } from "../model/takeover.ts";
import { untrustedText } from "../model/untrusted-text.ts";
import { useElementSize } from "../use-element-size.ts";
import { Banners } from "./banners.tsx";
import { Caption } from "./caption.tsx";
import { FullscreenButton } from "./fullscreen-button.tsx";
import { LiveFrame, type LiveStatus } from "./live-frame.tsx";
import { OriginPill, StatePill } from "./origin-pill.tsx";
import { StepCallout } from "./step-callout.tsx";

interface BrowserFrameProps {
  runId: string;
  model: RunModel;
  state: BrowserState;
  takeover: TakeoverState;
  replayStep: StepRow | null;
  replayLabel: string;
  showCallouts: boolean;
  liveEpoch: number;
  liveStatus: LiveStatus;
  onLiveStatus(status: LiveStatus): void;
  onHandBack(): void;
  onTakeControl(): void;
  onResume(): void;
  onJumpLive(): void;
  approval?: ReactNode;
  spotlight?: Point | null;
  scrubber?: ReactNode;
}

const SPOT = { w: 96, h: 56, r: 12 };

export function BrowserFrame(p: BrowserFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(viewportRef);
  const maskId = `spot-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { model, state } = p;
  const replaying = state === "replay";
  const shown = replaying ? p.replayStep : latestPointerStep(model);
  const url = replaying ? (p.replayStep?.url ?? model.currentUrl) : model.currentUrl;
  const host = hostAndPath(url)?.host ?? "new tab";
  const target = shown?.action?.point && size ? toViewport(shown.action.point, size) : null;
  const pointer = shown?.action?.pointer;
  // Only a finished click with a pointer kind pulses; a step without one (pre-A1) never does (W1).
  const pulseKey =
    !replaying && shown?.state === "done" && (pointer === "click" || pointer === "double_click")
      ? shown.seq
      : null;
  const shotSeq = replaying ? (p.replayStep?.seq ?? null) : latestScreenshotSeq(model);
  const showShot =
    replaying || state === "paused" || state === "reconnecting" || p.liveStatus !== "live";
  const pill = STATE_PILL[state];
  const spot = p.spotlight && size ? toViewport(p.spotlight, size) : null;
  const callout =
    p.showCallouts &&
    shown &&
    target &&
    size &&
    (state === "live" || state === "acting" || replaying)
      ? shown
      : null;

  return (
    <div ref={frameRef} className="run-frame" data-state={state} data-testid="browser-frame">
      <div className="run-chrome glass">
        <span className="run-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <OriginPill
          url={url}
          secure={model.secureFillOrigin !== null && originOf(url) === model.secureFillOrigin}
        />
        <div className="run-chrome-end">
          {model.approvalMode === "bypass" ? (
            // D44: the indicator travels with the frame into full screen (the header does not).
            <span className="run-bypass-chip" title="Bypass mode: approvals are automatic">
              Bypass
            </span>
          ) : null}
          <StatePill
            label={state === "paused" ? pausedCopy(model).title : pill.label}
            tone={pill.tone}
            pulse={pill.pulse}
          />
          <FullscreenButton target={frameRef} />
        </div>
      </div>
      <div ref={viewportRef} className="run-viewport" data-shot={showShot || undefined}>
        <LiveFrame
          runId={p.runId}
          slotName={model.slotName}
          epoch={p.liveEpoch}
          title={`Remote browser, ${host}`}
          interactive={state === "control"}
          onStatus={p.onLiveStatus}
        />
        {shotSeq !== null ? (
          <img
            className="run-shot"
            src={stepScreenshotPath(p.runId, shotSeq)}
            alt={
              replaying
                ? `Screenshot of step: ${untrustedText(p.replayStep?.caption, 120) || host}`
                : ""
            }
          />
        ) : null}
        <div className="run-agent-ring" aria-hidden="true" />
        <div className="run-user-ring" aria-hidden="true" />
        <svg className="run-dim" aria-hidden="true">
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {spot ? (
                <rect
                  x={spot.x - SPOT.w / 2}
                  y={spot.y - SPOT.h / 2}
                  width={SPOT.w}
                  height={SPOT.h}
                  rx={SPOT.r}
                  fill="black"
                />
              ) : null}
            </mask>
          </defs>
          <rect data-scrim="" width="100%" height="100%" mask={`url(#${maskId})`} />
        </svg>
        {callout && target && size ? (
          <StepCallout
            text={untrustedText(callout.action?.summary ?? callout.caption, 160)}
            number={actNumber(model, callout.seq)}
            target={target}
            box={size}
          />
        ) : null}
        <AgentCursor
          target={target}
          pulseKey={pulseKey}
          hidden={state === "control" || state === "reconnecting" || state === "paused"}
          thinking={state === "live"}
        />
        {canTakeOver(model, state, p.takeover) ? (
          <button
            type="button"
            className="run-takeover"
            aria-label="Take control of the browser"
            onClick={p.onTakeControl}
          >
            <span className="run-takeover-hint" aria-hidden="true">
              Click to take control
            </span>
          </button>
        ) : null}
        <Banners
          state={state}
          model={model}
          replayLabel={p.replayLabel}
          live={p.liveStatus}
          onHandBack={p.onHandBack}
          onResume={p.onResume}
          onJumpLive={p.onJumpLive}
        />
        {p.approval}
      </div>
      {replaying ? p.scrubber : null}
      <Caption
        text={captionFor(state, model, p.takeover, p.replayStep)}
        step={replaying ? p.replayLabel : stepLabel(model)}
        tone={state}
      />
    </div>
  );
}
