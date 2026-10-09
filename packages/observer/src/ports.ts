import type { ObserverRole } from "@mastertutor/contracts/telemetry";
import type { z } from "zod";

/**
 * The one seam between a role's pure core and the service that hosts it (D52, D53b). The core
 * builds the metadata-only input and the schema; the host (the agent for the Guard and layout,
 * the observer service for the Copilot) makes the call through the D38 wrapper, prices it with the
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

export interface ObserverModelPort {
  /** Rejects on timeout, error, refusal or an answer `schema` does not parse. */
  structured<S extends z.ZodType>(
    request: ObserverCallRequest<S>,
    signal: AbortSignal,
  ): Promise<{ parsed: z.output<S>; usd: number }>;
}
