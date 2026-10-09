import { describe, expect, it } from "vitest";
import { copilotInstructions } from "./prompts.ts";
import { UNTRUSTED_DATA_RULE } from "../prompt-rules.ts";

describe("Copilot instructions", () => {
  it("requires citations, treats all tool values as data and keeps a static prefix", () => {
    const shots = [{ title: "Runs", kind: "promql", query: "mt_runs_ended" }];
    const text = copilotInstructions(shots);
    expect(text).toContain(UNTRUSTED_DATA_RULE);
    expect(text).toContain("[Q1]");
    expect(text).toContain("read-only");
    expect(text).toBe(copilotInstructions(shots));
  });
});
