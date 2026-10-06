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
/** Batches in flight at once: bounded, so one long note never fans out into a request storm. */
export const EMBED_CONCURRENCY = 4;

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
  let next = 0;
  const worker = async () => {
    for (let batch = batches[next++]; batch; batch = batches[next++]) {
      const { start, input } = batch;
      const response = await client.embeddings.create({ input }, { signal: options.signal });
      tokens += response.tokens;
      for (const item of response.data) {
        // An index outside this batch would overwrite another batch's vector (M5).
        if (!Number.isInteger(item.index) || item.index < 0 || item.index >= input.length) {
          throw new Error(`embedding index ${item.index} outside its batch`);
        }
        if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`unexpected embedding size ${item.embedding.length}`);
        }
        out[start + item.index] = item.embedding;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(EMBED_CONCURRENCY, batches.length) }, () => worker()),
  );
  const vectors = out.map((vector, index) => {
    if (!vector) throw new Error(`missing embedding for input ${index}`);
    return vector;
  });
  return { vectors, tokens };
}
