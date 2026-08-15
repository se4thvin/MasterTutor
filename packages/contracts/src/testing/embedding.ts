import { EMBEDDING_DIMENSIONS } from "../constants.ts";
import type { EmbeddingsClient } from "../server/embeddings.ts";

/** Deterministic bag-of-words unit vector: texts sharing words are close in cosine space. */
export function hashEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 2166136261;
    for (const char of word) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    const slot = hash % EMBEDDING_DIMENSIONS;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  if (!vector.some((value) => value !== 0)) vector[0] = 1;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

export function fakeEmbeddingsClient(
  options: { fail?: boolean } = {},
): EmbeddingsClient & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    embeddings: {
      async create(body) {
        calls.push(body.input);
        if (options.fail) throw new Error("embeddings unavailable");
        return {
          data: body.input.map((text, index) => ({ index, embedding: hashEmbedding(text) })),
          tokens: body.input.length,
        };
      },
    },
  };
}
