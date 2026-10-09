import { EMPTY_USAGE, type RunEvent, type TrajectoryDigest } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import type { RunSnapshot } from "../../loop/run-state.ts";
import type { GuardReviewer } from "./reviewer.ts";
import { TrajectoryWatcher } from "./watcher.ts";

const RUN: RunSnapshot = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  goal: "Notes",
  title: null,
  model: "m",
  approvalMode: "bypass",
  observerMode: "enforce",
  toolProfile: "browser_use",
  budget: { maxSteps: 1, maxUsd: 1, maxActiveMinutes: 1 },
  usage: EMPTY_USAGE,
  allowedOrigins: [],
  plan: null,
  noteId: null,
};
const acts = (n: number): RunEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    type: "step",
    seq: i,
    phase: "act",
    state: "done",
    caption: null,
    url: `https://h${i}.test/`,
    screenshotKey: null,
    action: { tool: "computer", summary: "x", point: null },
  }));
const reviewer = (
  verdict: "allow" | "escalate",
  fail = false,
  seen: TrajectoryDigest[] = [],
): GuardReviewer => ({
  review: async () => {
    throw new Error("unused");
  },
  async reviewTrajectory(digest) {
    seen.push(digest);
    return {
      verdict: {
        verdict,
        category: "goal_drift",
        stage: "review",
        itemKeys: [],
        rationale: "Wandering.",
      },
      usage: { ...EMPTY_USAGE, usd: 0.003 },
      latencyMs: 5,
      failure: fail ? "error" : null,
    };
  },
});

describe("TrajectoryWatcher (spec §6.9)", () => {
  it("sets a hold on an escalation, charged once at the next boundary", async () => {
    const w = new TrajectoryWatcher({ run: RUN, reviewer: reviewer("escalate"), redact: (t) => t });
    w.ingest(acts(5));
    await w.settled();
    expect(w.takeHold()).toMatchObject({ verdict: "escalate", category: "goal_drift" });
    expect(w.takeHold()).toBeNull();
    expect(w.takeUsage()?.usd).toBe(0.003);
    expect(w.takeEvent()).toMatchObject({ type: "guard", verdict: "escalate", applied: true });
    expect(w.riskLevel).toBe("elevated");
  });
  it("fails open: a failed review sets no hold", async () => {
    const w = new TrajectoryWatcher({
      run: RUN,
      reviewer: reviewer("escalate", true),
      redact: (t) => t,
    });
    w.ingest(acts(5));
    await w.settled();
    expect(w.takeHold()).toBeNull();
  });
  it("records only in shadow", async () => {
    const w = new TrajectoryWatcher({
      run: { ...RUN, observerMode: "shadow" },
      reviewer: reviewer("escalate"),
      redact: (t) => t,
    });
    w.ingest(acts(5));
    await w.settled();
    expect(w.takeHold()).toBeNull();
    expect(w.takeEvent()).toMatchObject({ applied: false, rollout: "shadow" });
  });
});

it("reviews a detector hit that arrives while another review is in flight", async () => {
  const seen: TrajectoryDigest[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = reviewer("allow", false, seen);
  let first = true;
  const w = new TrajectoryWatcher({
    run: RUN,
    redact: (t) => t,
    reviewer: {
      ...base,
      async reviewTrajectory(digest, signal) {
        if (first) {
          first = false;
          await gate;
        }
        return base.reviewTrajectory(digest, signal);
      },
    },
  });
  w.ingest(acts(5));
  const denied: RunEvent = {
    type: "approval_resolved",
    approvalId: "00000000-0000-4000-8000-000000000001",
    status: "denied",
    decidedBy: "user-1",
  };
  w.ingest([denied, denied]);
  release();
  await w.settled();
  expect(seen).toHaveLength(2);
  expect(seen[1]?.signals).toContain("person_denials");
  expect(w.takeUsage()?.usd).toBe(0.006);
  expect(w.takeEvent()).not.toBeNull();
  expect(w.takeEvent()).not.toBeNull();
  expect(w.takeEvent()).toBeNull();
});

it("uses the current mode and allowed origins in a trajectory review", async () => {
  const seen: TrajectoryDigest[] = [];
  const w = new TrajectoryWatcher({
    run: RUN,
    reviewer: reviewer("allow", false, seen),
    redact: (t) => t,
  });
  w.updateContext("ask", ["https://approved.test"]);
  w.ingest(acts(5));
  await w.settled();
  expect(seen[0]).toMatchObject({ mode: "ask", allowedOrigins: ["https://approved.test"] });
});
