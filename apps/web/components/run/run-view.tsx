"use client";

import type { ApprovalDecisionInput } from "@mastertutor/contracts";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ChunkBoundary } from "@/components/ui/chunk-boundary.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { api } from "@/lib/api/client.ts";
import { MEDIA } from "@/lib/breakpoints.ts";
import { lazyComponent } from "@/lib/hooks/lazy-component.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { ApprovalSheet } from "./approval/approval-sheet.tsx";
import { BrowserFrame } from "./browser/browser-frame.tsx";
import { HandBackSheet } from "./browser/hand-back-sheet.tsx";
import type { LiveStatus } from "./browser/live-frame.tsx";
import { REPLAY_INTERVAL_MS, ReplayScrubber } from "./browser/replay-scrubber.tsx";
import { useCalloutsPreference } from "./callout-preference.ts";
import { approvalCopy } from "./model/approval-copy.ts";
import { canTakeOver, deriveBrowserState } from "./model/browser-state.ts";
import { INFO_ERROR_COPY, hostAndPath, shortRunId } from "./model/copy.ts";
import { isInformational, isTerminal, latestError, type RunModel } from "./model/run-model.ts";
import { inControl } from "./model/takeover.ts";
import {
  summaryLabel,
  thinkingState,
  timelineItems,
  type PendingMessage,
} from "./model/timeline-items.ts";
import { forgetWatchedRun, rememberWatchedRun } from "./pip/watching.ts";
import { RunHeader } from "./run-header.tsx";
import { useRun } from "./stream/use-run.ts";
import { BudgetMeters } from "./timeline/budget-meters.tsx";
import { TimelinePanel } from "./timeline/timeline-panel.tsx";
import { useTakeover } from "./use-takeover.ts";

/** The OTP card is rare (a site asked for a code): off the run page's first load. */
const { Component: OtpCard, usePrefetch: usePrefetchOtpCard } = lazyComponent(() =>
  import("./timeline/otp-card.tsx").then((mod) => mod.OtpCard),
);
const ignoreFailure = () => undefined;

