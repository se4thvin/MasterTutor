"use client";

import type { RunDetail, RunEventRecord, RunStepView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { Connection } from "../model/browser-state.ts";
import {
  applyRunEvents,
  initRunModel,
  isTerminal,
  syncRunModel,
  type RunModel,
} from "../model/run-model.ts";
import { syncRunQueries } from "./query-sync.ts";
import { connectRunEvents } from "./run-events.ts";
import { scheduleFlush } from "./schedule.ts";

const STEP_PAGE = 500;

type Action =
  | { type: "init"; model: RunModel }
  | { type: "events"; records: RunEventRecord[] }
  | { type: "sync"; detail: RunDetail };

function reducer(state: RunModel | null, action: Action): RunModel | null {
  if (action.type === "init") return action.model;
  if (state === null) return null;
  return action.type === "events"
    ? applyRunEvents(state, action.records)
    : syncRunModel(state, action.detail);
}

async function loadAllSteps(runId: string): Promise<RunStepView[]> {
  const all: RunStepView[] = [];
  let afterSeq: number | null = null;
  for (;;) {
    const { items } = await api.runs.steps({ runId, afterSeq, limit: STEP_PAGE });
    all.push(...items);
    const last = items.at(-1);
    if (items.length < STEP_PAGE || !last) return all;
    afterSeq = last.seq;
  }
}

interface RunHandle {
  model: RunModel | null;
  connection: Connection;
  loadError: boolean;
  /** Re-reads runs.get and settles controller, status and slot on it (A6). */
  resync(): void;
}

/**
 * Snapshot (runs.get + runs.steps), then the SSE stream from the snapshot's lastEventId. Records
 * are applied once per animation frame: a policy's approval_requested + approval_resolved pair
 * lands in one render, so the sheet never mounts and never steals focus (A9).
 */
export function useRun(runId: string): RunHandle {
  const qc = useQueryClient();
  const [model, dispatch] = useReducer(reducer, null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [loadError, setLoadError] = useState(false);
  const [after, setAfter] = useState<{ id: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.runs.get({ runId }), loadAllSteps(runId)]).then(
      ([detail, steps]) => {
        if (cancelled) return;
        dispatch({ type: "init", model: initRunModel(detail, steps) });
        setAfter({ id: detail.lastEventId });
      },
      () => {
        if (!cancelled) setLoadError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const terminal = model !== null && isTerminal(model.status);
  useEffect(() => {
    if (after === null || terminal) return undefined;
    let queue: RunEventRecord[] = [];
    let pending = false;
    let closed = false;
    const flush = () => {
      pending = false;
      if (closed) return;
      const records = queue;
      queue = [];
      if (records.length === 0) return;
      dispatch({ type: "events", records });
      syncRunQueries(qc, runId, records);
    };
    const stream = connectRunEvents({
      runId,
      after: after.id,
      onRecord: (record) => {
        queue.push(record);
        if (!pending) {
          pending = true;
          scheduleFlush(flush);
        }
      },
      onConnection: setConnection,
      // After 3 refused reopens, runs.get through the RPC link says why: UNAUTHORIZED ends the
      // session (R29-4 interceptor); 401/403/404 end this view; a 5xx keeps retrying.
      // A detail it reads is applied too: a run that finished meanwhile settles and stops (M7).
      probe: () => api.runs.get({ runId }).then((detail) => dispatch({ type: "sync", detail })),
      onFailure: () => setLoadError(true),
    });
    return () => {
      stream.close();
      flush();
      closed = true;
    };
  }, [runId, after, terminal, qc]);

  const resync = useCallback(() => {
    api.runs.get({ runId }).then(
      (detail) => dispatch({ type: "sync", detail }),
      () => undefined,
    );
  }, [runId]);

  return { model, connection, loadError, resync };
}
