import { getWebEnv } from "@/lib/server/env.ts";
import { refusalResponse } from "@/lib/server/observability/authorize.ts";
import { viewerObservabilityDecision } from "@/lib/server/observability/viewer-decision.ts";

export const dynamic = "force-dynamic";

/**
 * Traefik ForwardAuth for /observability (spec §12). Fails closed. On allow, Traefik copies the
 * Authorization and Cookie headers onto the upstream request (authResponseHeaders), replacing the
 * browser's, so OpenObserve never sees our session cookie.
 */
export async function GET(): Promise<Response> {
  // A fixture build signs in a fake viewer; it must never open real telemetry.
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API)
    return refusalResponse({ kind: "forbidden" });
  const decision = await viewerObservabilityDecision();
  if (decision.kind !== "allow") return refusalResponse(decision);
  return new Response(null, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      authorization: decision.authorization,
      cookie: "mt_obs=1",
    },
  });
}
