import {
  LIVE_COOKIE_TTL_SECONDS,
  LIVE_SLOT_COOKIE,
  NEKO_MEMBERS,
  NEKO_PORT,
  NEKO_SESSION_COOKIE,
  OpenLiveResult,
  liveEmbedPath,
} from "@mastertutor/contracts";
import { NekoLoginError, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { getRunForMember, type Database } from "@mastertutor/db";
import { liveSetCookies, signLiveSlot } from "./cookie.ts";

interface LiveDeps {
  db: Database;
  nekoMemberSecret: string;
  liveCookieSecret: string;
  nekoBaseUrl?: (slotName: string) => string;
  fetch?: typeof fetch;
  nowSeconds?: () => number;
}

class LiveAccessError extends Error {
  readonly code: "not_found" | "in_use" | "unavailable";
  constructor(code: "not_found" | "in_use" | "unavailable") {
    super(`live view ${code}`);
    this.name = "LiveAccessError";
    this.code = code;
  }
}

interface OpenLiveOutcome {
  result: OpenLiveResult;
  setCookies: string[];
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const defaultNekoBaseUrl = (slot: string) => `http://${slot}:${NEKO_PORT}`;

/**
 * Spec §10.2.1. The caller has already authenticated the user. n.eko credentials never leave
 * the server; the browser gets the session token and the signed slot cookie, both scoped to
 * /live/<runId>/. v1 has no TURN (D42), so iceServers is empty.
 */
export async function openLive(
  deps: LiveDeps,
  input: { runId: string; userId: string },
): Promise<OpenLiveOutcome> {
  const run = await getRunForMember(deps.db, input.runId, input.userId);
  if (!run) throw new LiveAccessError("not_found");
  if (!run.slotLeased || run.slotName === null)
    return { result: { sleeping: true }, setCookies: [] };
  const slotName = run.slotName;

  let token: string;
  try {
    token = await loginNeko({
      baseUrl: (deps.nekoBaseUrl ?? defaultNekoBaseUrl)(slotName),
      username: NEKO_MEMBERS.user,
      password: deriveNekoPassword(deps.nekoMemberSecret, slotName),
      fetch: deps.fetch,
    });
  } catch (error) {
    if (error instanceof NekoLoginError && error.status === 422)
      throw new LiveAccessError("in_use");
    throw new LiveAccessError("unavailable");
  }

  const liveSlot = signLiveSlot(deps.liveCookieSecret, {
    slotName,
    runId: run.id,
    userId: input.userId,
    expiresAt: (deps.nowSeconds ?? nowSeconds)() + LIVE_COOKIE_TTL_SECONDS,
  });
  const setCookies = liveSetCookies(
    run.id,
    [
      { name: NEKO_SESSION_COOKIE, value: token },
      { name: LIVE_SLOT_COOKIE, value: liveSlot },
    ],
    LIVE_COOKIE_TTL_SECONDS,
  );
  const result = OpenLiveResult.parse({
    sleeping: false,
    slotName,
    embedPath: liveEmbedPath(run.id),
    iceServers: [],
  });
  return { result, setCookies };
}
