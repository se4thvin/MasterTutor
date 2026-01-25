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
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const userInput = (text: string) => [{ role: "user", content: [{ type: "input_text", text }] }];

describe("llm-mock", () => {
  it("plays a scenario turn by turn and follows previous_response_id", async () => {
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
    const second = await post({
      model: "gpt-6-astra",
      previous_response_id: first.body.id,
      input: [
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
      previous_response_id: second.body.id,
      input: [
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
    expect(
      (await post({ model: "x", previous_response_id: third.body.id, input: [] })).status,
    ).toBe(409);
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
    const unpaired = await post({ previous_response_id: first.body.id, input: [] });
    expect(unpaired.status).toBe(400);
    const unknown = await post({
      previous_response_id: first.body.id,
      input: [{ type: "function_call_output", call_id: "call_nope", output: "{}" }],
    });
    expect(unknown.status).toBe(400);
    expect(mock.failures).toHaveLength(2);
    const ok = await post({
      previous_response_id: first.body.id,
      input: [{ type: "function_call_output", call_id: call.call_id, output: "{}" }],
    });
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
});
