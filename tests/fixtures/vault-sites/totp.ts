import { createHmac, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 SHA-1 TOTP, written from scratch so the fixture cross-checks the agent's otplib. */
export function totpAt(seed: string, epochSeconds: number, digits = 6, period = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(epochSeconds / period)));
  const mac = createHmac("sha1", base32Decode(seed)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Constant-time code comparison: no early exit reveals how many leading digits were right. */
export function codesEqual(expected: string, submitted: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(submitted, "utf8");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function verifyTotp(seed: string, code: string, nowMs: number): boolean {
  const now = Math.floor(nowMs / 1000);
  // Every window is checked (no short-circuit), so timing does not say which one matched.
  return [-30, 0, 30]
    .map((skew) => codesEqual(totpAt(seed, now + skew), code))
    .reduce((any, match) => any || match, false);
}
