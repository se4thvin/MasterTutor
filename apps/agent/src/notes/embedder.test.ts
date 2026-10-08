import { EMBED_BATCH_SIZE } from "@mastertutor/contracts/server";
import { hashEmbedding } from "@mastertutor/contracts/testing";
import { describe, expect, it } from "vitest";
import { StepCollector } from "../loop/step-collector.ts";
import { testLogger } from "../testing/notes.ts";
import { createEmbedder } from "./embedder.ts";

describe("createEmbedder", () => {
  it("charges the batches that succeeded even when a later one fails (review I5)", async () => {
    let call = 0;
    const embedder = createEmbedder(
      {
        embeddings: {
          create: async (body) => {
            call += 1;
            if (call > 1) throw new Error("rate limited");
            return {
              data: body.input.map((text, index) => ({ index, embedding: hashEmbedding(text) })),
              tokens: 1_000,
            };
          },
        },
      },
      testLogger,
    );
    const step = new StepCollector();
    const texts = Array.from({ length: EMBED_BATCH_SIZE * 5 }, (_, i) => `block ${i}`);
    const vectors = await embedder.embed(texts, { step });
    expect(vectors.every((v) => v === null)).toBe(true);
    expect(step.usage.inputTokens).toBeGreaterThanOrEqual(1_000);
    expect(step.usage.usd).toBeGreaterThan(0);
  });
});
