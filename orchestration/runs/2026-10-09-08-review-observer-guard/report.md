---
run_id: 2026-10-09-08-review-observer-guard
date: 2026-10-09
agent_type: code-reviewer
phase: review
status: completed
depends_on: []
---

Reviewed `874ff7e3..ae5238a6`, Track G only. **Not ready to merge without fixes.**

**Strengths**

- Clear contracts-only core, monotone policy composition, metadata projection, and redaction assertions.
- Reviewer preserves billed usage across structured parsing failures and uses the existing stateless OpenAI wrapper.
- Shadow defaults and migration 0017 follow the user’s override.
- Existing logs confirm 2,066 unit, 364 integration, 2 security, 17 behaviour, and 4 alert tests passed. I did not rerun suites or modify files.

**Critical — must fix**

1. **A refused first actuation consumes its trigger.**  
   `apps/agent/src/guardrails/observer/guard.ts:127` adds the origin to `actuated` before the review or execution. On an off-allowlist page reachable through the sign-in window, let the Guard block an otherwise ordinary click. If the agent retries that click next turn, `first_actuation_off_allowlist` no longer applies; with no other trigger, the click executes without review. The same problem follows an unavailable review and a human denial. Record actuation only after an action actually executes, and retain review eligibility after refusal. Add a blocked-click → same-origin retry regression.

**Important — should fix**

2. **Turn verdicts are discarded when an earlier item asks for approval.**  
   `apps/agent/src/loop/run-loop.ts:1081` reviews all open items, but `:1107` stops applying outcomes at the first ask. Remaining outcomes are neither retained nor restored; resume reviews those items again. A later block can therefore disappear on a subsequent allow, and an outage with multiple risky actions creates a separate call/card after every answer instead of the required one card per turn. The existing outage test uses separate single-action turns. Persist the turn’s item outcomes and explicit human-override scope through resume/restart; test one turn containing multiple actions and an earlier ask followed by a later block.

3. **Sleep/restart clears elevated risk and injection history.**  
   `apps/agent/src/loop/run-loop.ts:314` creates a fresh Guard and subscribes only to future events. `apps/agent/src/guardrails/observer/guard.ts:50` restores the denial ledger but initializes the remaining trigger history anew; the watcher likewise starts with an empty trajectory. After a detector elevates risk, sleeping and restoring removes the widened trigger set, contrary to “for the rest of the run.” The post-injection window also disappears. Restore durable trigger state and recent trajectory without replaying already billed reviews.

4. **One human denial counts as two.**  
   `apps/agent/src/loop/run-loop.ts:389` ingests a resolved approval in `hasNews`, and `:1789` ingests it again in `resume`. The worker normally calls these consecutively (`apps/agent/src/loop/worker.ts:314`); the web approval handler wakes the run without changing its waiting status. `Trajectory` does not deduplicate approval IDs, so one denial reaches the two-person-denials threshold, permanently elevates risk, and schedules an unnecessary review/possible hold. Ingest once or deduplicate by durable event/approval identity. Test the actual worker wake sequence.

5. **Watcher results and costs can disappear on waiting/release paths.**  
   `apps/agent/src/guardrails/observer/watcher.ts:97` uses an independent timeout and buffers usage/holds in memory. The loop drains them at `step` boundaries and completion (`apps/agent/src/loop/run-loop.ts:1737`), but sleep, cancellation, shutdown, and failure release paths do not drain or cancel the watcher (`apps/agent/src/loop/worker.ts:460`). A review finishing while an approval waits can be lost when that worker sleeps; an in-flight review can finish after cancellation and never enter run spend. Add lifecycle ownership: stop new reviews, abort or boundedly settle existing work, and durably account for received usage and pending holds before release where the lease permits. Cover delayed review → wait/sleep and delayed review → cancel.

**Minor**

None separately raised.

**Declined to judge**

- Copilot, designer, UI cards/badges, and other Tracks C/U/E/D: explicitly outside this review.
- Real-model detection quality and production latency: no real OpenAI calls authorized; mock tests cannot establish these.
- Screenshot-only provenance: explicitly documented limitation.
- Organization-level OpenAI retention settings: operator configuration outside this change.
- Complete re-audit of merged Foundation and migrations 0015/0016: inspected as integration context, not new scope.

These findings concern lifecycle and multi-action inputs absent from the passing tests. Some follow the plan’s sample implementation; matching that sample does not remove their runtime effects.
