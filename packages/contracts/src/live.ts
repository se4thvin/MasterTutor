import { z } from "zod";
import { SlotName, Uuid } from "./primitives.ts";

/** Signed cookie naming the slot for Traefik's per-slot routers (spec §10.2). */
export const LIVE_SLOT_COOKIE = "live_slot";
/** n.eko members in every slot; passwords are HMAC(secret, slotName). */
export const NEKO_MEMBERS = { agent: "agent", user: "user" } as const;
export const TURN_CREDENTIAL_TTL_SECONDS = 600;

export function livePath(runId: string): string {
  return `/live/${Uuid.parse(runId)}/`;
}
export function liveEmbedPath(runId: string): string {
  return `${livePath(runId)}?embed=1`;
}

export const IceServer = z.object({
  urls: z.array(z.string().regex(/^(stun|turns?):/)).min(1),
  username: z.string().max(256).optional(),
  credential: z.string().max(256).optional(),
});
export type IceServer = z.infer<typeof IceServer>;

/** Output of oRPC runs.openLive. A sleeping run holds no slot. */
export const OpenLiveResult = z.discriminatedUnion("sleeping", [
  z.object({ sleeping: z.literal(true) }),
  z.object({
    sleeping: z.literal(false),
    slotName: SlotName,
    embedPath: z.string().regex(/^\/live\/[0-9a-f-]{36}\/\?embed=1$/),
    iceServers: z.array(IceServer).max(4),
  }),
]);
export type OpenLiveResult = z.infer<typeof OpenLiveResult>;
