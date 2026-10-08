import { EMPTY_USAGE, MODELS, TOOL_NAMES } from "@mastertutor/contracts";
import { APIError, statelessParams } from "./openai.ts";
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { instantClock } from "../runtime/clock.ts";
import { ContextOverflow, ModelUnavailable } from "../runtime/errors.ts";
import { createLogger } from "@mastertutor/contracts/server";
import {
  MODEL_ERROR_MESSAGE_MAX,
  ModelCaller,
  backoffMs,
  classifyModelError,
  modelErrorLog,
  retryAfterMs,
} from "./caller.ts";
import {
  createOpenAIModelClient,
  type ModelClient,
  type ModelReply,
  type ModelRequest,
} from "./client.ts";
import { agentInstructions, goalText } from "./instructions.ts";
import { callSignature, describeCall, parseModelOutput } from "./items.ts";
import { MODEL_PRICES, addUsage, costUsd, usageDelta } from "./pricing.ts";
import { agentTools } from "./tools.ts";

const request: ModelRequest = {
  model: MODELS.agentPrimary,
  instructions: "i",
  input: [],
  format: "agent_turn",
  toolProfile: "browser_use",
};
const reply: ModelReply = {
  id: "resp_1",
  model: MODELS.agentPrimary,
  output: [],
  usage: { input: 10, cached: 0, cacheWrite: 0, output: 1 },
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
    const at = (input: number, cached: number, output: number) =>
      costUsd(MODELS.agentPrimary, { input, cached, cacheWrite: 0, output });
    expect(at(1_000_000, 0, 0)).toBeCloseTo(20);
    expect(at(100_000, 100_000, 10_000)).toBeCloseTo(0.6);
    expect(at(300_000, 0, 0)).toBeCloseTo(6);
    expect(
      addUsage(
        EMPTY_USAGE,
        usageDelta(MODELS.agentPrimary, { input: 10, cached: 2, cacheWrite: 0, output: 3 }),
      ),
    ).toMatchObject({ steps: 1, inputTokens: 10, cachedInputTokens: 2, outputTokens: 3 });
  });

  it("prices cache-write tokens at the cache-write rate, never below the input rate (run 30)", () => {
    const price = MODEL_PRICES[MODELS.agentPrimary]!;
    expect(price.cacheWritePerM).toBeGreaterThanOrEqual(price.inputPerM);
    const tokens = { input: 100_000, cached: 20_000, cacheWrite: 30_000, output: 0 };
    expect(costUsd(MODELS.agentPrimary, tokens)).toBeCloseTo(
      (50_000 * price.inputPerM + 20_000 * price.cachedPerM + 30_000 * price.cacheWritePerM) / 1e6,
    );
  });
});

