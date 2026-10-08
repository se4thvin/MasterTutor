import { getWebEnv } from "@/lib/server/env.ts";
import { refusalResponse } from "@/lib/server/observability/authorize.ts";
import { enterPage } from "@/lib/server/observability/enter-page.ts";
import { viewerObservabilityDecision } from "@/lib/server/observability/viewer-decision.ts";

export const dynamic = "force-dynamic";

/** The owner's way into /observability (spec §12): seeds OpenObserve's UI identity, then opens it. */
export async function GET(): Promise<Response> {
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API)
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const decision = await viewerObservabilityDecision();
  if (decision.kind !== "allow") return refusalResponse(decision);
  return new Response(enterPage(), {
    status: 200,
    headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
  });
}
