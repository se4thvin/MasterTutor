import type { SearchHit, SearchInput } from "@mastertutor/contracts";
import { embedTexts, type EmbeddingsClient } from "@mastertutor/contracts/server";
import { hybridSearch, type Database } from "@mastertutor/db";

const QUERY_EMBED_TIMEOUT_MS = 3_000;

/** `notes.search` (decision 19): hybrid when the query embeds in time, lexical otherwise; one hit per note. */
export async function searchNotes(
  db: Database,
  workspaceId: string,
  input: SearchInput,
  deps: { embeddings: EmbeddingsClient; signal?: AbortSignal },
): Promise<{ items: SearchHit[] }> {
  let embedding: number[] | null;
  try {
    // The request's signal too: a search the client dropped stops paying for its embedding (QA-091).
    const { vectors } = await embedTexts(deps.embeddings, [input.q], {
      batchTimeoutMs: QUERY_EMBED_TIMEOUT_MS,
      signal: deps.signal,
    });
    embedding = vectors[0] ?? null;
  } catch {
    embedding = null;
  }
  deps.signal?.throwIfAborted();
  const items = await hybridSearch(db, {
    workspaceId,
    q: input.q,
    embedding,
    kind: input.kind,
    limit: input.limit,
  });
  return { items };
}
