import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

type Purpose = "ticket" | "session";

interface ObservabilityClaim {
  purpose: Purpose;
  userId: string;
  /** Unix seconds. */
  expiresAt: number;
}

const TOKEN = /^(ticket|session)\.([A-Za-z0-9_-]{1,256})\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/;

/** A key of its own, derived from the app secret (no new env): it signs only these tokens. */
export function observabilityKey(appSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", appSecret, "", "mt.observability.v1", 32));
}

const mac = (key: Buffer, purpose: Purpose, user: string, expiresAt: number) =>
  createHmac("sha256", key).update(`v1|${purpose}|${user}|${expiresAt}`).digest("base64url");

/**
 * `<purpose>.<base64url user id>.<expiry>.<hmac>`: the app host's one-minute hand-off ticket, or
 * the obs host's session (D50 ruling I-2). Cookie- and form-safe characters only.
 */
export function signObservabilityToken(key: Buffer, claim: ObservabilityClaim): string {
  const user = Buffer.from(claim.userId).toString("base64url");
  return `${claim.purpose}.${user}.${claim.expiresAt}.${mac(key, claim.purpose, user, claim.expiresAt)}`;
}

/** The user id if the token is genuine, for this purpose, and unexpired; else null. */
export function verifyObservabilityToken(
  key: Buffer,
  purpose: Purpose,
  value: string,
  nowSeconds: number,
): string | null {
  const match = TOKEN.exec(value);
  if (!match) return null;
  const [, kind, user, expiry, signature] = match as unknown as [
    string,
    Purpose,
    string,
    string,
    string,
  ];
  const expiresAt = Number(expiry);
  if (kind !== purpose || expiresAt <= nowSeconds) return null;
  const want = Buffer.from(mac(key, kind, user, expiresAt));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return Buffer.from(user, "base64url").toString("utf8");
}
