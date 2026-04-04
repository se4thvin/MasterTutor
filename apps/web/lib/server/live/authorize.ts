import { LIVE_SLOT_COOKIE, NEKO_SESSION_COOKIE, runIdFromLivePath } from "@mastertutor/contracts";
import { parseCookies, verifyLiveSlot } from "./cookie.ts";

export interface AuthorizeDeps {
  liveCookieSecret: string;
  canAccess(query: { runId: string; slotName: string; userId: string }): Promise<boolean>;
  nowSeconds?: () => number;
}

interface AuthorizeInput {
  /** Traefik's X-Forwarded-Uri (ForwardAuth runs before StripPrefixRegex). */
  forwardedUri: string | null;
  cookieHeader: string | null;
  /** The signed-in user (getViewer), or null. */
  userId: string | null;
}

type AuthorizeDecision =
  { allow: true; upstreamCookie: string } | { allow: false; status: 401 | 403 };

const NEKO_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Spec §10.2.2: 200 only if the live_slot signature is valid, browser_slots[N].run_id equals the
 * path's run, and the user belongs to that run's workspace. Exactly one live_slot (the one Traefik
 * routed on) and exactly one well-formed NEKO_SESSION are accepted. Traefik copies the 200's
 * Cookie header over the browser's (authResponseHeaders), so n.eko only ever sees NEKO_SESSION;
 * without one there is nothing to replace the browser's cookies with, so the answer is 401 (S3).
 */
export async function authorizeLive(
  deps: AuthorizeDeps,
  input: AuthorizeInput,
): Promise<AuthorizeDecision> {
  if (!input.userId) return { allow: false, status: 401 };
  const runId = input.forwardedUri ? runIdFromLivePath(input.forwardedUri) : null;
  if (!runId) return { allow: false, status: 403 };
  const cookies = parseCookies(input.cookieHeader);
  const slotCookies = cookies.get(LIVE_SLOT_COOKIE) ?? [];
  if (slotCookies.length !== 1) return { allow: false, status: 401 };
  const slotName = verifyLiveSlot(deps.liveCookieSecret, slotCookies[0]!, {
    runId,
    userId: input.userId,
    nowSeconds: (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))(),
  });
  if (!slotName) return { allow: false, status: 401 };
  const neko = cookies.get(NEKO_SESSION_COOKIE) ?? [];
  if (neko.length !== 1 || !NEKO_TOKEN.test(neko[0]!)) return { allow: false, status: 401 };
  if (!(await deps.canAccess({ runId, slotName, userId: input.userId })))
    return { allow: false, status: 403 };
  return { allow: true, upstreamCookie: `${NEKO_SESSION_COOKIE}=${neko[0]}` };
}
