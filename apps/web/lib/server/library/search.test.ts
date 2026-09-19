import { fakeEmbeddingsClient } from "@mastertutor/contracts/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mastertutor/db", () => ({
  hybridSearch: vi.fn(async (_db: unknown, input: { embedding: number[] | null }) => [
    {
      noteId: "n",
      blockId: null,
      title: input.embedding ? "vector" : "lexical",
      snippet: "",
      score: 1,
    },
  ]),
}));

const { searchNotes } = await import("./search.ts");

describe("searchNotes", () => {
  const db = {} as never;
  it("embeds the query when the API works", async () => {
    const out = await searchNotes(
      db,
      "w",
      { q: "atp", kind: null, limit: 5 },
      { embeddings: fakeEmbeddingsClient() },
    );
    expect(out.items[0]?.title).toBe("vector");
  });
  it("falls back to lexical search when embeddings fail", async () => {
    const out = await searchNotes(
      db,
      "w",
      { q: "atp", kind: null, limit: 5 },
      { embeddings: fakeEmbeddingsClient({ fail: true }) },
    );
    expect(out.items[0]?.title).toBe("lexical");
  });
  it("hands the request's abort signal to the query embedding and stops once aborted (QA-091)", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const embeddings = {
      embeddings: {
        create: (_body: { input: string[] }, options?: { signal?: AbortSignal }) => {
          seen = options?.signal;
          return new Promise<never>((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () => reject(options.signal?.reason)),
          );
        },
      },
    };
    const pending = searchNotes(
      db,
      "w",
      { q: "atp", kind: null, limit: 5 },
      {
        embeddings,
        signal: controller.signal,
      },
    );
    controller.abort(new Error("client went away"));
    await expect(pending).rejects.toThrow("client went away");
    expect(seen?.aborted).toBe(true);
  });
});
