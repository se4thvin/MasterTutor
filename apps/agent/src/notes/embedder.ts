import { embeddingText, embedTexts, type EmbeddingsClient } from "@mastertutor/contracts/server";
import { embeddingUsage } from "../llm/pricing.ts";
import type { Log } from "../runtime/types.ts";
import type { StepWriter } from "../tools/types.ts";

export const EMBED_TIMEOUT_MS = 15_000;

export interface Embedder {
  /** One vector per input; null for empty text or when the API fails (blocks are stored anyway). */
  embed(
    markdowns: readonly string[],
    options?: { signal?: AbortSignal; step?: StepWriter },
  ): Promise<(number[] | null)[]>;
}

export function createEmbedder(client: EmbeddingsClient, log: Log): Embedder {
  return {
    async embed(markdowns, options = {}) {
      const texts = markdowns.map(embeddingText);
      const out: (number[] | null)[] = texts.map(() => null);
      const indexes = texts.flatMap((text, index) => (text.length > 0 ? [index] : []));
      if (indexes.length === 0) return out;
      const timeout = AbortSignal.timeout(EMBED_TIMEOUT_MS);
      try {
        const { vectors, tokens } = await embedTexts(
          client,
          indexes.map((index) => texts[index] ?? ""),
          { signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout },
        );
        options.step?.addUsage(embeddingUsage(tokens));
        indexes.forEach((index, k) => {
          out[index] = vectors[k] ?? null;
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        log.warn(
          { errName: (error as Error).name, count: indexes.length },
          "embedding failed; stored without vectors",
        );
      }
      return out;
    },
  };
}
