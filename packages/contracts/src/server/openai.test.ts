import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { policyProblems } from "../../../../tests/llm-mock/src/policy.ts";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { hashEmbedding } from "../testing/embedding.ts";
import { StructuredParseError, createOpenAI, statelessParams } from "./openai.ts";

let mock: LlmMock;
beforeAll(async () => {
  mock = await startLlmMock();
});
afterAll(async () => {
  await mock?.close();
});
const client = () => createOpenAI({ apiKey: "k", baseURL: `${mock.url}/v1` });
const signal = () => new AbortController().signal;

describe("the single OpenAI factory (openai-data-policy.md)", () => {
  it("parses structured answers statelessly with the task text in instructions", async () => {
    mock.setStructured("probe_format", () => ({ answer: 42 }));
    const reply = await client().responses.parse(
      {
        model: "gpt-6-luna",
        instructions: "Answer.",
        input: [{ role: "user", content: "q" }],
        schema: z.object({ answer: z.number() }),
        name: "probe_format",
      },
      { signal: signal() },
    );
    expect(reply.parsed).toEqual({ answer: 42 });
    expect(reply.tokens).toEqual({ input: 1_000, cached: 0, output: 100 });
    const sent = mock.requests.at(-1)!;
    expect(sent.body).toMatchObject({ store: false, instructions: "Answer." });
    expect(JSON.stringify(sent.body.input)).not.toContain('"system"');
  });

  it("sends max_output_tokens only when a structured request caps it", async () => {
    mock.setStructured("capped_format", () => ({ answer: 1 }));
    const ask = (maxOutputTokens?: number) =>
      client().responses.parse(
        {
          model: "gpt-6-luna",
          instructions: "Answer.",
          input: [],
          schema: z.object({ answer: z.number() }),
          name: "capped_format",
          maxOutputTokens,
        },
        { signal: signal() },
      );
    await ask(200);
    expect(mock.requests.at(-1)!.body).toMatchObject({ max_output_tokens: 200, store: false });
    await ask();
    expect(mock.requests.at(-1)!.body).not.toHaveProperty("max_output_tokens");
  });

  it("rejects a structured answer that does not match the schema", async () => {
    mock.setStructured("bad_format", () => ({ answer: "x" }));
    await expect(
      client().responses.parse(
        {
          model: "m",
          instructions: "i",
          input: [],
          schema: z.object({ answer: z.number() }),
          name: "bad_format",
        },
        { signal: signal() },
      ),
    ).rejects.toThrow();
  });

  it("fixes the embeddings model and encoding and reports tokens", async () => {
    const out = await client().embeddings.create({ input: ["a b", "c"] }, { signal: signal() });
    expect(out.data[1]!.embedding).toEqual(hashEmbedding("c"));
    expect(out.tokens).toBe(2);
    expect(mock.requests.at(-1)!.body).toMatchObject({
      model: "text-embedding-3-small",
      encoding_format: "float",
    });
  });

  it("forces the diarized transcription fields", async () => {
    const out = await client().audio.transcriptions.create(
      { bytes: new TextEncoder().encode("RIFF"), filename: "chunk-000.wav" },
      { signal: signal() },
    );
    expect(out.segments[0]).toEqual({
      start: 0,
      end: 3,
      text: "Welcome to the lecture.",
      speaker: "A",
    });
    expect(out.seconds).toBe(6);
    expect(mock.requests.at(-1)!.body).toMatchObject({
      model: "gpt-4o-transcribe-diarize",
      response_format: "diarized_json",
      chunking_strategy: "auto",
    });
  });

  it("leaves every recorded request policy-clean", () => {
    expect(policyProblems(mock.requests)).toEqual([]);
    expect(mock.failures).toEqual([]);
  });

  it("never logs a request, even when OPENAI_LOG asks for debug output (Task 0 review M2)", async () => {
    const previous = process.env.OPENAI_LOG;
    process.env.OPENAI_LOG = "debug";
    const spies = (["log", "info", "debug", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    try {
      await client().embeddings.create({ input: ["MARMOT4CANARY8VELVET"] }, { signal: signal() });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
      if (previous === undefined) delete process.env.OPENAI_LOG;
      else process.env.OPENAI_LOG = previous;
    }
  });

  it("still strips chaining and identifiers whatever the caller passed", () => {
    expect(
      statelessParams({
        model: "m",
        input: [],
        store: true,
        user: "u",
        metadata: { a: "b" },
      } as never),
    ).toEqual({ model: "m", input: [], store: false });
  });
});

describe("reasoning effort (D52, spike §10)", () => {
  it("sends a reasoning effort only when a structured request asks for one", async () => {
    mock.setStructured("effort_format", () => ({ answer: 1 }));
    const ask = (reasoningEffort?: "none" | "low") =>
      client().responses.parse(
        {
          model: "gpt-6-luna",
          instructions: "Answer.",
          input: [{ role: "user", content: "q" }],
          schema: z.object({ answer: z.number() }),
          name: "effort_format",
          reasoningEffort,
        },
        { signal: signal() },
      );
    await ask("none");
    expect(mock.requests.at(-1)!.body).toMatchObject({ reasoning: { effort: "none" } });
    await ask();
    expect(mock.requests.at(-1)!.body).not.toHaveProperty("reasoning");
  });
});

describe("an unparseable structured reply (review: billed, so counted)", () => {
  it("throws StructuredParseError carrying the billed usage, never the text", async () => {
    mock.setStructured("prose_format", () => ({ answer: "We need classify only metadata" }));
    const error = await client()
      .responses.parse(
        {
          model: "gpt-6-luna",
          instructions: "Answer.",
          input: [{ role: "user", content: "q" }],
          schema: z.object({ answer: z.number() }),
          name: "prose_format",
        },
        { signal: signal() },
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StructuredParseError);
    expect((error as StructuredParseError).tokens).toEqual({
      input: 1_000,
      cached: 0,
      output: 100,
    });
    expect(String((error as Error).message)).not.toContain("We need");
  });
});

describe("responses.stream", () => {
  it("streams text, complete items and usage without retention or identifiers", async () => {
    mock.setScenarios([
      {
        name: "stream_probe",
        turns: [{ outputs: [{ type: "turn", status: "done", reason: "Hello there, owner." }] }],
      },
    ]);
    const events = [];
    for await (const event of client().responses.stream(
      { model: "gpt-6.1-sol", input: [{ role: "user", content: "[scenario:stream_probe] hi" }] },
      { signal: signal() },
    ))
      events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      tokens: { input: 1000, output: 100 },
    });
    expect(events.some((e) => e.type === "item")).toBe(true);
    expect(events.filter((e) => e.type === "text").length).toBeGreaterThan(0);
    const sent = mock.requests.at(-1)!.body;
    expect(sent).toMatchObject({ store: false, stream: true });
    expect(sent).not.toHaveProperty("prompt_cache_retention");
    expect(policyProblems(mock.requests)).toEqual([]);
  });
  it("stops when the signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(async () => {
      for await (const event of client().responses.stream(
        { model: "m", input: "x" },
        { signal: controller.signal },
      ))
        void event;
    }).rejects.toThrow();
  });
});

it("omits prompt_cache_retention even when supplied at runtime (amended D52)", () => {
  expect(
    statelessParams({ model: "m", input: "x", prompt_cache_retention: "24h" }),
  ).not.toHaveProperty("prompt_cache_retention");
});
