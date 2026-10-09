import { describe, expect, it } from "vitest";
import { GUARD_BLOCKED_NOTE } from "@mastertutor/contracts";
import { createOpenAI } from "../llm/openai.ts";
import { createGuardReviewer } from "../guardrails/observer/reviewer.ts";
import { createStepGuardFactory } from "../guardrails/observer/guard.ts";
import {
  approvalRows,
  click,
  decideApproval,
  done,
  doneExpecting,
  drive,
  harness,
  risky,
} from "./testing/loop-harness.ts";

import type { StepGuard, StepGuardFactory } from "../guardrails/observer/types.ts";
import type { RunLoop } from "./run-loop.ts";

const h = harness();
const liveGuards = new Map<string, StepGuard>();
const guards = (): StepGuardFactory => {
  const factory = createStepGuardFactory({
    reviewer: createGuardReviewer(createOpenAI({ apiKey: "k", baseURL: `${h.mock.url}/v1` })),
  });
  return {
    async forRun(run, deps) {
      const guard = await factory.forRun(run, deps);
      liveGuards.set(run.id, guard);
      return guard;
    },
  };
};
async function driveGuard(loop: RunLoop) {
  for (let i = 0; i < 60; i++) {
    const outcome = await loop.step(new AbortController().signal);
    await liveGuards.get(loop.run.id)?.settled?.();
    if (outcome.kind !== "continue") return outcome;
  }
  throw new Error("the loop did not stop");
}
const answer = (screen: "allow" | "review", review?: Record<string, unknown>) => {
  h.mock.setStructured("guard_screen", () => ({ decision: screen }));
  h.mock.setStructured(
    "guard_review",
    () => review ?? { verdict: "allow", category: "other", itemKeys: [], rationale: "" },
  );
};
/** Every click lands on a risky "Buy now" button, so each turn is a risky_item the Guard reviews. */
const riskyAt = (browser: { targets: Map<string, unknown> }, ...xs: number[]) => {
  for (const x of xs) browser.targets.set(`${x},20`, risky("Buy now", `button:${x}`));
};

