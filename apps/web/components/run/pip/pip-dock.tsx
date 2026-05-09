"use client";

import { usePathname } from "next/navigation";
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { MEDIA } from "@/lib/breakpoints.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { forgetWatchedRun, watchedRun } from "./watching.ts";

/** The PiP (stream, live frame, motion) loads only when there is a run to watch: off every route's first load. */
const RunPip = lazy(() => import("./run-pip.tsx").then((mod) => ({ default: mod.RunPip })));

export function PipDock() {
  const pathname = usePathname();
  const regular = useMediaQuery(MEDIA.md);
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    setRunId(watchedRun());
  }, [pathname]);
  const gone = useCallback(() => {
    if (runId) forgetWatchedRun(runId);
    setRunId(null);
  }, [runId]);
  // Never over a run's own page, this run's or another's: one stream at a time per view (M3).
  if (!regular || !runId || pathname.startsWith("/runs/") || pathname === "/new") return null;
  return (
    <Suspense fallback={null}>
      <RunPip key={runId} runId={runId} onGone={gone} />
    </Suspense>
  );
}
