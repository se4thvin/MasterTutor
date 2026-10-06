import { AgentTurn, CompactionSummary } from "@mastertutor/contracts";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { TokenUsage } from "./pricing.ts";
import { agentTools } from "./tools.ts";

export interface ModelRequest {
  model: string;
  instructions: string;
  input: ResponseInputItem[];
  previousResponseId: string | null;
  format: "agent_turn" | "compaction_summary";
  withTools: boolean;
}

export interface ModelReply {
  id: string;
  model: string;
  output: unknown[];
  usage: TokenUsage;
}

/** The swappable LLM boundary (CLAUDE.md principle 5). */
export interface ModelClient {
  create(request: ModelRequest, signal: AbortSignal): Promise<ModelReply>;
}

const FORMATS = {
  agent_turn: zodTextFormat(AgentTurn, "agent_turn"),
  compaction_summary: zodTextFormat(CompactionSummary, "compaction_summary"),
};

export function createOpenAIModelClient(options: {
  apiKey: string;
  baseURL?: string;
}): ModelClient {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: 0,
    timeout: 180_000,
  });
  return {
    async create(request, signal) {
      const response = await client.responses.create(
        {
          model: request.model,
          instructions: request.instructions,
          input: request.input,
          previous_response_id: request.previousResponseId ?? undefined,
          store: true,
          reasoning: { effort: "medium" },
          tools: request.withTools ? agentTools() : undefined,
          text: { format: FORMATS[request.format] },
        },
        { signal },
      );
      return {
        id: response.id,
        model: response.model,
        output: response.output,
        usage: {
          input: response.usage?.input_tokens ?? 0,
          cached: response.usage?.input_tokens_details?.cached_tokens ?? 0,
          output: response.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}
