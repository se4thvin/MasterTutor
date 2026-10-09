import { EMPTY_USAGE, type GuardInput, type GuardVerdict } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import type { RunSnapshot } from "../../loop/run-state.ts";
import type { TargetDescription } from "../../browser/page-helpers.ts";
import { createStepGuard } from "./guard.ts";
import type { GuardReviewer } from "./reviewer.ts";
import type { SeenItem } from "./types.ts";

const RUN: RunSnapshot = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  goal: "Take notes on chapter 4",
  title: null,
  model: "gpt-6-astra",
  approvalMode: "bypass",
  observerMode: "enforce",
  toolProfile: "browser_use",
  budget: { maxSteps: 100, maxUsd: 5, maxActiveMinutes: 60 },
  usage: EMPTY_USAGE,
  allowedOrigins: ["https://a.test"],
  plan: null,
  noteId: null,
};
const button: TargetDescription = {
  label: "Buy now",
  tag: "button",
  path: "p",
  context: "c",
  isFormSubmit: false,
  formKind: null,
  isSecretField: false,
  editable: false,
  interactive: true,
};
const click: SeenItem = {
  item: "c1#0",
  callId: "c1",
  index: 0,
  action: { type: "click", x: 1, y: 1, button: "left" },
  tool: null,
  args: null,
  target: button,
  request: null,
  policy: null,
};
const turn = (seen: SeenItem[] = [click]) => ({
  seen,
  pageOrigin: "https://b.test",
  allowedOrigins: ["https://a.test"],
  loopHits: 0,
  label: () => ({ provenance: "none", sourceOrigin: null, chars: 0 }) as const,
});
const fakeReviewer = (verdict: Partial<GuardVerdict>, seen: GuardInput[] = []): GuardReviewer => ({
  async review(input) {
    seen.push(input);
    return {
      verdict: {
        verdict: "allow",
        category: "other",
        stage: "review",
        itemKeys: [],
        rationale: "",
        ...verdict,
      },
      usage: { ...EMPTY_USAGE, usd: 0.002 },
      latencyMs: 10,
      failure: null,
    };
  },
  reviewTrajectory: async () => {
    throw new Error("not in this test");
  },
});
const guard = (
  verdict: Partial<GuardVerdict>,
  options: {
    mode?: "ask" | "bypass";
    rollout?: "shadow" | "enforce";
    redact?: (t: string) => string;
    inputs?: GuardInput[];
  } = {},
) =>
  createStepGuard({
    run: {
      ...RUN,
      approvalMode: options.mode ?? "bypass",
      observerMode: options.rollout ?? "enforce",
    },
    reviewer: fakeReviewer(verdict, options.inputs),
    redact: options.redact ?? ((t) => t),
    ledger: { consecutive: 0, total: 0 },
  });
const signal = () => new AbortController().signal;

describe("StepGuard (spec §6.5–§6.8)", () => {
  it("skips a turn with no trigger: no review, no event", async () => {
    const inputs: GuardInput[] = [];
    const g = guard({ verdict: "block" }, { inputs });
    const result = await g.review({ ...turn(), pageOrigin: "https://a.test" }, signal());
    expect(inputs).toEqual([]);
    expect(result.event).toBeNull();
  });
  it("denies a blocked item in bypass and counts it in the ledger", async () => {
    const result = await guard({
      verdict: "block",
      category: "destructive_or_financial",
      itemKeys: ["i1"],
    }).review(turn(), signal());
    expect(result.outcomes.get("c1#0")).toMatchObject({ effect: "deny", verdict: "block" });
    expect(result.event).toMatchObject({
      type: "guard",
      verdict: "block",
      applied: true,
      rollout: "enforce",
    });
    expect(result.review).toMatchObject({ consecutive: 1, total: 1, applied: true });
    expect(result.usage.usd).toBe(0.002);
  });
  it("asks instead of denying in ask mode (a person may override)", async () => {
    const result = await guard({ verdict: "block", itemKeys: ["i1"] }, { mode: "ask" }).review(
      turn(),
      signal(),
    );
    expect(result.outcomes.get("c1#0")?.effect).toBe("ask");
  });
  it("records but changes nothing in shadow", async () => {
    const result = await guard(
      { verdict: "block", itemKeys: ["i1"] },
      { rollout: "shadow" },
    ).review(turn(), signal());
    expect(result.outcomes.size).toBe(0);
    expect(result.event).toMatchObject({ verdict: "block", applied: false, rollout: "shadow" });
  });
  it("sends nothing and escalates when the input would leak a secret", async () => {
    const inputs: GuardInput[] = [];
    const g = guard(
      { verdict: "allow" },
      { inputs, redact: (t) => t.replaceAll("chapter", "[secret]") },
    );
    const result = await g.review(turn(), signal());
    expect(inputs).toEqual([]);
    expect(result.outcomes.get("c1#0")).toMatchObject({
      effect: "ask",
      category: "guard_unavailable",
    });
  });
  it("asks a run-level denial_limit hold once 3 turns in a row were blocked", async () => {
    const g = guard({ verdict: "block", itemKeys: ["i1"] });
    for (let i = 0; i < 3; i++)
      await g.review({ ...turn(), pageOrigin: `https://b${i}.test` }, signal());
    const result = await g.review({ ...turn(), pageOrigin: "https://b9.test" }, signal());
    expect(result.limit).toBe(true);
    expect(result.event).toMatchObject({
      verdict: "escalate",
      category: "denial_limit",
      stage: "rules",
    });
    expect(g.personCleared()).toEqual({ consecutive: 0, total: 0 });
  });
});

it("ends a consecutive-block streak on an untriggered turn and retains the total", async () => {
  const g = guard({ verdict: "block" });
  await g.review(turn(), signal());
  const quiet = await g.review({ ...turn(), pageOrigin: "https://a.test" }, signal());
  expect(quiet.event).toBeNull();
  expect(quiet.review).toMatchObject({ consecutive: 0, total: 1 });
  const next = await g.review({ ...turn(), pageOrigin: "https://new.test" }, signal());
  expect(next.review).toMatchObject({ consecutive: 1, total: 2 });
});

it("uses the current approval mode after a switch", async () => {
  const g = guard({ verdict: "block" });
  const result = await g.review({ ...turn(), mode: "ask" }, signal());
  expect(result.outcomes.get("c1#0")?.effect).toBe("ask");
  expect(result.review?.input?.mode).toBe("ask");
});

it("counts only observer blocks actually applied by the loop", async () => {
  const g = guard({ verdict: "block" });
  const result = await g.review(turn(), signal());
  g.recordApplied(result, { blocked: 0, asked: false });
  expect(result.review).toMatchObject({ consecutive: 0, total: 0, applied: false });
});
