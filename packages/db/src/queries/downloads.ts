import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database, DbTx } from "../client.ts";
import { assets, downloads, runs } from "../schema/index.ts";
import { lockRunRow } from "./events.ts";

export async function findAssetBySha(
  db: Database,
  workspaceId: string,
  sha256: string,
): Promise<{ id: string; key: string } | null> {
  const [row] = await db
    .select({ id: assets.id, key: assets.key })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), eq(assets.sha256, sha256)));
  return row ?? null;
}

/**
 * The workspace's asset for this content: inserted once per (workspace, sha256), otherwise the
 * existing row (whose object key it keeps). The one upsert every download path uses.
 */
export async function upsertAsset(
  tx: DbTx,
  input: {
    workspaceId: string;
    sha256: string;
    bucket: string;
    key: string;
    mime: string;
    bytes: number;
    sourceUrl: string | null;
  },
): Promise<string> {
  const [inserted] = await tx
    .insert(assets)
    .values({ ...input, sourceUrl: input.sourceUrl?.slice(0, 4_096) ?? null })
    .onConflictDoNothing({ target: [assets.workspaceId, assets.sha256] })
    .returning({ id: assets.id });
  if (inserted) return inserted.id;
  const [existing] = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.sha256, input.sha256)));
  if (!existing) throw new Error("asset row missing after insert");
  return existing.id;
}

export interface DownloadRecordInput {
  runId: string;
  workspaceId: string;
  filename: string;
  sha256: string;
  bucket: string;
  key: string;
  mime: string;
  bytes: number;
  sourceUrl: string;
  /** The member who held control when the download began (v1: only the user downloads). */
  approvedBy: string;
}

/** assets (deduped per workspace by sha256) + downloads, inside the caller's transaction (spec §10.2.9). */
export async function recordDownload(
  tx: DbTx,
  input: DownloadRecordInput,
): Promise<{ downloadId: string; assetId: string }> {
  // Defence in depth: the asset is deduped per workspace, so the run must belong to that workspace.
  const [run] = await tx
    .select({ workspaceId: runs.workspaceId })
    .from(runs)
    .where(eq(runs.id, input.runId));
  if (run?.workspaceId !== input.workspaceId)
    throw new Error("download run is not in the given workspace");
  const assetId = await upsertAsset(tx, {
    workspaceId: input.workspaceId,
    sha256: input.sha256,
    bucket: input.bucket,
    key: input.key,
    mime: input.mime,
    bytes: input.bytes,
    sourceUrl: input.sourceUrl,
  });
  const [download] = await tx
    .insert(downloads)
    .values({
      runId: input.runId,
      filename: input.filename,
      assetId,
      bytes: input.bytes,
      approvedBy: input.approvedBy,
    })
    .returning({ id: downloads.id });
  if (!download) throw new Error("downloads insert returned no row");
  return { downloadId: download.id, assetId };
}

/**
 * A download a person made during control: recorded as pending, nothing stored (B6, A11).
 * Only while that person still holds control, checked under the run-row lock the hand-back also
 * takes, so a hand-back either sees the row (and settles it) or this refuses it (N2).
 */
export async function recordPendingDownload(
  tx: DbTx,
  input: { id: string; runId: string; filename: string; bytes: number; approvedBy: string },
): Promise<boolean> {
  const [run] = await tx
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.id, input.runId),
        eq(runs.controller, "user"),
        eq(runs.controlUserId, input.approvedBy),
      ),
    )
    .for("update");
  if (!run) return false;
  await tx.insert(downloads).values({ ...input, pending: true, byUser: true });
  return true;
}

/** Pending downloads of the run, with keptAt set for the ones the person kept at hand-back. */
export async function pendingDownloads(
  db: Database,
  runId: string,
): Promise<
  Array<{ id: string; filename: string; bytes: number; approvedBy: string; keptAt: Date | null }>
> {
  return db
    .select({
      id: downloads.id,
      filename: downloads.filename,
      bytes: downloads.bytes,
      approvedBy: downloads.approvedBy,
      keptAt: downloads.keptAt,
    })
    .from(downloads)
    .where(and(eq(downloads.runId, runId), eq(downloads.pending, true)));
}

/**
 * The run's downloads still waiting for the person's Keep or Discard (B6 A11), for the run
 * snapshot: pending and not yet kept, only while a person holds control, and only for a run in
 * this workspace. Oldest first, the order they were made.
 */
