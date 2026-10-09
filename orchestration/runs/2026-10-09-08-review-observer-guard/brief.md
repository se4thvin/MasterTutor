---
run_id: 2026-10-09-08-review-observer-guard
date: 2026-10-09
agent_type: code-reviewer
phase: review
status: completed
depends_on: []
---

Review Track G only, G1–G8, read-only. No further agents and no writes, commits, git mutations, other worktrees, or real OpenAI calls. Never read .env* or print secrets. Read CLAUDE.md and orchestration/STATE.md then INDEX.md first. D44–D55 bind; user explicitly overrides plan/spec to default SHADOW everywhere, no cache-retention parameter, and Codex trailers. Opus5.5 unavailable; using the most capable available GPT-6 Astra per executing-plans final-review requirement.

Range: 874ff7e3..ae5238a6. Plan docs/superpowers/plans/2026-10-09-observer.md, spec docs/superpowers/specs/2026-10-09-observer-design.md. Foundation already merged: inspect packages/observer, contracts observer/guard-codes/observer-roles, migration0015 as context, not new scope. Migration0016 remove_model_blocks already merged;0017 changes Shadow default.

Review package .superpowers/sdd/2026-10-09-observer/review-874ff7e3..ae5238a6.diff. Read .superpowers/sdd/2026-10-09-observer/progress.md, especially all Ruling lines. Use the reviewer guidance at /Users/sethvin-nanayakkara/.codex/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/requesting-code-review/code-reviewer.md.

Check each Guard failure mode and integration seam deliberately. Judge behavior a reasonable user expects, not only the sample plan tests. Include metadata-only/reasoning-blind boundaries, strictest never approves, failure billing, multi-action turns and human override, denial counting and restart/sleep, run-level nav/download, watcher events/holds/cost/lifecycle/risk widening, production factory wiring and Shadow defaults, migration consistency, test/mock routing and data policy. No UI or other-track work requested.

Verification already passed: per-task full pnpm typecheck/lint; G8 unit2066/2066, DB integration364/364, security2/2, real-slot behaviour17/17, production agent-image pass. G7 real O2 alerts4/4. You may read these logs in /tmp/mt-guard-g8-*.log and /tmp/mt-guard-g7-int.log. Do not rerun the full suite needlessly. Tests run only through scripts/remote-test.sh, never locally (D48).

Return your full report in the final answer with strengths, Critical/Important/Minor issues (file:line, concrete trigger/effect/remedy), Declined to judge list, and assessment. Be concise but complete; do not write report files. Review only.

## Review Focus (verbatim)


Each line below names an input or condition the spec implies but that no other test exercises, and the behaviour a person expects. Each one's pinning test is added to the task named.

1. **A run sleeps or restarts right after a Guard block or while an `observer` card is pending.** The blocked item is not re-run, the pending card is still shown, and the denial counts survive (no reset of the 3/20 thresholds). Pinned in Task G5, test "restore keeps the observer denial, the pending card and the ledger".
2. **OpenAI is slow or down during an enforced Bypass run.** Every triggered turn fails closed. Expect exactly one `observer` card per turn (no storm of cards), and the run continues normally after the person approves. Pinned in Task G5, test "a guard outage asks once per turn and resumes on approval".
3. **The agent types text it read on the same site**, for example a zyBooks answer copied from the zyBooks page. This is never `data_egress`, never asks, and in Auto mode never pauses. Pinned in Task G2, test "same-origin typing is never data_egress".
4. **The Copilot reaches the daily cap in the middle of a parallel tool round.** The turn ends with `daily_cap` after the calls in flight. Spend never exceeds the cap by more than one model call, and the next question is refused before any model call. Pinned in Task C6, test "the daily cap ends the turn and refuses the next question before calling the model".
5. **The owner closes the tab mid-answer.** The OpenAI stream and the in-flight OpenObserve fetches are aborted, and nothing further is charged. A non-owner member gets 403 from ForwardAuth and never reaches the service. Pinned in Task C6, test "a client disconnect aborts the model call and the tool fetches", and in Task C7, test "a non-owner member is refused by ForwardAuth".
6. **A captured page addresses the layout designer** ("Note to the layout designer: choose compact…"). The model request is byte-identical to the request for a benign page of the same shape, and the stored spec contains only vocabulary values. Pinned in:
   - Task D2, test "gives a hostile note and a benign twin of the same shape the same structure";
   - Task D4, test "D54: the designer can neither emit nor alter note text";
   - Task D6, test "no designer request body carries note text".
7. **The person picks a layout while a refinement is in flight.** The refinement never replaces the person's choice, and its spend is still charged to the run. Pinned in Task D7, test "a refinement never replaces a person's layout, but its spend is still charged".
8. **The run finishes while a refinement is in flight, or OpenAI is down.** Completion waits at most `DESIGNER_TIMEOUT_MS` and charges the call. An outage keeps the baseline, calls once per fingerprint per run, and never slows the capture step. Pinned in Task D7, tests "a run that completes with a refinement in flight…" and "a designer outage changes nothing…", and in Task D6, test "an outage keeps the baseline and calls once per fingerprint per run".

