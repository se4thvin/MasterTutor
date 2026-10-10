import { expect, it } from "vitest";
import { EMPTY_USAGE } from "@mastertutor/contracts";
import { runs, runEvents } from "@mastertutor/db";
import { eq } from "drizzle-orm";
import { createIntentModel } from "../capture/intent-model.ts";
import { requireCaptureBudget } from "../capture/model-budget.ts";
import { createOpenAI } from "../llm/openai.ts";
import { initializeCaptureIntent } from "./capture-intent.ts";
import {
  done,
  drive,
  mock,
  owner,
  setup,
  status,
  approvalRows,
  decideApproval,
} from "./testing/loop-harness.ts";

const signal = () => new AbortController().signal;
const brief = { keep: ["reading_text"] as "reading_text"[], skip: [], scopeNote: "" };

it("initializes a fresh low-budget run after extension instead of rounding its cap to zero", async () => {
  const model = createIntentModel(createOpenAI({ apiKey: "mock", baseURL: `${mock.url}/v1` }));
  mock.setStructured("capture_intent", () => ({ brief, ambiguous: false }));
  const h = await setup([done()], {
    budget: { maxUsd: 0.0001, maxSteps: 150, maxActiveMinutes: 60 },
    hooks: {
      prepareCapture: (run, step, s, redact) =>
        initializeCaptureIntent(owner.db, model, run, step, s, redact),
    },
  });
  expect(await h.loop.step(signal())).toEqual({ kind: "waiting", reason: "approval" });
  await decideApproval(h.run.id, "approved", { instruction: null, budgetChoice: "extend" });
  const restored = await h.reload();
  expect(await restored.resume(signal())).toEqual({ kind: "continue" });
  expect(await drive(restored)).toEqual({ kind: "completed" });
  expect((await status(h.run.id))?.captureBrief).toEqual(brief);
});

it.each(["ask", "auto_within_allowlist", "bypass"] as const)(
  "pauses insufficient intent budget before observation and retries after a person extends it (%s)",
  async (approvalMode) => {
    const model = createIntentModel(createOpenAI({ apiKey: "mock", baseURL: `${mock.url}/v1` }));
    mock.setStructured("capture_intent", () => ({ brief, ambiguous: false }));
    let accrued = false;
    const h = await setup([done()], {
      approvalMode,
      budget: { maxUsd: 0.01, maxSteps: 150, maxActiveMinutes: 60 },
      hooks: {
        prepareCapture: async (run, step, s, redact) => {
          if (!accrued) {
            step.addUsage({ ...EMPTY_USAGE, usd: 0.0099, inputTokens: 99 });
            accrued = true;
          }
          return initializeCaptureIntent(owner.db, model, run, step, s, redact);
        },
      },
    });
    let observations = 0;
    h.browser.observeHook = () => {
      observations++;
    };
    expect(await h.loop.step(signal())).toEqual({ kind: "waiting", reason: "approval" });
    expect(observations).toBe(0);
    expect(await status(h.run.id)).toMatchObject({
      usage: { usd: 0.0099, inputTokens: 99 },
      captureBrief: null,
      error: null,
    });
    expect((await approvalRows(h.run.id))[0]?.kind).toBe("budget");
    const restored = await h.reload();
    expect(await restored.resume(signal())).toEqual({ kind: "waiting", reason: "approval" });
    expect(await approvalRows(h.run.id)).toHaveLength(1);
    await decideApproval(h.run.id, "approved", { instruction: null, budgetChoice: "extend" });
    expect(await restored.resume(signal())).toEqual({ kind: "continue" });
    expect(await drive(restored)).toEqual({ kind: "completed" });
    expect(await status(h.run.id)).toMatchObject({ captureBrief: brief, budget: { maxUsd: 0.02 } });
    expect((await status(h.run.id))!.usage.usd).toBeGreaterThan(0.0099);
  },
);

it("keeps selection usage, discards partial writes, and retries the interrupted capture after extension", async () => {
  const h = await setup(
    [
      {
        outputs: [
          {
            type: "function",
            name: "capture",
            args: { scope: "page", selector: null, kind: null },
          },
        ],
      },
      done(),
    ],
    { approvalMode: "bypass", budget: { maxUsd: 1, maxSteps: 150, maxActiveMinutes: 60 } },
  );
  let first = true;
  h.browser.functionHook = async (_name, step) => {
    step.defer(async (tx) => {
      await tx.update(runs).set({ title: "Captured" }).where(eq(runs.id, h.run.id));
    });
    if (first) {
      first = false;
      step.addUsage({ ...EMPTY_USAGE, usd: 0.9999, inputTokens: 99 });
    }
    requireCaptureBudget(step, 500, 1000);
  };
  expect(await drive(h.loop)).toEqual({ kind: "waiting", reason: "approval" });
  expect((await status(h.run.id))?.title).toBeNull();
  const spent = (await status(h.run.id))!.usage.usd;
  expect(spent).toBeGreaterThanOrEqual(0.9999);
  expect((await approvalRows(h.run.id))[0]?.kind).toBe("budget");
  await decideApproval(h.run.id, "approved", { instruction: null, budgetChoice: "extend" });
  const restored = await h.reload();
  expect(await restored.resume(signal())).toEqual({ kind: "continue" });
  expect(await drive(restored)).toEqual({ kind: "completed" });
  expect((await status(h.run.id))?.title).toBe("Captured");
  expect((await status(h.run.id))!.usage.usd).toBeGreaterThanOrEqual(spent);
  expect(h.browser.functionRuns).toHaveLength(2);
  const events = await owner.db.select().from(runEvents).where(eq(runEvents.runId, h.run.id));
  expect(events.some((e) => e.type === "error")).toBe(false);
});
