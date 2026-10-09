import { FUNCTION_TOOLS } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import type { RecordedRequest } from "../scenario.ts";
import { E2E_SCENARIO, E2E_SCENARIOS } from "./e2e.ts";
import { SCENARIOS } from "./index.ts";

const pageText = (name: string, text: string): RecordedRequest => ({
  scenario: name,
  turn: 3,
  body: { input: [{ type: "function_call_output", call_id: "c", output: text }] },
  at: 0,
  path: "/v1/responses",
});

describe("E2E scenarios served by the llm-mock service", () => {
  it("serves every named E2E scenario exactly once", () => {
    const names = SCENARIOS.map((scenario) => scenario.name);
    expect(new Set(names).size).toBe(names.length);
    expect(E2E_SCENARIOS.map((s) => s.name).sort()).toEqual(Object.values(E2E_SCENARIO).sort());
    for (const name of Object.values(E2E_SCENARIO)) expect(names).toContain(name);
  });

  it("keeps every name valid for scenarioGoal", () => {
    for (const name of Object.values(E2E_SCENARIO)) expect(name).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  it("ends every scenario with a finished turn, except the scripted model failure", () => {
    for (const scenario of E2E_SCENARIOS) {
      if (scenario.name === E2E_SCENARIO.modelRejected) continue;
      expect(scenario.turns.at(-1)?.outputs?.at(-1), scenario.name).toMatchObject({
        type: "turn",
        status: "done",
      });
    }
  });

  it("fails the finishing turn when the page shows the wrong state, so the run fails (P7-23)", () => {
    const check = (name: string) =>
      E2E_SCENARIOS.find((s) => s.name === name)!.turns.at(-1)!.check!;
    expect(() => check(E2E_SCENARIO.riskyDeny)(pageText("d", "Study tips"))).not.toThrow();
    expect(() => check(E2E_SCENARIO.riskyDeny)(pageText("d", "Account deleted"))).toThrow();
    expect(() => check(E2E_SCENARIO.riskyApprove)(pageText("a", "Account deleted"))).not.toThrow();
    expect(() => check(E2E_SCENARIO.riskyApprove)(pageText("a", "Study tips"))).toThrow();
  });

  it("scripts only tool calls the agent accepts: every function call parses against its contract", () => {
    for (const scenario of SCENARIOS)
      for (const turn of scenario.turns)
        for (const output of turn.outputs ?? []) {
          if (output.type !== "function") continue;
          const tool = FUNCTION_TOOLS[output.name as keyof typeof FUNCTION_TOOLS];
          expect(tool, `${scenario.name}: ${output.name}`).toBeDefined();
          const parsed = tool.args.safeParse(output.args);
          expect(parsed.success, `${scenario.name}: ${output.name} ${parsed.error?.message}`).toBe(
            true,
          );
        }
  });
});
