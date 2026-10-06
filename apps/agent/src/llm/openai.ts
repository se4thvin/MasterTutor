/**
 * The only module allowed to import `openai` (data-minimisation policy D38, enforced by ESLint).
 * Every Responses call is stateless: `store:false`, and no `previous_response_id`, `metadata`,
 * `user`, `safety_identifier`, `conversation` or `background` ever leaves the process. Request bodies are never logged.
 *
 * Allowed endpoints are `responses.create`, `embeddings.create` and `audio.transcriptions.create`.
 * Only `responses` is exposed today; add the other two here when a phase needs them. Never expose
 * the raw client (files, vector stores, assistants, threads, conversations, batches, evals).
 */
import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

export { APIError } from "openai";
export { zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
export type {
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  Tool as ResponsesTool,
} from "openai/resources/responses/responses";

/**
 * Fields that would make OpenAI keep or link our data; stripped from every Responses request.
 * `conversation` attaches the call to a stored Conversation; `background` needs stored responses.
 */
export const FORBIDDEN_RESPONSE_FIELDS = [
  "previous_response_id",
  "metadata",
  "user",
  "safety_identifier",
  "conversation",
  "background",
] as const;

export type StatelessResponseParams = Omit<
  ResponseCreateParamsNonStreaming,
  (typeof FORBIDDEN_RESPONSE_FIELDS)[number] | "store"
>;

/** Forces `store:false` and drops identifiers and chaining, whatever the caller passed. */
export function statelessParams(
  params: ResponseCreateParamsNonStreaming | StatelessResponseParams,
): ResponseCreateParamsNonStreaming {
  const copy: Record<string, unknown> = { ...params };
  for (const field of FORBIDDEN_RESPONSE_FIELDS) delete copy[field];
  return { ...(copy as StatelessResponseParams), store: false };
}

export interface StatelessOpenAI {
  responses: {
    create(params: StatelessResponseParams, options: { signal: AbortSignal }): Promise<Response>;
  };
}

/** Retries live in ModelCaller, so the SDK's own retries are off. */
export function createOpenAI(options: {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
}): StatelessOpenAI {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: 0,
    timeout: options.timeoutMs ?? 180_000,
  });
  return {
    responses: {
      create: (params, requestOptions) =>
        client.responses.create(statelessParams(params), { signal: requestOptions.signal }),
    },
  };
}
