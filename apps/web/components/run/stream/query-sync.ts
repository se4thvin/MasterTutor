import type { RunDetail, RunEventRecord, RunEvent } from "@mastertutor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api/client.ts";
import { isTerminal } from "../model/run-model.ts";

type StatusEvent = Extract<RunEvent, { type: "status" }>;

/**
 * Keeps other screens' run queries honest from the stream, without polling (delight X6):
 * any status or title change invalidates every runs.list (the sidebar badge refetches), and a terminal
 * status patches a cached runs.get, so useRunPulse never reads a stale "running" (delight I3).
 */
export function syncRunQueries(
  qc: QueryClient,
  runId: string,
  records: readonly RunEventRecord[],
): void {
  let status: StatusEvent | null = null;
  let titled = false;
  for (const record of records) {
    if (record.runId !== runId) continue;
    if (record.event.type === "status") status = record.event;
    titled ||= record.event.type === "title";
  }
  if (status === null && !titled) return;
  void qc.invalidateQueries({ queryKey: orpc.runs.list.key() });
  if (status === null) return;
  if (!isTerminal(status.status)) return;
  const finished = status;
  qc.setQueryData<RunDetail>(orpc.runs.get.queryKey({ input: { runId } }), (old) =>
    old ? { ...old, status: finished.status, waitReason: finished.waitReason } : old,
  );
}
