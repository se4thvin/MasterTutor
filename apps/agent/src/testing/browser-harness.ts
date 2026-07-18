import { createLogger } from "@mastertutor/contracts/server";
import { OTHER, SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { BrowserSession, type BrowserSessionOptions } from "../browser/session.ts";

/** The behaviour stack's nginx serves tests/fixtures/sites/site/ here (tests/fixtures/nginx.conf). */
export const FIXTURES = SITE;

const log = createLogger({ service: "test", level: "silent" });

/**
 * A session on behaviour slot browser-1. Behaviour files run one at a time, so a file owns the slot
 * for its duration; close the session in afterAll. No Supervisor is involved.
 */
export function openTestSession(
  options: Pick<BrowserSessionOptions, "responseLog" | "redactUrl" | "resolveHost"> = {},
): Promise<BrowserSession> {
  const cdpBaseUrl = SLOT_CDP["browser-1"];
  if (!cdpBaseUrl) throw new Error("behaviour slot browser-1 is not configured");
  return BrowserSession.connect({
    cdpBaseUrl,
    allowedOrigins: () => [SITE, OTHER],
    testMode: true,
    log,
    ...options,
  });
}
