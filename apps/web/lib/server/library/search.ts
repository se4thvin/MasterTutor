import type { SearchHit, SearchInput } from "@mastertutor/contracts";
import { embedTexts, type EmbeddingsClient } from "@mastertutor/contracts/server";
import { hybridSearch, type Database } from "@mastertutor/db";

const QUERY_EMBED_TIMEOUT_MS = 3_000;

/** `notes.search` (decision 19): hybrid when the query embeds in time, lexical otherwise; one hit per note. */
export async function searchNotes(
  db: Database,
  workspaceId: string,
  input: SearchInput,
  deps: { embeddings: EmbeddingsClient },
): Promise<{ items: SearchHit[] }> {
  let embedding: number[] | null;
  try {
    const { vectors } = await embedTexts(deps.embeddings, [input.q], {
      batchTimeoutMs: QUERY_EMBED_TIMEOUT_MS,
    });
    embedding = vectors[0] ?? null;
  } catch {
    embedding = null;
  }
  const items = await hybridSearch(db, {
    workspaceId,
    q: input.q,
    embedding,
    kind: input.kind,
    limit: input.limit,
  });
  return { items };
}
