import type { RunEvent, RunEventRecord } from "@mastertutor/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  initialWatchState,
  onRecord,
  onTick,
  watchRun,
  type WatchDeps,
  type WatchPolicy,
  type WatchState,
} from "./watch.ts";

const RUN = "33333333-3333-4333-8333-333333333333";
let n = 0;
const rec = (event: RunEvent): RunEventRecord => ({
  id: String(++n),
  runId: RUN,
  at: "2026-10-06T12:00:00.000Z",
  event,
});
const zybooks: WatchPolicy = {
  onBudget: "ask_human",
  onSafetyCheck: "ask_human",
  humanTimeoutMs: 1_200_000,
  stallMs: 600_000,
};
const fixtures: WatchPolicy = {
  onBudget: "finish_now",
  onSafetyCheck: "deny",
  humanTimeoutMs: 1_200_000,
  stallMs: 600_000,
};
const A1 = "44444444-4444-4444-8444-444444444441";
const budget = rec({
  type: "approval_requested",
  approvalId: A1,
  request: {
    kind: "budget",
    exceeded: "usd",
    usage: {
      steps: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usd: 50,
      activeMs: 0,
    },
    budget: { maxSteps: 150, maxUsd: 50, maxActiveMinutes: 60 },
  },
});
const safety = (code: string) =>
  rec({
    type: "approval_requested",
    approvalId: A1,
    request: {
      kind: "risky_click",
      action: { type: "click", x: 1, y: 1, button: "left" },
      label: "Continue",
      url: "https://site.example/x",
      screenshotKey: null,
      safetyChecks: [{ code, message: "m" }],
    },
  });
const status = (
  s: "running" | "waiting" | "completed",
  waitReason: "approval" | "takeover" | null = null,
) => rec({ type: "status", status: s, waitReason, reason: null });
const apply = (s: WatchState, r: RunEventRecord, at: number, p = zybooks) => onRecord(s, r, at, p);

