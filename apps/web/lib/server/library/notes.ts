import type {
  BlockRef,
  ListNotesInput,
  NoteBlock,
  NoteDetail,
  NoteRef,
  NoteSummary,
  Ok,
  SourceKind,
  UpdateBlockInput,
} from "@mastertutor/contracts";
import {
  KeysetCursorInvalid,
  NOTE_BLOCK_COLUMNS,
  keysetBefore,
  deleteNoteWithMedia,
  keysetCursor,
  loadNoteDetail,
  msOf,
  noteBlockView,
  noteBlocks,
  noteSummaryView,
  notes,
  parseKeysetCursor,
  refreshNoteQuality,
  type Database,
  type KeysetPosition,
} from "@mastertutor/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ServiceError } from "../service-error.ts";

/** A note's source kinds come through its blocks' sources, exactly as loadNoteDetail derives them. */
// Raw subqueries name their tables in full: drizzle renders bare column names inside sql``, and
// "id" would be ambiguous between note_blocks, sources and the outer notes row.
const kindsOfNote = sql<
  SourceKind[]
>`array(select distinct s.kind::text from note_blocks b join sources s on s.id = b.source_id where b.note_id = notes.id)`;
const hasKind = (kind: SourceKind) =>
  sql`exists (select 1 from note_blocks b join sources s on s.id = b.source_id where b.note_id = notes.id and s.kind = ${kind})`;
const missingBlock = () => new ServiceError("not_found", "Block not found");

export async function listNotes(
  db: Database,
  workspaceId: string,
  input: ListNotesInput,
): Promise<{ items: NoteSummary[]; nextCursor: string | null }> {
  let position: KeysetPosition | null;
  try {
    position = parseKeysetCursor(input.cursor);
  } catch (error) {
    if (error instanceof KeysetCursorInvalid)
      throw new ServiceError("invalid", "That page of notes doesn't exist.");
    throw error;
  }
  const folder =
    input.folder === "all"
      ? undefined
      : input.folder === "unfiled"
        ? isNull(notes.folderId)
        : eq(notes.folderId, input.folder);
  const rows = await db
    .select({
      id: notes.id,
      folderId: notes.folderId,
      title: notes.title,
      lede: notes.lede,
      fidelity: notes.fidelity,
      coverage: notes.coverage,
      filedBy: notes.filedBy,
      runId: notes.runId,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      sourceKinds: kindsOfNote,
    })
    .from(notes)
    .where(
      and(
        eq(notes.workspaceId, workspaceId),
        folder,
        input.kind === null ? undefined : hasKind(input.kind),
        keysetBefore(notes.createdAt, notes.id, position),
      ),
    )
    .orderBy(desc(msOf(notes.createdAt)), desc(notes.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items: items.map((row) => noteSummaryView(row, row.sourceKinds)),
    nextCursor: rows.length > input.limit && last ? keysetCursor(last.createdAt, last.id) : null,
  };
}

export async function getNote(
  db: Database,
  workspaceId: string,
  input: NoteRef,
): Promise<NoteDetail> {
  const detail = await loadNoteDetail(db, workspaceId, input.noteId);
  if (!detail) throw new ServiceError("not_found", "Note not found");
  return detail;
}

/**
 * A person's edit (spec §7): the first edit keeps the captured text in original_markdown. The
 * block's vector described the old text, so it is dropped; full-text search follows the edit at
 * once (generated column). If the note's run is still active, the agent's embedding backfill may
 * embed the edited text later (as it does any block without a vector), so search stays semantic.
 */
export async function updateBlock(
  db: Database,
  workspaceId: string,
  input: UpdateBlockInput,
): Promise<NoteBlock> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ noteId: noteBlocks.noteId })
      .from(noteBlocks)
      .innerJoin(notes, eq(notes.id, noteBlocks.noteId))
      .where(and(eq(noteBlocks.id, input.blockId), eq(notes.workspaceId, workspaceId)))
      // The note row first, then its blocks: the one lock order of every library write.
      .for("update", { of: notes });
    if (!found) throw missingBlock();
    const [row] = await tx
      .update(noteBlocks)
      .set({
        originalMarkdown: sql`case when ${noteBlocks.edited} then ${noteBlocks.originalMarkdown} else ${noteBlocks.markdown} end`,
        markdown: input.markdown,
        edited: true,
        embedding: null,
      })
      .where(eq(noteBlocks.id, input.blockId))
      .returning(NOTE_BLOCK_COLUMNS);
    if (!row) throw missingBlock();
    await tx.update(notes).set({ updatedAt: new Date() }).where(eq(notes.id, found.noteId));
    return noteBlockView(row);
  });
}

/** "Mark verified" (spec §7.5): the block is verified and the note's fidelity is recomputed by the shared rule. */
export async function markVerified(
  db: Database,
  workspaceId: string,
  input: BlockRef,
): Promise<NoteBlock> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ noteId: notes.id, coverage: notes.coverage })
      .from(noteBlocks)
      .innerJoin(notes, eq(notes.id, noteBlocks.noteId))
      .where(and(eq(noteBlocks.id, input.blockId), eq(notes.workspaceId, workspaceId)))
      .for("update", { of: notes });
    if (!found) throw missingBlock();
    const [row] = await tx
      .update(noteBlocks)
      .set({ verified: true })
      .where(eq(noteBlocks.id, input.blockId))
      .returning(NOTE_BLOCK_COLUMNS);
    if (!row) throw missingBlock();
    await refreshNoteQuality(tx, workspaceId, found.noteId, found.coverage);
    return noteBlockView(row);
  });
}

/** Deletes the note with its blocks, sources and the assets only it used (deleteNoteWithMedia). */
export async function deleteNote(db: Database, workspaceId: string, input: NoteRef): Promise<Ok> {
  const deleted = await db.transaction((tx) => deleteNoteWithMedia(tx, workspaceId, input.noteId));
  if (!deleted) throw new ServiceError("not_found", "Note not found");
  return { ok: true };
}
