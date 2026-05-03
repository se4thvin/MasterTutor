import type { RunDetail, RunEventRecord, RunEvent } from "@mastertutor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api/client.ts";
import { isTerminal } from "../model/run-model.ts";

type StatusEvent = Extract<RunEvent, { type: "status" }>;

/**
 * Keeps other screens' run queries honest from the stream, without polling (delight X6):
 * any status change invalidates every runs.list (the sidebar badge refetches), and a terminal
 * status patches a cached runs.get, so useRunPulse never reads a stale "running" (delight I3).
 */
export function syncRunQueries(
  qc: QueryClient,
  runId: string,
  records: readonly RunEventRecord[],
): void {
  let status: StatusEvent | null = null;
  for (const record of records) {
    if (record.runId === runId && record.event.type === "status") status = record.event;
  }
  if (status === null) return;
  void qc.invalidateQueries({ queryKey: orpc.runs.list.key() });
  if (!isTerminal(status.status)) return;
  const finished = status;
  qc.setQueryData<RunDetail>(orpc.runs.get.queryKey({ input: { runId } }), (old) =>
    old ? { ...old, status: finished.status, waitReason: finished.waitReason } : old,
  );
}
