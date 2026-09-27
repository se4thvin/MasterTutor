import { METRIC } from "@mastertutor/contracts/telemetry";
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "../testing.ts";
import { emitRunEvent } from "./events.ts";

let database: TestDatabase;
let owner: DbHandle;
let telemetry: TestTelemetry;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  telemetry = installTestTelemetry();
});
afterAll(async () => {
  await telemetry?.shutdown();
  await owner?.close();
  await database?.stop();
});

describe("emitRunEvent records product metrics (seam 6)", () => {
  it("counts approvals and run endings from the events both apps write", async () => {
    const { workspaceId } = await seedMember(owner.db);
    const runId = await seedRun(owner.db, { workspaceId });
    await owner.db.transaction(async (tx) => {
      await emitRunEvent(tx, runId, {
        type: "approval_requested",
        approvalId: "11111111-1111-4111-8111-111111111111",
        request: { kind: "download", url: "https://a.example/f.pdf", filename: "f.pdf" } as never,
      });
      await emitRunEvent(tx, runId, {
        type: "status",
        status: "completed",
        waitReason: null,
        reason: null,
      });
    });
    expect((await telemetry.metric(METRIC.approvalsRequested.name))[0]!.attributes).toEqual({
      "mt.approval.kind": "download",
    });
    expect((await telemetry.metric(METRIC.runsEnded.name))[0]!.attributes).toEqual({
      "mt.run.status": "completed",
    });
    expect(await telemetry.exported()).not.toContain("f.pdf");
  });
});
