import { afterEach, describe, expect, it } from "vitest";
import { SCENARIOS } from "./scenarios/index.ts";
import { startLlmMock, type LlmMock } from "./server.ts";

let mock: LlmMock | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function post(body: unknown) {
  const response = await fetch(`${mock!.url}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ store: false, ...(body as Record<string, unknown>) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const userInput = (text: string) => [{ role: "user", content: [{ type: "input_text", text }] }];

describe("llm-mock", () => {
  it("lets click_named carry the model's pending safety checks", async () => {
    mock = await startLlmMock({
      scenarios: [
        {
          name: "warn",
          turns: [
            {
              outputs: [
                {
                  type: "function",
                  name: "read_page",
                  args: { mode: "interactive", sinceHash: null },
                },
              ],
            },
            {
              outputs: [
                {
                  type: "click_named",
                  name: "Continue",
                  safetyChecks: [
                    { id: "sc_1", code: "malicious_instructions", message: "Injected text" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const first = await post({ model: "gpt-6-astra", input: userInput("[scenario:warn] go") });
    const read = (first.body.output as Array<Record<string, unknown>>)[0]!;
    const page = JSON.stringify({
      hash: "a".repeat(64),
      url: "http://x/",
      title: "T",
      elements: [
        { ref: "e1", tag: "a", role: "link", name: "Continue", attrs: {}, point: { x: 5, y: 6 } },
      ],
    });
    const second = await post({
      model: "gpt-6-astra",
      input: [
        ...userInput("[scenario:warn] go"),
        read,
        { type: "function_call_output", call_id: read.call_id, output: page },
      ],
    });
    expect((second.body.output as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: "computer_call",
      actions: [{ type: "click", x: 5, y: 6, button: "left" }],
      pending_safety_checks: [
        { id: "sc_1", code: "malicious_instructions", message: "Injected text" },
      ],
    });
  });

  it("answers fill_named with a fill_credential call on the named element's ref", async () => {
    mock = await startLlmMock({
      scenarios: [
        {
          name: "fill",
          turns: [
            {
              outputs: [
                {
                  type: "function",
                  name: "read_page",
                  args: { mode: "interactive", sinceHash: null },
                },
              ],
            },
            {
              outputs: [{ type: "fill_named", alias: "site", field: "password", name: "Password" }],
            },
          ],
        },
      ],
    });
    const first = await post({ model: "gpt-6-astra", input: userInput("[scenario:fill] go") });
    const read = (first.body.output as Array<Record<string, unknown>>)[0]!;
    const readPageOutput = JSON.stringify({
      hash: "a".repeat(64),
      url: "http://x/",
      title: "T",
      elements: [
        {
          ref: "e4",
          tag: "input",
          role: "textbox",
          name: "Password",
          attrs: {},
          point: { x: 1, y: 2 },
        },
      ],
    });
    const second = await post({
      model: "gpt-6-astra",
      input: [
        ...userInput("[scenario:fill] go"),
        read,
        { type: "function_call_output", call_id: read.call_id, output: readPageOutput },
      ],
    });
    const call = (second.body.output as Array<Record<string, unknown>>)[0]!;
    expect(call).toMatchObject({ type: "function_call", name: "fill_credential" });
    expect(JSON.parse(call.arguments as string)).toEqual({
      alias: "site",
      field: "password",
      target: "e4",
    });
  });

  it("plays a scenario turn by turn from full stateless inputs", async () => {
    mock = await startLlmMock({
      scenarios: [
        {
          name: "basic",
          turns: [
            {
              outputs: [
                {
                  type: "function",
                  name: "read_page",
                  args: { mode: "interactive", sinceHash: null },
                },
              ],
              usage: { input: 1_000 },
            },
            { outputs: [{ type: "click_named", name: "Next" }] },
            { outputs: [{ type: "turn", status: "done", reason: "Finished" }] },
          ],
        },
      ],
    });
    const first = await post({ model: "gpt-6-astra", input: userInput("[scenario:basic] go") });
    expect(first.status).toBe(200);
    const call = (first.body.output as Array<Record<string, unknown>>)[0]!;
    expect(call).toMatchObject({ type: "function_call", name: "read_page" });
    expect(first.body.usage).toMatchObject({ input_tokens: 1_000 });
    const readPageOutput = JSON.stringify({
      hash: "a".repeat(64),
      url: "http://x/",
      title: "T",
      elements: [
        {
          ref: "e1",
          tag: "a",
          role: "link",
          name: "Next page",
          attrs: {},
          point: { x: 40, y: 60 },
        },
      ],
    });
    const history = [...userInput("[scenario:basic] go"), call];
    const second = await post({
      model: "gpt-6-astra",
      input: [
        ...history,
        {
          type: "function_call_output",
          call_id: call.call_id,
          output: `<untrusted_page_content origin="http://x">\n${readPageOutput}\n</untrusted_page_content>`,
        },
      ],
    });
    expect((second.body.output as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: "computer_call",
      actions: [{ type: "click", x: 40, y: 60, button: "left" }],
    });
    const clickCall = (second.body.output as Array<Record<string, unknown>>)[0]!;
    const third = await post({
      model: "gpt-6-astra",
      input: [
        ...history,
        {
          type: "function_call_output",
          call_id: call.call_id,
          output: "{}",
        },
        clickCall,
        {
          type: "computer_call_output",
          call_id: clickCall.call_id,
          output: { type: "computer_screenshot", image_url: "data:image/png;base64,AAAA" },
        },
      ],
    });
    const message = (third.body.output as Array<{ content: Array<{ text: string }> }>)[0]!;
    expect(JSON.parse(message.content[0]!.text)).toEqual({
      status: "done",
      needHuman: null,
      reason: "Finished",
      planUpdate: null,
    });
    expect((await post({ model: "x", input: userInput("[scenario:basic] again") })).status).toBe(
      409,
    );
    expect(mock.requestsFor("basic")).toHaveLength(4);
  });

  it("returns scripted errors, answers compaction without advancing, and records failed checks", async () => {
    mock = await startLlmMock({
      scenarios: [
        {
          name: "errors",
          turns: [
            { error: { status: 500, message: "boom" } },
            {
              check: () => {
                throw new Error("expected a screenshot");
              },
            },
          ],
        },
      ],
    });
    const failed = await post({ input: userInput("[scenario:errors]") });
    expect(failed.status).toBe(500);
    const compaction = await post({
      input: userInput("[scenario:errors] summarize"),
      text: { format: { name: "compaction_summary" } },
    });
    expect(compaction.status).toBe(200);
    expect((await post({ input: userInput("[scenario:errors]") })).status).toBe(418);
    expect(mock.failures).toEqual(["errors turn 1: expected a screenshot"]);
  });

  it("rejects unknown and unpaired tool outputs like the real API", async () => {
    mock = await startLlmMock({
      scenarios: [
        {
          name: "pairing",
          turns: [
            {
              outputs: [
                { type: "function", name: "read_page", args: { mode: "text", sinceHash: null } },
              ],
            },
            { outputs: [{ type: "turn", status: "done", reason: "ok" }] },
          ],
        },
      ],
    });
    const first = await post({ input: userInput("[scenario:pairing]") });
    const call = (first.body.output as Array<Record<string, unknown>>)[0]!;
    const history = [...userInput("[scenario:pairing]"), call];
    const unpaired = await post({ input: history });
    expect(unpaired.status).toBe(400);
    const unknown = await post({
      input: [...history, { type: "function_call_output", call_id: "call_nope", output: "{}" }],
    });
    expect(unknown.status).toBe(400);
    const output = { type: "function_call_output", call_id: call.call_id, output: "{}" };
    const twice = await post({ input: [...history, output, output] });
    expect(twice.status).toBe(400);
    const before = await post({ input: [...userInput("[scenario:pairing]"), output, call] });
    expect(before.status).toBe(400);
    expect(mock.failures).toHaveLength(4);
    const ok = await post({ input: [...history, output] });
    expect(ok.status).toBe(200);
  });

  it("emits the single-action computer_call shape and reasoning items", async () => {
    mock = await startLlmMock({ scenarios: SCENARIOS.filter((s) => s.name === "wire-shapes") });
    const first = await post({ input: userInput("[scenario:wire-shapes]") });
    const output = first.body.output as Array<Record<string, unknown>>;
    expect(output[0]).toMatchObject({ type: "reasoning" });
    expect(output[1]).toMatchObject({ type: "computer_call", action: { type: "screenshot" } });
    expect(output[1]).not.toHaveProperty("actions");
  });

  it("rejects a replayed reasoning item without encrypted_content like the real store:false API", async () => {
    mock = await startLlmMock({ scenarios: SCENARIOS.filter((s) => s.name === "wire-shapes") });
    const input = userInput("[scenario:wire-shapes]");
    const first = await post({ input });
    const [reasoning, call] = first.body.output as Array<Record<string, unknown>>;
    expect(reasoning).toMatchObject({ type: "reasoning" });
    const output = {
      type: "computer_call_output",
      call_id: call!.call_id,
      output: { type: "computer_screenshot", image_url: "data:image/png;base64,AA==" },
    };
    const { encrypted_content: _dropped, ...bare } = reasoning!;
    const stripped = await post({ input: [...input, bare, call, output] });
    expect(stripped.status).toBe(400);
    const empty = await post({
      input: [...input, { ...reasoning, encrypted_content: "" }, call, output],
    });
    expect(empty.status).toBe(400);
    expect(mock.failures).toHaveLength(2);
    expect((await post({ input: [...input, reasoning, call, output] })).status).toBe(200);
  });

  it("refuses stored, chained or identified requests (openai-data-policy.md)", async () => {
    mock = await startLlmMock({
      scenarios: [
        { name: "policy", turns: [{ outputs: [{ type: "turn", status: "done", reason: "ok" }] }] },
      ],
    });
    const input = userInput("[scenario:policy]");
    for (const extra of [
      { store: true },
      { store: undefined },
      { previous_response_id: "resp_1" },
      { metadata: { runId: "r" } },
      { user: "u" },
      { safety_identifier: "s" },
      { conversation: "conv_1" },
      { background: false },
    ])
      expect((await post({ input, ...extra })).status).toBe(400);
    expect(mock.failures).toHaveLength(8);
    expect((await post({ input })).status).toBe(200);
    const other = await fetch(`${mock.url}/v1/files`, { method: "POST", body: "{}" });
    expect(other.status).toBe(404);
    expect(mock.requests.at(-1)?.path).toBe("/v1/files");
  });
});
