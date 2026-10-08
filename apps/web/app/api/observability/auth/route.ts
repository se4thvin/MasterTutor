import { getWebEnv } from "@/lib/server/env.ts";
import { viewerObservabilityDecision } from "@/lib/server/observability/viewer-decision.ts";

export const dynamic = "force-dynamic";

const STATUS = { forbidden: 403, unavailable: 503 } as const;

/**
 * Traefik ForwardAuth for /observability (spec §12). Fails closed. On allow, Traefik copies the
 * Authorization and Cookie headers onto the upstream request (authResponseHeaders), replacing the
 * browser's, so OpenObserve never sees our session cookie.
 */
export async function GET(): Promise<Response> {
  const headers = new Headers({ "cache-control": "no-store" });
  // A fixture build signs in a fake viewer; it must never open real telemetry.
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API)
    return new Response(null, { status: 403, headers });
  const decision = await viewerObservabilityDecision();
  switch (decision.kind) {
    case "sign_in":
      headers.set("location", decision.location);
      return new Response(null, { status: 302, headers });
    case "allow":
      headers.set("authorization", decision.authorization);
      headers.set("cookie", "mt_obs=1");
      return new Response(null, { status: 200, headers });
    default:
      return new Response(null, { status: STATUS[decision.kind], headers });
  }
}
