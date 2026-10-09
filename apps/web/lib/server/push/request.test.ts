import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import webpush from "web-push";
import { pushRequest } from "./request.ts";

const b = (value: string) => Buffer.from(value, "base64url");

// RFC 8291 Appendix A. If this fails, compare every value with the RFC text before touching code.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** An independent RFC 8291 (aes128gcm, one record) decryption: the user agent's side. */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20]!;
  const asPublic = body.subarray(21, 21 + idLength);
  const data = body.subarray(21 + idLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const key = (ikm: Buffer, salt2: Buffer, info: Buffer, n: number) =>
    Buffer.from(hkdfSync("sha256", ikm, salt2, info, n));
  const ikm = key(
    shared,
    authSecret,
    Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]),
    32,
  );
  const cek = key(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = key(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const padded = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  return padded.subarray(0, padded.lastIndexOf(2)).toString("utf8");
}

const keys = { ...webpush.generateVAPIDKeys(), subject: "https://notes.example.org" };
const rfcTarget = {
  endpoint: "https://web.push.apple.com/QGuR?x=1",
  p256dh: RFC.uaPublic,
  auth: RFC.authSecret,
};
const payload = {
  title: "MasterTutor" as const,
  body: "A run failed",
  url: "/settings/alerts#alert-11111111-1111-4111-8111-111111111111",
};

describe("pushRequest (web-push: RFC 8291 encryption, RFC 8292 VAPID)", () => {
  it("the test's decryption reads the RFC 8291 Appendix A message", () => {
    expect(decrypt(b(RFC.message), b(RFC.uaPrivate), b(RFC.uaPublic), b(RFC.authSecret))).toBe(
      RFC.plaintext,
    );
  });

  it("encrypts with aes128gcm so the RFC's user agent key decrypts exactly the payload", () => {
    const request = pushRequest(rfcTarget, payload, keys);
    expect(request.headers["content-encoding"]).toBe("aes128gcm");
    const plain = decrypt(request.body, b(RFC.uaPrivate), b(RFC.uaPublic), b(RFC.authSecret));
    expect(JSON.parse(plain)).toEqual(payload);
    expect(request.body.toString("latin1")).not.toContain("A run failed");
  });

  it("draws a fresh salt and server key for every message", () => {
    const one = pushRequest(rfcTarget, payload, keys).body;
    const two = pushRequest(rfcTarget, payload, keys).body;
    expect(one.subarray(0, 16).equals(two.subarray(0, 16))).toBe(false);
    expect(one.subarray(21, 86).equals(two.subarray(21, 86))).toBe(false);
  });

  it("signs an ES256 VAPID JWT for the push service's origin that our public key verifies", () => {
    const request = pushRequest(rfcTarget, payload, keys);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(
      request.headers.authorization ?? "",
    )!;
    expect(match[4]).toBe(keys.publicKey);
    expect(JSON.parse(b(match[1]!).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(b(match[2]!).toString()) as { aud: string; exp: number; sub: string };
    expect(claims.aud).toBe("https://web.push.apple.com");
    expect(claims.sub).toBe("https://notes.example.org");
    expect(claims.exp - Date.now() / 1_000).toBeLessThanOrEqual(24 * 3_600);
    const raw = b(keys.publicKey);
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33).toString("base64url"),
      },
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${match[1]}.${match[2]}`),
        { key, dsaEncoding: "ieee-p1363" },
        b(match[3]!),
      ),
    ).toBe(true);
  });

  it("asks for a short TTL and high urgency, as fetch-ready string headers", () => {
    const { headers } = pushRequest(rfcTarget, payload, keys);
    expect(headers).toEqual({
      authorization: expect.stringMatching(/^vapid t=/),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "3600",
      urgency: "high",
    });
  });

  it("refuses a payload outside the push contract", () => {
    expect(() =>
      pushRequest(rfcTarget, { ...payload, body: "x", note: "page text" } as never, keys),
    ).toThrow();
  });
});
