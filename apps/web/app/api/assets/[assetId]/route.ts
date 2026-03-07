import { Uuid } from "@mastertutor/contracts";
import { getWebEnv } from "@/lib/server/env.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

/** Stored assets are never documents: no sniffing, no script, no embedding elsewhere, no caching by others. */
const INERT_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cache-Control": "private, max-age=3600",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * GET /api/assets/<uuid>: what block Markdown's `asset:` targets map to. Session required.
 * Fixture mode serves the placeholder figures; B2 (Phase 7, its Task 11) replaces this handler
 * with the Garage-backed one that also checks workspace membership.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await ctx.params;
  if (!Uuid.safeParse(assetId).success) return new Response(null, { status: 404 });
  if (!(await getViewer())) return new Response(null, { status: 401 });
  if (!(__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API))
    return new Response(null, { status: 501 });
  const { FIXTURE_ASSETS } = await import("@/lib/fixtures/assets.ts");
  const dataUri = FIXTURE_ASSETS.get(assetId);
  if (!dataUri) return new Response(null, { status: 404 });
  const comma = dataUri.indexOf(",");
  return new Response(decodeURIComponent(dataUri.slice(comma + 1)), {
    headers: { ...INERT_HEADERS, "Content-Type": "image/svg+xml" },
  });
}
