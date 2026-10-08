import { describe, expect, it } from "vitest";
import {
  ALERT_LABELS,
  ALERT_RULES,
  AlertWebhookBody,
  PushPayload,
  PushSubscriptionInput,
  alertPushPayload,
  isPushServiceEndpoint,
} from "./alerts.ts";

const P256DH = `B${"A".repeat(86)}`;
const AUTH = "A".repeat(22);

describe("alerts contracts (spec §13)", () => {
  it("has a short label for every rule", () => {
    for (const rule of ALERT_RULES) expect(ALERT_LABELS[rule].length).toBeLessThanOrEqual(80);
  });

  it("accepts only {rule} from the webhook", () => {
    expect(AlertWebhookBody.safeParse({ rule: "run_failed" }).success).toBe(true);
    expect(AlertWebhookBody.safeParse({ rule: "run_failed", text: "x" }).success).toBe(false);
    expect(AlertWebhookBody.safeParse({ rule: "anything" }).success).toBe(false);
  });

  it("allows push endpoints on the known push services over https only (SSRF guard)", () => {
    expect(isPushServiceEndpoint("https://web.push.apple.com/QGuR")).toBe(true);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isPushServiceEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(
      true,
    );
    for (const bad of [
      "http://web.push.apple.com/x",
      "https://push.apple.com.evil.test/x",
      "https://evilpush.apple.com.attacker/x",
      "https://user:pw@web.push.apple.com/x",
      "https://web.push.apple.com:8443/x",
      "https://169.254.169.254/latest",
      "https://localhost/x",
      "not a url",
    ])
      expect(isPushServiceEndpoint(bad), bad).toBe(false);
  });

  it("validates subscription keys by shape", () => {
    const ok = { endpoint: "https://web.push.apple.com/x", keys: { p256dh: P256DH, auth: AUTH } };
    expect(PushSubscriptionInput.safeParse(ok).success).toBe(true);
    expect(
      PushSubscriptionInput.safeParse({ ...ok, keys: { p256dh: "short", auth: AUTH } }).success,
    ).toBe(false);
  });

  it("builds a payload with a fixed label and a deep link only", () => {
    const payload = alertPushPayload({
      id: "11111111-1111-4111-8111-111111111111",
      rule: "run_failed",
    });
    expect(payload).toEqual({
      title: "MasterTutor",
      body: "A run failed",
      url: "/settings/alerts#alert-11111111-1111-4111-8111-111111111111",
    });
    expect(PushPayload.safeParse({ ...payload, goal: "x" }).success).toBe(false);
  });
});
