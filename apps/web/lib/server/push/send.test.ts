import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import webpush from "web-push";
import { sendPush } from "./send.ts";

const ua = createECDH("prime256v1");
ua.generateKeys();
const target = (endpoint = "https://web.push.apple.com/sub") => ({
  endpoint,
  p256dh: ua.getPublicKey().toString("base64url"),
  auth: Buffer.alloc(16, 1).toString("base64url"),
});
const keys = { ...webpush.generateVAPIDKeys(), subject: "https://notes.example.org" };
const payload = {
  title: "MasterTutor" as const,
  body: "A run failed",
  url: "/settings/alerts#alert-11111111-1111-4111-8111-111111111111",
};

describe("sendPush (spec §13.4)", () => {
  it("posts an encrypted, VAPID-signed message with TTL and urgency, following no redirect", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const outcome = await sendPush(target(), payload, keys, async (url, init) => {
      seen = { url: String(url), init: init! };
      return new Response(null, { status: 201 });
    });
    expect(outcome).toBe("sent");
    const { url, init } = seen!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://web.push.apple.com/sub");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.ttl).toBe("3600");
    expect(headers.urgency).toBe("high");
    expect(headers.authorization).toMatch(/^vapid t=/);
    expect(Buffer.from(init.body as Uint8Array).toString("latin1")).not.toContain("A run failed");
  });

  it("refuses an endpoint outside the push services without any request (SSRF)", async () => {
    let called = false;
    const outcome = await sendPush(
      target("https://169.254.169.254/latest"),
      payload,
      keys,
      async () => {
        called = true;
        return new Response(null);
      },
    );
    expect([outcome, called]).toEqual(["refused", false]);
  });

  it("maps 404/410 to gone and anything else to failed, never throwing", async () => {
    const answer = (status: number) => async () => new Response(null, { status });
    expect(await sendPush(target(), payload, keys, answer(410))).toBe("gone");
    expect(await sendPush(target(), payload, keys, answer(404))).toBe("gone");
    expect(await sendPush(target(), payload, keys, answer(500))).toBe("failed");
    expect(await sendPush(target(), payload, keys, answer(301))).toBe("failed");
    expect(
      await sendPush(target(), payload, keys, async () => {
        throw new TypeError("network");
      }),
    ).toBe("failed");
    // A stored subscription with broken keys fails that push, not the fan-out.
    expect(await sendPush({ ...target(), p256dh: "bad" }, payload, keys, answer(201))).toBe(
      "failed",
    );
  });
});