describe("describeCall pointer (run view A1)", () => {
  const computerCall = (action: Record<string, unknown>) =>
    parseModelOutput([
      {
        type: "computer_call",
        id: "cu_1",
        call_id: "call_1",
        status: "completed",
        actions: [action],
        pending_safety_checks: [],
      },
    ]).calls[0]!;
  it("sets the pointer kind for pointer actions and nothing for keys", () => {
    expect(
      describeCall(computerCall({ type: "click", x: 10, y: 20, button: "left" }), 1),
    ).toMatchObject({ tool: "computer", point: { x: 10, y: 20 }, pointer: "click" });
    expect(describeCall(computerCall({ type: "keypress", keys: ["ENTER"] }), 1)).not.toHaveProperty(
      "pointer",
    );
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
        arguments: '{"mode":"text","sinceHash":null,"offset":null}',
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
      pointer: "click",
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
  it("tells a goal-only run it starts on a blank page and must find its own sources", () => {
    const text = goalText(
      { goal: "Find a good intro to Rust lifetimes", allowedOrigins: [], approvalMode: "ask" },
      [],
    );
    expect(text).toContain("Allowed origins: none yet");
    expect(text).toContain("blank page");
    expect(text).toContain("https://html.duckduckgo.com/html/?q=");
    // Result links go through a redirector on another origin: open the destination directly.
    expect(text).toContain("uddg");
    expect(text).toContain("open the destination directly with CTRL+L");
    expect(text).toContain("risky actions wait for the user's approval");
  });
  it("never sends the search guidance to a run with allowed origins (benchmarks, sourced runs)", () => {
    for (const approvalMode of ["ask", "auto_within_allowlist", "bypass"] as const) {
      const text = goalText(
        { goal: "Do X", allowedOrigins: ["https://learn.example.edu"], approvalMode },
        [],
      );
      expect(text).not.toMatch(/duckduckgo|search the web|find sources|not limits|none yet/i);
    }
    for (const profile of ["computer_use", "browser_use"] as const) {
      const instructions = agentInstructions(profile);
      expect(instructions).not.toMatch(/duckduckgo|Finding sources|not limits/i);
      expect(instructions).toContain("- Stay on the allowed origins listed in the task.\n");
    }
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
  it("gives up after the fallback also fails, and maps 4xx (a lost chain cannot happen under D37)", async () => {
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
    ).rejects.toMatchObject({ name: "ModelUnavailable", code: "model_request_rejected" });
    expect(classifyModelError(apiError(400, "previous_response_not_found"))).toBe("fatal");
    await expect(
      caller(scripted([apiError(400)]).client).call(request, signal()),
    ).rejects.toBeInstanceOf(ModelUnavailable);
    expect(classifyModelError(new Error("socket hang up"))).toBe("server");
  });
  it("keeps why OpenAI refused (status, type, code, param, redacted capped message) for the run log", async () => {
    const refusal = APIError.generate(
      400,
      {
        error: {
          type: "invalid_request_error",
          code: null,
          param: "input",
          message: `Computer tool cannot use multiple image inputs. hunter2 sk-proj-abcdef123456 ${"x".repeat(400)}`,
        },
      },
      "x",
      new Headers(),
    );
    const failure = await caller(scripted([refusal]).client)
      .call(request, signal())
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "model_request_rejected" });
    const fields = modelErrorLog((failure as ModelUnavailable).cause, (text) =>
      text.replaceAll("hunter2", "[secret]"),
    );
    expect(fields).toMatchObject({
      modelStatus: 400,
      modelErrorType: "invalid_request_error",
      modelErrorCode: null,
      modelErrorParam: "input",
    });
    const lines: string[] = [];
    createLogger({
      service: "t",
      destination: { write: (line: string) => lines.push(line) },
    }).error({ errorCode: "model_request_rejected", ...fields }, "run failed");
    const logged = JSON.parse(lines[0]!) as Record<string, unknown>;
    const message = String(logged.modelErrorMessage);
    expect(
      message.startsWith("Computer tool cannot use multiple image inputs. [secret] sk-[redacted]"),
    ).toBe(true);
    expect(message).toHaveLength(MODEL_ERROR_MESSAGE_MAX);
    expect(logged).toMatchObject({
      modelErrorParam: "input",
      modelErrorType: "invalid_request_error",
    });
    expect(lines[0]).not.toContain("hunter2");
    expect(lines[0]).not.toContain("abcdef123456");
    expect(modelErrorLog(new Error("socket"), (text) => text)).toEqual({});
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

  it("reads cache_write_tokens into the reply usage (run 30)", async () => {
    mock = await startLlmMock({
      scenarios: [
        {
          name: "cache",
          turns: [
            {
              outputs: [{ type: "turn", status: "done", reason: "ok" }],
              usage: { input: 2_000, cached: 500, cacheWrite: 700, output: 10 },
            },
          ],
        },
      ],
    });
    const client = createOpenAIModelClient({ apiKey: "test-key", baseURL: `${mock.url}/v1` });
    const result = await client.create(
      {
        ...request,
        input: [{ role: "user", content: [{ type: "input_text", text: "[scenario:cache] go" }] }],
      },
      signal(),
    );
    expect(result.usage).toEqual({ input: 2_000, cached: 500, cacheWrite: 700, output: 10 });
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

describe("tool profiles (Phase 10)", () => {
  const names = (tools: ReturnType<typeof agentTools>) =>
    tools.map((tool) => ("name" in tool ? tool.name : tool.type));

  it("declares exactly the profile's tools", () => {
    expect(names(agentTools("computer_use"))).toEqual([
      "computer",
      "fill_credential",
      "use_passkey",
    ]);
    expect(names(agentTools("browser_use")).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("describes fill_credential by profile: focused for pixels, a ref or focused for the DOM", () => {
    const fill = (profile: "computer_use" | "browser_use") =>
      JSON.stringify(
        agentTools(profile).find((tool) => "name" in tool && tool.name === "fill_credential"),
      );
    expect(fill("computer_use")).toContain('target \\"focused\\"');
    expect(fill("computer_use")).not.toContain("read_page");
    expect(fill("browser_use")).toContain("read_page");
  });

  it("sends the run's profile tools on every request", async () => {
    const mock = await startLlmMock({
      scenarios: [
        { name: "pixels", turns: [{ outputs: [{ type: "turn", status: "done", reason: "ok" }] }] },
      ],
    });
    try {
      const client = createOpenAIModelClient({ apiKey: "test-key", baseURL: `${mock.url}/v1` });
      await client.create(
        {
          ...request,
          toolProfile: "computer_use",
          input: [
            { role: "user", content: [{ type: "input_text", text: "[scenario:pixels] go" }] },
          ],
        },
        signal(),
      );
      expect(
        mock.requestsFor("pixels")[0]!.body.tools?.map((tool) => tool.name ?? tool.type),
      ).toEqual(["computer", "fill_credential", "use_passkey"]);
    } finally {
      await mock.close();
    }
  });

  it("writes instructions per profile, with a generic consent-banner rule and no site names", () => {
    const pixels = agentInstructions("computer_use");
    const dom = agentInstructions("browser_use");
    expect(pixels).not.toContain("read_page");
    expect(pixels).toContain('target "focused"');
    expect(dom).toContain('read_page with mode "interactive"');
    expect(dom).toContain("element ref");
    for (const text of [pixels, dom]) {
      expect(text).toContain("cookie or consent banner");
      expect(text).toContain("<untrusted_page_content>");
      expect(text).not.toMatch(/zybook|osano/i);
    }
  });
});

describe("ModelCaller telemetry (seam 4)", () => {
  let telemetry: TestTelemetry;
  beforeEach(() => {
    telemetry = installTestTelemetry();
  });
  afterEach(async () => {
    await telemetry.shutdown();
  });
  const request = {
    model: MODELS.agentPrimary,
    instructions: "i",
    input: [],
    format: "agent_turn" as const,
    toolProfile: "browser_use" as const,
  };

  it("records model, attempts, tokens and cost", async () => {
    let calls = 0;
    const caller = new ModelCaller(
      {
        create: async () => {
          calls += 1;
          if (calls === 1)
            throw APIError.generate(429, { error: { message: "slow down" } }, "x", new Headers());
          return {
            id: "r",
            model: MODELS.agentPrimary,
            output: [],
            usage: { input: 1_000, cached: 200, cacheWrite: 0, output: 50 },
          };
        },
      },
      { clock: instantClock(), fallbackAfter5xx: 3 },
    );
    await caller.call(request, new AbortController().signal);
    const [span] = telemetry.spans().filter((s) => s.name === "mt.model.request");
    expect(span!.attributes).toMatchObject({
      "mt.model.name": MODELS.agentPrimary,
      "mt.model.fallback": false,
      "mt.model.attempts": 2,
      "mt.model.tokens.input": 1_000,
      "mt.model.tokens.cached": 200,
      "mt.model.tokens.output": 50,
    });
    expect(span!.attributes["mt.model.cost_usd"]).toBeGreaterThan(0);
    expect(await telemetry.metric("mt.model.tokens")).toHaveLength(3);
  });

  it("records a rejection by its code, never the API's message", async () => {
    const caller = new ModelCaller(
      {
        create: async () => {
          throw APIError.generate(
            400,
            { error: { message: "bad request quoting page-canary" } },
            "bad request quoting page-canary",
            new Headers(),
          );
        },
      },
      { clock: instantClock(), fallbackAfter5xx: 3 },
    );
    await expect(caller.call(request, new AbortController().signal)).rejects.toMatchObject({
      code: "model_request_rejected",
    });
    const [span] = telemetry.spans();
    expect(span!.attributes["mt.error.code"]).toBe("model_request_rejected");
    expect(await telemetry.exported()).not.toContain("page-canary");
  });
});
