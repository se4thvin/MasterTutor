"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import type { BrowserState } from "../model/browser-state.ts";
import { pausedCopy } from "../model/copy.ts";
import type { RunModel } from "../model/run-model.ts";
import type { LiveStatus } from "./live-frame.tsx";

interface BannersProps {
  state: BrowserState;
  model: RunModel;
  replayLabel: string;
  live: LiveStatus;
  onHandBack(): void;
  onResume(): void;
  onJumpLive(): void;
}

function Banner({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div
      className="run-banner glass"
      data-show={show || undefined}
      inert={!show}
      aria-hidden={!show || undefined}
    >
      {children}
    </div>
  );
}

export function Banners({
  state,
  model,
  replayLabel,
  live,
  onHandBack,
  onResume,
  onJumpLive,
}: BannersProps) {
  const paused = pausedCopy(model);
  const liveIssue = state !== "control" && state !== "replay" && state !== "paused" ? live : "off";
  return (
    <>
      <Banner show={state === "control"}>
        <Icon name="hand" size="sm" />
        <span className="run-banner-text">
          <b>You're in control</b> · Agent paused · screenshots off
        </span>
        <button type="button" className="btn btn-gray run-banner-btn" onClick={onHandBack}>
          Hand back
        </button>
      </Banner>
      <Banner show={state === "paused"}>
        <Icon name="sleeping" size="sm" />
        <span className="run-banner-text">
          <b>{paused.title}</b> · <bdi>{paused.detail}</bdi>
        </span>
        {paused.canResume ? (
          <button type="button" className="btn btn-gray run-banner-btn" onClick={onResume}>
            <Icon name="play" size="sm" />
            Resume
          </button>
        ) : null}
      </Banner>
      <Banner show={state === "replay"}>
        <Icon name="session" size="sm" />
        <span className="run-banner-text">
          <b>Replay</b> · {replayLabel}
        </span>
        <button type="button" className="btn btn-gray run-banner-btn" onClick={onJumpLive}>
          Jump to live
        </button>
      </Banner>
      <Banner show={liveIssue === "in_use"}>
        <Icon name="external" size="sm" />
        <span className="run-banner-text">
          <b>Open in another tab</b> · Close it there to watch here
        </span>
      </Banner>
      <Banner show={liveIssue === "unavailable"}>
        <Icon name="info" size="sm" />
        <span className="run-banner-text">
          <b>Live view unavailable</b> · Showing the last screenshot
        </span>
      </Banner>
      {state === "reconnecting" ? (
        <div className="run-reconnect glass" role="status">
          <span className="run-spinner" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ rotate: `${i * 45}deg` }} />
            ))}
          </span>
          Reconnecting to the browser…
        </div>
      ) : null}
    </>
  );
}
