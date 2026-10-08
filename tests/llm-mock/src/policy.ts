import type { RecordedRequest } from "./scenario.ts";

export const ALLOWED_PATHS = ["/v1/responses", "/v1/embeddings", "/v1/audio/transcriptions"];
/** Kept independent of the code under test: the mock is the second opinion (openai-data-policy.md). */
export const FORBIDDEN_FIELDS = [
  "previous_response_id",
  "metadata",
  "user",
  "safety_identifier",
  "conversation",
  "background",
];

/** Rule 6 over every recorded request on every path. */
export function policyProblems(requests: readonly RecordedRequest[]): string[] {
  const problems: string[] = [];
  for (const request of requests) {
    if (!ALLOWED_PATHS.includes(request.path))
      problems.push(`${request.path}: not an allowed endpoint`);
    if (request.path === "/v1/responses" && request.body.store !== false)
      problems.push(`${request.path}: store is not false`);
    for (const field of FORBIDDEN_FIELDS)
      if (field in request.body) problems.push(`${request.path}: sends ${field}`);
  }
  return problems;
}
