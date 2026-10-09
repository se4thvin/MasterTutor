import { RPCHandler } from "@orpc/server/fetch";
import { ResponseHeadersPlugin } from "@orpc/server/plugins";
import type { FixtureContext } from "@/lib/fixtures/types.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import type { LiveContext } from "@/lib/server/rpc/live-os.ts";
import { isCrossSiteWrite } from "@mastertutor/contracts/server";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

const PREFIX = "/api/rpc";
let fixtureHandler: RPCHandler<FixtureContext> | undefined;
let liveHandler: RPCHandler<LiveContext> | undefined;

async function handle(request: Request): Promise<Response> {
  // Session cookies are ambient: refuse cross-site state changes before anything else (E2).
  if (
    isCrossSiteWrite(
      request.method,
      request.headers.get("origin"),
      new URL(getWebEnv().BETTER_AUTH_URL).origin,
    )
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  // Both routers enforce the session themselves (requireViewer), so a missing one is a typed
  // oRPC UNAUTHORIZED error the client understands, not a bare 401.
  const viewer = await getViewer();
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) {
    const { fixtureRouter } = await import("@/lib/fixtures/router.ts");
    const { fixtureNamespaceFrom } = await import("@/lib/fixtures/cookies.ts");
    fixtureHandler ??= new RPCHandler(fixtureRouter);
    const { response } = await fixtureHandler.handle(request, {
      prefix: PREFIX,
      context: { ns: fixtureNamespaceFrom(request.headers.get("cookie")), viewer },
    });
    return response ?? new Response("Not found", { status: 404 });
  }
  const { liveRouter } = await import("@/lib/server/rpc/live-router.ts");
  // openLive sets the live cookies through context.resHeaders (B6).
  liveHandler ??= new RPCHandler(liveRouter, { plugins: [new ResponseHeadersPlugin()] });
  const { response } = await liveHandler.handle(request, { prefix: PREFIX, context: { viewer } });
  return response ?? new Response("Not found", { status: 404 });
}

export const GET = handle;
export const POST = handle;
