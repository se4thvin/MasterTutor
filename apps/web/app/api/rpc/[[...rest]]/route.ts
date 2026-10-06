import { RPCHandler } from "@orpc/server/fetch";
import type { FixtureContext } from "@/lib/fixtures/types.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import type { LiveContext } from "@/lib/server/rpc/live-router.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

const PREFIX = "/api/rpc";
let fixtureHandler: RPCHandler<FixtureContext> | undefined;
let liveHandler: RPCHandler<LiveContext> | undefined;

async function handle(request: Request): Promise<Response> {
  if (getWebEnv().WEB_FIXTURE_API) {
    const { fixtureRouter } = await import("@/lib/fixtures/router.ts");
    const { fixtureNamespaceFrom } = await import("@/lib/fixtures/cookies.ts");
    fixtureHandler ??= new RPCHandler(fixtureRouter);
    const { response } = await fixtureHandler.handle(request, {
      prefix: PREFIX,
      context: { ns: fixtureNamespaceFrom(request.headers.get("cookie")) },
    });
    return response ?? new Response("Not found", { status: 404 });
  }
  const viewer = await getViewer();
  if (!viewer) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const { liveRouter } = await import("@/lib/server/rpc/live-router.ts");
  liveHandler ??= new RPCHandler(liveRouter);
  const { response } = await liveHandler.handle(request, { prefix: PREFIX, context: { viewer } });
  return response ?? new Response("Not found", { status: 404 });
}

export const GET = handle;
export const POST = handle;
