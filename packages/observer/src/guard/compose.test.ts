import fc from "fast-check";
import {
  APPROVAL_MODES,
  GUARD_VERDICTS,
  OBSERVER_MODES,
  type PolicyDecision,
} from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { decisionRank, guardEffect, strictest } from "./compose.ts";

const DECISIONS: PolicyDecision[] = ["approved", "ask", "denied"];
const all = fc.record({
  policy: fc.constantFrom(...DECISIONS),
  verdict: fc.constantFrom(...GUARD_VERDICTS),
  mode: fc.constantFrom(...APPROVAL_MODES),
  rollout: fc.constantFrom(...OBSERVER_MODES),
});

describe("strictest(policy, guard) never loosens a decision (D52, spec §6.6)", () => {
  it("is at least as strict as policy, for every policy, verdict, mode and rollout", () => {
    fc.assert(
      fc.property(all, ({ policy, verdict, mode, rollout }) => {
        const final = strictest(policy, guardEffect(verdict, mode, rollout));
        expect(decisionRank(final)).toBeGreaterThanOrEqual(decisionRank(policy));
      }),
      { numRuns: 2_000 },
    );
  });

  it("never yields approved where policy said ask or denied", () => {
    fc.assert(
      fc.property(all, ({ policy, verdict, mode, rollout }) => {
        fc.pre(policy !== "approved");
        expect(strictest(policy, guardEffect(verdict, mode, rollout))).not.toBe("approved");
      }),
    );
  });

  it("changes nothing in shadow", () => {
    fc.assert(
      fc.property(all, ({ policy, verdict, mode }) => {
        expect(strictest(policy, guardEffect(verdict, mode, "shadow"))).toBe(policy);
      }),
    );
  });

  it("asks on escalate in every mode, bypass included; a block asks in ask mode and denies elsewhere", () => {
    for (const mode of APPROVAL_MODES) expect(guardEffect("escalate", mode, "enforce")).toBe("ask");
    expect(guardEffect("block", "ask", "enforce")).toBe("ask");
    expect(guardEffect("block", "auto_within_allowlist", "enforce")).toBe("deny");
    expect(guardEffect("block", "bypass", "enforce")).toBe("deny");
    expect(guardEffect("flag", "bypass", "enforce")).toBe("none");
    expect(guardEffect("allow", "bypass", "enforce")).toBe("none");
  });
});
