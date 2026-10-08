import type { ExportResult, NoteDetail } from "@mastertutor/contracts";
import { exportTooLarge, noteAssetIds, streamNoteArchive } from "@mastertutor/contracts/export";
import { assets, type Database, folderPaths, listFolders, loadNoteDetail } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { and, eq, inArray } from "drizzle-orm";
import { ServiceError } from "../service-error.ts";

const EXPORT_LINK_TTL_SECONDS = 300;

interface ExportPlan {
  detail: NoteDetail;
  assets: Array<{ id: string; sha256: string; mime: string; key: string; bytes: number }>;
}

/**
 * What one export holds, workspace-scoped; null when the note is not in this workspace. A note
 * over the count or size cap is refused here, before anything is read (13-14 review).
 */
async function exportPlan(
  db: Database,
  workspaceId: string,
  noteId: string,
): Promise<ExportPlan | null> {
  const detail = await loadNoteDetail(db, workspaceId, noteId);
  if (!detail) return null;
  const ids = noteAssetIds(detail);
  const rows = ids.length
    ? await db
        .select({
          id: assets.id,
          sha256: assets.sha256,
          mime: assets.mime,
          key: assets.key,
          bytes: assets.bytes,
        })
        .from(assets)
        .where(and(inArray(assets.id, ids), eq(assets.workspaceId, workspaceId)))
    : [];
  const tooLarge = exportTooLarge(rows);
  if (tooLarge) throw new ServiceError("invalid", tooLarge);
  return { detail, assets: rows };
}

/** The note's export, streamed: each asset is read from storage only as the zip reaches it. */
export async function buildNoteExport(
  deps: { db: Database; storage: Pick<Storage, "getStream"> },
  workspaceId: string,
  noteId: string,
): Promise<{ fileName: string; body: ReadableStream<Uint8Array> } | null> {
  const plan = await exportPlan(deps.db, workspaceId, noteId);
  if (!plan) return null;
  const folderPath = plan.detail.note.folderId
    ? (folderPaths(await listFolders(deps.db, workspaceId)).get(plan.detail.note.folderId) ?? [])
    : [];
  return streamNoteArchive({
    detail: plan.detail,
    folderPath,
    assets: plan.assets.map((row) => ({ ...row, open: () => deps.storage.getStream(row.key) })),
  });
}

/** `notes.export`: a same-origin download path; an export over the caps is refused here already. */
export async function exportNote(
  db: Database,
  workspaceId: string,
  input: { noteId: string },
): Promise<ExportResult> {
  const plan = await exportPlan(db, workspaceId, input.noteId);
  if (!plan) throw new ServiceError("not_found", "Note not found");
  return {
    downloadUrl: `/api/notes/${plan.detail.note.id}/export`,
    expiresAt: new Date(Date.now() + EXPORT_LINK_TTL_SECONDS * 1_000).toISOString(),
  };
}
