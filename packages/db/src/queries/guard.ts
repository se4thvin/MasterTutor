import { GuardState } from "@mastertutor/contracts";
import { runs } from "../schema/runs.ts";
import type {
  GuardCategory,
  GuardInput,
  GuardStage,
  GuardVerdictName,
  ObserverMode,
} from "@mastertutor/contracts";
import { asc, desc, eq } from "drizzle-orm";
import type { DbLike } from "../client.ts";
import { guardReviews } from "../schema/guard.ts";

export interface GuardReviewRow {
  runId: string;
  stepSeq: number;
  stage: GuardStage;
  verdict: GuardVerdictName;
  category: GuardCategory;
  rollout: ObserverMode;
  applied: boolean;
  input: GuardInput | null;
  latencyMs: number;
  usd: number;
  consecutive: number;
  total: number;
}

/** Written in the same transaction as the approve step that applied it (spec §6.7). */
export async function insertGuardReview(tx: DbLike, row: GuardReviewRow): Promise<void> {
  await tx.insert(guardReviews).values(row);
}

/** The denial ledger after the run's last review: survives sleeps and restarts (spec §6.7). */
export async function loadGuardLedger(
  db: DbLike,
  runId: string,
): Promise<{ consecutive: number; total: number }> {
  const [last] = await db
    .select({ consecutive: guardReviews.consecutive, total: guardReviews.total })
    .from(guardReviews)
    .where(eq(guardReviews.runId, runId))
    .orderBy(desc(guardReviews.createdAt), desc(guardReviews.stepSeq))
    .limit(1);
  return last ?? { consecutive: 0, total: 0 };
}

/** Every stored input of a run, oldest first: the benign replay corpus (spec §9). Owner only. */
export async function loadGuardInputs(db: DbLike, runId: string): Promise<GuardInput[]> {
  const rows = await db
    .select({ input: guardReviews.input })
    .from(guardReviews)
    .where(eq(guardReviews.runId, runId))
    .orderBy(asc(guardReviews.createdAt));
  return rows.flatMap((row) => (row.input ? [row.input] : []));
}

/** Invalid checkpoints fail the worker closed instead of silently dropping protection. */
export async function loadGuardState(db: DbLike, runId: string): Promise<GuardState | null> {
  const [row] = await db.select({ state: runs.guardState }).from(runs).where(eq(runs.id, runId));
  return row?.state ? GuardState.parse(row.state) : null;
}
