import type { CopilotToolName } from "@mastertutor/contracts";
import { and, asc, count, desc, eq, gte, lt, max, sql } from "drizzle-orm";
import type { DbLike } from "../client.ts";
import { copilotItems, copilotResults, copilotSpend, copilotThreads } from "../schema/observer.ts";

export type CopilotRole = "user" | "assistant" | "tool";
export interface StoredResult {
  resultId: string;
  tool: CopilotToolName;
  summary: string;
  query: Record<string, unknown>;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  rowCount: number;
  truncated: boolean;
  tookMs: number;
  tainted: boolean;
}

export async function createThread(
  db: DbLike,
  thread: { workspaceId: string; createdBy: string; title: string },
): Promise<string> {
  const [row] = await db.insert(copilotThreads).values(thread).returning({ id: copilotThreads.id });
  return row!.id;
}

export async function loadThread(
  db: DbLike,
  workspaceId: string,
  id: string,
): Promise<{ id: string; title: string; handles: Record<string, string> } | null> {
  const [row] = await db
    .select({ id: copilotThreads.id, title: copilotThreads.title, handles: copilotThreads.handles })
    .from(copilotThreads)
    .where(and(eq(copilotThreads.id, id), eq(copilotThreads.workspaceId, workspaceId)));
  return row ?? null;
}

export async function saveHandles(
  db: DbLike,
  id: string,
  handles: Record<string, string>,
): Promise<void> {
  await db
    .update(copilotThreads)
    .set({ handles, updatedAt: sql`now()` })
    .where(eq(copilotThreads.id, id));
}

/** Appends after the thread's last item, in order (stateless replay, D37). */
export async function appendItems(
  db: DbLike,
  threadId: string,
  items: ReadonlyArray<{ role: CopilotRole; item: Record<string, unknown> }>,
): Promise<void> {
  if (items.length === 0) return;
  const [last] = await db
    .select({ seq: max(copilotItems.seq) })
    .from(copilotItems)
    .where(eq(copilotItems.threadId, threadId));
  const start = (last?.seq ?? -1) + 1;
  await db
    .insert(copilotItems)
    .values(items.map((entry, i) => ({ threadId, seq: start + i, ...entry })));
  await db
    .update(copilotThreads)
    .set({ updatedAt: sql`now()` })
    .where(eq(copilotThreads.id, threadId));
}

export async function loadItems(
  db: DbLike,
  threadId: string,
): Promise<Array<{ seq: number; role: CopilotRole; item: Record<string, unknown> }>> {
  return db
    .select({ seq: copilotItems.seq, role: copilotItems.role, item: copilotItems.item })
    .from(copilotItems)
    .where(eq(copilotItems.threadId, threadId))
    .orderBy(asc(copilotItems.seq));
}

export async function saveResult(
  db: DbLike,
  threadId: string,
  result: StoredResult,
): Promise<void> {
  await db.insert(copilotResults).values({ threadId, ...result });
}

export async function loadResult(
  db: DbLike,
  threadId: string,
  resultId: string,
): Promise<StoredResult | null> {
  const [row] = await db
    .select()
    .from(copilotResults)
    .where(and(eq(copilotResults.threadId, threadId), eq(copilotResults.resultId, resultId)));
  return row ?? null;
}

export async function loadResults(db: DbLike, threadId: string): Promise<StoredResult[]> {
  return db
    .select()
    .from(copilotResults)
    .where(eq(copilotResults.threadId, threadId))
    .orderBy(asc(copilotResults.createdAt));
}

export async function listThreads(
  db: DbLike,
  workspaceId: string,
): Promise<Array<{ id: string; title: string; updatedAt: Date }>> {
  return db
    .select({
      id: copilotThreads.id,
      title: copilotThreads.title,
      updatedAt: copilotThreads.updatedAt,
    })
    .from(copilotThreads)
    .where(eq(copilotThreads.workspaceId, workspaceId))
    .orderBy(desc(copilotThreads.updatedAt))
    .limit(50);
}

export async function deleteThread(db: DbLike, workspaceId: string, id: string): Promise<void> {
  await db
    .delete(copilotThreads)
    .where(and(eq(copilotThreads.id, id), eq(copilotThreads.workspaceId, workspaceId)));
}

/** Questions asked since `since` in this workspace: the rate limit's count (spec §7.8). */
export async function countQuestionsSince(
  db: DbLike,
  workspaceId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(copilotItems)
    .innerJoin(copilotThreads, eq(copilotThreads.id, copilotItems.threadId))
    .where(
      and(
        eq(copilotThreads.workspaceId, workspaceId),
        eq(copilotItems.role, "user"),
        gte(copilotItems.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

/** The UTC day the cap counts against (spec §7.8). */
const today = () => new Date().toISOString().slice(0, 10);

export async function spentToday(db: DbLike): Promise<number> {
  const [row] = await db
    .select({ usd: copilotSpend.usd })
    .from(copilotSpend)
    .where(eq(copilotSpend.day, today()));
  return row?.usd ?? 0;
}

export async function addSpend(db: DbLike, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  await db
    .insert(copilotSpend)
    .values({ day: today(), usd })
    .onConflictDoUpdate({
      target: copilotSpend.day,
      set: { usd: sql`${copilotSpend.usd} + ${usd}` },
    });
}

export async function purgeThreadsBefore(db: DbLike, cutoff: Date): Promise<void> {
  await db.delete(copilotThreads).where(lt(copilotThreads.updatedAt, cutoff));
}
