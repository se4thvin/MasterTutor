import { Uuid } from "@mastertutor/contracts";
import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { ASSET_CACHE, OBJECT_HEADERS, assetResponse } from "@/lib/server/library/objects.ts";
import { getStorage } from "@/lib/server/storage.ts";
import { getViewer, getViewerId } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

const headers = { ...OBJECT_HEADERS, "Cache-Control": ASSET_CACHE };

/** GET /api/assets/<uuid>: what block Markdown's `asset:` targets map to. Session and workspace required. */
export async function GET(request: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await ctx.params;
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) {
    // Fixture mode serves the placeholder figures.
    if (!Uuid.safeParse(assetId).success) return new Response(null, { status: 404, headers });
    if (!(await getViewer())) return new Response(null, { status: 401, headers });
    const { FIXTURE_ASSETS } = await import("@/lib/fixtures/assets.ts");
    const dataUri = FIXTURE_ASSETS.get(assetId);
    if (!dataUri) return new Response(null, { status: 404, headers });
    const comma = dataUri.indexOf(",");
    return new Response(decodeURIComponent(dataUri.slice(comma + 1)), {
      headers: { ...headers, "Content-Type": "image/svg+xml" },
    });
  }
  return assetResponse(
    { db: getDb().db, storage: getStorage(), viewerId: getViewerId },
    request,
    assetId,
  );
}
