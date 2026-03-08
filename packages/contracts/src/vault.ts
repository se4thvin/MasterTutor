import { z } from "zod";
import type { TypedSecretField } from "./enums.ts";

export const TOTP_ALGORITHMS = ["sha1", "sha256", "sha512"] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];

export interface TotpSpec {
  /** Uppercase base32 without padding or separators. */
  secret: string;
  digits: 6 | 7 | 8;
  period: number;
  algorithm: TotpAlgorithm;
}

const BASE32 = /^[A-Z2-7]+$/;

function normalizeBase32(raw: string): string | null {
  const secret = raw.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  // 16 characters = 80 bits, the shortest key real sites issue; 128 characters = 640 bits.
  return secret.length >= 16 && secret.length <= 128 && BASE32.test(secret) ? secret : null;
}

function isAlgorithm(value: string): value is TotpAlgorithm {
  return (TOTP_ALGORITHMS as readonly string[]).includes(value);
}

/**
 * Validates a TOTP key as a person pastes it: a base32 setup key (any case, grouped, padded)
 * or an otpauth://totp link. web checks it before sealing; agent parses it again to generate.
 */
export function parseTotpSeed(input: string): TotpSpec | null {
  const text = input.trim();
  if (!/^otpauth:/i.test(text)) {
    const secret = normalizeBase32(text);
    return secret ? { secret, digits: 6, period: 30, algorithm: "sha1" } : null;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "otpauth:" || url.hostname.toLowerCase() !== "totp") return null;
  const secret = normalizeBase32(url.searchParams.get("secret") ?? "");
  const digits = Number(url.searchParams.get("digits") ?? "6");
  const period = Number(url.searchParams.get("period") ?? "30");
  const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
  if (secret === null || !isAlgorithm(algorithm)) return null;
  if (digits !== 6 && digits !== 7 && digits !== 8) return null;
  if (!Number.isInteger(period) || period < 15 || period > 120) return null;
  return { secret, digits, period, algorithm };
}

/** A PIN as sites issue them: 4–12 digits, nothing else. */
export const PinValue = z.string().regex(/^[0-9]{4,12}$/);

/**
 * The single trust-boundary rule for a typed vault value (E4). web refuses what this rejects;
 * the frontend uses it for its own copy. The message never contains the value.
 */
export function secretValueProblem(field: TypedSecretField, value: string): string | null {
  if (field === "pin" && !PinValue.safeParse(value).success) return "A PIN is 4–12 digits.";
  if (field === "totp" && parseTotpSeed(value) === null)
    return "That authenticator key isn't valid. Paste the setup key or the otpauth:// link.";
  return null;
}
