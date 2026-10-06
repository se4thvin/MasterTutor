import { replaceAssetUris } from "../asset-uri.ts";
import { EMBEDDING_DIMENSIONS } from "../constants.ts";

/** What embedding needs from OpenAI. `createOpenAI()` implements it with the model and encoding fixed. */
export interface EmbeddingsClient {
  embeddings: {
    create(
      body: { input: string[] },
      options: { signal?: AbortSignal },
    ): Promise<{ data: Array<{ index: number; embedding: number[] }>; tokens: number }>;
  };
}

export const EMBED_MAX_CHARS = 8_000;
export const EMBED_BATCH_SIZE = 128;

/** Text sent for a block: asset links removed, image alt kept, whitespace collapsed, truncated. */
export function embeddingText(markdown: string): string {
  return replaceAssetUris(markdown, () => "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EMBED_MAX_CHARS);
}

export async function embedTexts(
  client: EmbeddingsClient,
  texts: readonly string[],
  options: { signal?: AbortSignal } = {},
): Promise<{ vectors: number[][]; tokens: number }> {
  if (texts.some((text) => text.trim().length === 0)) throw new Error("cannot embed empty text");
  const batches: { start: number; input: string[] }[] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    batches.push({ start, input: texts.slice(start, start + EMBED_BATCH_SIZE) });
  }
  const out: (number[] | undefined)[] = new Array(texts.length).fill(undefined);
  let tokens = 0;
  await Promise.all(
    batches.map(async ({ start, input }) => {
      const response = await client.embeddings.create({ input }, { signal: options.signal });
      tokens += response.tokens;
      for (const item of response.data) {
        if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`unexpected embedding size ${item.embedding.length}`);
        }
        out[start + item.index] = item.embedding;
      }
    }),
  );
  const vectors = out.map((vector, index) => {
    if (!vector) throw new Error(`missing embedding for input ${index}`);
    return vector;
  });
  return { vectors, tokens };
}
