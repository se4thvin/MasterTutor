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

/**
 * OpenObserve's UI has its own host, obs.<app host> (D50 ruling I-2): its scripts never share the
 * app's origin, storage or host-only session cookie. Locally that is obs.localhost.
 */
export const OBSERVE_SUBDOMAIN = "obs";
export function observabilityOrigin(appUrl: string): string {
  const url = new URL(appUrl);
  url.hostname = `${OBSERVE_SUBDOMAIN}.${url.hostname}`;
  return url.origin;
}
/** Where OpenObserve's UI starts once its identity record is seeded (B1). */
export const OBSERVABILITY_UI_PATH = `${OBSERVE_BASE_PATH}/web/`;
/** On the app host: the owner's way in ("Open dashboards"); hands off to the obs host. */
export const OBSERVABILITY_APP_PATH = "/observability";
/** On the obs host, served by web: trades a hand-off ticket for the obs session cookie. */
export const OBSERVABILITY_SESSION_PATH = "/api/observability/session";
/** The obs host's own session cookie (host-only on obs.<app host>, HttpOnly). */
export const OBSERVABILITY_SESSION_COOKIE = "mt_obs_session";
export const OBSERVABILITY_AUTH_PATH = "/api/observability/auth";

/**
 * web's authority on the internal network, as OpenObserve addresses it (spec §13.2). A request
 * through Traefik always carries the public Host, so this Host proves an internal caller.
 */
export const WEB_INTERNAL_HOST = "web:3000";
export const ALERT_WEBHOOK_PATH = "/api/alerts/webhook";
export const ALERT_WEBHOOK_INTERNAL_URL = `http://${WEB_INTERNAL_HOST}${ALERT_WEBHOOK_PATH}`;

const validHost = (host: string) => {
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new TypeError("Invalid router host");
  return host;
};

/** Traefik rule for the OpenObserve router: the whole obs host (owner-only by ForwardAuth). */
export function observabilityRouterRule(appHost: string): string {
  return `Host(\`${OBSERVE_SUBDOMAIN}.${validHost(appHost)}\`)`;
}

/** Traefik rule for the one obs-host path web serves (higher priority, no ForwardAuth). */
export function observabilitySessionRouterRule(appHost: string): string {
  return `${observabilityRouterRule(appHost)} && Path(\`${OBSERVABILITY_SESSION_PATH}\`)`;
}

export function observabilityForwardAuthAddress(
  cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX,
): string {
  return `${webCdpOrigin(cdpSubnetPrefix)}${OBSERVABILITY_AUTH_PATH}`;
}

/** The Host Traefik's ForwardAuth sub-request carries; a public request never has it. */
export function observabilityForwardAuthHost(
  cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX,
): string {
  return new URL(observabilityForwardAuthAddress(cdpSubnetPrefix)).host;
}

/**
 * The Hosts only an internal caller sends (D50 review C-1, I-1): OpenObserve's webhook posts to
 * web:3000, Traefik's ForwardAuth calls web's cdp address. A request through Traefik always carries
 * the public Host. Built from config (the prefix compose uses), never from the request.
 */
export function internalWebHosts(cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX): string[] {
  return [WEB_INTERNAL_HOST, observabilityForwardAuthHost(cdpSubnetPrefix)];
}