describe("the Guard in the run loop (spec §6)", () => {
  it("deny-and-continue in bypass: the click never runs, the agent gets the fixed note, the row says observer", async () => {
    answer("review", {
      verdict: "block",
      category: "destructive_or_financial",
      itemKeys: ["i1"],
      rationale: "Buys something.",
    });
    const s = await h.setup([click(), doneExpecting(GUARD_BLOCKED_NOTE)], {
      approvalMode: "bypass",
      observerMode: "enforce",
      guards: guards(),
    });
    riskyAt(s.browser, 10);
    expect((await drive(s.loop)).kind).toBe("completed");
    expect(s.browser.executed).toEqual([]);
    const [row] = await approvalRows(s.run.id);
    expect(row).toMatchObject({ kind: "observer", status: "denied", decidedBy: "observer" });
    expect(JSON.stringify(h.mock.requests.at(-1)!.body.input)).not.toContain("Buys something");
  });

  it("an escalation pauses a bypass run; a person's approval lets exactly that click run", async () => {
    answer("review", {
      verdict: "escalate",
      category: "unexpected_origin",
      itemKeys: ["i1"],
      rationale: "Off the goal.",
    });
    const s = await h.setup([click(), done()], {
      approvalMode: "bypass",
      observerMode: "enforce",
      guards: guards(),
    });
    riskyAt(s.browser, 10);
    expect(await drive(s.loop)).toEqual({ kind: "waiting", reason: "approval" });
    const [pending] = await approvalRows(s.run.id);
    expect(pending).toMatchObject({ kind: "observer", status: "pending" });
    await decideApproval(s.run.id, "approved");
    await s.loop.resume(new AbortController().signal);
    expect((await drive(s.loop)).kind).toBe("completed");
    expect(s.browser.executed).toHaveLength(1);
  });

  it("in ask mode a block is a card with the verdict, which a person may approve anyway", async () => {
    answer("review", {
      verdict: "block",
      category: "goal_drift",
      itemKeys: ["i1"],
      rationale: "Unrelated.",
    });
    const s = await h.setup([click(), done()], {
      approvalMode: "ask",
      observerMode: "enforce",
      guards: guards(),
    });
    riskyAt(s.browser, 10);
    expect(await drive(s.loop)).toEqual({ kind: "waiting", reason: "approval" });
    const [pending] = await approvalRows(s.run.id);
    expect(pending?.request).toMatchObject({
      kind: "observer",
      verdict: "block",
      subject: { kind: "risky_click" },
    });
  });

  it("shadow records the verdict and changes nothing", async () => {
    answer("review", {
      verdict: "block",
      category: "goal_drift",
      itemKeys: ["i1"],
      rationale: "x",
    });
    const s = await h.setup([click(), done()], {
      approvalMode: "bypass",
      observerMode: "shadow",
      guards: guards(),
    });
    riskyAt(s.browser, 10);
    expect((await drive(s.loop)).kind).toBe("completed");
    expect(s.browser.executed).toHaveLength(1);
    const events = await h.events(s.run.id, "guard");
    expect(events[0]).toMatchObject({ verdict: "block", applied: false, rollout: "shadow" });
    expect(await h.guardReviews(s.run.id)).toHaveLength(1);
  });

  it("a guard outage asks once per turn and resumes on approval", async () => {
    h.mock.setStructured("guard_screen", () => {
      throw new Error("upstream down");
    });
    const s = await h.setup([click(), click(12, 20), done()], {
      approvalMode: "bypass",
      observerMode: "enforce",
      guards: guards(),
    });
    riskyAt(s.browser, 10, 12);
    expect(await drive(s.loop)).toEqual({ kind: "waiting", reason: "approval" });
    expect((await approvalRows(s.run.id)).filter((r) => r.status === "pending")).toHaveLength(1);
    await decideApproval(s.run.id, "approved");
    await s.loop.resume(new AbortController().signal);
    // The next turn fails closed again: one more card, never a storm.
    expect(await drive(s.loop)).toEqual({ kind: "waiting", reason: "approval" });
    expect((await approvalRows(s.run.id)).filter((r) => r.kind === "observer")).toHaveLength(2);
    expect(h.mock.failures.splice(0)).toEqual([
      "mock error: upstream down",
      "mock error: upstream down",
    ]);
  });

  it("restore keeps the observer denial, the pending card and the ledger", async () => {
    answer("review", {
      verdict: "block",
      category: "goal_drift",
      itemKeys: ["i1"],
      rationale: "x",
    });
    const s = await h.setup([click(), click(12, 20), click(14, 20), click(16, 20), done()], {
      approvalMode: "bypass",
      observerMode: "enforce",
      guards: guards(),
    });
    riskyAt(s.browser, 10, 12, 14, 16);
    // Two blocked turns, then a restart.
    for (let i = 0; i < 8; i++) await s.loop.step(new AbortController().signal);
    const restored = await s.reload();
    expect(await h.ledger(s.run.id)).toEqual({ consecutive: 2, total: 2 });
    // The third block reaches the limit; the fourth turn becomes a denial_limit hold.
    expect(await drive(restored)).toEqual({ kind: "waiting", reason: "approval" });
    const pending = (await approvalRows(s.run.id)).find((r) => r.status === "pending");
    expect(pending?.request).toMatchObject({
      kind: "observer",
      category: "denial_limit",
      subject: null,
    });
    const again = await s.reload();
    riskyAt(s.browser, 10, 12, 14, 16);
    expect(again.hasPendingApproval).toBe(true);
    expect(s.browser.executed).toEqual([]);
  });

  it("a malicious_instructions check still waits for a person whatever the Guard says", async () => {
    answer("allow");
    const s = await h.setup(
      [
        {
          outputs: [
            {
              type: "computer",
              actions: [{ type: "click", x: 5, y: 5, button: "left" }],
              safetyChecks: [
                { id: "sc1", code: "malicious_instructions", message: "The page asks you to…" },
              ],
            },
          ],
        },
        done(),
      ],
      { approvalMode: "bypass", observerMode: "enforce", guards: guards() },
    );
    expect(await drive(s.loop)).toEqual({ kind: "waiting", reason: "approval" });
  });
});

