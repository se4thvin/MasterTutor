import { BYPASS_DECIDER, POLICY_DECIDER } from "@mastertutor/contracts";
import { METRIC } from "@mastertutor/contracts/telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deciderOf,
  recordModelTokens,
  recordRunEvent,
  recordRunFailure,
  recordObserverFailure,
  recordObserverSpend,
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

  it("maps deciders to a class, never a user id, and never counts a machine as a person", async () => {
    expect(deciderOf(POLICY_DECIDER)).toBe("policy");
    expect(deciderOf(BYPASS_DECIDER)).toBe("bypass");
    expect(deciderOf("observer")).toBe("observer");
    expect(deciderOf("agent")).toBe("agent");
    expect(deciderOf("not a user id")).toBe("unknown");
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
    recordSpend(0.25, "run");
    recordSpend(0, "run");
    recordModelTokens("gpt-6-astra", { input: 100, cached: 40, output: 10 });
    recordRunFailure("model_request_rejected");
    expect((await telemetry.metric(METRIC.spendUsd.name))[0]!.value).toBeCloseTo(0.25);
    expect(await telemetry.metric(METRIC.modelTokens.name)).toHaveLength(3);
    expect((await telemetry.metric(METRIC.runFailures.name))[0]!.attributes).toEqual({
      "mt.error.code": "model_request_rejected",
    });
  });

  it("counts guard verdicts by verdict, category and rollout, and spend by purpose", async () => {
    recordRunEvent({
      type: "guard",
      verdict: "block",
      category: "data_exfiltration",
      stage: "review",
      rollout: "enforce",
      applied: true,
      items: 1,
      flows: 1,
    });
    expect(await telemetry.metric(METRIC.observerVerdicts.name)).toEqual([
      {
        value: 1,
        attributes: {
          "mt.observer.verdict": "block",
          "mt.observer.category": "data_exfiltration",
          "mt.observer.rollout": "enforce",
        },
      },
    ]);
    recordSpend(0.5, "copilot");
    expect(await telemetry.metric(METRIC.spendUsd.name)).toEqual([
      { value: 0.5, attributes: { "mt.spend.purpose": "copilot" } },
    ]);
  });

  it("counts observer spend and failures by role, never more", async () => {
    recordObserverSpend("copilot", 0.01);
    recordObserverSpend("guard", 0);
    recordObserverFailure("guard", "timeout");
    expect(await telemetry.metric(METRIC.observerSpend.name)).toEqual([
      { value: 0.01, attributes: { "mt.observer.role": "copilot" } },
    ]);
    expect(await telemetry.metric(METRIC.observerFailures.name)).toEqual([
      { value: 1, attributes: { "mt.observer.role": "guard", "mt.observer.outcome": "timeout" } },
    ]);
  });
});
