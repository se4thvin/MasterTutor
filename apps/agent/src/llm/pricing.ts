import { MODELS, type Usage } from "@mastertutor/contracts";

export interface TokenUsage {
  input: number;
  cached: number;
  output: number;
}

interface Price {
  inputPerM: number;
  cachedPerM: number;
  outputPerM: number;
  longContextAbove: number;
}

/** USD per million tokens (run 01). gpt-6.1-sol is unpublished; assumed equal so budgets over-estimate. */
export const MODEL_PRICES: Record<string, Price> = {
  [MODELS.agentPrimary]: {
    inputPerM: 10,
    cachedPerM: 1,
    outputPerM: 50,
    longContextAbove: 272_000,
  },
  [MODELS.agentFallback]: {
    inputPerM: 10,
    cachedPerM: 1,
    outputPerM: 50,
    longContextAbove: 272_000,
  },
};

export function costUsd(model: string, tokens: TokenUsage): number {
  const price = MODEL_PRICES[model] ?? MODEL_PRICES[MODELS.agentPrimary]!;
  const long = tokens.input > price.longContextAbove;
  const uncached = Math.max(0, tokens.input - tokens.cached);
  const input =
    ((uncached * price.inputPerM + tokens.cached * price.cachedPerM) / 1e6) * (long ? 2 : 1);
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
