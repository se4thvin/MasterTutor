import type { GuardInput } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLlmMock, type LlmMock } from "../../../../../tests/llm-mock/src/server.ts";
import { createOpenAI } from "../../llm/openai.ts";
import { createGuardReviewer } from "./reviewer.ts";

let mock: LlmMock;
beforeAll(async () => {
  mock = await startLlmMock();
});
afterAll(async () => mock?.close());
const reviewer = (timeoutMs?: number) =>
  createGuardReviewer(createOpenAI({ apiKey: "k", baseURL: `${mock.url}/v1` }), { timeoutMs });

const input: GuardInput = {
  goal: "Take notes",
  mode: "bypass",
  allowedOrigins: ["https://a.test"],
  page: { origin: "https://b.test", inAllowed: false },
  items: [
    {
      key: "i1",
      actionClass: "type",
      triggers: ["data_egress"],
      policyKind: null,
      policyDecision: null,
      target: null,
      destination: null,
      sent: { provenance: "other_origin", sourceOrigin: "https://a.test", chars: 80 },
      vault: null,
      safetyChecks: [],
    },
  ],
  run: {
    step: 3,
    newOrigins: 1,
    denials: { consecutive: 0, total: 0 },
    loopHits: 0,
    injectionSignals: 0,
    riskLevel: "normal",
  },
};
const signal = () => new AbortController().signal;

describe("the two-stage Guard reviewer (spec §6.5)", () => {
  it("stops at the screen when it allows, and calls luna only", async () => {
    mock.setStructured("guard_screen", () => ({ decision: "allow" }));
    const before = mock.requests.length;
    const outcome = await reviewer().review(input, signal());
    expect(outcome.verdict).toMatchObject({ verdict: "allow", stage: "screen" });
    const sent = mock.requests.slice(before);
    expect(sent.map((r) => r.body.model)).toEqual(["gpt-6-luna"]);
    expect(sent[0]!.body.store).toBe(false);
    expect(outcome.usage.usd).toBeGreaterThan(0);
  });

  it("asks the stronger model only on a flag, and keeps only known item keys", async () => {
    mock.setStructured("guard_screen", () => ({ decision: "review" }));
    mock.setStructured("guard_review", () => ({
      verdict: "block",
      category: "data_exfiltration",
      itemKeys: ["i1", "i9"],
      rationale: "Copies page text‮ to another site.",
    }));
    const before = mock.requests.length;
    const outcome = await reviewer().review(input, signal());
    expect(mock.requests.slice(before).map((r) => r.body.model)).toEqual([
      "gpt-6-luna",
      "gpt-6.1-sol",
    ]);
    expect(outcome.verdict).toMatchObject({ verdict: "block", stage: "review", itemKeys: ["i1"] });
    expect(outcome.verdict.rationale).not.toContain("‮");
  });

  it("fails closed on an unparseable answer", async () => {
    mock.setStructured("guard_screen", () => ({ decision: "maybe" }));
    const outcome = await reviewer().review(input, signal());
    expect(outcome.usage.usd).toBeGreaterThan(0);
    expect(outcome).toMatchObject({
      failure: "invalid",
      verdict: { verdict: "escalate", category: "guard_unavailable" },
    });
  });

  it("fails closed on a timeout", async () => {
    mock.setStructured("guard_screen", async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { decision: "allow" };
    });
    const outcome = await reviewer(50).review(input, signal());
    expect(outcome).toMatchObject({ failure: "timeout", verdict: { verdict: "escalate" } });
  });

  it("sends the input as JSON data only: no agent prose, no extra fields", async () => {
    mock.setStructured("guard_screen", () => ({ decision: "allow" }));
    await reviewer().review(input, signal());
    const body = mock.requests.at(-1)!.body;
    expect(JSON.parse((body.input as Array<{ content: string }>)[0]!.content)).toEqual(input);
  });
});

it("charges both calls when the stronger model's answer is unparseable", async () => {
  mock.setStructured("guard_screen", () => ({ decision: "review" }));
  mock.setStructured("guard_review", () => ({ verdict: "approve" }));
  const outcome = await reviewer().review(input, signal());
  expect(outcome.failure).toBe("invalid");
  expect(outcome.verdict.verdict).toBe("escalate");
  expect(outcome.usage.inputTokens).toBe(2_000);
  expect(outcome.usage.outputTokens).toBe(200);
});
