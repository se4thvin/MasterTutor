import type { NoteDetail } from "@mastertutor/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../client.ts";
import { noteBlocks, notes, sources } from "../schema/index.ts";

const iso = (value: Date) => value.toISOString();

/** One note with its blocks (position byte order) and sources, workspace-scoped (export now; notes.get in Phase 7). */
export async function loadNoteDetail(
  db: DbLike,
  workspaceId: string,
  noteId: string,
): Promise<NoteDetail | null> {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.workspaceId, workspaceId)));
  if (!note) return null;
  const blocks = await db
    .select()
    .from(noteBlocks)
    .where(eq(noteBlocks.noteId, noteId))
    .orderBy(sql`${noteBlocks.position} collate "C"`);
  const sourceIds = [...new Set(blocks.flatMap((b) => (b.sourceId ? [b.sourceId] : [])))];
  const sourceRows = sourceIds.length
    ? await db
        .select()
        .from(sources)
        .where(and(inArray(sources.id, sourceIds), eq(sources.workspaceId, workspaceId)))
    : [];
  return {
    note: {
      id: note.id,
      folderId: note.folderId,
      title: note.title,
      lede: note.lede,
      fidelity: note.fidelity,
      coverage: note.coverage,
      filedBy: note.filedBy,
      runId: note.runId,
      sourceKinds: [...new Set(sourceRows.map((s) => s.kind))],
      createdAt: iso(note.createdAt),
      updatedAt: iso(note.updatedAt),
    },
    blocks: blocks.map((b) => ({
      id: b.id,
      noteId: b.noteId,
      position: b.position,
      type: b.type,
      markdown: b.markdown,
      assetId: b.assetId,
      sourceId: b.sourceId,
      origin: b.origin,
      anchor: b.anchor ?? null,
      contentSha256: b.contentSha256,
      verified: b.verified,
      edited: b.edited,
      originalMarkdown: b.originalMarkdown,
      createdAt: iso(b.createdAt),
    })),
    sources: sourceRows.map((s) => ({
      id: s.id,
      kind: s.kind,
      url: s.url,
      canonicalUrl: s.canonicalUrl,
      origin: s.origin,
      title: s.title,
      faviconAssetId: s.faviconAssetId,
      capturedAt: iso(s.capturedAt),
    })),
  };
}
