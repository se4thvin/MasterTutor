import type { ObserverOutcome, ObserverRole } from "@mastertutor/contracts/telemetry";
import type { z } from "zod";

/**
 * The one seam between a role's pure core and the service that hosts it (D52). The core
 * builds the metadata-only input and the schema; the host (the agent for the Guard, the observer
 * service for the Copilot) makes the call through the D38 wrapper, prices it with the
 * contracts price table and records spend under the role. The core never imports openai.
 * The host runs assertRedacted on `input` before anything leaves the process.
 */
export interface ObserverCallRequest<S extends z.ZodType> {
  role: ObserverRole;
  model: string;
  instructions: string;
  /** Serialized metadata only: never page text, typed text, URLs or secrets. */
  input: string;
  schema: S;
  /** The json_schema name. */
  name: string;
  maxOutputTokens: number;
  /** Pinned per model by the spike (spec §10): luna "none" or "low", sol "low". */
  reasoningEffort: "none" | "low" | null;
}

/**
 * Why a port call produced no answer, and what it cost anyway. An unparseable answer
 * (StructuredParseError in the wrapper) is billed, so `usd` is what the host charges the run budget,
 * the D46 cap and mt.observer.spend before the caller fails closed. Never carries model text.
 */
export class ObserverCallError extends Error {
  readonly outcome: Exclude<ObserverOutcome, "ok">;
  readonly usd: number;
  constructor(outcome: Exclude<ObserverOutcome, "ok">, usd: number) {
    super(`Observer call failed: ${outcome}`);
    this.name = "ObserverCallError";
    this.outcome = outcome;
    this.usd = usd;
  }
}

export interface ObserverModelPort {
  /**
   * Rejects with ObserverCallError on timeout, error, refusal or an answer `schema` does not
   * parse ("invalid", with the billed usd).
   */
  structured<S extends z.ZodType>(
    request: ObserverCallRequest<S>,
    signal: AbortSignal,
  ): Promise<{ parsed: z.output<S>; usd: number }>;
}
