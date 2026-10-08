import { DEFAULT_CDP_SUBNET_PREFIX, webCdpOrigin } from "./live.ts";

/** OpenObserve serves its UI and API under this prefix (ZO_BASE_URI, spec §11). */
export const OBSERVE_BASE_PATH = "/observability";
export const OBSERVE_ORG = "default";
/** OpenObserve's base URL on the internal `observe` network. */
export const OBSERVE_INTERNAL_URL = `http://openobserve:5080${OBSERVE_BASE_PATH}`;
/** Its three users (spec §11): root for provisioning, ingest for the collector, viewer for the owner. */
export const OBSERVE_USERS = {
  root: "root@mastertutor.internal",
  ingest: "ingest@mastertutor.internal",
  viewer: "viewer@mastertutor.internal",
} as const;
/**
 * Where OpenObserve's UI keeps its client-side session record, and its shape (spec §12). Pinned by
 * packages/observability/src/o2-api.int.test.ts (Task B1) against the image digest.
 */
export const OBSERVE_UI_SESSION = {
  storage: "localStorage",
  key: "userInfo",
  /** The record is base64(JSON) of this identity: no secret. */
  identity: { email: OBSERVE_USERS.viewer, name: "Owner", role: "admin" },
} as const;

export const OBSERVABILITY_PATH = `${OBSERVE_BASE_PATH}/`;
export const OBSERVABILITY_AUTH_PATH = "/api/observability/auth";
export const OBSERVABILITY_ENTER_PATH = "/api/observability/enter";

/** Traefik rule for the OpenObserve router: /observability and its subtree only. */
export function observabilityRouterRule(host: string): string {
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new TypeError("Invalid router host");
  return `Host(\`${host}\`) && PathRegexp(\`^${OBSERVE_BASE_PATH}(/|$)\`)`;
}

export function observabilityForwardAuthAddress(
  cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX,
): string {
  return `${webCdpOrigin(cdpSubnetPrefix)}${OBSERVABILITY_AUTH_PATH}`;
}
