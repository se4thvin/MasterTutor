import { MODELS } from "@mastertutor/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { ModelCaller } from "../llm/caller.ts";
import { createOpenAIModelClient } from "../llm/client.ts";
import { functionCallOutput, userMessage } from "../llm/items.ts";
import { instantClock } from "../runtime/clock.ts";
import { seedFromSummary, summarizeContext, summarizeTranscript } from "./compaction.ts";

let mock: LlmMock | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const summary = {
  goal: "[scenario:c] g",
  plan: { items: [{ text: "a", done: true }] },
  progress: "p",
  facts: ["f"],
  openQuestions: [],
};

async function deps() {
  mock = await startLlmMock({ scenarios: [{ name: "c", turns: [], compaction: summary }] });
  const caller = new ModelCaller(
    createOpenAIModelClient({ apiKey: "k", baseURL: `${mock.url}/v1` }),
    { clock: instantClock(), fallbackAfter5xx: 3 },
  );
  return {
    caller,
    model: MODELS.agentPrimary,
    instructions: "i",
    toolProfile: "browser_use" as const,
    signal: new AbortController().signal,
  };
}

describe("compaction (spec §5.4)", () => {
  it("summarizes the full context it is given, statelessly", async () => {
    const d = await deps();
    const context = [
      userMessage(["[scenario:c] goal"], null),
      { type: "function_call", call_id: "call_1", name: "read_page", arguments: "{}" } as never,
      functionCallOutput("call_1", "{}"),
    ];
    const result = await summarizeContext(d, context);
    expect(result.summary).toEqual(summary);
    const body = mock!.requestsFor("c")[0]!.body;
    expect(body).toMatchObject({ store: false, text: { format: { name: "compaction_summary" } } });
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).toMatchObject({ tool_choice: "none" });
    expect(JSON.stringify(body.input)).toContain("call_1");
  });

  it("rebuilds from the transcript without a previous response", async () => {
    const d = await deps();
    const result = await summarizeTranscript(
      d,
      [
        {
          dir: "out",
          item: { type: "function_call", name: "read_page", arguments: "{}" },
          responseId: "r",
          userEventId: null,
        },
      ],
      "[scenario:c] goal",
      [],
    );
    expect(result.summary.progress).toBe("p");
    const body = mock!.requestsFor("c")[0]!.body;
    expect(body).not.toHaveProperty("previous_response_id");
    expect(JSON.stringify(body.input)).toContain("read_page");
    expect(JSON.stringify(body.input)).toContain("<untrusted_page_content");
  });

  it("seeds a new chain with the summary, the last 3 screenshots as refs, and carried texts verbatim", () => {
    const run = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const seed = seedFromSummary(
      summary,
      [`runs/${run}/transcript/1-0.png`, `runs/${run}/steps/2-ab.png`],
      {
        pageText: "Current page: x",
        screenshotKey: `runs/${run}/steps/3-cd.png`,
        carried: ["Executor: the click was refused", "Message from the user: do 2.4 next"],
      },
    );
    // Refs only: nothing is fetched or re-uploaded; the request rehydrates them.
    expect(JSON.stringify(seed)).toContain(`"garage:runs/${run}/steps/3-cd.png"`);
    expect(JSON.stringify(seed)).not.toContain("data:image");
    expect(JSON.stringify(seed).match(/input_image/g)).toHaveLength(3);
    const texts = seed.flatMap((item) =>
      "content" in item && Array.isArray(item.content)
        ? item.content.flatMap((part) =>
            "text" in part && typeof part.text === "string" ? [part.text] : [],
          )
        : [],
    );
    const summaryText = texts.find((text) => text.startsWith("Summary:\n"));
    expect(JSON.parse(summaryText!.slice("Summary:\n".length))).toEqual(summary);
    expect(texts).toContain("Message from the user: do 2.4 next");
    expect(texts).toContain("Executor: the click was refused");
  });
});
