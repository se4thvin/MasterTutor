import { EMPTY_USAGE, MODELS, TOOL_NAMES } from "@mastertutor/contracts";
import { APIError, statelessParams } from "./openai.ts";
import { afterEach, describe, expect, it } from "vitest";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { instantClock } from "../runtime/clock.ts";
import { ChainLost, ContextOverflow, ModelUnavailable } from "../runtime/errors.ts";
import { ModelCaller, backoffMs, classifyModelError, retryAfterMs } from "./caller.ts";
import {
  createOpenAIModelClient,
  type ModelClient,
  type ModelReply,
  type ModelRequest,
} from "./client.ts";
import { goalText } from "./instructions.ts";
import { callSignature, describeCall, parseModelOutput } from "./items.ts";
import { addUsage, costUsd, usageDelta } from "./pricing.ts";

const request: ModelRequest = {
  model: MODELS.agentPrimary,
  instructions: "i",
  input: [],
  format: "agent_turn",
};
const reply: ModelReply = {
  id: "resp_1",
  model: MODELS.agentPrimary,
  output: [],
  usage: { input: 10, cached: 0, output: 1 },
};
const apiError = (status: number, code?: string) =>
  APIError.generate(status, { error: { message: "x", code } }, "x", new Headers());
const signal = () => new AbortController().signal;

function scripted(steps: Array<ModelReply | Error>) {
  const models: string[] = [];
  const client: ModelClient = {
    create: async (req) => {
      models.push(req.model);
      const next = steps.shift();
      if (!next) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, models };
}
const caller = (client: ModelClient) =>
  new ModelCaller(client, { clock: instantClock(), fallbackAfter5xx: 3 });

describe("pricing", () => {
  it("prices gpt-6-astra and doubles input above 272K", () => {
    expect(costUsd(MODELS.agentPrimary, { input: 1_000_000, cached: 0, output: 0 })).toBeCloseTo(
      20,
    );
    expect(
      costUsd(MODELS.agentPrimary, { input: 100_000, cached: 100_000, output: 10_000 }),
    ).toBeCloseTo(0.6);
    expect(costUsd(MODELS.agentPrimary, { input: 300_000, cached: 0, output: 0 })).toBeCloseTo(6);
    expect(
      addUsage(EMPTY_USAGE, usageDelta(MODELS.agentPrimary, { input: 10, cached: 2, output: 3 })),
    ).toMatchObject({
      steps: 1,
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
    });
  });
});

describe("parseModelOutput", () => {
  it("normalizes batched and single computer actions and validates every call", () => {
    const parsed = parseModelOutput([
      {
        type: "computer_call",
        call_id: "c1",
        actions: [
          { type: "click", x: 5, y: 6, button: "left" },
          { type: "type", text: "hi" },
        ],
        pending_safety_checks: [
          { id: "s1", code: "malicious_instructions", message: "Check this" },
        ],
      },
      {
        type: "computer_call",
        call_id: "c2",
        action: { type: "scroll", x: 1, y: 1, scroll_x: 0, scroll_y: 300 },
        pending_safety_checks: [],
      },
      {
        type: "computer_call",
        call_id: "c3",
        actions: [{ type: "exec", code: "x" }],
        pending_safety_checks: [],
      },
      {
        type: "function_call",
        call_id: "f1",
        name: "read_page",
        arguments: '{"mode":"text","sinceHash":null}',
      },
      { type: "function_call", call_id: "f2", name: "exec_js", arguments: "{}" },
      { type: "function_call", call_id: "f3", name: "read_page", arguments: "{bad json" },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: '{"status":"continue","needHuman":null,"reason":"Reading","planUpdate":null}',
          },
        ],
      },
    ]);
    expect(parsed.turn).toEqual({
      status: "continue",
      needHuman: null,
      reason: "Reading",
      planUpdate: null,
    });
    expect(parsed.calls.map((call) => [call.callId, call.invalid === null])).toEqual([
      ["c1", true],
      ["c2", true],
      ["c3", false],
      ["f1", true],
      ["f2", false],
      ["f3", false],
    ]);
    const first = parsed.calls[0]!;
    expect(first.kind === "computer" && first.safetyChecks).toEqual([
      { id: "s1", code: "malicious_instructions", message: "Check this" },
    ]);
    expect(describeCall(first, 0.5)).toEqual({
      tool: "computer",
      summary: "click (5, 6) (+1 more)",
      point: { x: 10, y: 12 },
    });
    const same = parseModelOutput([
      {
        type: "computer_call",
        call_id: "zz",
        actions: [
          { type: "click", x: 5, y: 6, button: "left" },
          { type: "type", text: "hi" },
        ],
        pending_safety_checks: [],
      },
    ]);
    expect(callSignature(first)).toBe(callSignature(same.calls[0]!));
  });
  it("tolerates a refusal", () => {
    expect(
      parseModelOutput([{ type: "message", content: [{ type: "refusal", refusal: "no" }] }]).turn,
    ).toBeNull();
  });
});

