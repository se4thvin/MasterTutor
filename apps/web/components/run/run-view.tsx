"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { api } from "@/lib/api/client.ts";
import { BrowserFrame } from "./browser/browser-frame.tsx";
import type { ApprovalDecisionInput } from "@mastertutor/contracts";
import { ApprovalSheet } from "./approval/approval-sheet.tsx";
import { approvalCopy } from "./model/approval-copy.ts";
import { HandBackSheet } from "./browser/hand-back-sheet.tsx";
import type { LiveStatus } from "./browser/live-frame.tsx";
import { canTakeOver, deriveBrowserState } from "./model/browser-state.ts";
import { INFO_ERROR_COPY, shortRunId } from "./model/copy.ts";
import { isInformational, latestError, type RunModel } from "./model/run-model.ts";
import { inControl } from "./model/takeover.ts";
import { RunHeader } from "./run-header.tsx";
import { useRun } from "./stream/use-run.ts";
import { useTakeover } from "./use-takeover.ts";

export function RunView({ runId }: { runId: string; viewerId: string | null }) {
  const toast = useToast();
  const { model, connection, loadError, resync } = useRun(runId);
  const { takeover, takeControl, handBack } = useTakeover(runId, model, resync);
  const [replaySeq, setReplaySeq] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("off");
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [deciding, setDeciding] = useState<ReadonlySet<string>>(() => new Set());

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

  const userHasControl = inControl(view.controller, takeover);
  return (
    <>
      <Toolbar>
        <Crumbs items={crumbs} />
        <ToolbarSpacer />
        {/* toolbar-extra */}
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
                state === "approval" && view.approvals[0] ? (
                  <ApprovalSheet
                    key={view.approvals[0].id}
                    runId={runId}
                    approval={view.approvals[0]}
                    count={view.approvals.length}
                    onDecide={decide}
                    onTakeOver={startTakeover}
                  />
                ) : null
              }
              spotlight={
                state === "approval" && view.approvals[0]
                  ? approvalCopy(view.approvals[0].request).spotlight
                  : null
              }
              showCallouts
              onHandBack={() => setHandBackOpen(true)}
              onTakeControl={startTakeover}
              onResume={resume}
              onJumpLive={() => setReplaySeq(null)}
            />
          </section>
        </div>
      </div>
      <HandBackSheet
        open={handBackOpen && userHasControl}
        onOpenChange={setHandBackOpen}
        onHandBack={(note) => {
          setHandBackOpen(false);
          handBack(note);
        }}
      />
      {/* page-extra */}
    </>
  );
}
