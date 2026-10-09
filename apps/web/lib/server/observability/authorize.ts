import { OBSERVABILITY_SESSION_COOKIE, OBSERVE_USERS } from "@mastertutor/contracts";
import { parseCookies } from "../live/cookie.ts";

type ObservabilityDecision =
  | { kind: "allow"; userId: string; authorization: string }
  | { kind: "sign_in"; location: string }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

/**
 * Spec §12: only the signed-in workspace owner reaches OpenObserve. The viewer's credentials go to
 * Traefik's ForwardAuth sub-request only (authResponseHeaders) and never reach a browser.
 */
export function decideObservability(
  input: { userId: string | null; owner: boolean; viewerPassword: string | undefined },
  signInLocation: string,
): ObservabilityDecision {
  if (input.userId === null) return { kind: "sign_in", location: signInLocation };
  if (!input.owner) return { kind: "forbidden" };
  if (!input.viewerPassword) return { kind: "unavailable" };
  const credentials = `${OBSERVE_USERS.viewer}:${input.viewerPassword}`;
  return {
    kind: "allow",
    userId: input.userId,
    authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
  };
}

const REFUSAL_STATUS = { forbidden: 403, unavailable: 503 } as const;
const NO_STORE = { "cache-control": "no-store" } as const;

/** Anything but allow, as a never-cached response: a redirect to sign in, 403 or 503. */
export function refusalResponse(
  decision: Exclude<ObservabilityDecision, { kind: "allow" }>,
): Response {
  if (decision.kind !== "sign_in")
    return new Response(null, { status: REFUSAL_STATUS[decision.kind], headers: NO_STORE });
  return new Response(null, { status: 302, headers: { ...NO_STORE, location: decision.location } });
}

/** 404 for a request that is not the internal caller a route exists for (review C-1, I-1). */
export const notHere = () => new Response(null, { status: 404, headers: NO_STORE });

/** How long the obs host's session lasts; ForwardAuth still re-checks the owner on every request. */
export const OBS_SESSION_SECONDS = 12 * 3_600;

/**
 * The obs host's session (D50 ruling I-2): host-only on obs.<app host> (no Domain attribute), so
 * the app never receives it; HttpOnly, so OpenObserve's scripts never read it.
 */
export function obsSessionCookie(token: string, options: { secure: boolean }): string {
  const secure = options.secure ? "; Secure" : "";
  return `${OBSERVABILITY_SESSION_COOKIE}=${token}; Path=/; Max-Age=${OBS_SESSION_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

/** The obs session from a Cookie header, only when it appears exactly once. */
export function readObsSession(cookieHeader: string | null): string | null {
  const values = parseCookies(cookieHeader).get(OBSERVABILITY_SESSION_COOKIE) ?? [];
  return values.length === 1 ? values[0]! : null;
}
