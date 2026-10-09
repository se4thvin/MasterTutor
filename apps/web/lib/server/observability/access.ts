import { internalWebHosts, observabilityOrigin, type WebEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { isSignedInOwner } from "@mastertutor/db";
import { getDb } from "../db.ts";
import { getWebEnv } from "../env.ts";
import { observabilityKey } from "./token.ts";

const log = createLogger({ service: "web" });

interface ObservabilitySetup {
  appOrigin: string;
  obsOrigin: string;
  /** The Host a request to the obs host carries (D50 ruling I-2). */
  obsHost: string;
  /** Hosts only internal callers send, Traefik's ForwardAuth among them (review I-1). */
  internalHosts: readonly string[];
  viewerPassword: string | undefined;
  key: Buffer;
  secure: boolean;
}

export function setupFrom(env: WebEnv): ObservabilitySetup {
  const obsOrigin = observabilityOrigin(env.BETTER_AUTH_URL);
  return {
    appOrigin: new URL(env.BETTER_AUTH_URL).origin,
    obsOrigin,
    obsHost: new URL(obsOrigin).host,
    internalHosts: internalWebHosts(env.CDP_SUBNET_PREFIX),
    viewerPassword: env.OBSERVE_VIEWER_PASSWORD,
    key: observabilityKey(env.BETTER_AUTH_SECRET),
    secure: obsOrigin.startsWith("https:"),
  };
}

let cached: ObservabilitySetup | undefined;
/** Read once per process, like getWebEnv. */
export function observabilitySetup(): ObservabilitySetup {
  cached ??= setupFrom(getWebEnv());
  return cached;
}

/** The owner with a live session; a lookup failure fails closed and logs its type only (M6). */
export async function isOwnerSignedIn(userId: string): Promise<boolean> {
  return isSignedInOwner(getDb().db, userId).catch((error: unknown) => {
    const err = error instanceof Error ? error.name : "unknown";
    log.error({ errorCode: "observability_owner_lookup_failed", err }, "owner lookup failed");
    return false;
  });
}

export const nowSeconds = () => Math.floor(Date.now() / 1_000);
