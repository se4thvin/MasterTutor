import { streamFrames } from "./stream.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { hashEmbedding } from "@mastertutor/contracts/testing";
import { FORBIDDEN_FIELDS } from "./policy.ts";
import type { MockOutput, MockRequestBody, RecordedRequest, Scenario } from "./scenario.ts";
import { scenarioTag } from "./select.ts";

export interface LlmMock {
  url: string;
  requests: RecordedRequest[];
  failures: string[];
  setScenarios(list: readonly Scenario[]): void;
  /** One scenario's requests, or one run's when `nonce` is given (scenarioGoal). */
  requestsFor(name: string, nonce?: string): RecordedRequest[];
  /** Answers structured Responses calls with json_schema `name` (OCR, filing, run title) with `answer(body)`. */
  setStructured(name: string, answer: (body: MockRequestBody) => unknown): void;
  close(): Promise<void>;
}

interface ScenarioState {
  cursor: number;
  elements: Array<{ ref: string; name: string; point: { x: number; y: number } | null }>;
}

async function readJson(request: IncomingMessage): Promise<MockRequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as MockRequestBody;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function latestElements(body: MockRequestBody): ScenarioState["elements"] | null {
  const items = Array.isArray(body.input) ? (body.input as Array<Record<string, unknown>>) : [];
  let found: ScenarioState["elements"] | null = null;
  for (const item of items) {
    if (item.type !== "function_call_output" || typeof item.output !== "string") continue;
    const text = item.output;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        elements?: ScenarioState["elements"];
      };
      if (Array.isArray(parsed.elements)) found = parsed.elements;
    } catch {
      // Not a read_page result.
    }
  }
  return found;
}

const SUMMARY = "Summary:\n";

/**
 * The run's scenario (D26): the tag in the first text of the first user message (the goal, or a
 * compaction request's "Run goal"), else the goal of a compaction seed's summary (its second text).
 * Page text, tool output and later messages are never read, so a page cannot reroute a run.
 */
function routeOf(body: MockRequestBody): { name: string; nonce: string | null } | null {
  const items = Array.isArray(body.input) ? (body.input as Array<Record<string, unknown>>) : [];
  const content = items.find((item) => item.role === "user")?.content;
  const texts =
    typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? (content as Array<Record<string, unknown>>)
            .filter((part) => part.type === "input_text" && typeof part.text === "string")
            .map((part) => part.text as string)
        : [];
  const direct = texts[0] === undefined ? null : scenarioTag(texts[0]);
  if (direct) return direct;
  const summary = texts[1];
  if (!summary?.startsWith(SUMMARY)) return null;
  try {
    const goal = (JSON.parse(summary.slice(SUMMARY.length)) as { goal?: unknown }).goal;
    return typeof goal === "string" ? scenarioTag(goal) : null;
  } catch {
    return null;
  }
}

/** openai-data-policy.md: stateless and anonymous, or the request is refused. */
export function requestPolicyProblem(body: MockRequestBody): string | null {
  if (body.store !== false) return "store must be false.";
  for (const field of FORBIDDEN_FIELDS) if (field in body) return `${field} must not be sent.`;
  // With store:false a reasoning item can only be replayed with its encrypted content.
  const items = Array.isArray(body.input) ? (body.input as Array<Record<string, unknown>>) : [];
  for (const item of items) {
    if (item.type !== "reasoning") continue;
    if (typeof item.encrypted_content !== "string" || item.encrypted_content.length === 0)
      return `Reasoning item ${String(item.id)} must carry encrypted_content when store is false.`;
  }
  return null;
}

