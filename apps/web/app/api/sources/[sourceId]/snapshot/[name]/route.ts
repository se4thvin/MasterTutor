import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { OBJECT_CACHE, objectStatus, snapshotResponse } from "@/lib/server/library/objects.ts";
import { getStorage } from "@/lib/server/storage.ts";
import { getViewerId } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

/** GET /api/sources/<uuid>/snapshot/page.mhtml|page.png (spec §7.1 provenance). */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ sourceId: string; name: string }> },
): Promise<Response> {
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return objectStatus(404, OBJECT_CACHE);
  const { sourceId, name } = await ctx.params;
  return snapshotResponse(
    { db: getDb().db, storage: getStorage(), viewerId: getViewerId },
    request,
    sourceId,
    name,
  );
}