export async function heldDownloads(
  db: Database,
  input: { runId: string; workspaceId: string },
): Promise<Array<{ id: string; filename: string; bytes: number }>> {
  return db
    .select({ id: downloads.id, filename: downloads.filename, bytes: downloads.bytes })
    .from(downloads)
    .innerJoin(runs, eq(runs.id, downloads.runId))
    .where(
      and(
        eq(downloads.runId, input.runId),
        eq(runs.workspaceId, input.workspaceId),
        eq(runs.controller, "user"),
        eq(downloads.pending, true),
        isNull(downloads.keptAt),
      ),
    )
    .orderBy(asc(downloads.createdAt), asc(downloads.id));
}

/**
 * The run's stored downloads, for the run snapshot: filed (an asset, not pending), never
 * discarded, and only for a run in this workspace. Oldest first, as the stream announced them.
 */
export async function storedDownloads(
  db: Database,
  input: { runId: string; workspaceId: string },
): Promise<Array<{ id: string; assetId: string; filename: string; bytes: number; at: Date }>> {
  const rows = await db
    .select({
      id: downloads.id,
      assetId: downloads.assetId,
      filename: downloads.filename,
      bytes: downloads.bytes,
      at: downloads.createdAt,
    })
    .from(downloads)
    .innerJoin(runs, eq(runs.id, downloads.runId))
    .where(
      and(
        eq(downloads.runId, input.runId),
        eq(runs.workspaceId, input.workspaceId),
        eq(downloads.pending, false),
        isNull(downloads.discardedAt),
        isNotNull(downloads.assetId),
      ),
    )
    .orderBy(asc(downloads.createdAt), asc(downloads.id));
  return rows.flatMap((row) => (row.assetId ? [{ ...row, assetId: row.assetId }] : []));
}

/** Marks the listed pending downloads of this run as kept (the person's hand-back decision). */
export async function keepPendingDownloads(
  tx: DbTx,
  runId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(downloads)
    .set({ keptAt: sql`now()` })
    .where(
      and(eq(downloads.runId, runId), eq(downloads.pending, true), inArray(downloads.id, [...ids])),
    );
}

/** A kept download stored: its asset (deduped per workspace by sha256) and the row no longer pending. */
export async function fileKeptDownload(
  tx: DbTx,
  input: {
    downloadId: string;
    runId: string;
    workspaceId: string;
    sha256: string;
    bucket: string;
    key: string;
    mime: string;
    sourceUrl: string | null;
  },
): Promise<{ assetId: string }> {
  // Run row before download row, as the hand-back takes them (requestHandBack, then
  // keepPendingDownloads): the caller's download_ready event would otherwise lock in reverse.
  await lockRunRow(tx, input.runId);
  const [row] = await tx
    .select({ bytes: downloads.bytes })
    .from(downloads)
    .innerJoin(runs, eq(runs.id, downloads.runId))
    .where(
      and(
        eq(downloads.id, input.downloadId),
        eq(downloads.runId, input.runId),
        eq(runs.workspaceId, input.workspaceId),
        eq(downloads.pending, true),
      ),
    );
  if (!row) throw new Error("no pending download to file");
  const assetId = await upsertAsset(tx, {
    workspaceId: input.workspaceId,
    sha256: input.sha256,
    bucket: input.bucket,
    key: input.key,
    mime: input.mime,
    bytes: row.bytes,
    sourceUrl: input.sourceUrl,
  });
  await tx
    .update(downloads)
    .set({ assetId, pending: false })
    .where(eq(downloads.id, input.downloadId));
  return { assetId };
}

const DISCARDED = { pending: false, discardedAt: sql`now()` } as const;

/**
 * Every held download of the run discarded (lease end, crash recovery): their ids, for the files.
 * Discarded rows stay as markers so they still count toward the person's cap.
 */
export async function discardPendingDownloads(tx: DbTx, runId: string): Promise<string[]> {
  const rows = await tx
    .update(downloads)
    .set(DISCARDED)
    .where(and(eq(downloads.runId, runId), eq(downloads.pending, true)))
    .returning({ id: downloads.id });
  return rows.map((row) => row.id);
}

/** A pending download nobody kept, discarded (its local file is the caller's to delete). */
export async function discardDownload(tx: DbTx, runId: string, id: string): Promise<void> {
  await tx
    .update(downloads)
    .set(DISCARDED)
    .where(and(eq(downloads.id, id), eq(downloads.runId, runId), eq(downloads.pending, true)));
}

/**
 * The person's own downloads in this run, across all its leases, kept, held or discarded (the
 * per-run count cap): approved agent downloads do not count, and a discard frees nothing.
 */
export async function countUserDownloads(db: Database, runId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(downloads)
    .where(and(eq(downloads.runId, runId), eq(downloads.byUser, true)));
  return row?.count ?? 0;
}
