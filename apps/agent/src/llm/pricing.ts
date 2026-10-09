/** The agent's usage helpers; prices live in @mastertutor/contracts (one table, spec §3). */
import {
  EMPTY_USAGE,
  MODELS,
  EMBEDDING_USD_PER_M,
  TRANSCRIPTION_USD_PER_MINUTE,
  costUsd,
  type TokenUsage,
  type Usage,
} from "@mastertutor/contracts";
import { StructuredParseError } from "./openai.ts";

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

/** What a structured call that did not parse still cost (it is billed), or null for other errors. */
export function billedUsageOf(error: unknown): Usage | null {
  return error instanceof StructuredParseError
    ? usageDelta(error.model, { ...error.tokens, cacheWrite: 0 }, 0)
    : null;
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
