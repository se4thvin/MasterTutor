import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, DbTx } from "../client.ts";
import { approvals, assets, downloads, runs } from "../schema/index.ts";

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
  const [inserted] = await tx
    .insert(assets)
    .values({
      workspaceId: input.workspaceId,
      sha256: input.sha256,
      bucket: input.bucket,
      key: input.key,
      mime: input.mime,
      bytes: input.bytes,
      sourceUrl: input.sourceUrl.slice(0, 4_096),
    })
    .onConflictDoNothing({ target: [assets.workspaceId, assets.sha256] })
    .returning({ id: assets.id });
  const assetId =
    inserted?.id ??
    (
      await tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.sha256, input.sha256)))
    )[0]?.id;
  if (!assetId) throw new Error("asset row missing after insert");
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
 * Who approved the run's latest approved download: a user id, "policy" or "bypass" (B1's gate lets
 * exactly that download through; B6 files it with this approver). Null when none was approved.
 */
export async function latestDownloadApprover(db: Database, runId: string): Promise<string | null> {
  const [row] = await db
    .select({ decidedBy: approvals.decidedBy })
    .from(approvals)
    .where(
      and(
        eq(approvals.runId, runId),
        eq(approvals.kind, "download"),
        inArray(approvals.status, ["approved", "edited"]),
      ),
    )
    .orderBy(desc(approvals.decidedAt))
    .limit(1);
  return row?.decidedBy ?? null;
}

/** A download a person made during control: recorded as pending, nothing stored (B6, A11). */
export async function recordPendingDownload(
  tx: DbTx,
  input: { id: string; runId: string; filename: string; bytes: number; approvedBy: string },
): Promise<void> {
  await tx.insert(downloads).values({ ...input, pending: true });
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
  const [inserted] = await tx
    .insert(assets)
    .values({
      workspaceId: input.workspaceId,
      sha256: input.sha256,
      bucket: input.bucket,
      key: input.key,
      mime: input.mime,
      bytes: row.bytes,
      sourceUrl: input.sourceUrl?.slice(0, 4_096) ?? null,
    })
    .onConflictDoNothing({ target: [assets.workspaceId, assets.sha256] })
    .returning({ id: assets.id });
  const assetId =
    inserted?.id ??
    (
      await tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.sha256, input.sha256)))
    )[0]?.id;
  if (!assetId) throw new Error("asset row missing after insert");
  await tx
    .update(downloads)
    .set({ assetId, pending: false })
    .where(eq(downloads.id, input.downloadId));
  return { assetId };
}

/** A pending download nobody kept: gone (its local file is the caller's to delete). */
export async function discardDownload(tx: DbTx, runId: string, id: string): Promise<void> {
  await tx
    .delete(downloads)
    .where(and(eq(downloads.id, id), eq(downloads.runId, runId), eq(downloads.pending, true)));
}
