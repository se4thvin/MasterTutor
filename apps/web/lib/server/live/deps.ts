import { canAccessLiveSlot } from "@mastertutor/db";
import { getDb } from "../db.ts";
import { getWebEnv } from "../env.ts";
import type { AuthorizeDeps } from "./authorize.ts";

let authorizeDeps: AuthorizeDeps | undefined;

/** Built on first use, so importing the route never reads env or opens the database. */
export function getAuthorizeDeps(): AuthorizeDeps {
  authorizeDeps ??= {
    liveCookieSecret: getWebEnv().LIVE_COOKIE_SECRET,
    canAccess: (query) => canAccessLiveSlot(getDb().db, query),
  };
  return authorizeDeps;
}
