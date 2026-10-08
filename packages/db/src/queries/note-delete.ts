import { assetIdsIn } from "@mastertutor/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../client.ts";
import { downloads } from "../schema/runs.ts";
import { assets, noteBlocks, notes, objectDeletions, sources } from "../schema/index.ts";

/**
 * Deletes a note (spec §4) with what only it used, in the caller's transaction:
 * - its blocks (cascade) and its sources, with their snapshot objects;
 * - every asset its blocks or sources referenced that nothing else in the workspace still does
 *   (another note's block, inline `asset:` link, favicon, or a run's download).
 * Object keys go to object_deletions in the same transaction; the agent's sweep deletes the objects
 * afterwards and retries until it succeeds, so a failed object delete never leaves a row behind.
 * The note row is locked first, the order every library write uses. False when not found.
 */
export async function deleteNoteWithMedia(
  db: DbLike,
  workspaceId: string,
  noteId: string,
): Promise<boolean> {
  const [note] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.workspaceId, workspaceId)))
    .for("update");
  if (!note) return false;
  const blocks = await db
    .select({ assetId: noteBlocks.assetId, markdown: noteBlocks.markdown })
    .from(noteBlocks)
    .where(eq(noteBlocks.noteId, noteId));
  const ownSources = await db
    .delete(sources)
    .where(and(eq(sources.workspaceId, workspaceId), sql`${sources.meta}->>'noteId' = ${noteId}`))
    .returning({
      favicon: sources.faviconAssetId,
      mhtml: sources.mhtmlKey,
      screenshot: sources.screenshotKey,
    });
  await db.delete(notes).where(eq(notes.id, noteId));
  const candidates = [
    ...new Set([
      ...blocks.flatMap((b) => [...(b.assetId ? [b.assetId] : []), ...assetIdsIn(b.markdown)]),
      ...ownSources.flatMap((s) => (s.favicon ? [s.favicon] : [])),
    ]),
  ];
  const unused = candidates.length
    ? await db
        .delete(assets)
        .where(
          and(
            eq(assets.workspaceId, workspaceId),
            inArray(assets.id, candidates),
            sql`not exists (select 1 from ${noteBlocks} b join ${notes} n on n.id = b.note_id
                  where n.workspace_id = ${workspaceId}
                    and (b.asset_id = ${assets.id} or position('asset:' || ${assets.id}::text in b.markdown) > 0))`,
            sql`not exists (select 1 from ${sources} s where s.favicon_asset_id = ${assets.id})`,
            sql`not exists (select 1 from ${downloads} d where d.asset_id = ${assets.id})`,
          ),
        )
        .returning({ key: assets.key })
    : [];
  const keys = [
    ...unused.map((a) => a.key),
    ...ownSources.flatMap((s) => [s.mhtml, s.screenshot].filter((k): k is string => k !== null)),
  ];
  if (keys.length > 0)
    await db
      .insert(objectDeletions)
      .values(keys.map((key) => ({ key })))
      .onConflictDoNothing();
  return true;
}
