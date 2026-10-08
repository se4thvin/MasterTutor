import { createHash, timingSafeEqual } from "node:crypto";
import { AlertWebhookBody, MAX_ALERT_WEBHOOK_BYTES, type AlertRule } from "@mastertutor/contracts";
import { recordAlertReceived } from "@mastertutor/telemetry/record";
import { readCapped } from "./read-capped.ts";

export interface WebhookDeps {
  secret: string | undefined;
  /** Stores the alert (deduped); null when there is no workspace yet. */
  record(rule: AlertRule): Promise<{ id: string; workspaceId: string; created: boolean } | null>;
  /** Runs for a new alert only; the route defers delivery until after the response. */
  onRecorded(alert: { id: string; rule: AlertRule; workspaceId: string }): void;
}

const status = (code: number) =>
  new Response(null, { status: code, headers: { "cache-control": "no-store" } });
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant time, whatever the lengths. */
function bearerMatches(header: string | null, secret: string): boolean {
  const given = header?.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(given), digest(secret));
}

/**
 * OpenObserve → web (spec §13.2). Fail closed, in order: no secret → 404; arrived through Traefik
 * (forwarded headers) → 404, so it does not exist publicly; bearer → 401; size → 413; schema → 400.
 * Only the rule name is kept.
 */
export async function handleAlertWebhook(deps: WebhookDeps, request: Request): Promise<Response> {
  if (!deps.secret) return status(404);
  if (request.headers.has("x-forwarded-for") || request.headers.has("x-forwarded-host"))
    return status(404);
  if (!bearerMatches(request.headers.get("authorization"), deps.secret)) return status(401);
  const text = await readCapped(request, MAX_ALERT_WEBHOOK_BYTES);
  if (text === null) return status(413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return status(400);
  }
  const body = AlertWebhookBody.safeParse(json);
  if (!body.success) return status(400);
  const alert = await deps.record(body.data.rule);
  if (!alert) return status(409);
  recordAlertReceived(body.data.rule);
  if (alert.created)
    deps.onRecorded({ id: alert.id, rule: body.data.rule, workspaceId: alert.workspaceId });
  return status(202);
}
