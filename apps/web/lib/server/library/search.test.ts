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
});
