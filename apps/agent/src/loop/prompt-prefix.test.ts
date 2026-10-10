import { MODELS } from "@mastertutor/contracts";
import { expect, it } from "vitest";
import { startLlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { createOpenAIModelClient } from "../llm/client.ts";
import { agentInstructions } from "../llm/instructions.ts";
import { computerCallOutput, userMessage } from "../llm/items.ts";
import { TINY_PNG } from "../testing/fake-loop-browser.ts";
import { buildModelInput } from "./model-input.ts";
import { inJsonbOrder, type TranscriptEntry } from "./transcript.ts";

it("replays the complete serialized prefix through llm-mock after a jsonb restore", async () => {
  const mock = await startLlmMock({
    scenarios: [
      {
        name: "prefix",
        turns: [
          { outputs: [{ type: "computer", actions: [{ type: "wait" }] }] },
          { outputs: [{ type: "turn", status: "done", reason: "done" }] },
        ],
      },
    ],
  });
  try {
    const client = createOpenAIModelClient({ apiKey: "test-key", baseURL: `${mock.url}/v1` });
    const image = `data:image/png;base64,${Buffer.from(TINY_PNG).toString("base64")}`;
    const request = {
      model: MODELS.agentPrimary,
      instructions: agentInstructions("browser_use"),
      toolProfile: "browser_use" as const,
      format: "agent_turn" as const,
      promptCacheKey: "opaque-test-run",
    };
    const input = buildModelInput(
      [],
      [userMessage(["[scenario:prefix] read", "Executor: budget 0"], image)],
    );
    const reply = await client.create({ ...request, input }, new AbortController().signal);
    const history: TranscriptEntry[] = [
      ...input.map((item) => ({
        dir: "in" as const,
        item: inJsonbOrder(item) as unknown as Record<string, unknown>,
        responseId: null,
        userEventId: null,
      })),
      ...reply.output.map((item) => ({
        dir: "out" as const,
        item: inJsonbOrder(item) as unknown as Record<string, unknown>,
        responseId: reply.id,
        userEventId: null,
      })),
    ];
    const call = reply.output.find(
      (item) => (item as { type: string }).type === "computer_call",
    ) as { call_id: string };
    await client.create(
      {
        ...request,
        input: buildModelInput(history, [
          computerCallOutput(call.call_id, image, []),
          userMessage(["Executor: budget 1; step 2"], null),
        ]),
      },
      new AbortController().signal,
    );
    const [first, second] = mock.requestsFor("prefix").map((r) => r.body);
    const previous = first!.input as unknown[];
    expect(JSON.stringify((second!.input as unknown[]).slice(0, previous.length))).toBe(
      JSON.stringify(previous),
    );
    expect(second!.instructions).toBe(first!.instructions);
    expect(second!.tools).toEqual(first!.tools);
    for (const body of [first!, second!]) {
      expect(body.prompt_cache_key).toBe("opaque-test-run");
      expect(body.store).toBe(false);
      expect(body).not.toHaveProperty("prompt_cache_retention");
    }
  } finally {
    await mock.close();
  }
});
