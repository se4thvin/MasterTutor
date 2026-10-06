"use client";

import type { RunStatus } from "@mastertutor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { orpc } from "@/lib/api/client.ts";
import { durations } from "@/lib/motion-tokens.ts";
import { finishedIds, flashStatus, type RunFlash } from "@/lib/runs/pulse.ts";

type RunPulse = { status: "running"; count: number } | { status: RunFlash; count: 0 } | null;

/**
 * The Runs nav item's badge: the live count while runs are running, then, when runs leave the
 * running list, their outcome for `durations.flash`. It never polls: whatever refreshes the list
 * (a mount, a reconnect, F3's SSE invalidation) drives it. A run whose details cannot be fetched
 * simply does not flash.
 */
export function useRunPulse(): RunPulse {
  const qc = useQueryClient();
  const live = useQuery(orpc.runs.list.queryOptions({ input: { status: "running", limit: 20 } }));
  const ids = useMemo(() => live.data?.items.map((r) => r.id) ?? null, [live.data]);
  const previous = useRef<readonly string[] | null>(null);
  const [flash, setFlash] = useState<RunFlash | null>(null);

  useEffect(() => {
    if (ids === null) return undefined;
    const gone = previous.current ? finishedIds(previous.current, ids) : [];
    previous.current = ids;
    if (gone.length === 0) return undefined;
    let active = true;
    void Promise.all(
      gone.map((runId) =>
        // staleTime 0: a cached "running" (a Run view open earlier) must not hide the outcome (I3).
        qc.fetchQuery({ ...orpc.runs.get.queryOptions({ input: { runId } }), staleTime: 0 }).then(
          (run): RunStatus | null => run.status,
          () => null,
        ),
      ),
    ).then((statuses) => {
      const next = flashStatus(statuses.filter((s): s is RunStatus => s !== null));
      if (active && next) setFlash(next);
    });
    return () => {
      active = false;
    };
  }, [ids, qc]);

  useEffect(() => {
    if (flash === null) return undefined;
    const timer = setTimeout(() => setFlash(null), durations.flash);
    return () => clearTimeout(timer);
  }, [flash]);

  if (ids && ids.length > 0) return { status: "running", count: ids.length };
  return flash ? { status: flash, count: 0 } : null;
}
