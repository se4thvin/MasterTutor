import { z } from "zod";
import { NOTIFY_MAX_BYTES } from "./constants.ts";
import { WakeReason } from "./enums.ts";
import { Uuid } from "./primitives.ts";

export const NOTIFY_CHANNELS = [
  "run_queued",
  "run_wake",
  "run_control",
  "otp_ready",
  "run_event",
  "live_revoke",
] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

/** IDs only (spec §3.1). `run_wake` with runId null and reason "kill" addresses every agent. */
export const NotifyPayloads = {
  run_queued: z.strictObject({ runId: Uuid }),
  run_wake: z.strictObject({ runId: Uuid.nullable(), reason: WakeReason }),
  run_control: z.strictObject({ runId: Uuid }),
  otp_ready: z.strictObject({ runId: Uuid }),
  run_event: z.strictObject({ runId: Uuid, eventId: z.string().regex(/^[0-9]+$/) }),
  /**
   * From database triggers (B6): a Better Auth session ended (sign-out; workspaceId null) or a
   * membership was removed. The agent closes that person's open n.eko live views.
   */
  live_revoke: z.strictObject({
    userId: z.string().min(1).max(128),
    workspaceId: Uuid.nullable(),
  }),
} as const satisfies Record<NotifyChannel, z.ZodType>;
export type NotifyPayload<C extends NotifyChannel> = z.infer<(typeof NotifyPayloads)[C]>;

export function assertNotifySize(text: string): void {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > NOTIFY_MAX_BYTES) {
    throw new RangeError(`NOTIFY payload is ${bytes} bytes; the limit is ${NOTIFY_MAX_BYTES}`);
  }
}

export function encodeNotify<C extends NotifyChannel>(
  channel: C,
  payload: NotifyPayload<C>,
): string {
  const text = JSON.stringify(NotifyPayloads[channel].parse(payload));
  assertNotifySize(text);
  return text;
}

export function decodeNotify<C extends NotifyChannel>(channel: C, text: string): NotifyPayload<C> {
  assertNotifySize(text);
  return NotifyPayloads[channel].parse(JSON.parse(text)) as NotifyPayload<C>;
}
