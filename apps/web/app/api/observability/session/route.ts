import { OBSERVABILITY_APP_PATH } from "@mastertutor/contracts";
import { getWebEnv } from "@/lib/server/env.ts";
import {
  isOwnerSignedIn,
  nowSeconds,
  observabilitySetup,
} from "@/lib/server/observability/access.ts";
import {
  OBS_SESSION_SECONDS,
  decideObservability,
  notHere,
  obsSessionCookie,
  refusalResponse,
} from "@/lib/server/observability/authorize.ts";
import { enterPage } from "@/lib/server/observability/pages.ts";
import {
  signObservabilityToken,
  verifyObservabilityToken,
} from "@/lib/server/observability/token.ts";
import { readCapped } from "@/lib/server/read-capped.ts";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_024;

/**
 * On obs.<app host> only (D50 ruling I-2): trades the app's one-minute ticket for the obs host's
 * own host-only session cookie, then seeds OpenObserve's UI identity and opens it.
 */
export async function POST(request: Request): Promise<Response> {
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return notHere();
  const setup = observabilitySetup();
  if (request.headers.get("host") !== setup.obsHost) return notHere();
  const body = await readCapped(request, MAX_BODY_BYTES);
  if (body === null)
    return new Response(null, { status: 413, headers: { "cache-control": "no-store" } });
  const ticket = new URLSearchParams(body).get("ticket") ?? "";
  const now = nowSeconds();
  const userId = verifyObservabilityToken(setup.key, "ticket", ticket, now);
  const decision = decideObservability(
    {
      userId,
      owner: userId !== null && (await isOwnerSignedIn(userId)),
      viewerPassword: setup.viewerPassword,
    },
    `${setup.appOrigin}${OBSERVABILITY_APP_PATH}`,
  );
  if (decision.kind !== "allow") return refusalResponse(decision);
  const session = signObservabilityToken(setup.key, {
    purpose: "session",
    userId: decision.userId,
    expiresAt: now + OBS_SESSION_SECONDS,
  });
  return new Response(enterPage(), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "set-cookie": obsSessionCookie(session, { secure: setup.secure }),
    },
  });
}
