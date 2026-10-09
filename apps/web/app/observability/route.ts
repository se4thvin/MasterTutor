import { OBSERVABILITY_APP_PATH } from "@mastertutor/contracts";
import { signInPathFor } from "@/lib/auth/next-path.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import {
  isOwnerSignedIn,
  nowSeconds,
  observabilitySetup,
} from "@/lib/server/observability/access.ts";
import {
  decideObservability,
  notHere,
  refusalResponse,
} from "@/lib/server/observability/authorize.ts";
import { handoffPage } from "@/lib/server/observability/pages.ts";
import { signObservabilityToken } from "@/lib/server/observability/token.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

const TICKET_SECONDS = 60;

/**
 * The owner's way into the dashboards ("Open dashboards"). OpenObserve lives on obs.<app host>
 * (D50 ruling I-2), where the app's host-only session cookie never goes, so this hands over a
 * one-minute signed ticket by POST.
 */
export async function GET(): Promise<Response> {
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return notHere();
  const setup = observabilitySetup();
  const viewer = await getViewer().catch(() => null);
  const decision = decideObservability(
    {
      userId: viewer?.id ?? null,
      owner: viewer !== null && (await isOwnerSignedIn(viewer.id)),
      viewerPassword: setup.viewerPassword,
    },
    signInPathFor(OBSERVABILITY_APP_PATH, ""),
  );
  if (decision.kind !== "allow") return refusalResponse(decision);
  const ticket = signObservabilityToken(setup.key, {
    purpose: "ticket",
    userId: decision.userId,
    expiresAt: nowSeconds() + TICKET_SECONDS,
  });
  return new Response(handoffPage(setup.obsOrigin, ticket), {
    status: 200,
    headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
  });
}
