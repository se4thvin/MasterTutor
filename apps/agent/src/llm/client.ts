import { AgentTurn, CompactionSummary, type ToolProfile } from "@mastertutor/contracts";
import {
  createOpenAI,
  zodTextFormat,
  type ResponseInputItem,
  type StatelessOpenAI,
} from "./openai.ts";
import type { TokenUsage } from "@mastertutor/contracts";
import { agentTools } from "./tools.ts";

/** One stateless request: the whole input is rebuilt from run_transcript every time (D37). */
export interface ModelRequest {
  model: string;
  instructions: string;
  input: ResponseInputItem[];
  format: "agent_turn" | "compaction_summary";
  /** The run's tool profile: the same tools on every request, so replayed calls stay valid (Phase 10). */
  toolProfile: ToolProfile;
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

/** One stateless client per process: pass the shared client; the options form remains for tests. */
export function createOpenAIModelClient(
  source: StatelessOpenAI | { apiKey: string; baseURL?: string },
): ModelClient {
  const client = "responses" in source ? source : createOpenAI(source);
  return {
    async create(request, signal) {
      const response = await client.responses.create(
        {
          model: request.model,
          instructions: request.instructions,
          input: request.input,
          // Reasoning carries across turns only as encrypted items we replay ourselves.
          include: ["reasoning.encrypted_content"],
          reasoning: { effort: "medium" },
          // Tools are always declared so replayed calls stay valid; a summary must not call them.
          tools: agentTools(request.toolProfile),
          ...(request.format === "compaction_summary" ? { tool_choice: "none" as const } : {}),
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
          cacheWrite: response.usage?.input_tokens_details?.cache_write_tokens ?? 0,
          output: response.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}