export function RunView({ runId, viewerId }: { runId: string; viewerId: string | null }) {
  const toast = useToast();
  usePrefetchOtpCard();
  const { model, connection, loadError, resync } = useRun(runId);
  const { takeover, takeControl, handBack } = useTakeover(runId, model, resync);
  const status = model?.status ?? null;
  useEffect(() => {
    if (status === null) return;
    if (isTerminal(status)) forgetWatchedRun(runId);
    else rememberWatchedRun(runId);
  }, [runId, status]);
  const [replaySeq, setReplaySeq] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("off");
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [deciding, setDeciding] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [playing, setPlaying] = useState(false);
  const regular = useMediaQuery(MEDIA.md);
  const [callouts, setCallouts] = useCalloutsPreference();
  const [stopOpen, setStopOpen] = useState(false);
  const stop = useCallback(() => {
    api.runs.cancel({ runId }).catch(() => toast({ title: "Couldn't stop the run. Try again." }));
  }, [runId, toast]);

  // After a Reconnecting episode, open the live view again (B6 §8).
  const [liveEpoch, setLiveEpoch] = useState(0);
  const wasLost = useRef(false);
  useEffect(() => {
    if (connection === "lost") wasLost.current = true;
    else if (connection === "open" && wasLost.current) {
      wasLost.current = false;
      setLiveEpoch((n) => n + 1);
    }
  }, [connection]);

  // Informational run errors are toasts, never the failure reason (A7). takeover_failed is the
  // takeover hook's notice.
  const lastError = model ? latestError(model) : null;
  const infoKey = lastError && isInformational(lastError.code) ? lastError.eventId : null;
  const infoCode = lastError?.code ?? null;
  useEffect(() => {
    if (infoKey === null || infoCode === null || infoCode === "takeover_failed") return;
    toast({ title: INFO_ERROR_COPY[infoCode] ?? "The agent reported a problem." });
  }, [infoKey, infoCode, toast]);

  // Optimistic decisions: a decided approval leaves at once and comes back if the RPC fails.
  const view: RunModel | null = useMemo(
    () =>
      model ? { ...model, approvals: model.approvals.filter((a) => !deciding.has(a.id)) } : null,
    [model, deciding],
  );
  const shotSteps = useMemo(
    () => (view ? view.steps.filter((s) => s.screenshotKey !== null) : []),
    [view],
  );
  const replayIndex = shotSteps.findIndex((s) => s.seq === replaySeq);
  const replayStep = replayIndex >= 0 ? (shotSteps[replayIndex] ?? null) : null;
  const replayLabel = replayStep ? `step ${replayIndex + 1}/${shotSteps.length}` : "";
  // Each tick advances one shot; past the last one the replay ends. The updater stays pure: the
  // end is seen below, in an effect, not inside setReplaySeq (M7).
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setReplaySeq((seq) => {
        const at = shotSteps.findIndex((s) => s.seq === seq);
        return at < 0 ? null : (shotSteps[at + 1]?.seq ?? null);
      });
    }, REPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, shotSteps]);
  useEffect(() => {
    if (playing && replayStep === null) setPlaying(false);
  }, [playing, replayStep]);
  const items = useMemo(
    () => (view ? timelineItems(view, pending, viewerId) : []),
    [view, pending, viewerId],
  );
  const lastEventId = view?.lastEventId ?? null;
  const send = useCallback(
    async (text: string) => {
      // sentAt keeps the pending row's time stable across renders (group B fix).
      const entry: PendingMessage = {
        key: crypto.randomUUID(),
        text,
        afterEventId: lastEventId,
        sentAt: new Date().toISOString(),
      };
      setPending((p) => [...p, entry]);
      try {
        await api.runs.sendMessage({ runId, text });
        return true;
      } catch {
        setPending((p) => p.filter((m) => m.key !== entry.key));
        toast({ title: "Couldn't send your message. It's back in the box." });
        return false;
      }
    },
    [runId, lastEventId, toast],
  );
  const state = view
    ? deriveBrowserState(view, {
        connection,
        takeover,
        replaying: replayStep !== null,
        liveRetrying: liveStatus === "retrying",
      })
    : null;

  const startTakeover = useCallback(() => {
    if (!view || !state || !canTakeOver(view, state, takeover)) return;
    setReplaySeq(null);
    takeControl(view.status === "sleeping");
  }, [view, state, takeover, takeControl]);

  const resume = useCallback(() => {
    api.runs.resume({ runId }).catch(() => toast({ title: "Couldn't resume the run. Try again." }));
  }, [runId, toast]);

  const decide = useCallback(
    (input: ApprovalDecisionInput) => {
      setDeciding((s) => new Set(s).add(input.approvalId));
      api.runs.decideApproval(input).catch(() => {
        setDeciding((s) => {
          const next = new Set(s);
          next.delete(input.approvalId);
          return next;
        });
        toast({ title: "Couldn't send your answer. The approval is still waiting for you." });
      });
    },
    [toast],
  );

  const crumbs = [{ label: "Runs", href: "/runs" }, { label: shortRunId(runId) }];
  if (loadError) {
    return (
      <>
        <Toolbar>
          <Crumbs items={crumbs} />
        </Toolbar>
        <div className="wrap run">
          <LoadError
            title="This run couldn't be loaded."
            onRetry={() => window.location.reload()}
          />
        </div>
      </>
    );
  }
  if (!view || !state) {
    return (
      <>
        <Toolbar>
          <Crumbs items={crumbs} />
        </Toolbar>
        <div className="wrap run" aria-busy="true" aria-label="Loading run">
          <Skeleton className="run-skel-head" />
          <Skeleton className="run-skel-frame" />
        </div>
      </>
    );
  }

  const otp =
    view.status === "waiting" && view.waitReason === "otp" ? (
      <ChunkBoundary what="the code box" onFailed={ignoreFailure}>
        <Suspense fallback={null}>
          <OtpCard
            key={`otp-${view.steps.at(-1)?.seq ?? 0}`}
            runId={runId}
            host={hostAndPath(view.currentUrl)?.host ?? "The site"}
          />
        </Suspense>
      </ChunkBoundary>
    ) : null;
  const approval = state === "approval" ? (view.approvals[0] ?? null) : null;
  // One copy per render, shared by the sheet and the frame's spotlight (M8).
  const copy = approval ? approvalCopy(approval.request) : null;
  const thinking = thinkingState(view);
  // At md+ the timeline's ThoughtLine speaks while the agent thinks; the caption would repeat it.
  // Every other state (control, pause, CAPTCHA, stuck, acting) is the caption's to announce (final I1).
  const userHasControl = inControl(view.controller, takeover);
  return (
    <>
      <Toolbar>
        <Crumbs items={crumbs} />
        <ToolbarSpacer />
        <Button
          variant="plain"
          className="run-callout-toggle"
          aria-pressed={callouts}
          onClick={() => setCallouts(!callouts)}
        >
          Callouts
        </Button>
        {userHasControl ? (
          <Button
            variant="primary"
            icon="hand"
            disabled={takeover.phase !== "idle"}
            onClick={() => setHandBackOpen(true)}
          >
            Hand back
          </Button>
        ) : (
          <Button
            icon="hand"
            disabled={!canTakeOver(view, state, takeover)}
            onClick={startTakeover}
          >
            Take over
          </Button>
        )}
        <Button
          variant="plain"
          icon="stop"
          disabled={isTerminal(view.status)}
          onClick={() => setStopOpen(true)}
        >
          Stop
        </Button>
      </Toolbar>
      <div className="wrap run">
        <RunHeader model={view} state={state} />
        <div className="run-body">
          <section className="run-stage" aria-label="Agent browser">
            <BrowserFrame
              runId={runId}
              model={view}
              state={state}
              takeover={takeover}
              replayStep={replayStep}
              replayLabel={replayLabel}
              liveEpoch={liveEpoch}
              liveStatus={liveStatus}
              onLiveStatus={setLiveStatus}
              approval={
                approval && copy ? (
                  <ApprovalSheet
                    key={approval.id}
                    runId={runId}
                    approval={approval}
                    copy={copy}
                    count={view.approvals.length}
                    onDecide={decide}
                    onTakeOver={startTakeover}
                  />
                ) : null
              }
              spotlight={copy?.spotlight ?? null}
              scrubber={
                <ReplayScrubber
                  steps={shotSteps}
                  seq={replaySeq}
                  playing={playing}
                  onSeq={setReplaySeq}
                  onTogglePlay={() => setPlaying((p) => !p)}
                />
              }
              showCallouts={callouts}
              announceCaption={!regular || thinking === null || state !== "live"}
              onHandBack={() => setHandBackOpen(true)}
              onTakeControl={startTakeover}
              onResume={resume}
              onJumpLive={() => {
                setPlaying(false);
                setReplaySeq(null);
              }}
            />
            {regular ? null : otp}
            <BudgetMeters usage={view.usage} budget={view.budget} />
          </section>
          <TimelinePanel
            runId={runId}
            items={items}
            summary={summaryLabel(view)}
            thinking={thinking}
            otp={regular ? otp : null}
            replaySeq={replaySeq}
            onReplay={(seq) => {
              setPlaying(false);
              setReplaySeq(seq);
            }}
            canMessage={!isTerminal(view.status)}
            onSend={send}
          />
        </div>
      </div>
      <HandBackSheet
        open={handBackOpen && userHasControl}
        onOpenChange={setHandBackOpen}
        held={view.heldDownloads}
        onHandBack={(note, keep) => {
          setHandBackOpen(false);
          handBack(note, keep);
        }}
      />
      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title="Stop this run?"
        description="The agent stops now. Everything it captured stays in the draft note."
        confirmLabel="Stop run"
        cancelLabel="Keep running"
        destructive
        onConfirm={stop}
      />
    </>
  );
}
