import type { RunDetail, RunSummary } from "@mastertutor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { orpc } from "@/lib/api/client.ts";
import { RECORDED_RUN_ID, rec, recordedDetail } from "@/lib/fixtures/run-recording.ts";
import { syncRunQueries } from "./query-sync.ts";

const getKey = orpc.runs.get.queryKey({ input: { runId: RECORDED_RUN_ID } });
const listKey = orpc.runs.list.queryKey({ input: { status: "running", limit: 20 } });

function seeded() {
  const qc = new QueryClient();
  qc.setQueryData<RunDetail>(getKey, recordedDetail());
  qc.setQueryData(listKey, { items: [] as RunSummary[], nextCursor: null });
  return qc;
}

describe("syncRunQueries (delight X6, I3)", () => {
  it("patches a cached runs.get when the run finishes and invalidates every runs.list", () => {
    const qc = seeded();
    syncRunQueries(qc, RECORDED_RUN_ID, [
      rec({ type: "status", status: "completed", waitReason: null, reason: null }),
    ]);
    expect(qc.getQueryData<RunDetail>(getKey)?.status).toBe("completed");
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("invalidates the lists but leaves runs.get alone for a non-terminal status", () => {
    const qc = seeded();
    syncRunQueries(qc, RECORDED_RUN_ID, [
      rec({ type: "status", status: "waiting", waitReason: "approval", reason: null }),
    ]);
    expect(qc.getQueryData<RunDetail>(getKey)?.status).toBe("running");
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("does nothing for a batch without a status event", () => {
    const qc = seeded();
    syncRunQueries(qc, RECORDED_RUN_ID, [rec({ type: "user_message", text: "hi" })]);
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(false);
  });
});
