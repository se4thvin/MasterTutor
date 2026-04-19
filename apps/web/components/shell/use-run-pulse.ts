"use client";

import type { RunStatus } from "@mastertutor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { orpc } from "@/lib/api/client.ts";
import { durations } from "@/lib/motion-tokens.ts";
import { finishedIds, flashStatus, type RunFlash } from "@/lib/runs/pulse.ts";

type Shown = { status: "running"; count: number } | { status: RunFlash; count: 0 };
/** `leaving`: the badge fades out (CSS) before it unmounts, instead of vanishing. */
type RunPulse = (Shown & { leaving?: boolean }) | null;

/** Runs that left the running list and whose outcome is still being fetched. */
type Settling = { ids: readonly string[]; count: number };

/**
 * The Runs nav item's badge: the live count while runs are running, then, when runs leave the
 * running list, their outcome for `durations.flash`. It never polls: whatever refreshes the list
 * (a mount, a reconnect, F3's SSE invalidation) drives it. A run whose details cannot be fetched
 * simply does not flash.
 *
 * While outcomes are fetched the badge keeps its running state, so the one StatusMark morphs in
 * place from the dot to the outcome (no unmount, no gap). A batch that finishes during an earlier
 * fetch joins it and every pending run is fetched again, so a failure is never dropped.
 */
export function useRunPulse(): RunPulse {
  const qc = useQueryClient();
  const live = useQuery(orpc.runs.list.queryOptions({ input: { status: "running", limit: 20 } }));
  const ids = useMemo(() => live.data?.items.map((r) => r.id) ?? null, [live.data]);
  const [seen, setSeen] = useState<readonly string[] | null>(null);
  const [settling, setSettling] = useState<Settling | null>(null);
  const [flash, setFlash] = useState<RunFlash | null>(null);

  // Adjusted while rendering (not in an effect), so no frame renders between the two states.
  if (ids !== null && ids !== seen) {
    setSeen(ids);
    const gone = seen ? finishedIds(seen, ids) : [];
    if (seen && gone.length > 0) {
      const count = seen.length;
      setSettling((s) => ({
        ids: [...(s?.ids ?? []), ...gone],
        count: Math.max(s?.count ?? 0, count),
      }));
    }
  }

  useEffect(() => {
    if (settling === null) return undefined;
    let active = true;
    void Promise.all(
      settling.ids.map((runId) =>
        // staleTime 0: a cached "running" (a Run view open earlier) must not hide the outcome (I3).
        qc.fetchQuery({ ...orpc.runs.get.queryOptions({ input: { runId } }), staleTime: 0 }).then(
          (run): RunStatus | null => run.status,
          () => null,
        ),
      ),
    ).then((statuses) => {
      // A newer batch replaced this one and refetches every pending run, this one's included.
      if (!active) return;
      setFlash(flashStatus(statuses.filter((s): s is RunStatus => s !== null)));
      setSettling(null);
    });
    return () => {
      active = false;
    };
  }, [settling, qc]);

  useEffect(() => {
    if (flash === null) return undefined;
    const timer = setTimeout(() => setFlash(null), durations.flash);
    return () => clearTimeout(timer);
  }, [flash]);

  const current: Shown | null =
    ids && ids.length > 0
      ? { status: "running", count: ids.length }
      : settling
        ? { status: "running", count: settling.count }
        : flash
          ? { status: flash, count: 0 }
          : null;
  // The last badge shown, kept for one fade when the badge clears.
  const [last, setLast] = useState<Shown | null>(null);
  if (current && (current.status !== last?.status || current.count !== last.count)) {
    setLast(current);
  }
  const leaving = current === null && last !== null;
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => setLast(null), durations.base);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (current) return current;
  return last ? { ...last, leaving: true } : null;
}
