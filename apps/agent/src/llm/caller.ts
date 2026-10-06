import { MODELS } from "@mastertutor/contracts";
import { APIError } from "openai";
import type { Clock } from "../runtime/clock.ts";
import { ChainLost, ModelUnavailable } from "../runtime/errors.ts";
import type { ModelClient, ModelReply, ModelRequest } from "./client.ts";

export type ModelErrorKind = "rate_limited" | "server" | "chain_lost" | "fatal";

export function classifyModelError(error: unknown): ModelErrorKind {
  if (error instanceof APIError) {
    if (error.code === "previous_response_not_found") return "chain_lost";
    if (error.status === 429) return "rate_limited";
    if (error.status === undefined || error.status >= 500) return "server";
    return "fatal";
  }
  return "server";
}

export interface CallResult {
  reply: ModelReply;
  model: string;
  fallback: { from: string; to: string } | null;
}

export function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.5 + Math.random() / 2));
}

/** Spec §5.2 rule 8: 429/5xx backoff with jitter; 3 consecutive 5xx on gpt-6-astra → gpt-6.1-sol. */
export class ModelCaller {
  readonly #client: ModelClient;
  readonly #clock: Clock;
  readonly #fallbackAfter5xx: number;
  readonly #maxAttempts: number;

  constructor(
    client: ModelClient,
    options: { clock: Clock; fallbackAfter5xx: number; maxAttempts?: number },
  ) {
    this.#client = client;
    this.#clock = options.clock;
    this.#fallbackAfter5xx = options.fallbackAfter5xx;
    this.#maxAttempts = options.maxAttempts ?? 10;
  }

  async call(request: ModelRequest, signal: AbortSignal): Promise<CallResult> {
    let model = request.model;
    let fallback: CallResult["fallback"] = null;
    let consecutive5xx = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        return { reply: await this.#client.create({ ...request, model }, signal), model, fallback };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const kind = classifyModelError(error);
        if (kind === "chain_lost") throw new ChainLost();
        if (kind === "fatal")
          throw new ModelUnavailable("model_request_rejected", "The model rejected the request.");
        if (kind === "server") {
          consecutive5xx += 1;
          if (consecutive5xx >= this.#fallbackAfter5xx) {
            if (model !== MODELS.agentPrimary)
              throw new ModelUnavailable("model_unavailable", "The model is unavailable.");
            fallback = { from: model, to: MODELS.agentFallback };
            model = MODELS.agentFallback;
            consecutive5xx = 0;
            continue;
          }
        } else {
          consecutive5xx = 0;
        }
        if (attempt >= this.#maxAttempts)
          throw new ModelUnavailable("model_rate_limited", "The model kept rate-limiting.");
        await this.#clock.sleep(backoffMs(attempt), signal);
      }
    }
  }
}
