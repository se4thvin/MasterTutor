import type { ExportResult } from "@mastertutor/contracts";
import { buildNoteArchive, noteAssetIds } from "@mastertutor/contracts/export";
import {
  assets,
  type Database,
  folderPaths,
  listFolders,
  loadNoteDetail,
  notes,
} from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { and, eq, inArray } from "drizzle-orm";
import { ServiceError } from "../service-error.ts";

const EXPORT_LINK_TTL_SECONDS = 300;

/** The note's export archive, workspace-scoped; null when the note is not in this workspace. */
export async function buildNoteExport(
  deps: { db: Database; storage: Pick<Storage, "getBytes"> },
  workspaceId: string,
  noteId: string,
): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const detail = await loadNoteDetail(deps.db, workspaceId, noteId);
  if (!detail) return null;
  const ids = noteAssetIds(detail);
  const rows = ids.length
    ? await deps.db
        .select({ id: assets.id, sha256: assets.sha256, mime: assets.mime, key: assets.key })
        .from(assets)
        .where(and(inArray(assets.id, ids), eq(assets.workspaceId, workspaceId)))
    : [];
  const files = await Promise.all(
    rows.map(async (row) => ({ ...row, bytes: await deps.storage.getBytes(row.key) })),
  );
  const folderPath = detail.note.folderId
    ? (folderPaths(await listFolders(deps.db, workspaceId)).get(detail.note.folderId) ?? [])
    : [];
  return buildNoteArchive({ detail, folderPath, assets: files });
}

/** `notes.export`: a same-origin download path that needs the session cookie. */
export async function exportNote(
  db: Database,
  workspaceId: string,
  input: { noteId: string },
): Promise<ExportResult> {
  const [row] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, input.noteId), eq(notes.workspaceId, workspaceId)));
  if (!row) throw new ServiceError("not_found", "Note not found");
  return {
    downloadUrl: `/api/notes/${row.id}/export`,
    expiresAt: new Date(Date.now() + EXPORT_LINK_TTL_SECONDS * 1_000).toISOString(),
  };
}
