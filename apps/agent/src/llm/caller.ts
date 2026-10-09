import { MODELS } from "@mastertutor/contracts";
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { instrument } from "@mastertutor/telemetry/instrument";
import { recordModelTokens } from "@mastertutor/telemetry/record";
import { APIError } from "./openai.ts";
import type { Clock } from "../runtime/clock.ts";
import { DECIDE_SLOW_MS, DECIDE_TIMEOUT_MS } from "../runtime/config.ts";
import { ContextOverflow, ModelUnavailable, interruptionOf } from "../runtime/errors.ts";
import type { ModelClient, ModelReply, ModelRequest } from "./client.ts";
import { costUsd } from "@mastertutor/contracts";

export type ModelErrorKind = "rate_limited" | "server" | "transient" | "context_overflow" | "fatal";

export function classifyModelError(error: unknown): ModelErrorKind {
  if (error instanceof APIError) {
    if (error.code === "context_length_exceeded") return "context_overflow";
    if (error.status === 408 || error.status === 409) return "transient";
    if (error.status === 429) return "rate_limited";
    if (error.status === undefined || error.status >= 500) return "server";
    return "fatal";
  }
  return "server";
}

export const MODEL_ERROR_MESSAGE_MAX = 300;

/**
 * Log fields that say why OpenAI refused a request: status, error type, code and param, and its
 * message with `redact` applied before truncation (a cut never shows part of a secret). Never the
 * request body. Field names avoid the logger's redacted keys (`code`), so they survive.
 */
export function modelErrorLog(
  error: unknown,
  redact: (text: string) => string,
): Record<string, string | number | null> {
  if (!(error instanceof APIError)) return {};
  const body = (error.error ?? {}) as Record<string, unknown>;
  const field = (value: unknown) => (typeof value === "string" ? value.slice(0, 100) : null);
  const message = typeof body.message === "string" ? body.message : "";
  return {
    modelStatus: error.status ?? null,
    modelErrorType: field(body.type),
    modelErrorCode: field(body.code),
    modelErrorParam: field(body.param),
    modelErrorMessage: redact(message.replace(/sk-[\w-]{6,}/g, "sk-[redacted]")).slice(
      0,
      MODEL_ERROR_MESSAGE_MAX,
    ),
  };
}

export interface CallResult {
  reply: ModelReply;
  model: string;
  fallback: { from: string; to: string } | null;
}

export function backoffMs(attempt: number, retryAfterMs: number | null = null): number {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.round(base * (0.5 + Math.random() / 2));
  return retryAfterMs === null ? jittered : Math.max(jittered, Math.min(60_000, retryAfterMs));
}

