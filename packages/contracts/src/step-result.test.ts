import { describe, expect, it } from "vitest";
import { CallResult, summarizeComputerActions, summaryMayReachPage } from "./step-result.ts";

describe("stored computer step results (one shape for the agent and the grader)", () => {
  it("summarizes a batch by its first action and flags it as possibly reaching the page", () => {
    const move = { type: "move" as const, x: 1, y: 2 };
    const click = { type: "click" as const, x: 3, y: 4, button: "left" as const };
    expect(summarizeComputerActions([click])).toBe("click (3, 4)");
    expect(summarizeComputerActions([move, click])).toBe("move (1, 2) (+1 more)");
    expect(summaryMayReachPage("click (3, 4)")).toBe(true);
    expect(summaryMayReachPage("move (1, 2) (+1 more)")).toBe(true);
    expect(summaryMayReachPage("move (1, 2)")).toBe(false);
  });
  it("parses per-action effects, and rows from before they were recorded", () => {
    const base = { kind: "computer", notes: [], acknowledged: [] };
    expect(CallResult.parse({ ...base, effects: ["passive", "input"] })).toMatchObject({
      effects: ["passive", "input"],
    });
    expect(CallResult.parse(base)).not.toHaveProperty("effects");
    expect(() => CallResult.parse({ ...base, effects: ["teleport"] })).toThrow();
  });
});
