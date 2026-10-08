import { PushPayload } from "@mastertutor/contracts";
import type { PushTarget } from "@mastertutor/db";
import webpush from "web-push";
import type { VapidKeys } from "./config.ts";

/** An alert is stale after an hour; a phone that was off for longer just sees the Alerts page. */
const TTL_SECONDS = 3_600;

interface PushRequest {
  body: Buffer;
  /** Lower-case, string-valued, without Content-Length (fetch sets it). */
  headers: Record<string, string>;
}

/**
 * One push message for one subscription (spec §13.4), built by the maintained `web-push` package:
 * RFC 8291 aes128gcm encryption with a fresh key and salt, and an RFC 8292 VAPID signature for
 * the endpoint's origin. Only a payload that passes the push contract is ever encrypted.
 */
export function pushRequest(
  target: PushTarget,
  payload: PushPayload,
  keys: VapidKeys,
): PushRequest {
  const details = webpush.generateRequestDetails(
    { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
    JSON.stringify(PushPayload.parse(payload)),
    {
      vapidDetails: keys,
      TTL: TTL_SECONDS,
      urgency: "high",
      contentEncoding: "aes128gcm",
    },
  );
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(details.headers)) {
    const key = name.toLowerCase();
    if (key !== "content-length") headers[key] = String(value);
  }
  return { body: details.body, headers };
}
