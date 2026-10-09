/**
 * The Guard's verdict codes (D52, spec §6). Their own module, not ./observer.ts, so run events and
 * approval cards (in client bundles) can use them without pulling the Observer's schemas.
 */
import { z } from "zod";

export const GUARD_VERDICTS = ["allow", "flag", "escalate", "block"] as const;
export const GuardVerdictName = z.enum(GUARD_VERDICTS);
export type GuardVerdictName = z.infer<typeof GuardVerdictName>;

export const GUARD_CATEGORIES = [
  "goal_drift",
  "data_exfiltration",
  "credential_misuse",
  "injection_followed",
  "destructive_or_financial",
  "unexpected_origin",
  /** The review could not run (timeout, error, unparseable answer, redaction trip): fail closed. */
  "guard_unavailable",
  /** 3 consecutive or 20 total blocks (spec §6.7). */
  "denial_limit",
  "other",
] as const;
export const GuardCategory = z.enum(GUARD_CATEGORIES);
export type GuardCategory = z.infer<typeof GuardCategory>;

export const GUARD_STAGES = ["rules", "screen", "review"] as const;
export const GuardStage = z.enum(GUARD_STAGES);
export type GuardStage = z.infer<typeof GuardStage>;
