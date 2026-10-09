import { z } from "zod";
import { IsoDateTime, Uuid } from "./primitives.ts";

/** Alert rules (spec §13.1). Their definitions live in packages/observability/src/alerts.ts. */
export const ALERT_RULES = [
  "error_spike",
  "model_request_rejected",
  "run_failed",
  "slot_crash_loop",
  "spend_jump",
  "observer_escalation",
  "observer_failure",
] as const;
export const AlertRule = z.enum(ALERT_RULES);
export type AlertRule = z.infer<typeof AlertRule>;

/** The only words a phone ever shows for an alert (spec §13.4): fixed, never alert content. */
export const ALERT_LABELS: Record<AlertRule, string> = {
  error_spike: "Errors spiked",
  model_request_rejected: "The model rejected a request",
  run_failed: "A run failed",
  slot_crash_loop: "A browser slot keeps crashing",
  spend_jump: "Spend jumped",
  observer_escalation: "The safety observer stopped an action",
  observer_failure: "The safety observer is failing",
};

/** OpenObserve's webhook body (its template is in packages/observability). Extra keys are refused. */
export const AlertWebhookBody = z.strictObject({ rule: AlertRule });
export type AlertWebhookBody = z.infer<typeof AlertWebhookBody>;
export const MAX_ALERT_WEBHOOK_BYTES = 4_096;
/** A rule firing again within this window is the same alert: one row, one push. */
export const ALERT_DEDUPE_MINUTES = 10;

export const AlertView = z.object({
  id: Uuid,
  rule: AlertRule,
  label: z.string().max(80),
  firedAt: IsoDateTime,
  acknowledgedAt: IsoDateTime.nullable(),
});
export type AlertView = z.infer<typeof AlertView>;
export const AlertRef = z.object({ id: Uuid });
export type AlertRef = z.infer<typeof AlertRef>;

/** Hosts the server may POST a push to (the SSRF guard, spec §13.4). */
export const PUSH_SERVICE_HOST_SUFFIXES = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
] as const;

export function isPushServiceEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "")
    return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/** PushSubscription.toJSON(): p256dh is a 65-byte uncompressed P-256 point, auth 16 bytes (base64url). */
export const PushSubscriptionInput = z.object({
  endpoint: z.string().max(2_048).refine(isPushServiceEndpoint, "Not a supported push service"),
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/, "Expected a P-256 public key"),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Expected a 16-byte auth secret"),
  }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;
export const PushEndpointRef = z.object({ endpoint: z.string().min(1).max(2_048) });
export type PushEndpointRef = z.infer<typeof PushEndpointRef>;

/** Whether the server still holds this browser's subscription (a push service 404/410 drops it). */
export const PushStatus = z.object({ registered: z.boolean() });
export type PushStatus = z.infer<typeof PushStatus>;

/** Whether this server can send pushes (VAPID keys and HTTPS), and the key browsers subscribe with. */
export const PushConfig = z.object({ available: z.boolean(), publicKey: z.string().nullable() });
export type PushConfig = z.infer<typeof PushConfig>;

/** Everything a push carries (spec §13.4): never secrets, page text, goals or run content. */
export const PushPayload = z.strictObject({
  title: z.literal("MasterTutor"),
  body: z.string().max(80),
  url: z.string().regex(/^\/settings\/alerts#alert-[0-9a-f-]{36}$/),
});
export type PushPayload = z.infer<typeof PushPayload>;

export function alertPushPayload(alert: { id: string; rule: AlertRule }): PushPayload {
  return PushPayload.parse({
    title: "MasterTutor",
    body: ALERT_LABELS[alert.rule],
    url: `/settings/alerts#alert-${Uuid.parse(alert.id)}`,
  });
}
