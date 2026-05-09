"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { m } from "motion/react";
import { useEffect, useState } from "react";
import { ButtonLink, IconButton } from "@/components/ui/button.tsx";
import { transitions } from "@/lib/motion-tokens.ts";
import { LiveFrame } from "../browser/live-frame.tsx";
import { deriveBrowserState } from "../model/browser-state.ts";
import { STATE_PILL, captionFor, hostAndPath } from "../model/copy.ts";
import { isTerminal, latestScreenshotSeq } from "../model/run-model.ts";
import { IDLE_TAKEOVER } from "../model/takeover.ts";
import { useRun } from "../stream/use-run.ts";

/** 15rem of a 35rem stage: the mock's compact scale. */
const SMALL_SCALE = 0.4286;
const ignoreStatus = () => undefined;

export function RunPip({ runId, onGone }: { runId: string; onGone(): void }) {
  const { model, connection, loadError } = useRun(runId);
  const [big, setBig] = useState(false);
  const ended = loadError || (model !== null && isTerminal(model.status));

  useEffect(() => {
    if (ended) onGone();
  }, [ended, onGone]);
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBig(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [big]);

  if (!model || ended) return null;
  const state = deriveBrowserState(model, {
    connection,
    takeover: IDLE_TAKEOVER,
    replaying: false,
    liveRetrying: false,
  });
  const host = hostAndPath(model.currentUrl)?.host ?? "new tab";
  const shot = latestScreenshotSeq(model);
  const caption = captionFor(state, model, IDLE_TAKEOVER, null);
  return (
    <aside className="run-pip" aria-label="Mini browser">
      <m.div
        className="run-pip-screen"
        initial={false}
        animate={{ scale: big ? 1 : SMALL_SCALE }}
        transition={transitions.springSoft}
      >
        {shot !== null ? (
          <img className="run-pip-shot" src={stepScreenshotPath(runId, shot)} alt="" />
        ) : null}
        {big ? (
          <LiveFrame
            runId={runId}
            slotName={model.slotName}
            epoch={0}
            title={`Remote browser, ${host}`}
            interactive={false}
            onStatus={ignoreStatus}
          />
        ) : null}
        {big ? (
          <div className="run-pip-bar glass">
            <bdi className="run-pip-text">{caption}</bdi>
            <ButtonLink href={`/runs/${runId}`} variant="primary">
              Open run
            </ButtonLink>
            <IconButton icon="minimize" label="Shrink mini browser" onClick={() => setBig(false)} />
          </div>
        ) : (
          <button
            type="button"
            className="run-pip-expand"
            aria-label={`Live run, ${host}. Expand mini browser`}
            onClick={() => setBig(true)}
          />
        )}
      </m.div>
      <div className="run-pip-caption glass" data-hidden={big || undefined}>
        <i data-tone={STATE_PILL[state].tone} aria-hidden="true" />
        <bdi>{caption}</bdi>
      </div>
    </aside>
  );
}
