import type { EmbeddingsClient } from "@mastertutor/contracts/server";
import { createOpenAI } from "@mastertutor/contracts/server/openai";
import { getWebEnv } from "./env.ts";

let client: EmbeddingsClient | undefined;

/**
 * web's OpenAI access: query embeddings only (D36: the single OPENAI_API_KEY; D38: the shared
 * stateless factory, retries off). Only the embeddings surface is exposed to web code.
 */
export function getEmbeddingsClient(): EmbeddingsClient {
  if (!client) {
    const env = getWebEnv();
    client = createOpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
      timeoutMs: 10_000,
    });
  }
  return client;
}
