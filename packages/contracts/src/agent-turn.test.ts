import { describe, expect, it } from "vitest";
import { AgentTurn, CompactionSummary, FilingDecision } from "./agent-turn.ts";
import { strictSchemaProblems } from "./testing/strict-schema.ts";

describe("model-facing schemas are strict", () => {
  it.each([
    ["AgentTurn", AgentTurn],
    ["CompactionSummary", CompactionSummary],
    ["FilingDecision", FilingDecision],
  ])("%s", (_name, schema) => {
    expect(strictSchemaProblems(schema)).toEqual([]);
  });
});

describe("AgentTurn", () => {
  it("parses a continue turn", () => {
    const turn = AgentTurn.parse({
      status: "continue",
      needHuman: null,
      reason: "Reading section 1.2",
      planUpdate: { items: [{ text: "Open reading 1", done: true }] },
    });
    expect(turn.planUpdate?.items).toHaveLength(1);
  });
  it("rejects unknown statuses", () => {
    expect(
      AgentTurn.safeParse({ status: "pause", needHuman: null, reason: "", planUpdate: null })
        .success,
    ).toBe(false);
  });
});

describe("FilingDecision", () => {
  it("needs 1-8 path segments", () => {
    expect(FilingDecision.safeParse({ path: [], createLeaf: false }).success).toBe(false);
    expect(FilingDecision.safeParse({ path: Array(9).fill("x"), createLeaf: false }).success).toBe(
      false,
    );
    expect(FilingDecision.safeParse({ path: ["Biology", "Cells"], createLeaf: true }).success).toBe(
      true,
    );
  });
});
