import { getWebEnv } from "@/lib/server/env.ts";
import { authorizeLive } from "@/lib/server/live/authorize.ts";
import { getAuthorizeDeps } from "@/lib/server/live/deps.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

/**
 * Traefik ForwardAuth for /live/<runId>/ (spec §10.2.2). Traefik copies this response's Cookie
 * header onto the upstream request (authResponseHeaders: Cookie), replacing the browser's, so
 * n.eko only ever receives NEKO_SESSION, never the Better Auth or live_slot cookies.
 */
export async function GET(request: Request): Promise<Response> {
  const headers = new Headers({ "cache-control": "no-store" });
  // A fixture build signs in a fake viewer; it must never authorize a real slot (E3).
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API)
    return new Response(null, { status: 403, headers });
  const viewer = await getViewer().catch(() => null);
  const decision = await authorizeLive(getAuthorizeDeps(), {
    forwardedUri: request.headers.get("x-forwarded-uri"),
    cookieHeader: request.headers.get("cookie"),
    userId: viewer?.id ?? null,
  });
  if (!decision.allow) return new Response(null, { status: decision.status, headers });
  headers.set("cookie", decision.upstreamCookie);
  return new Response(null, { status: 200, headers });
}
