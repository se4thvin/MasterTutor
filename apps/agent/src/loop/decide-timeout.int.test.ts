import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { runEvents, runSteps } from "@mastertutor/db";
import { setup, drive, click, done, mock, owner, status } from "./testing/loop-harness.ts";
import { ModelUnavailable } from "../runtime/errors.ts";

describe("a slow decide in the run loop", () => {
  it("aborts the visible step after two stalls and invents no usage", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { name, run, loop } = await setup(
      [
        { ...done(), hold: () => held },
        { ...done(), hold: () => held },
      ],
      { modelTimings: { decideTimeoutMs: 200, decideSlowMs: 20 } },
    );
    try {
      await expect(drive(loop)).rejects.toBeInstanceOf(ModelUnavailable);
      expect(mock.requestsFor(name)).toHaveLength(2);
      expect(await status(run.id)).toMatchObject({
        usage: { steps: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
      });
      const steps = await owner.db.select().from(runSteps).where(eq(runSteps.runId, run.id));
      expect(steps.filter((step) => step.phase === "decide")).toMatchObject([{ state: "aborted" }]);
    } finally {
      release();
    }
  });

  it("shows waiting and retry captions, proceeds, and charges only received usage", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { name, run, browser, loop } = await setup(
      [
        { hold: () => held, ...done("stale"), usage: { input: 9000, output: 9000 } },
        { ...click(), usage: { input: 17, cached: 2, output: 3 } },
        { ...done(), usage: { input: 11, output: 5 } },
      ],
      { modelTimings: { decideTimeoutMs: 500, decideSlowMs: 50 } },
    );
    try {
      expect(await drive(loop)).toEqual({ kind: "completed" });
      expect(browser.executed).toHaveLength(1);
      expect(mock.requestsFor(name)).toHaveLength(3);
      expect(await status(run.id)).toMatchObject({
        usage: {
          steps: 2,
          inputTokens: 28,
          cachedInputTokens: 2,
          outputTokens: 8,
        },
      });
      const events = (
        await owner.db
          .select()
          .from(runEvents)
          .where(eq(runEvents.runId, run.id))
          .orderBy(asc(runEvents.id))
      )
        .map((row) => row.payload)
        .filter((event) => event.type === "step" && event.phase === "decide");
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ state: "started", caption: "Waiting on the model…" }),
          expect.objectContaining({ state: "started", caption: "Model slow, retrying…" }),
        ]),
      );
      const steps = await owner.db.select().from(runSteps).where(eq(runSteps.runId, run.id));
      expect(steps.filter((step) => step.phase === "decide")).toHaveLength(2);
      expect(steps.find((step) => step.phase === "decide" && step.action)?.action).toMatchObject({
        tool: "computer",
      });
      expect(steps.every((step) => step.state !== "started")).toBe(true);
    } finally {
      release();
    }
  });
});
