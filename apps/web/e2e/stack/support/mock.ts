import type { APIRequestContext } from "@playwright/test";
import type { RecordedRequest } from "../../../../../tests/llm-mock/src/scenario.ts";
import { LLM_MOCK_URL } from "./env.ts";

/** The llm-mock's requests for one run (the nonce of its scenarioGoal), oldest first. */
export async function mockRequests(
  request: APIRequestContext,
  nonce: string,
): Promise<RecordedRequest[]> {
  const response = await request.get(
    `${LLM_MOCK_URL}/__mock/requests?nonce=${encodeURIComponent(nonce)}`,
  );
  if (!response.ok()) throw new Error(`llm-mock requests: HTTP ${response.status()}`);
  return (await response.json()) as RecordedRequest[];
}
