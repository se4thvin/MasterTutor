import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { runEventStream } from "@/lib/server/runs/event-stream.ts";
import { getViewerId } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

/** SSE run events (spec §6). A fixture build has no event store and never touches the database. */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  return runEventStream({ db: getDb(), viewerId: getViewerId }, request, id);
}
