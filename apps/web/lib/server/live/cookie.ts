import { createHmac, timingSafeEqual } from "node:crypto";
import { SlotName, livePath } from "@mastertutor/contracts";

interface LiveSlotClaim {
  slotName: string;
  runId: string;
  userId: string;
  expiresAt: number;
}

const VALUE = /^(browser-[1-9][0-9]?)\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/;
const COOKIE_VALUE = /^[A-Za-z0-9._-]{1,512}$/;

function mac(secret: string, claim: LiveSlotClaim): string {
  return createHmac("sha256", secret)
    .update(`v1|${claim.slotName}|${claim.runId}|${claim.userId}|${claim.expiresAt}`)
    .digest("base64url");
}

/** "browser-N.<expiry>.<hmac>": the prefix is what Traefik's per-slot HeaderRegexp matches. */
export function signLiveSlot(secret: string, claim: LiveSlotClaim): string {
  SlotName.parse(claim.slotName);
  return `${claim.slotName}.${claim.expiresAt}.${mac(secret, claim)}`;
}

/** The slot name if the cookie is genuine, unexpired and bound to this run and user; else null. */
export function verifyLiveSlot(
  secret: string,
  value: string,
  expected: { runId: string; userId: string; nowSeconds: number },
): string | null {
  const match = VALUE.exec(value);
  if (!match) return null;
  const [, slotName, expiry, signature] = match as unknown as [string, string, string, string];
  const expiresAt = Number(expiry);
  if (expiresAt <= expected.nowSeconds) return null;
  const want = Buffer.from(
    mac(secret, { slotName, runId: expected.runId, userId: expected.userId, expiresAt }),
  );
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got) ? slotName : null;
}

/** Every cookie occurrence by name, in header order (duplicates are kept on purpose). */
export function parseCookies(header: string | null): Map<string, string[]> {
  const cookies = new Map<string, string[]>();
  if (!header) return cookies;
  for (const part of header.split(/[;,]/)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    cookies.set(name, [...(cookies.get(name) ?? []), part.slice(index + 1).trim()]);
  }
  return cookies;
}

/** Set-Cookie values scoped to /live/<runId>/ (spec §10.2: HttpOnly; Secure; SameSite=Strict). */
export function liveSetCookies(
  runId: string,
  cookies: ReadonlyArray<{ name: string; value: string }>,
  maxAgeSeconds: number,
): string[] {
  const path = livePath(runId);
  return cookies.map(({ name, value }) => {
    if (!COOKIE_VALUE.test(value)) throw new TypeError(`Unsafe value for cookie ${name}`);
    return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
  });
}
