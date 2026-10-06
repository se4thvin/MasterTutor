import { MODELS } from "@mastertutor/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { ModelCaller } from "../llm/caller.ts";
import { createOpenAIModelClient } from "../llm/client.ts";
import { functionCallOutput, userMessage } from "../llm/items.ts";
import { instantClock } from "../runtime/clock.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { seedFromSummary, summarizeChain, summarizeTranscript } from "./compaction.ts";

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
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

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
    signal: new AbortController().signal,
  };
}

describe("compaction (spec §5.4)", () => {
  it("summarizes through the old chain, answering pending calls first", async () => {
    const d = await deps();
    const pending = [functionCallOutput("call_1", "{}"), userMessage(["[scenario:c] note"], null)];
    const result = await summarizeChain(d, "resp_old", pending);
    expect(result.summary).toEqual(summary);
    const body = mock!.requestsFor("c")[0]!.body;
    expect(body).toMatchObject({
      previous_response_id: "resp_old",
      text: { format: { name: "compaction_summary" } },
    });
    expect(body.tools).toBeUndefined();
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
    expect(body.previous_response_id ?? null).toBeNull();
    expect(JSON.stringify(body.input)).toContain("read_page");
    expect(JSON.stringify(body.input)).toContain("<untrusted_page_content");
  });

  it("seeds a new chain with the summary and the last 3 screenshots", async () => {
    const storage = createMemoryStorage();
    const bytes = Buffer.from(PNG.slice(22), "base64");
    await storage.put("runs/3f2504e0-4f89-41d3-9a0c-0305e82c3301/transcript/1-0.png", bytes, {
      contentType: "image/png",
    });
    await storage.put("runs/3f2504e0-4f89-41d3-9a0c-0305e82c3301/transcript/2-0.png", bytes, {
      contentType: "image/png",
    });
    const seed = await seedFromSummary(
      storage,
      summary,
      [
        "runs/3f2504e0-4f89-41d3-9a0c-0305e82c3301/transcript/1-0.png",
        "runs/3f2504e0-4f89-41d3-9a0c-0305e82c3301/transcript/2-0.png",
      ],
      { pageText: "Current page: x", screenshot: PNG },
    );
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
  });
});
