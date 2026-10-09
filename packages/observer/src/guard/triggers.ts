import type { ActionClass, GuardTrigger, Provenance, RiskLevel } from "@mastertutor/contracts";

export interface TriggerFacts {
  /** The item is one the policy classified (a RiskyItem, or a run-level new_origin or download). */
  risky: boolean;
  actionClass: ActionClass;
  provenance: Provenance | null;
  pageOrigin: string | null;
  allowedOrigins: readonly string[];
  /** No earlier reviewed actuation on pageOrigin in this run. */
  firstActuationHere: boolean;
  injectionWindow: boolean;
  riskLevel: RiskLevel;
}

const ACTUATIONS: ReadonlySet<ActionClass> = new Set(["click", "type", "keypress", "submit"]);

/** The deterministic trigger set (spec §6.2, GD §3): no trigger, no review, no model call. */
export function triggersFor(facts: TriggerFacts): GuardTrigger[] {
  const triggers: GuardTrigger[] = [];
  if (facts.risky) triggers.push("risky_item");
  if (facts.actionClass === "vault_fill" || facts.actionClass === "passkey")
    triggers.push("vault_fill");
  if (facts.provenance === "other_origin") triggers.push("data_egress");
  if (!ACTUATIONS.has(facts.actionClass)) return triggers;
  if (
    facts.firstActuationHere &&
    facts.pageOrigin !== null &&
    !facts.allowedOrigins.includes(facts.pageOrigin)
  )
    triggers.push("first_actuation_off_allowlist");
  if (facts.injectionWindow) triggers.push("post_injection_window");
  if (facts.riskLevel === "elevated") triggers.push("elevated_risk");
  return triggers;
}