describe("watcher decisions", () => {
  it("ends a budget hit at once for fixtures, but leaves it to a person for zyBooks (D46)", () => {
    expect(apply(initialWatchState(0), budget, 1, fixtures).commands).toContainEqual({
      type: "decide_budget",
      approvalId: A1,
    });
    const z = apply(initialWatchState(0), budget, 1, zybooks);
    expect(z.commands.filter((c) => c.type !== "log")).toEqual([]);
    expect(z.state.budgetHit).toBe(true);
  });

  it("never approves a safety check: deny for fixtures, a person for zyBooks (D44)", () => {
    // A check stops the run only once the run waits on it for a person.
    const waiting = status("waiting", "approval");
    let f = apply(initialWatchState(0), safety("malicious_instructions"), 1, fixtures);
    expect(f.commands.filter((c) => c.type !== "log")).toEqual([]);
    f = apply(f.state, waiting, 2, fixtures);
    expect(f.commands).toContainEqual({ type: "deny_approval", approvalId: A1 });
    let z = apply(initialWatchState(0), safety("malicious_instructions"), 1, zybooks);
    z = apply(z.state, waiting, 2, zybooks);
    expect(z.commands.filter((c) => c.type !== "log")).toEqual([]);
    expect(z.state.safetyChecks).toEqual(["malicious_instructions"]);
  });

  it("denies a person-wait check at once in either event order: no 60 s sleep or 20 min timeout (N3)", () => {
    const waiting = status("waiting", "approval");
    const orders = {
      // The store's order (StepStore.#write): the status transition before the commit's events.
      "status first": [waiting, safety("malicious_instructions")],
      "request first": [safety("malicious_instructions"), waiting],
    };
    for (const [name, [first, second]] of Object.entries(orders)) {
      const at = 1_000;
      const a = apply(initialWatchState(0), first!, at, fixtures);
      const b = apply(a.state, second!, at, fixtures);
      const denies = [...a.commands, ...b.commands].filter((c) => c.type === "deny_approval");
      expect(denies, name).toEqual([{ type: "deny_approval", approvalId: A1 }]);
      expect(b.commands, name).toContainEqual({ type: "deny_approval", approvalId: A1 });
      expect(b.state.safetyChecks, name).toEqual(["malicious_instructions"]);
      expect(b.state.pendingSafetyChecks, name).toEqual({});
      // Nothing more on a later tick: the deny did not wait for a timer.
      expect(onTick(b.state, at + 1, fixtures).commands, name).toEqual([]);
    }
  });

  it("logs a check the bypass policy approved as auto_approved, never as a stop (I4)", () => {
    const resolved = rec({
      type: "approval_resolved",
      approvalId: A1,
      status: "approved",
      decidedBy: "bypass",
    });
    for (const policy of [zybooks, fixtures]) {
      const requested = apply(initialWatchState(0), safety("irrelevant_domain"), 1, policy);
      const after = apply(requested.state, resolved, 1, policy);
      expect([...requested.commands, ...after.commands].filter((c) => c.type !== "log")).toEqual(
        [],
      );
      expect(after.state.safetyChecks).toEqual([]);
      expect(after.state.autoApprovedSafetyChecks).toEqual(["irrelevant_domain"]);
      expect(after.commands).toContainEqual({
        type: "log",
        line: "safety check irrelevant_domain auto_approved (decided_by=bypass)",
      });
      // A later wait for something else does not turn it into a stop.
      expect(
        apply(after.state, status("waiting", "takeover"), 2, policy).state.safetyChecks,
      ).toEqual([]);
    }
  });

  it("treats an approval wait as a human wait with the timeout (X12)", () => {
    let s = apply(initialWatchState(0), status("running"), 0).state;
    s = apply(s, safety("malicious_instructions"), 5).state;
    s = apply(s, status("waiting", "approval"), 10).state;
    expect(onTick(s, 10 + 1_199_000, zybooks).commands).toEqual([]);
    expect(onTick(s, 10 + 1_200_001, zybooks).commands).toContainEqual({
      type: "cancel",
      reason: "human_timeout",
    });
  });

  it("counts takeovers and pauses the human timer while the user holds control (P10a-18)", () => {
    let s = apply(initialWatchState(0), status("waiting", "takeover"), 10).state;
    s = apply(s, rec({ type: "control", holder: "user" }), 20).state;
    expect(s.takeovers).toBe(1);
    expect(onTick(s, 10 * 3_600_000, zybooks).commands).toEqual([]);
    s = apply(s, rec({ type: "control", holder: "agent" }), 5_000_000).state;
    expect(onTick(s, 5_000_000 + 1_199_000, zybooks).commands).toEqual([]);
    expect(onTick(s, 5_000_000 + 1_200_001, zybooks).commands).toContainEqual({
      type: "cancel",
      reason: "human_timeout",
    });
  });

  it("keeps the human timer running when a waiting run is parked as sleeping", () => {
    let s = apply(initialWatchState(0), status("waiting", "takeover"), 10).state;
    s = apply(
      s,
      rec({ type: "status", status: "sleeping", waitReason: null, reason: null }),
      60_000,
    ).state;
    expect(s.humanWait).toBe("takeover");
    expect(onTick(s, 10 + 1_199_000, zybooks).commands).toEqual([]);
    expect(onTick(s, 10 + 1_200_001, zybooks).commands).toContainEqual({
      type: "cancel",
      reason: "human_timeout",
    });
  });

  it("clears a pending approval when it resolves", () => {
    let s = apply(initialWatchState(0), safety("irrelevant_domain"), 1).state;
    expect(s.pendingApprovals).toEqual([A1]);
    s = apply(
      s,
      rec({ type: "approval_resolved", approvalId: A1, status: "approved", decidedBy: "bypass" }),
      2,
    ).state;
    expect(s.pendingApprovals).toEqual([]);
  });

  it("cancels a stalled running run exactly once", () => {
    const s = apply(initialWatchState(0), status("running"), 0).state;
    const stalled = onTick(s, 600_001, zybooks);
    expect(stalled.commands).toContainEqual({ type: "cancel", reason: "stall" });
    expect(
      onTick(stalled.state, 700_000, zybooks).commands.filter((c) => c.type === "cancel"),
    ).toEqual([]);
  });

  it("finishes on a terminal status", () => {
    expect(apply(initialWatchState(0), status("completed"), 5).state.done).toBe(true);
  });
});

describe("watchRun", () => {
  function fakeStream() {
    const queue: RunEventRecord[] = [];
    let wake: (() => void) | null = null;
    return {
      push(record: RunEventRecord) {
        queue.push(record);
        wake?.();
      },
      async *stream(_runId: string, signal: AbortSignal): AsyncGenerator<RunEventRecord> {
        while (!signal.aborted) {
          const next = queue.shift();
          if (next) yield next;
          else await new Promise<void>((resolve) => (wake = resolve));
        }
      },
    };
  }

  it("cancels at the total spend cap while watching, and survives a rejected command (P10a-19)", async () => {
    const events = fakeStream();
    const lines: string[] = [];
    const cancel = vi.fn(async () => {
      events.push(status("completed"));
      throw new Error("network blip");
    });
    const deps: WatchDeps = {
      api: { runs: { cancel, decideApproval: vi.fn() } } as unknown as WatchDeps["api"],
      baseUrl: "http://x",
      cookie: "c",
      log: (line) => lines.push(line),
      now: () => Date.now(),
      stream: events.stream,
      tickMs: 5,
      spendPollMs: 5,
      spendCapReached: async () => true,
    };
    events.push(status("running"));
    const state = await watchRun(deps, RUN, zybooks);
    expect(cancel).toHaveBeenCalledWith({ runId: RUN });
    expect(state.spendCapHit).toBe(true);
    expect(state.done).toBe(true);
    expect(lines.some((line) => line.includes("network blip"))).toBe(true);
  });
});
