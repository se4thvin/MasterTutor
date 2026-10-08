import type { NoteBlock, NoteDetail, NoteSummary, SourceKind } from "@mastertutor/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../client.ts";
import { noteBlocks, notes, sources } from "../schema/index.ts";

const iso = (value: Date) => value.toISOString();

/** What a block view needs: never the embedding vector or the generated search column. */
export const NOTE_BLOCK_COLUMNS = {
  id: noteBlocks.id,
  noteId: noteBlocks.noteId,
  position: noteBlocks.position,
  type: noteBlocks.type,
  markdown: noteBlocks.markdown,
  assetId: noteBlocks.assetId,
  sourceId: noteBlocks.sourceId,
  origin: noteBlocks.origin,
  anchor: noteBlocks.anchor,
  contentSha256: noteBlocks.contentSha256,
  verified: noteBlocks.verified,
  edited: noteBlocks.edited,
  originalMarkdown: noteBlocks.originalMarkdown,
  createdAt: noteBlocks.createdAt,
};
type NoteBlockRow = Pick<typeof noteBlocks.$inferSelect, keyof typeof NOTE_BLOCK_COLUMNS>;
type NoteRow = Pick<
  typeof notes.$inferSelect,
  | "id"
  | "folderId"
  | "title"
  | "lede"
  | "fidelity"
  | "coverage"
  | "filedBy"
  | "runId"
  | "createdAt"
  | "updatedAt"
>;

/** The one notes-row → NoteSummary mapping (notes.list, notes.get, export). */
export function noteSummaryView(note: NoteRow, sourceKinds: readonly SourceKind[]): NoteSummary {
  return {
    id: note.id,
    folderId: note.folderId,
    title: note.title,
    lede: note.lede,
    fidelity: note.fidelity,
    coverage: note.coverage,
    filedBy: note.filedBy,
    runId: note.runId,
    sourceKinds: [...new Set(sourceKinds)].sort(),
    createdAt: iso(note.createdAt),
    updatedAt: iso(note.updatedAt),
  };
}

/** The one note_blocks-row → NoteBlock mapping. */
export function noteBlockView(block: NoteBlockRow): NoteBlock {
  return {
    id: block.id,
    noteId: block.noteId,
    position: block.position,
    type: block.type,
    markdown: block.markdown,
    assetId: block.assetId,
    sourceId: block.sourceId,
    origin: block.origin,
    anchor: block.anchor ?? null,
    contentSha256: block.contentSha256,
    verified: block.verified,
    edited: block.edited,
    originalMarkdown: block.originalMarkdown,
    createdAt: iso(block.createdAt),
  };
}

/** One note with its blocks (position byte order) and sources, workspace-scoped (export and notes.get). */
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
    .select(NOTE_BLOCK_COLUMNS)
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
    note: noteSummaryView(
      note,
      sourceRows.map((s) => s.kind),
    ),
    blocks: blocks.map(noteBlockView),
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
