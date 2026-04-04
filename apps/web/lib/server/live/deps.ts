import { getDb } from "../db.ts";
import { getWebEnv } from "../env.ts";
import type { LiveDeps } from "./open-live.ts";

let liveDeps: LiveDeps | undefined;

/** Built on first use, so importing the live router never reads env or opens the database. */
export function getLiveDeps(): LiveDeps {
  if (!liveDeps) {
    const env = getWebEnv();
    liveDeps = {
      db: getDb().db,
      nekoMemberSecret: env.NEKO_MEMBER_SECRET,
      liveCookieSecret: env.LIVE_COOKIE_SECRET,
    };
  }
  return liveDeps;
}
