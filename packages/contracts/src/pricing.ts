/**
 * The single price table (spec §3): every service that spends on OpenAI prices it here, so the
 * agent's run budget, the Guard's and the Copilot's caps agree. Published Standard-tier prices
 * (developers.openai.com/api/docs/pricing, read 2026-10-09 by the Observer spike §10).
 */
import { MODELS } from "./constants.ts";

export interface TokenUsage {
  input: number;
  cached: number;
  /** Input tokens written to the prompt cache (input_tokens_details.cache_write_tokens), part of `input`. */
  cacheWrite: number;
  output: number;
}

export interface Price {
  inputPerM: number;
  cachedPerM: number;
  cacheWritePerM: number;
  outputPerM: number;
  /** Above this many input tokens the long-context rates apply (2× input, 1.5× output). */
  longContextAbove: number;
}

/** USD per million tokens. An unlisted model is priced as gpt-6-astra, the dearest: never under. */
export const MODEL_PRICES: Record<string, Price> = {
  [MODELS.agentPrimary]: {
    inputPerM: 10,
    cachedPerM: 1,
    cacheWritePerM: 12.5,
    outputPerM: 50,
    longContextAbove: 272_000,
  },
  [MODELS.agentFallback]: {
    inputPerM: 2,
    cachedPerM: 0.1,
    cacheWritePerM: 2.5,
    outputPerM: 10,
    longContextAbove: 272_000,
  },
  /** gpt-6-luna: filing, run titles and the Guard's screen. */
  [MODELS.filing]: {
    inputPerM: 0.1,
    cachedPerM: 0.01,
    cacheWritePerM: 0.125,
    outputPerM: 0.5,
    longContextAbove: 272_000,
  },
};

export function costUsd(model: string, tokens: TokenUsage): number {
  const price = MODEL_PRICES[model] ?? MODEL_PRICES[MODELS.agentPrimary]!;
  const long = tokens.input > price.longContextAbove;
  const uncached = Math.max(0, tokens.input - tokens.cached - tokens.cacheWrite);
  const input =
    ((uncached * price.inputPerM +
      tokens.cached * price.cachedPerM +
      tokens.cacheWrite * price.cacheWritePerM) /
      1e6) *
    (long ? 2 : 1);
  const output = ((tokens.output * price.outputPerM) / 1e6) * (long ? 1.5 : 1);
  return input + output;
}

/** USD per million input tokens for MODELS.embeddings (text-embedding-3-small list price). */
export const EMBEDDING_USD_PER_M = 0.02;
/** USD per audio minute for MODELS.transcription (gpt-4o-transcribe-diarize list price). */
export const TRANSCRIPTION_USD_PER_MINUTE = 0.006;
