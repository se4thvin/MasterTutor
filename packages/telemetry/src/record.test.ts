import { BYPASS_DECIDER, POLICY_DECIDER } from "@mastertutor/contracts";
import { METRIC } from "@mastertutor/contracts/telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deciderOf,
  recordModelTokens,
  recordRunEvent,
  recordRunFailure,
  recordSpend,
} from "./record.ts";
import { installTestTelemetry, type TestTelemetry } from "./testing.ts";

const ID = "11111111-1111-4111-8111-111111111111";
let telemetry: TestTelemetry;
beforeEach(() => {
  telemetry = installTestTelemetry();
});
afterEach(async () => {
  await telemetry.shutdown();
});

describe("run event recorders (spec §5.3, seam 6)", () => {
  it("counts terminal statuses only", async () => {
    recordRunEvent({ type: "status", status: "running", waitReason: null, reason: null });
    recordRunEvent({ type: "status", status: "failed", waitReason: null, reason: "x" });
    expect(await telemetry.metric(METRIC.runsEnded.name)).toEqual([
      { value: 1, attributes: { "mt.run.status": "failed" } },
    ]);
  });

  it("maps deciders to person, policy or bypass, never a user id", async () => {
    expect(deciderOf(POLICY_DECIDER)).toBe("policy");
    expect(deciderOf(BYPASS_DECIDER)).toBe("bypass");
    recordRunEvent({
      type: "approval_resolved",
      approvalId: ID,
      status: "approved",
      decidedBy: "user_canary_7f3a",
    });
    const points = await telemetry.metric(METRIC.approvalsResolved.name);
    expect(points[0]!.attributes).toEqual({
      "mt.approval.status": "approved",
      "mt.approval.decider": "person",
    });
    expect(await telemetry.exported()).not.toContain("user_canary_7f3a");
  });

  it("records the approval kind and never the request's text", async () => {
    recordRunEvent({
      type: "approval_requested",
      approvalId: ID,
      request: { kind: "risky_click", label: "Delete account canary-label" } as never,
    });
    expect((await telemetry.metric(METRIC.approvalsRequested.name))[0]!.attributes).toEqual({
      "mt.approval.kind": "risky_click",
    });
    expect(await telemetry.exported()).not.toContain("canary-label");
  });

  it("ignores user messages entirely", async () => {
    recordRunEvent({ type: "user_message", text: "my secret canary note" });
    expect(await telemetry.exported()).not.toContain("canary note");
  });

  it("records downloads by state and size, and error codes normalised", async () => {
    recordRunEvent({
      type: "download_ready",
      downloadId: ID,
      assetId: ID,
      filename: "f.pdf",
      bytes: 2048,
    });
    recordRunEvent({ type: "error", code: "Weird Code", message: "page text canary" });
    expect((await telemetry.metric(METRIC.downloadSize.name))[0]!.value).toBe(2048);
    expect((await telemetry.metric(METRIC.runErrors.name))[0]!.attributes).toEqual({
      "mt.error.code": "unknown_error",
    });
    const exported = await telemetry.exported();
    expect(exported).not.toContain("f.pdf");
    expect(exported).not.toContain("page text canary");
  });

  it("records spend, tokens and failures", async () => {
    recordSpend(0.25);
    recordSpend(0);
    recordModelTokens("gpt-6-astra", { input: 100, cached: 40, output: 10 });
    recordRunFailure("model_request_rejected");
    expect((await telemetry.metric(METRIC.spendUsd.name))[0]!.value).toBeCloseTo(0.25);
    expect(await telemetry.metric(METRIC.modelTokens.name)).toHaveLength(3);
    expect((await telemetry.metric(METRIC.runFailures.name))[0]!.attributes).toEqual({
      "mt.error.code": "model_request_rejected",
    });
  });
});
