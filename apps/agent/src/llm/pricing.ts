import { EMPTY_USAGE, MODELS, type Usage } from "@mastertutor/contracts";

export interface TokenUsage {
  input: number;
  cached: number;
  /** Input tokens written to the prompt cache (input_tokens_details.cache_write_tokens), part of `input`. */
  cacheWrite: number;
  output: number;
}

interface Price {
  inputPerM: number;
  cachedPerM: number;
  /** Unpublished (run 30): assumed equal to inputPerM so budgets never under-estimate. */
  cacheWritePerM: number;
  outputPerM: number;
  longContextAbove: number;
}

/** USD per million tokens (run 01). gpt-6.1-sol is unpublished; assumed equal so budgets over-estimate. */
export const MODEL_PRICES: Record<string, Price> = {
  [MODELS.agentPrimary]: {
    inputPerM: 10,
    cachedPerM: 1,
    cacheWritePerM: 10,
    outputPerM: 50,
    longContextAbove: 272_000,
  },
  [MODELS.agentFallback]: {
    inputPerM: 10,
    cachedPerM: 1,
    cacheWritePerM: 10,
    outputPerM: 50,
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

export function usageDelta(model: string, tokens: TokenUsage, steps = 1): Usage {
  return {
    steps,
    inputTokens: tokens.input,
    cachedInputTokens: tokens.cached,
    outputTokens: tokens.output,
    usd: costUsd(model, tokens),
    activeMs: 0,
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    steps: a.steps + b.steps,
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    usd: Math.round((a.usd + b.usd) * 1e6) / 1e6,
    activeMs: a.activeMs + b.activeMs,
  };
}

/** USD per million input tokens for MODELS.embeddings (text-embedding-3-small list price). */
export const EMBEDDING_USD_PER_M = 0.02;
/** USD per audio minute for MODELS.transcription (gpt-4o-transcribe-diarize list price). */
export const TRANSCRIPTION_USD_PER_MINUTE = 0.006;

/** Embedding spend for one request; counts toward the run budget (preflight F16). */
export function embeddingUsage(tokens: number): Usage {
  return { ...EMPTY_USAGE, inputTokens: tokens, usd: (tokens * EMBEDDING_USD_PER_M) / 1e6 };
}

/**
 * What one OCR call may cost, checked before it is made (final review I6). One high-detail tile of
 * at most 1280×800 is about 1.1k image tokens; a dense page transcribes to well under 4k tokens.
 */
export function ocrTileUsage(): Usage {
  return usageDelta(
    MODELS.agentPrimary,
    { input: 1_500, cached: 0, cacheWrite: 0, output: 4_000 },
    0,
  );
}

export function transcriptionUsage(seconds: number): Usage {
  return { ...EMPTY_USAGE, usd: (Math.max(0, seconds) / 60) * TRANSCRIPTION_USD_PER_MINUTE };
}