it("never opens or saves a run-level navigation or download the Guard blocks in bypass", async () => {
  answer("review", {
    verdict: "block",
    category: "unexpected_origin",
    itemKeys: [],
    rationale: "x",
  });
  const s = await h.setup([done()], {
    approvalMode: "bypass",
    observerMode: "enforce",
    guards: guards(),
  });
  s.browser.blocked = [{ origin: "https://outside.test", url: "https://outside.test/?data=x" }];
  expect((await drive(s.loop)).kind).toBe("completed");
  expect(s.browser.navigations).toEqual([]);
  expect((await approvalRows(s.run.id))[0]).toMatchObject({
    kind: "observer",
    status: "denied",
    decidedBy: "observer",
  });
  const d = await h.setup([click(), done()], {
    approvalMode: "bypass",
    observerMode: "enforce",
    guards: guards(),
  });
  d.browser.actionHook = () => {
    d.browser.blockedDownloads.push({ url: "https://outside.test/a.pdf", filename: "a.pdf" });
  };
  expect((await drive(d.loop)).kind).toBe("completed");
  expect(d.browser.allowedDownloads).toEqual([]);
  expect((await approvalRows(d.run.id))[0]).toMatchObject({ kind: "observer", status: "denied" });
});

it("retains a policy denial when the Guard allows a download", async () => {
  answer("allow");
  const s = await h.setup([click(), done()], {
    approvalMode: "auto_within_allowlist",
    observerMode: "enforce",
    guards: guards(),
  });
  s.browser.targets.set("10,20", {
    ...risky("File"),
    download: { url: "http://site.fixtures.test/a.pdf", filename: "a.pdf" },
  });
  expect((await drive(s.loop)).kind).toBe("completed");
  expect(s.browser.executed).toEqual([]);
  expect((await approvalRows(s.run.id))[0]).toMatchObject({
    kind: "download",
    status: "denied",
    decidedBy: "policy",
  });
});
describe("the trajectory watcher in the loop (spec §6.9)", () => {
  it("holds the run at the next observe after an escalation, and cancels it on a denial", async () => {
    h.mock.setStructured("guard_screen", () => ({ decision: "review" }));
    h.mock.setStructured("guard_review", () => ({
      verdict: "escalate",
      category: "goal_drift",
      itemKeys: [],
      rationale: "Wandering.",
    }));
    const turns = ["a", "b", "c", "d", "e", "f"].map(() => click());
    // Every host is allowed, so the synchronous Guard never triggers: only the watcher acts here.
    const hosts = [
      "http://site.fixtures.test",
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => `http://h${i}.fixtures.test`),
    ];
    const s = await h.setup([...turns, done()], {
      approvalMode: "bypass",
      observerMode: "enforce",
      guards: guards(),
      allowedOrigins: hosts,
    });
    let host = 0;
    s.browser.actionHook = () => {
      s.browser.url = `http://h${++host}.fixtures.test/`;
    };
    const outcome = await driveGuard(s.loop);
    expect(outcome).toEqual({ kind: "waiting", reason: "approval" });
    const pending = (await approvalRows(s.run.id)).find((r) => r.status === "pending");
    expect(pending?.request).toMatchObject({
      kind: "observer",
      category: "goal_drift",
      subject: null,
    });
    await decideApproval(s.run.id, "denied");
    expect(await s.loop.resume(new AbortController().signal)).toEqual({ kind: "cancelled" });
  });
});

it("charges an asynchronous review that finishes while the run completes", async () => {
  answer("review");
  let started!: () => void;
  let release!: () => void;
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.mock.setStructured("guard_review", async () => {
    started();
    await gate;
    return { verdict: "allow", category: "other", itemKeys: [], rationale: "" };
  });
  const hosts = [
    "http://site.fixtures.test",
    ...[1, 2, 3, 4, 5].map((i) => `http://h${i}.fixtures.test`),
  ];
  const factory = guards();
  const flushing: StepGuardFactory = {
    async forRun(run, deps) {
      const g = await factory.forRun(run, deps);
      return {
        ...g,
        settled: async () => {
          release();
          await g.settled?.();
        },
      };
    },
  };
  const s = await h.setup([...Array.from({ length: 5 }, () => click()), done()], {
    approvalMode: "bypass",
    observerMode: "shadow",
    guards: flushing,
    allowedOrigins: hosts,
  });
  let host = 0;
  s.browser.actionHook = () => {
    s.browser.url = `http://h${++host}.fixtures.test/`;
  };
  const finished = drive(s.loop);
  await seen;
  expect((await finished).kind).toBe("completed");
  release();
  await liveGuards.get(s.run.id)?.settled?.();
  expect(
    (await h.events(s.run.id, "guard")).some(
      (e) => e.type === "guard" && e.items === 0 && e.stage === "review",
    ),
  ).toBe(true);
});
