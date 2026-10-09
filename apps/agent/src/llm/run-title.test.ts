import { MODELS } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { policyProblems } from "../../../../tests/llm-mock/src/policy.ts";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { createOpenAI } from "./openai.ts";
import {
  RUN_TITLE_MAX_OUTPUT_TOKENS,
  createRunTitler,
  runTitlePrompt,
  type RunTitler,
} from "./run-title.ts";

let mock: LlmMock;
let titler: RunTitler;
beforeAll(async () => {
  mock = await startLlmMock();
  titler = createRunTitler(createOpenAI({ apiKey: "k", baseURL: `${mock.url}/v1` }));
});
afterAll(async () => {
  await mock?.close();
});

const run = {
  goal:
    "Take notes on section 4.4 https://learn.zybooks.com/zybook/UTD2310/chapter/4/section/4?sig=AbC123\n" +
    "Sign in as me@uni.edu with password: Kestrel#9!",
  allowedOrigins: ["https://learn.zybooks.com", "https://www.example.org"],
};

describe("runTitlePrompt (D38: goal and hosts only, redacted)", () => {
  it("sends the redacted goal and the source hosts, never link paths, emails or secrets", () => {
    const prompt = runTitlePrompt(run);
    expect(prompt).toContain("Take notes on section 4.4 learn.zybooks.com");
    expect(prompt).toContain("Source hosts: learn.zybooks.com, example.org");
    for (const leak of ["/zybook/", "sig=", "me@uni.edu", "Kestrel"])
      expect(prompt).not.toContain(leak);
  });

  it("bounds the goal it sends", () => {
    const prompt = runTitlePrompt({ goal: "word ".repeat(1_000), allowedOrigins: [] });
    expect(prompt.length).toBeLessThan(1_100);
    expect(prompt).toContain("Source hosts: none");
  });
});

describe("createRunTitler (llm-mock)", () => {
  it("asks the small model statelessly with a strict schema and a token cap, and prices the call", async () => {
    mock.setStructured("run_title", () => ({ title: "Notes on two's complement (zyBooks 4.4)" }));
    const before = mock.requests.length;
    const title = await titler.generate(run);
    expect(title.title).toBe("Notes on two's complement (zyBooks 4.4)");
    expect(title.usage.usd).toBeGreaterThan(0);
    expect(title.usage.steps).toBe(0);
    const sent = mock.requests.slice(before);
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body as Record<string, unknown> & {
      text?: { format?: { name?: string; strict?: boolean } };
    };
    expect(body).toMatchObject({
      model: MODELS.runTitle,
      store: false,
      max_output_tokens: RUN_TITLE_MAX_OUTPUT_TOKENS,
    });
    expect(body.text?.format).toMatchObject({ name: "run_title", strict: true });
    expect(policyProblems(sent)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Kestrel");
  });

  it("treats the answer as untrusted: control, bidi and zero-width characters go", async () => {
    mock.setStructured("run_title", () => ({ title: "Notes\u202E on\u0007 <b>x</b>\u200B" }));
    expect((await titler.generate(run)).title).toBe("Notes on <b>x</b>");
  });

  it.each([
    ["an answer over the length limit", () => ({ title: "x".repeat(61) })],
    ["an empty answer", () => ({ title: "" })],
    ["an answer that cleans to nothing", () => ({ title: "\u200B\u202E" })],
    ["an answer of the wrong shape", () => ({ name: "Notes" })],
  ])("throws on %s, so the caller keeps the fallback", async (_label, answer) => {
    mock.setStructured("run_title", answer);
    await expect(titler.generate(run)).rejects.toThrow();
  });
});
