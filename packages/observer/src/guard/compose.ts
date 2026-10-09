import type {
  ApprovalMode,
  GuardVerdictName,
  ObserverMode,
  PolicyDecision,
} from "@mastertutor/contracts";

/** What a Guard verdict may add to a policy decision: never an approval (D52, spec §6.6). */
export type GuardEffect = "none" | "ask" | "deny";

const RANK = { approved: 0, ask: 1, denied: 2 } as const satisfies Record<PolicyDecision, number>;

export function decisionRank(decision: PolicyDecision): 0 | 1 | 2 {
  return RANK[decision];
}

/**
 * Escalate asks a person in every mode (bypass included, D52). A block asks in ask mode, where a
 * person may override it (audited), and denies elsewhere (deny-and-continue). Shadow adds nothing.
 */
export function guardEffect(
  verdict: GuardVerdictName,
  mode: ApprovalMode,
  rollout: ObserverMode,
): GuardEffect {
  if (rollout === "shadow") return "none";
  switch (verdict) {
    case "allow":
    case "flag":
      return "none";
    case "escalate":
      return "ask";
    case "block":
      return mode === "ask" ? "ask" : "deny";
  }
}

/** The stricter of policy and the Guard: approved < ask < denied. Monotone by construction. */
export function strictest(policy: PolicyDecision, effect: GuardEffect): PolicyDecision {
  const guard: PolicyDecision | null =
    effect === "ask" ? "ask" : effect === "deny" ? "denied" : null;
  return guard !== null && RANK[guard] > RANK[policy] ? guard : policy;
}
