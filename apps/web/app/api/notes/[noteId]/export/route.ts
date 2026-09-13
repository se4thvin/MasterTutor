import { Uuid } from "@mastertutor/contracts";
import { attachmentDisposition } from "@mastertutor/contracts/export";
import { workspaceIdOf } from "@mastertutor/db";
import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { buildNoteExport } from "@/lib/server/library/export.ts";
import { OBJECT_CACHE, OBJECT_HEADERS } from "@/lib/server/library/objects.ts";
import { ServiceError } from "@/lib/server/service-error.ts";
import { getStorage } from "@/lib/server/storage.ts";
import { getViewerId } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

const status = (code: number) =>
  new Response(null, {
    status: code,
    headers: { ...OBJECT_HEADERS, "Cache-Control": OBJECT_CACHE },
  });

/** GET /api/notes/<uuid>/export: the note's zip (decision 18), for the viewer's workspace only. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ noteId: string }> },
): Promise<Response> {
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return status(404);
  const { noteId } = await ctx.params;
  if (!Uuid.safeParse(noteId).success) return status(404);
  const userId = await getViewerId();
  if (!userId) return status(401);
  const db = getDb().db;
  const workspaceId = await workspaceIdOf(db, userId);
  if (!workspaceId) return status(404);
  let out: Awaited<ReturnType<typeof buildNoteExport>>;
  try {
    out = await buildNoteExport({ db, storage: getStorage() }, workspaceId, noteId);
  } catch (error) {
    // Over the export caps: a clear refusal, never a partial archive.
    if (error instanceof ServiceError && error.code === "invalid")
      return new Response(error.message, {
        status: 413,
        headers: { ...OBJECT_HEADERS, "Cache-Control": OBJECT_CACHE, "Content-Type": "text/plain" },
      });
    throw error;
  }
  if (!out) return status(404);
  return new Response(out.body, {
    headers: {
      ...OBJECT_HEADERS,
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentDisposition(out.fileName),
      "Cache-Control": OBJECT_CACHE,
    },
  });
}