export async function startLlmMock(
  options: { port?: number; host?: string; scenarios?: readonly Scenario[] } = {},
): Promise<LlmMock> {
  const scenarios = new Map<string, Scenario>();
  const states = new Map<string, ScenarioState>();
  /** Every call_id the mock has issued; replayed calls and outputs must refer to one of them. */
  const issued = new Set<string>();
  const requests: RecordedRequest[] = [];
  const failures: string[] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${(++counter).toString(36)}`;

  const setScenarios = (list: readonly Scenario[]) => {
    for (const scenario of list) {
      scenarios.set(scenario.name, scenario);
      for (const key of [...states.keys()])
        if (key.startsWith(`${scenario.name}#`)) states.delete(key);
    }
  };
  /** One cursor per run: `name#nonce`; nonce-less tags (behaviour tests) share `name#`. */
  const stateFor = (name: string, nonce: string | null): ScenarioState => {
    const key = `${name}#${nonce ?? ""}`;
    let state = states.get(key);
    if (!state) {
      state = { cursor: 0, elements: [] };
      states.set(key, state);
    }
    return state;
  };
  setScenarios(options.scenarios ?? []);

  /** Summaries come back only when the request sets `reasoning.summary`, as with the real API. */
  const wantsSummary = (body: MockRequestBody) => {
    const reasoning = body.reasoning as { summary?: unknown } | undefined;
    return typeof reasoning?.summary === "string";
  };
  const build = (outputs: readonly MockOutput[], state: ScenarioState, summarize: boolean) =>
    outputs.map((output) => {
      switch (output.type) {
        case "computer":
          return {
            type: "computer_call",
            id: nextId("cu"),
            call_id: nextId("call"),
            status: "completed",
            actions: output.actions,
            pending_safety_checks: output.safetyChecks ?? [],
          };
        case "click_named": {
          const element = state.elements.find(
            (candidate) => candidate.name.startsWith(output.name) && candidate.point,
          );
          if (!element?.point)
            throw new Error(`click_named: no element named "${output.name}" with a point`);
          return {
            type: "computer_call",
            id: nextId("cu"),
            call_id: nextId("call"),
            status: "completed",
            actions: [
              { type: "click", x: element.point.x, y: element.point.y, button: "left" },
              ...(output.then ?? []),
            ],
            pending_safety_checks: output.safetyChecks ?? [],
          };
        }
        case "fill_named": {
          const element = state.elements.find((candidate) =>
            candidate.name.startsWith(output.name),
          );
          if (!element) throw new Error(`fill_named: no element named "${output.name}"`);
          return {
            type: "function_call",
            id: nextId("fc"),
            call_id: nextId("call"),
            name: "fill_credential",
            arguments: JSON.stringify({
              alias: output.alias,
              field: output.field,
              target: element.ref,
            }),
            status: "completed",
          };
        }
        case "computer_single":
          return {
            type: "computer_call",
            id: nextId("cu"),
            call_id: nextId("call"),
            status: "completed",
            action: output.action,
            pending_safety_checks: [],
          };
        case "reasoning":
          return {
            type: "reasoning",
            id: nextId("rs"),
            encrypted_content: `enc_${counter.toString(36)}`,
            summary: output.text && summarize ? [{ type: "summary_text", text: output.text }] : [],
          };
        case "function":
          return {
            type: "function_call",
            id: nextId("fc"),
            call_id: nextId("call"),
            name: output.name,
            arguments: JSON.stringify(output.args),
            status: "completed",
          };
        case "turn":
          return {
            type: "message",
            id: nextId("msg"),
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                annotations: [],
                text: JSON.stringify({
                  status: output.status,
                  needHuman: output.needHuman ?? null,
                  reason: output.reason,
                  planUpdate: output.plan ? { items: output.plan } : null,
                }),
              },
            ],
          };
      }
    });

  const respond = (
    response: ServerResponse,
    body: MockRequestBody,
    name: string | null,
    output: unknown[],
    usage: { input?: number; cached?: number; cacheWrite?: number; output?: number } = {},
  ) => {
    const id = nextId("resp");
    void name;
    for (const item of output as Array<{ type?: string; call_id?: string }>) {
      if ((item.type === "function_call" || item.type === "computer_call") && item.call_id)
        issued.add(item.call_id);
    }
    const input = usage.input ?? 1_000;
    const out = usage.output ?? 100;
    const payload = {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: body.model ?? "mock",
      output,
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: {},
      parallel_tool_calls: true,
      temperature: null,
      tool_choice: "auto",
      tools: [],
      top_p: null,
      usage: {
        input_tokens: input,
        input_tokens_details: {
          cached_tokens: usage.cached ?? 0,
          cache_write_tokens: usage.cacheWrite ?? 0,
        },
        output_tokens: out,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: input + out,
      },
    };
    if (body.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      response.end(streamFrames(payload));
      return;
    }
    send(response, 200, payload);
  };

  /**
   * Stateless requests carry the whole context, so pairing is checked across the whole input: every
   * output follows its call, and every call is answered exactly once (the real API rejects both).
   */
  const pairingProblem = (body: MockRequestBody): string | null => {
    const items = Array.isArray(body.input) ? (body.input as Array<Record<string, unknown>>) : [];
    const open = new Set<string>();
    const answered = new Set<string>();
    for (const item of items) {
      const id = typeof item.call_id === "string" ? item.call_id : null;
      if (!id) continue;
      if (item.type === "function_call" || item.type === "computer_call") {
        if (!issued.has(id)) return `Unknown call_id ${id}.`;
        open.add(id);
      } else if (item.type === "function_call_output" || item.type === "computer_call_output") {
        if (!issued.has(id) || !open.has(id) || answered.has(id))
          return `No tool call found for call_id ${id}.`;
        open.delete(id);
        answered.add(id);
      }
    }
    for (const id of open) return `No tool output found for call_id ${id}.`;
    return null;
  };

  /**
   * With the computer tool declared, the real API refuses more than one input_image across the
   * input's messages; computer_call_output screenshots do not count (probed 2026-10-08).
   */
  const imageProblem = (body: MockRequestBody): string | null => {
    if (!body.tools?.some((tool) => tool.type === "computer")) return null;
    const items = Array.isArray(body.input) ? (body.input as Array<Record<string, unknown>>) : [];
    const images = items
      .flatMap((item) =>
        Array.isArray(item.content) ? (item.content as Array<{ type?: unknown }>) : [],
      )
      .filter((part) => part.type === "input_image").length;
    return images > 1 ? "Computer tool cannot use multiple image inputs." : null;
  };

  /** Structured Responses calls (OCR, filing, run title) carry no scenario tag; they route on text.format.name. */
  const ALLOW_REVIEW = { verdict: "allow", category: "other", itemKeys: [], rationale: "" };
  function guardAnswer(body: MockRequestBody): { screen: unknown; review: unknown } {
    const content = (body.input as Array<{ content?: unknown }> | undefined)?.[0]?.content;
    let parsed: { goal?: unknown } = {};
    try {
      parsed = JSON.parse(String(content));
    } catch {
      // Not a Guard payload: fall back to allow.
    }
    const name = scenarioTag(String(parsed.goal ?? ""))?.name;
    const answer = name ? scenarios.get(name)?.guard?.(parsed) : undefined;
    return {
      screen: { decision: answer?.screen ?? "allow" },
      review: answer?.review ?? ALLOW_REVIEW,
    };
  }

  const structured = new Map<string, (body: MockRequestBody) => unknown>([
    ["ocr_text", () => ({ markdown: "" })],
    ["filing_decision", () => ({ path: ["Inbox"], createLeaf: true })],
    ["run_title", () => ({ title: "Mock run title" })],
    ["guard_screen", (body) => guardAnswer(body).screen],
    ["guard_review", (body) => guardAnswer(body).review],
  ]);

  const refuse = (
    response: ServerResponse,
    path: string,
    body: MockRequestBody,
    problem: string,
  ) => {
    requests.push({ scenario: null, turn: null, body, at: Date.now(), path });
    failures.push(`${path}: ${problem}`);
    send(response, 400, { error: { message: problem, type: "invalid_request_error" } });
  };

  const handleEmbeddings = async (request: IncomingMessage, response: ServerResponse) => {
    const path = "/v1/embeddings";
    const body = await readJson(request);
    const field = FORBIDDEN_FIELDS.find((name) => name in body);
    if (field) return refuse(response, path, body, `${field} must not be sent.`);
    const input = typeof body.input === "string" ? [body.input] : body.input;
    if (
      !Array.isArray(input) ||
      input.length === 0 ||
      input.some((text) => typeof text !== "string")
    )
      return refuse(response, path, body, "input must be a non-empty string array.");
    requests.push({ scenario: null, turn: null, body, at: Date.now(), path });
    send(response, 200, {
      object: "list",
      model: body.model ?? "mock",
      data: (input as string[]).map((text, index) => ({
        object: "embedding",
        index,
        embedding: hashEmbedding(text),
      })),
      usage: { prompt_tokens: input.length, total_tokens: input.length },
    });
  };

  const handleTranscriptions = async (request: IncomingMessage, response: ServerResponse) => {
    const path = "/v1/audio/transcriptions";
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers["content-type"] ?? "" },
    }).formData();
    const body: MockRequestBody = {};
    for (const [key, value] of form.entries())
      body[key] = typeof value === "string" ? value : `<${value.size} bytes>`;
    const field = FORBIDDEN_FIELDS.find((name) => name in body);
    if (field) return refuse(response, path, body, `${field} must not be sent.`);
    requests.push({ scenario: null, turn: null, body, at: Date.now(), path });
    send(response, 200, {
      task: "transcribe",
      duration: 6,
      text: "Welcome to the lecture. Today we study photosynthesis.",
      segments: [
        {
          id: "seg_0",
          type: "transcript.text.segment",
          start: 0,
          end: 3,
          speaker: "A",
          text: "Welcome to the lecture.",
        },
        {
          id: "seg_1",
          type: "transcript.text.segment",
          start: 3,
          end: 6,
          speaker: "B",
          text: "Today we study photosynthesis.",
        },
      ],
    });
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://mock");
      if (request.method === "GET" && url.pathname === "/__mock/requests") {
        const nonce = url.searchParams.get("nonce");
        return send(
          response,
          200,
          nonce === null ? requests : requests.filter((entry) => entry.nonce === nonce),
        );
      }
      const path = request.url ?? "";
      if (request.method === "POST" && path === "/v1/embeddings")
        return handleEmbeddings(request, response);
      if (request.method === "POST" && path === "/v1/audio/transcriptions")
        return handleTranscriptions(request, response);
      if (request.method !== "POST" || path !== "/v1/responses") {
        requests.push({ scenario: null, turn: null, body: {}, at: Date.now(), path });
        return send(response, 404, { error: { message: "not found" } });
      }
      const body = await readJson(request);
      const format = body.text?.format?.name;
      const answer = format ? structured.get(format) : undefined;
      if (answer) {
        const policy = requestPolicyProblem(body);
        if (policy) return refuse(response, path, body, policy);
        const route = format?.startsWith("guard_") ? routeOf(body) : null;
        requests.push({
          scenario: route?.name ?? null,
          nonce: route?.nonce ?? null,
          turn: null,
          body,
          at: Date.now(),
          path,
        });
        return respond(response, body, route?.name ?? null, [
          {
            type: "message",
            id: nextId("msg"),
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", annotations: [], text: JSON.stringify(await answer(body)) },
            ],
          },
        ]);
      }

      const route = routeOf(body);
      const name = route?.name ?? null;
      const nonce = route?.nonce ?? null;
      const scenario = name ? scenarios.get(name) : undefined;
      if (!scenario || !name) {
        requests.push({ scenario: null, turn: null, body, at: Date.now(), path });
        return send(response, 404, {
          error: { message: "no scenario for this request", type: "invalid_request_error" },
        });
      }
      const state = stateFor(name, nonce);
      const routed = (turn: number | null): RecordedRequest => ({
        scenario: name,
        nonce,
        turn,
        body,
        at: Date.now(),
        path,
      });
      const policy = requestPolicyProblem(body);
      if (policy) {
        requests.push(routed(null));
        failures.push(`${name} request: ${policy}`);
        return send(response, 400, {
          error: { message: policy, type: "invalid_request_error", param: null, code: null },
        });
      }
      const images = imageProblem(body);
      if (images) {
        requests.push(routed(null));
        failures.push(`${name} request: ${images}`);
        return send(response, 400, {
          error: { message: images, type: "invalid_request_error", param: "input", code: null },
        });
      }
      if (body.text?.format?.name === "compaction_summary") {
        requests.push(routed(null));
        const summary = scenario.compaction ?? {
          goal: `[scenario:${name}${nonce ? `#${nonce}` : ""}] resumed`,
          plan: { items: [] },
          progress: "",
          facts: [],
          openQuestions: [],
        };
        return respond(response, body, name, [
          {
            type: "message",
            id: nextId("msg"),
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", annotations: [], text: JSON.stringify(summary) }],
          },
        ]);
      }
      const pairing = pairingProblem(body);
      if (pairing) {
        requests.push(routed(null));
        failures.push(`${name} request: ${pairing}`);
        return send(response, 400, {
          error: { message: pairing, type: "invalid_request_error", param: "input", code: null },
        });
      }
      const index = state.cursor;
      state.cursor += 1;
      const recorded = routed(index);
      requests.push(recorded);
      const elements = latestElements(body);
      if (elements) state.elements = elements;
      const turn = scenario.turns[index];
      if (!turn)
        return send(response, 409, {
          error: { message: `scenario ${name} exhausted`, type: "invalid_request_error" },
        });
      try {
        turn.check?.(recorded);
      } catch (error) {
        failures.push(
          `${name} turn ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return send(response, 418, {
          error: { message: "scenario check failed", type: "invalid_request_error" },
        });
      }
      await turn.hold?.();
      if (turn.error) {
        return send(response, turn.error.status, {
          error: {
            message: turn.error.message ?? "scripted error",
            type: turn.error.status >= 500 ? "server_error" : "invalid_request_error",
            code: turn.error.code ?? null,
            param: null,
          },
        });
      }
      let output: unknown[];
      try {
        output = build(turn.outputs ?? [], state, wantsSummary(body));
      } catch (error) {
        failures.push(
          `${name} turn ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return send(response, 418, {
          error: { message: "scenario output failed", type: "invalid_request_error" },
        });
      }
      return respond(response, body, name, output, turn.usage);
    })().catch((error: unknown) => {
      failures.push(`mock error: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) send(response, 500, { error: { message: "mock error" } });
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    failures,
    setScenarios,
    requestsFor: (name, nonce) =>
      requests.filter(
        (entry) => entry.scenario === name && (nonce === undefined || entry.nonce === nonce),
      ),
    setStructured: (name, answer) => void structured.set(name, answer),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
