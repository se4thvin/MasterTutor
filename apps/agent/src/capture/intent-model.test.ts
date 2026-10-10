import { expect, it } from "vitest";
import { StructuredParseError, type StatelessOpenAI } from "../llm/openai.ts";
import { StepCollector } from "../loop/step-collector.ts";
import { createIntentModel } from "./intent-model.ts";
const brief = {
  keep: ["reading_text"] as const,
  skip: ["due_dates"] as const,
  scopeNote: "Notes only",
};
it("derives strict bounded intent and charges billed invalid replies", async () => {
  const step = new StepCollector();
  const client = {
    responses: {
      parse: async (request: {
        name: string;
        instructions: string;
        input: unknown;
        schema: { safeParse(value: unknown): { success: boolean } };
      }) => {
        expect(request.name).toBe("capture_intent");
        expect(request.instructions).toContain("explicit goal");
        expect(JSON.stringify(request.input)).not.toContain("x".repeat(8001));
        expect(request.schema.safeParse({ brief, ambiguous: false, text: "extra" }).success).toBe(
          false,
        );
        throw new StructuredParseError("gpt-6-luna", { input: 100, cached: 0, output: 20 });
      },
    },
  } as unknown as StatelessOpenAI;
  await expect(
    createIntentModel(client).derive("x".repeat(9000), [], {
      step,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  expect(step.usage.inputTokens).toBe(100);
  expect(step.usage.usd).toBeGreaterThan(0);
});

it("does not derive intent beyond the run's remaining budget", async () => {
  let calls = 0;
  const model = createIntentModel({
    responses: {
      parse: async () => {
        calls++;
        return {
          parsed: { brief: { keep: ["reading_text"], skip: [], scopeNote: "" }, ambiguous: false },
          model: "gpt-6-luna",
          tokens: { input: 1, cached: 0, output: 1 },
        };
      },
    },
  } as unknown as StatelessOpenAI);
  await expect(
    model.derive("Reading notes", [], {
      step: new StepCollector({ usdLeft: 0 }),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});
