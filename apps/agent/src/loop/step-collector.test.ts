import { EMPTY_USAGE } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import { StepCollector } from "./step-collector.ts";

const log = createLogger({ service: "test", level: "silent" });

describe("StepCollector", () => {
  it("runs deferred writes in call order inside one extra()", async () => {
    const step = new StepCollector();
    const order: number[] = [];
    step.defer(async () => void order.push(1));
    step.defer(async () => void order.push(2));
    await step.commitParts().extra?.({} as never);
    expect(order).toEqual([1, 2]);
    expect(new StepCollector().commitParts().extra).toBeUndefined();
  });
  it("keeps usage across reset but drops writes, events and after-commit tasks", async () => {
    const step = new StepCollector();
    step.addUsage({ ...EMPTY_USAGE, usd: 0.25 });
    step.emit({ type: "budget", usage: EMPTY_USAGE } as never);
    step.ownObject("assets/a");
    step.afterCommit(async () => {
      throw new Error("never runs");
    });
    expect(step.reset()).toEqual(["assets/a"]);
    expect(step.usage.usd).toBe(0.25);
    expect(step.commitParts()).toEqual({ events: [], ownedObjects: [] });
    await step.afterCommitted(log);
  });
  it("logs a failing after-commit task instead of throwing", async () => {
    const step = new StepCollector();
    let ran = false;
    step.afterCommit(async () => {
      throw new Error("x");
    });
    step.afterCommit(async () => {
      ran = true;
    });
    await expect(step.afterCommitted(log)).resolves.toBeUndefined();
    expect(ran).toBe(true);
  });
  it("reports what the budget still allows after the step's own spend", () => {
    const step = new StepCollector({ usdLeft: 1 });
    step.addUsage({ ...EMPTY_USAGE, usd: 0.25 });
    expect(step.usdLeft()).toBeCloseTo(0.75, 9);
    expect(new StepCollector().usdLeft()).toBe(Number.POSITIVE_INFINITY);
  });
});
