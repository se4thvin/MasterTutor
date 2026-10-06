import { parseTotpSeed } from "@mastertutor/contracts";
import { createGuardrails, generateSync } from "otplib";

/** otplib 13 rejects keys under 16 bytes by default; real sites issue 80-bit keys (verification 7). */
const GUARDRAILS = createGuardrails({ MIN_SECRET_BYTES: 10 });
/** Never type a code that expires before the site can check it (Review Focus 2). */
export const TOTP_MIN_REMAINING_MS = 3_000;

export function totpCode(seed: string, nowMs: number): string | null {
  const spec = parseTotpSeed(seed);
  if (!spec) return null;
  return generateSync({
    secret: spec.secret,
    digits: spec.digits,
    period: spec.period,
    algorithm: spec.algorithm,
    epoch: Math.floor(nowMs / 1000),
    guardrails: GUARDRAILS,
  });
}

/** 0 when the current window has enough life left; otherwise how long to wait (+50 ms margin). */
export function msUntilFreshWindow(seed: string, nowMs: number): number | null {
  const spec = parseTotpSeed(seed);
  if (!spec) return null;
  const periodMs = spec.period * 1000;
  const remaining = periodMs - (nowMs % periodMs);
  return remaining < TOTP_MIN_REMAINING_MS ? remaining + 50 : 0;
}
