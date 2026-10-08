import type { SearchHit, SourceKind } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import type { DbLike } from "../client.ts";

export const RRF_K = 60;
const CANDIDATES = 50;
/**
 * Nearest neighbours below this cosine similarity are not matches: without it every block is a
 * vector candidate. Tunable, and not yet calibrated on text-embedding-3 vectors, where unrelated
 * pairs often score 0.1-0.3 (QA-089). So the floor only bounds the candidates: which block a hit
 * shows never rests on it (see `shown` below).
 */
const MIN_VECTOR_SIMILARITY = 0.2;

export interface HybridSearchInput {
  workspaceId: string;
  q: string;
  embedding: number[] | null;
  kind: SourceKind | null;
  limit: number;
}

/** Spec §4 search: tsvector + pgvector cosine, merged by reciprocal-rank fusion; one hit per note. */
export async function hybridSearch(db: DbLike, input: HybridSearchInput): Promise<SearchHit[]> {
  const ws = input.workspaceId;
  const kindFilter = input.kind
    ? sql`and exists (select 1 from note_blocks kb join sources ks on ks.id = kb.source_id where kb.note_id = n.id and ks.kind = ${input.kind})`
    : sql``;
  const vector = input.embedding ? JSON.stringify(input.embedding) : null;
  const vec = vector
    ? sql`, vec as (
        select b.id as block_id, b.note_id, row_number() over (order by b.embedding <=> ${vector}::vector) as rank
        from note_blocks b join notes n on n.id = b.note_id
        where n.workspace_id = ${ws} and b.embedding is not null
          and b.embedding <=> ${vector}::vector <= ${1 - MIN_VECTOR_SIMILARITY} ${kindFilter}
        order by b.embedding <=> ${vector}::vector limit ${CANDIDATES})`
    : sql``;
  const vecContribution = vector
    ? sql`union all select note_id, block_id, 1.0 / (${RRF_K} + rank), false from vec`
    : sql``;
  const rows = await db.execute(sql`
    with q as (select websearch_to_tsquery('english', ${input.q}) as query),
    lex as (
      select b.id as block_id, b.note_id, row_number() over (order by ts_rank_cd(b.search, q.query) desc) as rank
      from note_blocks b join notes n on n.id = b.note_id, q
      where n.workspace_id = ${ws} and b.search @@ q.query ${kindFilter}
      order by ts_rank_cd(b.search, q.query) desc limit ${CANDIDATES}),
    titles as (
      select n.id as note_id, row_number() over (order by ts_rank_cd(n.search, q.query) desc) as rank
      from notes n, q
      where n.workspace_id = ${ws} and n.search @@ q.query ${kindFilter}
      order by ts_rank_cd(n.search, q.query) desc limit ${CANDIDATES})
    ${vec},
    contributions as (
      select note_id, block_id, 1.0 / (${RRF_K} + rank) as s, true as lexical from lex
      ${vecContribution}),
    per_block as (
      select note_id, block_id, sum(s) as s, bool_or(lexical) as lexical
      from contributions group by note_id, block_id),
    best as (select distinct on (note_id) note_id, s from per_block order by note_id, s desc),
    shown as (
      select distinct on (note_id) note_id, block_id, lexical
      from per_block order by note_id, lexical desc, s desc),
    scored as (
      select coalesce(best.note_id, titles.note_id) as note_id,
             -- A title hit shows a block only when its text matched too: a vector-only neighbour
             -- still ranks the note, but never stands in as its snippet (QA-089).
             case when titles.note_id is not null and not shown.lexical then null
                  else shown.block_id end as block_id,
             coalesce(best.s, 0) + coalesce(1.0 / (${RRF_K} + titles.rank), 0) as score
      from best join shown on shown.note_id = best.note_id
      full outer join titles on titles.note_id = best.note_id)
    select s.note_id, s.block_id, n.title, s.score,
           case when s.block_id is null then coalesce(n.lede, '')
                else ts_headline('english', b.markdown, q.query, 'MaxWords=30, MinWords=10, MaxFragments=1') end as snippet
    from scored s join notes n on n.id = s.note_id left join note_blocks b on b.id = s.block_id, q
    order by s.score desc
    limit ${input.limit}`);
  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    noteId: String(row.note_id),
    blockId: row.block_id === null ? null : String(row.block_id),
    title: String(row.title),
    snippet: String(row.snippet ?? "")
      .replace(/<\/?b>/g, "")
      .slice(0, 400),
    score: Number(row.score),
  }));
}
