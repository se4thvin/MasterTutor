import { OBSERVABILITY_APP_PATH } from "@mastertutor/contracts";
import { getWebEnv } from "@/lib/server/env.ts";
import {
  isOwnerSignedIn,
  nowSeconds,
  observabilitySetup,
} from "@/lib/server/observability/access.ts";
import {
  decideObservability,
  notHere,
  readObsSession,
  refusalResponse,
} from "@/lib/server/observability/authorize.ts";
import { verifyObservabilityToken } from "@/lib/server/observability/token.ts";
import { isInternalRequest } from "@/lib/server/internal-request.ts";

export const dynamic = "force-dynamic";

/**
 * Traefik's ForwardAuth for obs.<app host> (spec §12). It answers only internal callers (the
 * sub-request's Host is web's cdp address, on the internal allowlist): a browser can never read the viewer credentials (review I-1).
 * On allow, Traefik copies Authorization and Cookie onto the upstream request, so OpenObserve never
 * sees the obs session cookie either. Fails closed.
 */
export async function GET(request: Request): Promise<Response> {
  // A fixture build signs in a fake viewer; it must never open real telemetry.
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return notHere();
  const setup = observabilitySetup();
  if (!isInternalRequest(request, setup.internalHosts)) return notHere();
  const token = readObsSession(request.headers.get("cookie"));
  const userId = token ? verifyObservabilityToken(setup.key, "session", token, nowSeconds()) : null;
  const decision = decideObservability(
    {
      userId,
      owner: userId !== null && (await isOwnerSignedIn(userId)),
      viewerPassword: setup.viewerPassword,
    },
    `${setup.appOrigin}${OBSERVABILITY_APP_PATH}`,
  );
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
