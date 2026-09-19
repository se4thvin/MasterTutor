import { CAPTURED_ORIGINS, noteFidelity, type Fidelity } from "@mastertutor/contracts";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../client.ts";
import { noteBlocks, notes, sources } from "../schema/index.ts";

/**
 * The one write of a note's coverage and fidelity (B2 decision 13): the agent after a capture
 * (NoteWriter.stageQuality) and web's "Mark verified" both call it. Lost media is what capture
 * recorded in sources.meta.mediaLost for this note; a non-numeric value counts as none rather
 * than aborting the caller's transaction. Every read and the write are workspace-scoped.
 */
export async function refreshNoteQuality(
  db: DbLike,
  workspaceId: string,
  noteId: string,
  coverage: number | null,
): Promise<Fidelity> {
  const [unverified] = await db
    .select({ n: count() })
    .from(noteBlocks)
    .innerJoin(notes, eq(notes.id, noteBlocks.noteId))
    .where(
      and(
        eq(noteBlocks.noteId, noteId),
        eq(notes.workspaceId, workspaceId),
        inArray(noteBlocks.origin, [...CAPTURED_ORIGINS]),
        eq(noteBlocks.verified, false),
      ),
    );
  const mediaLost = sql`${sources.meta}->>'mediaLost'`;
  const [lost] = await db
    .select({
      n: sql<number>`coalesce(sum(case when ${mediaLost} ~ '^[0-9]{1,9}$' then (${mediaLost})::int else 0 end), 0)::int`,
    })
    .from(sources)
    .where(and(eq(sources.workspaceId, workspaceId), sql`${sources.meta}->>'noteId' = ${noteId}`));
  const fidelity = noteFidelity({
    coverage,
    unverifiedCaptured: unverified?.n ?? 0,
    missingMedia: lost?.n ?? 0,
  });
  await db
    .update(notes)
    .set({ coverage, fidelity, updatedAt: new Date() })
    .where(and(eq(notes.id, noteId), eq(notes.workspaceId, workspaceId)));
  return fidelity;
}
