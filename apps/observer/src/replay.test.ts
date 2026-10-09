import { describe, expect, it } from "vitest";
import { COPILOT_LIMITS } from "@mastertutor/contracts";
import { replayInput } from "./replay.ts";

const user = (text: string, optIn = false) => ({
  role: "user",
  item: { role: "user", content: text, _copilotOptIn: optIn },
});
describe("bounded stateless replay", () => {
  it("removes opt-in turns from a non-opt-in question and never sends local metadata", () => {
    const input = replayInput([user("tainted", true), user("plain")], false, 0);
    expect(JSON.stringify(input)).toContain("plain");
    expect(JSON.stringify(input)).not.toMatch(/tainted|_copilot/);
  });
  it("omits old tool rows before pruning whole exchanges, preserving call/output pairs", () => {
    const entries = [
      user("old"),
      {
        role: "assistant",
        item: { type: "function_call", name: "code_search", call_id: "c1", arguments: "{}" },
      },
      {
        role: "tool",
        item: {
          type: "function_call_output",
          call_id: "c1",
          output: JSON.stringify({ resultId: "Q1", rows: ["x".repeat(300000)] }),
        },
      },
      user("latest"),
    ];
    const input = replayInput(entries, false, 10000);
    expect(JSON.stringify(input)).toContain("result Q1 omitted");
    expect(input.filter((i) => i.type === "function_call_output")).toHaveLength(1);
    expect(JSON.stringify(entries)).toContain("x".repeat(1000));
    expect((JSON.stringify(input).length + 10000) / 4).toBeLessThanOrEqual(
      COPILOT_LIMITS.inputTokens,
    );
  });
  it("prunes whole old turns when messages still exceed the budget", () => {
    const input = replayInput([user("x".repeat(300000)), user("latest")], false, 1000);
    expect(input).toHaveLength(1);
    expect(JSON.stringify(input)).toContain("latest");
  });
  it("refuses an oversized latest exchange instead of exceeding the input cap", () => {
    expect(() => replayInput([user("x".repeat(300000))], false, 1000)).toThrow("input_limit");
  });
});