describe("goalText", () => {
  it("states the goal, the allowlist and the approval mode", () => {
    const text = goalText(
      { goal: "Do X", allowedOrigins: ["https://a.com"], approvalMode: "auto_within_allowlist" },
      ["Vault aliases: zybooks"],
    );
    for (const part of [
      "Do X",
      "https://a.com",
      "approved automatically",
      "Vault aliases: zybooks",
    ])
      expect(text).toContain(part);
  });
});

describe("ModelCaller", () => {
  it("retries 429 with backoff, then succeeds", async () => {
    expect(
      (await caller(scripted([apiError(429), apiError(429), reply]).client).call(request, signal()))
        .fallback,
    ).toBeNull();
  });
  it("falls back to gpt-6.1-sol after 3 consecutive 5xx from the primary", async () => {
    const { client, models } = scripted([apiError(500), apiError(503), apiError(502), reply]);
    const result = await caller(client).call(request, signal());
    expect(result.model).toBe(MODELS.agentFallback);
    expect(result.fallback).toEqual({ from: MODELS.agentPrimary, to: MODELS.agentFallback });
    expect(models).toEqual([
      MODELS.agentPrimary,
      MODELS.agentPrimary,
      MODELS.agentPrimary,
      MODELS.agentFallback,
    ]);
  });
  it("gives up after the fallback also fails, and maps chain loss and 4xx", async () => {
    await expect(
      caller(scripted(Array.from({ length: 6 }, () => apiError(500))).client).call(
        request,
        signal(),
      ),
    ).rejects.toMatchObject({ code: "model_unavailable" });
    await expect(
      caller(scripted([apiError(400, "previous_response_not_found")]).client).call(
        request,
        signal(),
      ),
    ).rejects.toBeInstanceOf(ChainLost);
    await expect(
      caller(scripted([apiError(400)]).client).call(request, signal()),
    ).rejects.toBeInstanceOf(ModelUnavailable);
    expect(classifyModelError(new Error("socket hang up"))).toBe("server");
  });
  it("treats context overflow as compact-now, 408/409 as retryable and honours Retry-After", async () => {
    expect(classifyModelError(apiError(400, "context_length_exceeded"))).toBe("context_overflow");
    await expect(
      caller(scripted([apiError(400, "context_length_exceeded")]).client).call(request, signal()),
    ).rejects.toBeInstanceOf(ContextOverflow);
    expect(classifyModelError(apiError(408))).toBe("transient");
    expect(classifyModelError(apiError(409))).toBe("transient");
    expect(
      (await caller(scripted([apiError(409), apiError(408), reply]).client).call(request, signal()))
        .fallback,
    ).toBeNull();
    const limited = APIError.generate(
      429,
      { error: { message: "x" } },
      "x",
      new Headers({ "retry-after": "20" }),
    );
    expect(retryAfterMs(limited)).toBe(20_000);
    expect(retryAfterMs(apiError(429))).toBeNull();
    expect(backoffMs(1, 20_000)).toBe(20_000);
    expect(backoffMs(1, null)).toBeLessThanOrEqual(500);
  });
});

describe("OpenAI client against llm-mock", () => {
  let mock: LlmMock | undefined;
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });
  it("sends exactly the 7 tools, store:false with no identifiers, encrypted reasoning, medium effort and the agent_turn format", async () => {
    mock = await startLlmMock({
      scenarios: [
        { name: "wire", turns: [{ outputs: [{ type: "turn", status: "done", reason: "ok" }] }] },
      ],
    });
    const client = createOpenAIModelClient({ apiKey: "test-key", baseURL: `${mock.url}/v1` });
    const result = await client.create(
      {
        ...request,
        input: [{ role: "user", content: [{ type: "input_text", text: "[scenario:wire] go" }] }],
      },
      signal(),
    );
    expect(parseModelOutput(result.output).turn?.status).toBe("done");
    const body = mock.requestsFor("wire")[0]!.body;
    expect(body.tools?.map((tool) => tool.name ?? tool.type).sort()).toEqual(
      [...TOOL_NAMES].sort(),
    );
    const functions = (body.tools ?? []).filter((tool) => tool.type === "function") as Array<{
      strict?: boolean;
    }>;
    expect(functions).toHaveLength(6);
    for (const tool of functions) expect(tool.strict).toBe(true);
    expect(body).toMatchObject({
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "medium" },
      text: { format: { name: "agent_turn" } },
    });
    for (const field of ["previous_response_id", "metadata", "user", "safety_identifier"])
      expect(body).not.toHaveProperty(field);
  });
});

describe("statelessParams (openai-data-policy.md)", () => {
  it("forces store:false and strips chaining and identifiers whatever the caller passed", () => {
    const params = statelessParams({
      model: "m",
      input: [],
      store: true,
      previous_response_id: "resp_1",
      metadata: { runId: "r" },
      user: "u@example.com",
      safety_identifier: "s",
      conversation: "conv_1",
      background: true,
    } as never);
    expect(params).toEqual({ model: "m", input: [], store: false });
  });
});
