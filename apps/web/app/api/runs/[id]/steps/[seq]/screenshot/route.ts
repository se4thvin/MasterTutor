import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { stepScreenshotResponse } from "@/lib/server/runs/screenshots.ts";
import { getStorage } from "@/lib/server/storage.ts";
import { getViewerId } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; seq: string }> },
): Promise<Response> {
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return new Response(null, { status: 404 });
  const { id, seq } = await ctx.params;
  return stepScreenshotResponse(
    { db: getDb().db, storage: getStorage(), viewerId: getViewerId },
    request,
    id,
    seq,
  );
}
