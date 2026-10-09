# D56 turn context / run fd46ae6e

Authorized scope, in order:
1. One turn-context module: changed facts, allowed/current-origin vault metadata, policy, budget, plan, control/waits; full restatement after compaction. Persist bookkeeping in the transcript. Extend VM spec and P1/P3 task instructions.
2. Goal URLs as source hints through a single contracts helper and create DTO; web form and service use that schema.
3. Once-per-origin saved-login takeover redirection, through turn context; durable across worker restore.
4. Named ten-minute takeover/CAPTCHA wait retention, all other waits unchanged.

Ruling: The VM plan is a future implementation plan with a hard P0 gate. This request authorizes the browser-loop fixes and a documentation amendment, not executing P0–P4. Follow the four bug-fix tasks above in the user's order; no VM implementation or migrations are needed.
Ruling: Execute in the supplied worktree, inline. The repository's requested Opus subagent model is not available in this harness; no substitute model is selected.
Ruling: Sources currently live as URL hints in goal text, not a run-sources DTO/table relation. Use the existing representation and derive allowed origins in the contracts create schema; avoid adding redundant persistent sources.

Task 1 RED: six new remote llm-mock context regressions failed before implementation.

Task 1 GREEN: six new llm-mock regressions; 164 loop/worker/context integration tests after fixes, plus the seven other integration files (47 tests) passed in the wider run. The corrected gated-clock test passed separately. Unit: 960/960 across agent/contracts at two workers; restored system-prompt regression: 24/24 llm unit tests. `pnpm typecheck`, `pnpm lint`, `git diff --check` passed.
Ruling: Context bookkeeping belongs beside transcript items, not in model-visible JSON and not in another table. This avoids migrations and restore queries; only executor inputs receive checkpoints.
Ruling: Canonicalize budget/usage/plan using existing contract schemas before stringifying, preserving D37 byte-identical replay after jsonb reorders keys.
Ruling: The worker's existing gated-clock test raced timer registration and retained aborted sleepers. Remove aborted sleepers and await registration before firing; preserve its original assertions and timeouts.
Transient unit failures: at 32 workers, PDF caption verification and OCR budget tests timed out; at 8 workers, docling caption escaping/fallback/second rendering and JPEG 2000 decoding timed out. Full two-worker rerun passed unchanged. No timeout, retry or assertion was relaxed.

Task 1 commit: `53419480`.
Task 2 RED: 17 new source-inference/boundary assertions failed against the original create DTO and form; two further trailing-dot localhost cases failed before normalization.
Task 2 GREEN: 1,836 agent/web/contracts unit tests; 122 URL/DTO/form/network boundary tests after the final localhost fix; 37 server-create and llm-mock context integration tests. Includes goal-URL → allowed origin → first-turn vault alias, all modes, deduplication, origin cap, credential URLs and private IPv4/IPv6/encoded literals. Typecheck/lint passed.
Ruling: `/new` uses the client form plus `runs.create` RPC, not a separate server action. Both form and service already parse CreateRunInput; the schema is the shared creation boundary. URL hints remain verbatim in the goal. No source DTO/table duplication or migration.
Ruling: Move existing private-literal rules to browser-safe contracts, and reuse them from navigation and source validation. DNS resolution/rebinding and slot egress remain enforced by the existing network boundary. Add a P1.7 note identifying the new owner for the future VM net-policy move.

Task 2 commit: `8fa60935`.
Task 3 RED: five guardrail assertions failed (three modes, successful follow-up fill, compaction); unusable-origin and CAPTCHA tests passed unchanged.
Task 3 GREEN: 130 loop/context integration tests, including second-request takeover after restart, after compaction, successful follow-up fill and canary exclusion; 661/661 agent unit tests. `pnpm typecheck`, `pnpm lint`, `git diff --check` passed.
Ruling: Append the credential correction and once-per-origin checkpoint to the SAME decide transaction, after the model's output. No extra DB query or pause; restoring a worker cannot lose or repeat the correction. Eligibility comes only from the module's existing hasSignIn result and alias comes only from existing promptContext field lines. CAPTCHA and a second takeover are honored.

Task 3 commit: `4937a0a9`.
Task 4 RED: takeover and CAPTCHA both released their timers at 60 seconds; approval and OTP retained their existing idle timeout (two failures, two passes).
Task 4 integration GREEN: 253/253 tests across ten loop, vault and run-service files on the remote Docker host. Includes both human waits retaining their slot/page through 60 seconds and releasing at exactly ten minutes; approval and OTP still release at idleSleepMs. Typecheck/lint/diff check passed.
Ruling: Keep the named human-wait limit and reason mapping in turn context. The worker uses its already loaded control row; no additional DB read or wake timer restart. Existing explicit user control still holds its slot until the user returns control.
Transient final unit failure: 660/661 passed at two workers while DB integration ran concurrently; the existing PDF text-layer secret-refusal test exceeded its five-second timeout. Rerun serially without changing any assertions, timeouts or implementation.
Task 4 unit GREEN: 661/661 tests across 95 files at one worker, exit 0. All requested regressions run with llm-mock and synthetic secret/label canaries; no real OpenAI calls. No credentials written, no captured content changed, no migrations, push or merge. Live deployment/replay of fd46ae6e remains unperformed.
