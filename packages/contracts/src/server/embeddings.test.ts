import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../constants.ts";
import { fakeEmbeddingsClient, hashEmbedding } from "../testing/embedding.ts";
import { EMBED_BATCH_SIZE, EMBED_CONCURRENCY, embeddingText, embedTexts } from "./embeddings.ts";

describe("embeddingText", () => {
  it("drops asset links, keeps alt text and truncates", () => {
    expect(
      embeddingText("![Leaf cell](asset:3f2504e0-4f89-41d3-9a0c-0305e82c3301)  photo\n\nsynthesis"),
    ).toBe("Leaf cell photo synthesis");
    expect(embeddingText("x".repeat(10_000))).toHaveLength(8_000);
  });
});

describe("embedTexts", () => {
  it("batches, keeps input order, validates dimensions and sums tokens", async () => {
    const client = fakeEmbeddingsClient();
    const texts = Array.from({ length: EMBED_BATCH_SIZE + 3 }, (_, i) => `text ${i}`);
    const { vectors, tokens } = await embedTexts(client, texts);
    expect(client.calls.map((c) => c.length)).toEqual([EMBED_BATCH_SIZE, 3]);
    expect(vectors[5]).toEqual(hashEmbedding("text 5"));
    expect(vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(tokens).toBe(EMBED_BATCH_SIZE + 3);
  });
  it("refuses an answer whose index falls outside its batch (Task 0 review M5)", async () => {
    const client = {
      embeddings: {
        create: async (body: { input: string[] }) => ({
          data: body.input.map((text, index) => ({
            index: index + 1,
            embedding: hashEmbedding(text),
          })),
          tokens: 1,
        }),
      },
    };
    await expect(embedTexts(client, ["a", "b"])).rejects.toThrow(/index/);
  });
  it("runs at most EMBED_CONCURRENCY batches at once (Task 0 review M5)", async () => {
    let inFlight = 0;
    let peak = 0;
    const client = {
      embeddings: {
        create: async (body: { input: string[] }) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return {
            data: body.input.map((text, index) => ({ index, embedding: hashEmbedding(text) })),
            tokens: body.input.length,
          };
        },
      },
    };
    const texts = Array.from({ length: EMBED_BATCH_SIZE * 10 }, (_, i) => `t${i}`);
    const { vectors } = await embedTexts(client, texts);
    expect(vectors).toHaveLength(texts.length);
    expect(peak).toBeLessThanOrEqual(EMBED_CONCURRENCY);
  });
  it("refuses empty inputs", async () => {
    await expect(embedTexts(fakeEmbeddingsClient(), [""])).rejects.toThrow(/empty/);
  });
});

describe("hashEmbedding", () => {
  it("is unit-length and closer for overlapping words", () => {
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
    const a = hashEmbedding("chlorophyll absorbs light");
    expect(dot(a, a)).toBeCloseTo(1, 6);
    expect(dot(a, hashEmbedding("light absorbs chlorophyll strongly"))).toBeGreaterThan(
      dot(a, hashEmbedding("tax law reform")),
    );
  });
  it("reports each batch's tokens as it lands, also when a later batch fails (review I5)", async () => {
    let call = 0;
    const client = {
      embeddings: {
        create: async (body: { input: string[] }) => {
          call += 1;
          if (call === 2) throw new Error("rate limited");
          return {
            data: body.input.map((text, index) => ({ index, embedding: hashEmbedding(text) })),
            tokens: 7,
          };
        },
      },
    };
    const spent: number[] = [];
    const texts = Array.from({ length: EMBED_BATCH_SIZE * 2 }, (_, i) => `t${i}`);
    await expect(
      embedTexts(client, texts, { concurrency: 1, onUsage: (tokens) => spent.push(tokens) }),
    ).rejects.toThrow(/rate limited/);
    expect(spent).toEqual([7]);
  });
  it("times out each batch on its own, not the whole note (review I5)", async () => {
    const seen: boolean[] = [];
    const client = {
      embeddings: {
        create: async (body: { input: string[] }, options: { signal?: AbortSignal }) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          seen.push(options.signal?.aborted ?? false);
          return {
            data: body.input.map((text, index) => ({ index, embedding: hashEmbedding(text) })),
            tokens: 1,
          };
        },
      },
    };
    const texts = Array.from({ length: EMBED_BATCH_SIZE * 3 }, (_, i) => `t${i}`);
    // Three sequential 30 ms batches under a 50 ms per-batch timeout: none is aborted.
    const { vectors } = await embedTexts(client, texts, { concurrency: 1, batchTimeoutMs: 50 });
    expect(vectors).toHaveLength(texts.length);
    expect(seen).toEqual([false, false, false]);
    const slow = {
      embeddings: {
        create: (_body: { input: string[] }, options: { signal?: AbortSignal }) =>
          new Promise<never>((_resolve, reject) =>
            options.signal?.addEventListener("abort", () => reject(options.signal?.reason)),
          ),
      },
    };
    await expect(embedTexts(slow, ["a"], { batchTimeoutMs: 20 })).rejects.toThrow();
  });
});
