import { parseTotpSeed } from "@mastertutor/contracts";
import { createGuardrails, generateSync } from "otplib";

/**
 * otplib 13 rejects keys under 16 bytes by default; real sites issue 80-bit keys (verification 7).
 * The upper bound matches parseTotpSeed's 128 base32 characters (80 bytes).
 */
const GUARDRAILS = createGuardrails({ MIN_SECRET_BYTES: 10, MAX_SECRET_BYTES: 80 });
/** Never type a code that expires before the site can check it (Review Focus 2). */
export const TOTP_MIN_REMAINING_MS = 3_000;

export function totpCode(seed: string, nowMs: number): string | null {
  const spec = parseTotpSeed(seed);
  if (!spec) return null;
  try {
    return generateSync({
      secret: spec.secret,
      digits: spec.digits,
      period: spec.period,
      algorithm: spec.algorithm,
      epoch: Math.floor(nowMs / 1000),
      guardrails: GUARDRAILS,
    });
  } catch {
    // A key otplib refuses is a failed fill, never a crashed tool.
    return null;
  }
}

/** The RFC 6238 time step a code at `nowMs` belongs to. */
export function totpStep(seed: string, nowMs: number): number | null {
  const spec = parseTotpSeed(seed);
  return spec ? Math.floor(nowMs / (spec.period * 1000)) : null;
}

/**
 * 0 when the current window has enough life left and is not `lastStep` (a code already typed,
 * which RFC 6238 §5.2 verifiers may reject); otherwise how long to wait (+50 ms margin).
 */
export function msUntilFreshWindow(seed: string, nowMs: number, lastStep?: number): number | null {
  const spec = parseTotpSeed(seed);
  if (!spec) return null;
  const periodMs = spec.period * 1000;
  if (lastStep !== undefined && Math.floor(nowMs / periodMs) <= lastStep)
    return (lastStep + 1) * periodMs - nowMs + 50;
  const remaining = periodMs - (nowMs % periodMs);
  return remaining < TOTP_MIN_REMAINING_MS ? remaining + 50 : 0;
}