/** Retry-After as seconds or an HTTP date; null when absent or unusable. */
export function retryAfterMs(error: unknown, now = Date.now()): number | null {
  if (!(error instanceof APIError)) return null;
  const value = error.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Spec §5.2 rule 8: 429/5xx backoff with jitter; 3 consecutive 5xx on gpt-6-astra → gpt-6.1-sol. */
export class ModelCaller {
  readonly #client: ModelClient;
  readonly #clock: Clock;
  readonly #fallbackAfter5xx: number;
  readonly #maxAttempts: number;
  readonly #decideTimeoutMs: number;
  readonly #decideSlowMs: number;

  constructor(
    client: ModelClient,
    options: {
      clock: Clock;
      fallbackAfter5xx: number;
      maxAttempts?: number;
      decideTimeoutMs?: number;
      decideSlowMs?: number;
    },
  ) {
    this.#client = client;
    this.#clock = options.clock;
    this.#fallbackAfter5xx = options.fallbackAfter5xx;
    this.#maxAttempts = options.maxAttempts ?? 10;
    this.#decideTimeoutMs = options.decideTimeoutMs ?? DECIDE_TIMEOUT_MS;
    this.#decideSlowMs = options.decideSlowMs ?? DECIDE_SLOW_MS;
  }

  /** Seam 4 (spec §7.3): one mt.model.request span covering every retry and the fallback. */
  call(
    request: ModelRequest,
    signal: AbortSignal,
    onProgress?: (caption: string) => Promise<void>,
  ): Promise<CallResult> {
    return instrument(
      SPAN.modelRequest,
      { [ATTR.modelName]: request.model },
      async (span) => {
        if (request.format === "agent_turn")
          span.set({ [ATTR.decideTimeouts]: 0, [ATTR.decideRetries]: 0 });
        const result = await this.#attempts(
          request,
          signal,
          (attempt, timeouts) => {
            span.set({ [ATTR.modelAttempts]: attempt });
            if (timeouts > 0) span.set({ [ATTR.decideRetries]: 1 });
          },
          (count) => span.set({ [ATTR.decideTimeouts]: count }),
          onProgress,
        );
        const tokens = result.reply.usage;
        span.set({
          [ATTR.modelName]: result.model,
          [ATTR.modelFallback]: result.fallback !== null,
          [ATTR.tokensInput]: tokens.input,
          [ATTR.tokensCached]: tokens.cached,
          [ATTR.tokensOutput]: tokens.output,
          [ATTR.costUsd]: costUsd(result.model, tokens),
        });
        recordModelTokens(result.model, tokens);
        return result;
      },
      { expected: interruptionOf },
    );
  }

  async #attempts(
    request: ModelRequest,
    signal: AbortSignal,
    onAttempt: (attempt: number, timeouts: number) => void,
    onTimeout: (count: number) => void,
    onProgress?: (caption: string) => Promise<void>,
  ): Promise<CallResult> {
    let model = request.model;
    let fallback: CallResult["fallback"] = null;
    let consecutive5xx = 0;
    let timeouts = 0;
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted();
      onAttempt(attempt, timeouts);
      const deadline = new AbortController();
      try {
        return {
          reply: await this.#create({ ...request, model }, signal, deadline, onProgress),
          model,
          fallback,
        };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (deadline.signal.aborted) {
          timeouts++;
          onTimeout(timeouts);
          if (timeouts === 2)
            throw new ModelUnavailable("model_unavailable", "The model is unavailable.", error);
          await this.#progress("Model slow, retrying…", signal, onProgress);
          continue;
        }
        const kind = classifyModelError(error);
        if (kind === "context_overflow") throw new ContextOverflow();
        if (kind === "fatal")
          throw new ModelUnavailable(
            "model_request_rejected",
            "The model rejected the request.",
            error,
          );
        if (kind === "server") {
          consecutive5xx += 1;
          if (consecutive5xx >= this.#fallbackAfter5xx) {
            if (model !== MODELS.agentPrimary)
              throw new ModelUnavailable("model_unavailable", "The model is unavailable.", error);
            fallback = { from: model, to: MODELS.agentFallback };
            model = MODELS.agentFallback;
            consecutive5xx = 0;
            continue;
          }
        } else {
          consecutive5xx = 0;
        }
        if (attempt >= this.#maxAttempts)
          throw new ModelUnavailable("model_rate_limited", "The model kept rate-limiting.", error);
        await this.#clock.sleep(backoffMs(attempt, retryAfterMs(error)), signal);
      }
    }
  }

  async #create(
    request: ModelRequest,
    signal: AbortSignal,
    deadline: AbortController,
    onProgress?: (caption: string) => Promise<void>,
  ): Promise<ModelReply> {
    if (request.format !== "agent_turn") return this.#client.create(request, signal);
    let notice: Promise<void> | undefined;
    const slow = setTimeout(() => {
      notice = this.#progress("Waiting on the model…", signal, onProgress);
    }, this.#decideSlowMs);
    const timeout = setTimeout(
      () => deadline.abort(new DOMException("Decide deadline exceeded", "TimeoutError")),
      this.#decideTimeoutMs,
    );
    try {
      return await this.#client.create(request, AbortSignal.any([signal, deadline.signal]));
    } finally {
      clearTimeout(slow);
      clearTimeout(timeout);
      // A notice already being stored must precede the final step event.
      await notice;
    }
  }

  async #progress(
    caption: string,
    signal: AbortSignal,
    onProgress?: (caption: string) => Promise<void>,
  ): Promise<void> {
    if (signal.aborted) return;
    // A status update is best effort; it must never fail or retry a paid response.
    try {
      await onProgress?.(caption);
    } catch {
      /* The step's normal commit checks its lease. */
    }
  }
}
