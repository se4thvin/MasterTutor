import { OBSERVABILITY_ENTER_PATH, OBSERVE_USERS, type MemberRole } from "@mastertutor/contracts";
import { signInPathFor } from "../../auth/next-path.ts";

export type ObservabilityDecision =
  | { kind: "allow"; authorization: string }
  | { kind: "sign_in"; location: string }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

/**
 * Spec §12: only the workspace owner reaches OpenObserve. The viewer's credentials are added to the
 * upstream request by Traefik (authResponseHeaders) and never reach the browser.
 */
export function decideObservability(input: {
  signedIn: boolean;
  role: MemberRole | null;
  viewerPassword: string | undefined;
}): ObservabilityDecision {
  if (!input.signedIn)
    return { kind: "sign_in", location: signInPathFor(OBSERVABILITY_ENTER_PATH, "") };
  if (input.role !== "owner") return { kind: "forbidden" };
  if (!input.viewerPassword) return { kind: "unavailable" };
  const credentials = `${OBSERVE_USERS.viewer}:${input.viewerPassword}`;
  return { kind: "allow", authorization: `Basic ${Buffer.from(credentials).toString("base64")}` };
}

const REFUSAL_STATUS = { forbidden: 403, unavailable: 503 } as const;

/** Anything but allow, as a never-cached response: a redirect to sign in, 403 or 503. */
export function refusalResponse(
  decision: Exclude<ObservabilityDecision, { kind: "allow" }>,
): Response {
  const headers = new Headers({ "cache-control": "no-store" });
  if (decision.kind !== "sign_in")
    return new Response(null, { status: REFUSAL_STATUS[decision.kind], headers });
  headers.set("location", decision.location);
  return new Response(null, { status: 302, headers });
}
