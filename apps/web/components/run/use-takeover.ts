"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api } from "@/lib/api/client.ts";
import { errorCode } from "@/lib/api/errors.ts";
import { TAKEOVER_NOTICE, handBackErrorCopy, takeControlErrorCopy } from "./model/copy.ts";
import { latestError, type RunModel } from "./model/run-model.ts";
import {
  IDLE_TAKEOVER,
  takeoverReducer,
  takeoverTimeoutMs,
  type TakeoverState,
} from "./model/takeover.ts";

interface TakeoverControls {
  takeover: TakeoverState;
  takeControl(wake: boolean): void;
  /** `keep` lists the held downloads to keep; null when none were held (the request is unchanged). */
  handBack(note: string | null, keep: readonly string[] | null): void;
}

/**
 * Takeover and hand back (spec §10.3, D19, D27): optimistic in both directions, settled by the
 * agent's events. Each `control` event and `takeover_failed` error is acted on by its event id, so
 * a repeated holder still counts (A6). A hand back that never sees control{agent} re-reads the run.
 */
export function useTakeover(
  runId: string,
  model: RunModel | null,
  resync: () => void,
): TakeoverControls {
  const toast = useToast();
  const [takeover, dispatch] = useReducer(takeoverReducer, IDLE_TAKEOVER);
  const sending = useRef(false);

  const controlId = model?.lastControl?.eventId ?? null;
  const holder = model?.lastControl?.holder ?? null;
  useEffect(() => {
    if (controlId !== null && holder !== null) dispatch({ type: "holder", holder });
  }, [controlId, holder]);

  const error = model ? latestError(model) : null;
  const failedId = error?.code === "takeover_failed" ? error.eventId : null;
  useEffect(() => {
    if (failedId !== null) dispatch({ type: "takeover_failed" });
  }, [failedId]);

  const timeoutMs = takeoverTimeoutMs(takeover);
  const releasing = takeover.phase === "releasing";
  useEffect(() => {
    if (timeoutMs === null) return undefined;
    const timer = setTimeout(() => {
      if (releasing) {
        dispatch({ type: "release_timeout" });
        resync();
      } else {
        dispatch({ type: "timeout" });
      }
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs, releasing, resync]);

  const notice = takeover.notice;
  useEffect(() => {
    if (notice === null) return;
    toast({ title: TAKEOVER_NOTICE[notice] });
    dispatch({ type: "seen" });
  }, [notice, toast]);

  const takeControl = useCallback(
    (wake: boolean) => {
      if (sending.current) return;
      sending.current = true;
      dispatch({ type: "request", wake });
      api.runs
        .takeControl({ runId })
        .catch((failure: unknown) => {
          dispatch({ type: "request_failed" });
          toast({ title: takeControlErrorCopy(errorCode(failure)) });
        })
        .finally(() => {
          sending.current = false;
        });
    },
    [runId, toast],
  );

  const handBack = useCallback(
    (note: string | null, keep: readonly string[] | null) => {
      dispatch({ type: "release" });
      // Every held download not listed in keep is discarded server-side (A11).
      const input = keep === null ? { runId, note } : { runId, note, keep: [...keep] };
      api.runs.handBack(input).catch((failure: unknown) => {
        dispatch({ type: "release_failed" });
        toast({ title: handBackErrorCopy(errorCode(failure)) });
      });
    },
    [runId, toast],
  );

  return { takeover, takeControl, handBack };
}
