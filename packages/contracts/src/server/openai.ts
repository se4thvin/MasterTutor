/**
 * The only module that imports `openai` (data-minimisation policy D38 rule 5; ESLint enforces it).
 * The agent and web both build their one client here. Every Responses call is stateless
 * (`store:false`, no chaining, no identifiers); embeddings and transcriptions have their model and
 * fields fixed. SDK retries are off (callers own retries). Request bodies are never logged.
 */
import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseOutputItem,
  ResponseInput,
} from "openai/resources/responses/responses";
import { z } from "zod";
import { MODELS } from "../constants.ts";
import type { EmbeddingsClient } from "./embeddings.ts";

export { APIError } from "openai";
export { zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
export type {
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseOutputItem,
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
  // Amended D52: all supported Observer models refuse in_memory; omit the option entirely.
  "prompt_cache_retention",
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

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "item"; item: ResponseOutputItem }
  | { type: "completed"; model: string; tokens: TokenCounts };

export interface TokenCounts {
  input: number;
  cached: number;
  output: number;
}

export interface StructuredRequest<S extends z.ZodType> {
  model: string;
  /** Fixed task text. Page-derived text goes in `input`, wrapped by the caller. */
  instructions: string;
  input: ResponseInput;
  schema: S;
  /** The json_schema name (llm-mock routes on it). */
  name: string;
  /** A hard cap on output tokens (reasoning included); a cut-off answer does not parse. */
  maxOutputTokens?: number;
  /**
   * Only where the spike pinned support (spec §10): gpt-6-luna takes "none" or "low",
   * gpt-6.1-sol "low" at the least; "minimal" is refused by both.
   */
  reasoningEffort?: "none" | "low";
}

/**
 * A structured answer that came back but did not parse (prose, cut off, off-schema). OpenAI bills
 * it all the same, so it carries the usage: callers charge it, then fail closed. Never the text.
 */
export class StructuredParseError extends Error {
  readonly model: string;
  readonly tokens: TokenCounts;
  constructor(model: string, tokens: TokenCounts) {
    super("The structured reply did not match its schema");
    this.name = "StructuredParseError";
    this.model = model;
    this.tokens = tokens;
  }
}

export interface StructuredReply<T> {
  parsed: T;
  model: string;
  tokens: TokenCounts;
}

export interface DiarizedSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

export interface Transcript {
  segments: DiarizedSegment[];
  /** Audio seconds billed (the response's `duration`). */
  seconds: number;
}

export interface StatelessOpenAI extends EmbeddingsClient {
  responses: {
    create(params: StatelessResponseParams, options: { signal: AbortSignal }): Promise<Response>;
    stream(
      params: StatelessResponseParams,
      options: { signal: AbortSignal },
    ): AsyncIterable<StreamEvent>;
    /** A structured answer validated by `schema` (OCR, filing). Throws when it does not parse. */
    parse<S extends z.ZodType>(
      request: StructuredRequest<S>,
      options: { signal: AbortSignal },
    ): Promise<StructuredReply<z.output<S>>>;
  };
  audio: {
    transcriptions: {
      create(
        input: { bytes: Uint8Array; filename: string },
        options: { signal: AbortSignal },
      ): Promise<Transcript>;
    };
  };
}

const Diarized = z.object({
  duration: z.number().nonnegative().optional(),
  segments: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      text: z.string(),
      speaker: z.string().nullish(),
    }),
  ),
});

function tokensOf(response: Response): TokenCounts {
  return {
    input: response.usage?.input_tokens ?? 0,
    cached: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    output: response.usage?.output_tokens ?? 0,
  };
}

function outputText(response: Response): string {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) if (part.type === "output_text") return part.text;
  }
  throw new Error("structured reply has no output text");
}

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
    // Request bodies carry page text: the SDK never logs, whatever OPENAI_LOG says (M2).
    logLevel: "off",
  });
  const create = (params: StatelessResponseParams, requestOptions: { signal: AbortSignal }) =>
    client.responses.create(statelessParams(params), { signal: requestOptions.signal });
  return {
    responses: {
      create,
      async *stream(params, requestOptions) {
        const events = await client.responses.create(
          { ...statelessParams(params), stream: true } as ResponseCreateParamsStreaming,
          { signal: requestOptions.signal },
        );
        let completed = false;
        for await (const event of events) {
          switch (event.type) {
            case "response.output_text.delta":
              yield { type: "text", delta: event.delta };
              break;
            case "response.output_item.done":
              yield { type: "item", item: event.item };
              break;
            case "response.completed":
              completed = true;
              yield {
                type: "completed",
                model: event.response.model,
                tokens: tokensOf(event.response),
              };
              break;
            case "response.failed":
            case "response.incomplete":
            case "error":
              throw new Error(`stream ended with ${event.type}`);
          }
        }
        if (!completed) throw new Error("stream ended without completion");
      },
      async parse(request, requestOptions) {
        const response = await create(
          {
            model: request.model,
            instructions: request.instructions,
            input: request.input,
            text: { format: zodTextFormat(request.schema, request.name) },
            ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
            ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
          },
          requestOptions,
        );
        const tokens = tokensOf(response);
        let parsed: z.output<typeof request.schema>;
        try {
          parsed = request.schema.parse(JSON.parse(outputText(response)));
        } catch {
          throw new StructuredParseError(response.model, tokens);
        }
        return { parsed, model: response.model, tokens };
      },
    },
    embeddings: {
      async create(body, requestOptions) {
        const response = await client.embeddings.create(
          { model: MODELS.embeddings, input: body.input, encoding_format: "float" },
          { signal: requestOptions.signal },
        );
        return {
          data: response.data.map((item) => ({ index: item.index, embedding: item.embedding })),
          tokens: response.usage?.prompt_tokens ?? 0,
        };
      },
    },
    audio: {
      transcriptions: {
        async create(input, requestOptions) {
          const file = await toFile(input.bytes, input.filename, { type: "audio/wav" });
          const response = await client.audio.transcriptions.create(
            {
              file,
              model: MODELS.transcription,
              response_format: "diarized_json",
              chunking_strategy: "auto",
            },
            { signal: requestOptions.signal },
          );
          const body = Diarized.parse(response);
          return {
            segments: body.segments.map((s) => ({
              start: s.start,
              end: s.end,
              text: s.text,
              speaker: s.speaker ?? null,
            })),
            seconds: body.duration ?? 0,
          };
        },
      },
    },
  };
}
