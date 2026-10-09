import { randomUUID } from "node:crypto";
import { noteBlocks } from "@mastertutor/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BlockDraft, WriteContext } from "./note-writer.ts";
import type { Embedder } from "./embedder.ts";
import { sha256Hex } from "./hash.ts";
import { keysBetween } from "./positions.ts";

export type CaptureRow = typeof noteBlocks.$inferSelect;

/** Source location identifies repeated text at distinct anchors; DOM order is placement, not identity. */
function anchorKey(anchor: BlockDraft["anchor"]): string {
  if (!anchor) return "null";
  const { domOrder, ...location } = anchor;
  if (!anchor.selector && !anchor.xpath && !anchor.page && anchor.tStart === undefined)
    return JSON.stringify({ ...location, domOrder });
  return JSON.stringify(
    Object.fromEntries(Object.entries(location).sort(([a], [b]) => a.localeCompare(b))),
  );
}
/** A text change may change end/fragment; its starting location is still the same element. */
function placeKey(anchor: BlockDraft["anchor"]): string | null {
  if (!anchor) return null;
  const { end: _end, textFragment: _fragment, tEnd: _tEnd, ...location } = anchor;
  return anchorKey({ ...location, end: null, textFragment: null });
}
const identity = (markdown: string, anchor: BlockDraft["anchor"]) =>
  `${sha256Hex(markdown)}:${anchorKey(anchor)}`;

function sourceOrder(a: CaptureRow, b: CaptureRow): number {
  const left = a.anchor?.domOrder,
    right = b.anchor?.domOrder;
  if (!left || !right) return 0;
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i]! - right[i]!;
    if (difference) return difference;
  }
  return left.length - right.length || (a.anchor?.start ?? 0) - (b.anchor?.start ?? 0);
}

/** Reconcile verbatim blocks, preserving IDs/edits and placing partial captures by DOM location. */
export async function stageCaptureBlocks(
  embedder: Embedder,
  w: WriteContext,
  options: { noteId: string; sourceId: string; blocks: readonly BlockDraft[]; whole: boolean },
  previous: CaptureRow[],
): Promise<{ rows: CaptureRow[]; blockIds: string[] }> {
  const mine = previous.filter((row) => row.sourceId === options.sourceId);
  const existing = new Map(
    mine.map((row) => [identity(row.originalMarkdown ?? row.markdown, row.anchor), row]),
  );
  const seen = new Set<string>();
  const incoming = options.blocks.filter((block) => {
    const key = identity(block.markdown, block.anchor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const added = incoming.filter((block) => !existing.has(identity(block.markdown, block.anchor)));
  const vectors = await embedder.embed(
    added.map((block) => block.markdown),
    { signal: w.signal, step: w.step },
  );
  const embeddings = new Map(
    added.map((block, i) => [identity(block.markdown, block.anchor), vectors[i] ?? null]),
  );
  const rows = incoming.map((block): CaptureRow => {
    const old = existing.get(identity(block.markdown, block.anchor));
    return {
      id: old?.id ?? randomUUID(),
      noteId: options.noteId,
      sourceId: options.sourceId,
      position: "",
      ...block,
      contentSha256: sha256Hex(block.markdown),
      embedding: old?.embedding ?? embeddings.get(identity(block.markdown, block.anchor)) ?? null,
      edited: old?.edited ?? false,
      originalMarkdown: old?.originalMarkdown ?? null,
      markdown: old?.edited ? old.markdown : block.markdown,
      search: old?.search ?? "",
      createdAt: old?.createdAt ?? new Date(),
    };
  });
  const selected = new Set(rows.map((row) => row.id));
  const anchors = new Set(
    incoming.map((block) => placeKey(block.anchor)).filter((key) => key !== null),
  );
  const kept = mine.filter(
    (row) =>
      !selected.has(row.id) &&
      (row.edited || (!options.whole && !anchors.has(placeKey(row.anchor) ?? ""))),
  );
  const merged = options.whole ? [...rows, ...kept] : [...kept, ...rows].sort(sourceOrder);
  const others = previous.filter((row) => row.sourceId !== options.sourceId);
  const ordered = [...merged, ...others];
  const positions = keysBetween(null, null, ordered.length);
  ordered.forEach((row, i) => {
    row.position = positions[i]!;
  });
  const retained = new Set(ordered.map((row) => row.id));
  const removed = previous.filter((row) => !retained.has(row.id)).map((row) => row.id);
  w.step.defer(async (tx) => {
    if (removed.length)
      await tx
        .delete(noteBlocks)
        .where(
          and(
            eq(noteBlocks.noteId, options.noteId),
            eq(noteBlocks.edited, false),
            inArray(noteBlocks.id, removed),
          ),
        );
    // Free the unique position keys before moving rows (including source reorder/reversal).
    if (previous.length)
      await tx
        .update(noteBlocks)
        .set({ position: sql`'pending:' || ${noteBlocks.id}::text` })
        .where(
          and(
            eq(noteBlocks.noteId, options.noteId),
            inArray(
              noteBlocks.id,
              previous.map((row) => row.id),
            ),
          ),
        );
    const values = ordered.map(({ search: _search, ...row }) => row);
    for (let i = 0; i < values.length; i += 500)
      await tx
        .insert(noteBlocks)
        .values(values.slice(i, i + 500))
        .onConflictDoUpdate({
          target: noteBlocks.id,
          set: {
            position: sql`excluded.position`,
            sourceId: sql`excluded.source_id`,
            anchor: sql`excluded.anchor`,
            verified: sql`excluded.verified`,
            assetId: sql`excluded.asset_id`,
            type: sql`excluded.type`,
            origin: sql`excluded.origin`,
          },
        });
  });
  const previousIds = new Set(previous.map((row) => row.id));
  for (const row of rows.filter((row) => !previousIds.has(row.id)))
    w.step.emit({
      type: "block_added",
      noteId: options.noteId,
      blockId: row.id,
      blockType: row.type,
      origin: row.origin,
    });
  return { rows: ordered, blockIds: rows.map((row) => row.id) };
}
