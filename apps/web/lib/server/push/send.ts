import { isPushServiceEndpoint, type PushPayload } from "@mastertutor/contracts";
import type { PushOutcome } from "@mastertutor/contracts/telemetry";
import type { PushTarget } from "@mastertutor/db";
import type { VapidKeys } from "./config.ts";
import { pushRequest } from "./request.ts";

const TIMEOUT_MS = 5_000;

/**
 * One Web Push to one subscription (spec §13.4). Never throws and never follows a redirect; an
 * endpoint outside the push services is refused before any request (the SSRF guard).
 */
export async function sendPush(
  target: PushTarget,
  payload: PushPayload,
  keys: VapidKeys,
  fetchImpl: typeof fetch = fetch,
): Promise<PushOutcome> {
  if (!isPushServiceEndpoint(target.endpoint)) return "refused";
  try {
    const { body, headers } = pushRequest(target, payload, keys);
    const response = await fetchImpl(target.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers,
      body: new Uint8Array(body),
    });
    if (response.status === 404 || response.status === 410) return "gone";
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export type SendPush = typeof sendPush;
