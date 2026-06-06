import { and, desc, eq, inArray } from "drizzle-orm";
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
