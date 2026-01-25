import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { MockOutput, MockRequestBody, RecordedRequest, Scenario } from "./scenario.ts";

export interface LlmMock {
  url: string;
  requests: RecordedRequest[];
  failures: string[];
  setScenarios(list: readonly Scenario[]): void;
  requestsFor(name: string): RecordedRequest[];
  close(): Promise<void>;
}

interface ScenarioState {
  cursor: number;
  elements: Array<{ name: string; point: { x: number; y: number } | null }>;
}

const TAG = /\[scenario:([a-z0-9_-]+)\]/i;

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

export async function startLlmMock(
  options: { port?: number; scenarios?: readonly Scenario[] } = {},
): Promise<LlmMock> {
  const scenarios = new Map<string, Scenario>();
  const states = new Map<string, ScenarioState>();
  const chains = new Map<string, string>();
  const requests: RecordedRequest[] = [];
  const failures: string[] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${(++counter).toString(36)}`;

  const setScenarios = (list: readonly Scenario[]) => {
    for (const scenario of list) {
      scenarios.set(scenario.name, scenario);
      states.set(scenario.name, { cursor: 0, elements: [] });
    }
  };
  setScenarios(options.scenarios ?? []);

  const build = (outputs: readonly MockOutput[], state: ScenarioState) =>
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
            actions: [{ type: "click", x: element.point.x, y: element.point.y, button: "left" }],
            pending_safety_checks: [],
          };
        }
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
    usage: { input?: number; cached?: number; output?: number } = {},
  ) => {
    const id = nextId("resp");
    if (name) chains.set(id, name);
    const input = usage.input ?? 1_000;
    const out = usage.output ?? 100;
    send(response, 200, {
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
        input_tokens_details: { cached_tokens: usage.cached ?? 0, cache_write_tokens: 0 },
        output_tokens: out,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: input + out,
      },
    });
  };

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/__mock/requests")
        return send(response, 200, requests);
      if (request.method !== "POST" || request.url !== "/v1/responses")
        return send(response, 404, { error: { message: "not found" } });
      const body = await readJson(request);
      const tagged = TAG.exec(JSON.stringify(body.input ?? ""))?.[1] ?? null;
      const name =
        tagged ??
        (body.previous_response_id ? (chains.get(body.previous_response_id) ?? null) : null);
      const scenario = name ? scenarios.get(name) : undefined;
      const state = name ? states.get(name) : undefined;
      if (!scenario || !state || !name) {
        requests.push({ scenario: null, turn: null, body, at: Date.now() });
        return send(response, 404, {
          error: { message: "no scenario for this request", type: "invalid_request_error" },
        });
      }
      if (body.text?.format?.name === "compaction_summary") {
        requests.push({ scenario: name, turn: null, body, at: Date.now() });
        const summary = scenario.compaction ?? {
          goal: `[scenario:${name}] resumed`,
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
      const index = state.cursor;
      state.cursor += 1;
      const recorded: RecordedRequest = { scenario: name, turn: index, body, at: Date.now() };
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
        output = build(turn.outputs ?? [], state);
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
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    failures,
    setScenarios,
    requestsFor: (name) => requests.filter((entry) => entry.scenario === name),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
