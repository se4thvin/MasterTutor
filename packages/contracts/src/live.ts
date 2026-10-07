import { z } from "zod";
import { SlotName, Uuid } from "./primitives.ts";

/** Signed cookie naming the slot for Traefik's per-slot routers (spec §10.2). */
export const LIVE_SLOT_COOKIE = "live_slot";
/** n.eko's session cookie name; web re-issues it scoped to /live/<runId>/. */
export const NEKO_SESSION_COOKIE = "NEKO_SESSION";
/** n.eko members in every slot; passwords are HMAC(secret, slotName). Session id = member id. */
export const NEKO_MEMBERS = { agent: "agent", user: "user" } as const;
export const LIVE_COOKIE_TTL_SECONDS = 12 * 60 * 60;
/** Spec §5.1: takeover ends after 15 minutes with no user input, counted from the takeover. */
export const AUTO_HAND_BACK_IDLE_MS = 15 * 60 * 1000;
/** How long a live takeover waits for the user's n.eko session to be connected (F3: inside F3's 2 s). */
export const TAKEOVER_GIVE_WAIT_MS = 1_000;
/** A takeover that arrives with a fresh lease waits longer: the iframe reconnects after the slot event. */
export const TAKEOVER_RESTORE_WAIT_MS = 15_000;
/**
 * n.eko 3.1.6 embeds its legacy client, which auto-connects only when usr/pwd are in the URL.
 * pwd is a placeholder: the legacy /ws handler authenticates with the NEKO_SESSION cookie first.
 */
export const NEKO_EMBED_QUERY = "embed=1&usr=user&pwd=cookie";
/** Traefik PathRegexp for live requests (Go RE2 and JS agree on this pattern). */
export const LIVE_PATH_REGEX = "^/live/[0-9a-f-]{36}/";
/** n.eko's upload endpoints (drop, file chooser) under the prefix: their body is capped (A14). */
export const LIVE_UPLOAD_PATH_REGEX = "^/live/[0-9a-f-]{36}/api/room/upload/";
/** Traefik StripPrefixRegex: n.eko is served at / behind it. */
export const LIVE_STRIP_REGEX = "^/live/[0-9a-f-]{36}";
/** web's ForwardAuth endpoint for the live routers. */
export const LIVE_AUTH_PATH = "/api/live/auth";
/** Compose default for CDP_SUBNET_PREFIX (agent .10, web .11, Traefik .12). */
export const DEFAULT_CDP_SUBNET_PREFIX = "172.30.231";

export function livePath(runId: string): string {
  return `/live/${Uuid.parse(runId)}/`;
}

export function liveEmbedPath(runId: string): string {
  return `${livePath(runId)}?${NEKO_EMBED_QUERY}`;
}

/** The run id from an X-Forwarded-Uri such as /live/<uuid>/api/ws, or null. */
export function runIdFromLivePath(uri: string): string | null {
  const match = /^\/live\/([0-9a-f-]{36})\//.exec(uri);
  if (!match) return null;
  const parsed = Uuid.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}

/** Cookie-header regex selecting one slot's router; the trailing "\." stops browser-1 matching browser-10. */
export function liveSlotCookiePattern(slotName: string): string {
  return `(?:^|;\\s*)${LIVE_SLOT_COOKIE}=${SlotName.parse(slotName)}\\.`;
}

function slotRule(slotName: string, host: string, pathRegex: string): string {
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new TypeError("Invalid router host");
  return `Host(\`${host}\`) && PathRegexp(\`${pathRegex}\`) && HeaderRegexp(\`Cookie\`, \`${liveSlotCookiePattern(slotName)}\`)`;
}

/** The single source of the per-slot Traefik rule (test file provider here, labels in Phase 9). */
export function liveRouterRule(slotName: string, host: string): string {
  return slotRule(slotName, host, LIVE_PATH_REGEX);
}

/** The per-slot upload rule (higher priority): the same routing, plus a body-size cap (A14). */
export function liveUploadRouterRule(slotName: string, host: string): string {
  return slotRule(slotName, host, LIVE_UPLOAD_PATH_REGEX);
}

/**
 * ForwardAuth target by web's static cdp address (D41): on Dokploy's shared network the name `web`
 * can resolve to another app's container, so the live routers never use it.
 */
export function liveForwardAuthAddress(
  cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX,
): string {
  const octets = cdpSubnetPrefix.split(".");
  const valid =
    octets.length === 3 && octets.every((o) => /^[0-9]{1,3}$/.test(o) && Number(o) <= 255);
  if (!valid) throw new TypeError("Invalid CDP subnet prefix");
  return `http://${cdpSubnetPrefix}.11:3000${LIVE_AUTH_PATH}`;
}

export const IceServer = z.object({
  urls: z.array(z.string().regex(/^(stun|turns?):/)).min(1),
  username: z.string().max(256).optional(),
  credential: z.string().max(256).optional(),
});
export type IceServer = z.infer<typeof IceServer>;

/** Output of oRPC runs.openLive. A sleeping run holds no slot. v1 has no TURN, so iceServers is []. */
export const OpenLiveResult = z.discriminatedUnion("sleeping", [
  z.object({ sleeping: z.literal(true) }),
  z.object({
    sleeping: z.literal(false),
    slotName: SlotName,
    embedPath: z.string().regex(/^\/live\/[0-9a-f-]{36}\/\?embed=1&usr=user&pwd=cookie$/),
    iceServers: z.array(IceServer).max(4),
  }),
]);
export type OpenLiveResult = z.infer<typeof OpenLiveResult>;
