import { internalWebHosts } from "@mastertutor/contracts";
import { memberRoleOf } from "@mastertutor/db";
import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { isInternalRequest } from "@/lib/server/internal-request.ts";
import { isOwnerSignedIn } from "@/lib/server/observability/access.ts";
import { notHere } from "@/lib/server/observability/authorize.ts";
import { decideObserverAccess } from "@/lib/server/observer/authorize.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

/** Traefik's ForwardAuth for /api/observer/* (spec §7.2). Internal callers only; fails closed. */
export async function GET(request: Request): Promise<Response> {
  const env = getWebEnv();
  // A fixture build signs in a fake viewer; it must never open the real observer.
  if (__FIXTURE_BUILD__)
    return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  if (!isInternalRequest(request, internalWebHosts(env.CDP_SUBNET_PREFIX))) return notHere();
  const viewer = await getViewer().catch(() => null);
  const membership = viewer ? await memberRoleOf(getDb().db, viewer.id).catch(() => null) : null;
  const owner =
    viewer !== null &&
    membership?.role === "owner" &&
    (await isOwnerSignedIn(viewer.id).catch(() => false));
  const decision = decideObserverAccess({
    userId: viewer?.id ?? null,
    workspaceId: membership?.workspaceId ?? null,
    owner,
    token: env.OBSERVER_INTERNAL_TOKEN,
  });
  if (decision.kind === "refuse")
    return new Response(null, {
      status: decision.status,
      headers: { "cache-control": "no-store" },
    });
  return new Response(null, { status: 200, headers: decision.headers });
}
