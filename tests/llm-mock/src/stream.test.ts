import { describe, expect, it } from "vitest";
import { streamFrames } from "./stream.ts";

describe("mock SSE frames", () => {
  it("emits deltas, complete items and usage in order", () => {
    const frames = streamFrames({
      id: "resp_1",
      model: "m",
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello world, this is long" }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const types = [...frames.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    expect(types[0]).toBe("response.created");
    expect(types.filter((t) => t === "response.output_text.delta").length).toBeGreaterThan(1);
    expect(types.at(-2)).toBe("response.output_item.done");
    expect(types.at(-1)).toBe("response.completed");
  });
});
