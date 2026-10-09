---
run_id: 2026-10-09-08-review-observer-guard
date: 2026-10-09
phase: completion
status: completed
---

# Observer Guard — G1–G8 completion

Track G is implemented and committed on `observer-guard`. The authorized integration merge fast-forwarded `493f045a` to `874ff7e3`, including the six browser_use tools test correction. Each task then received its own commit in order. No subsequent merge or push occurred; the worktree stays in place.

Guard defaults to **Shadow** across API, database and benchmark CLI. Enforcement is explicit (`--observer-mode enforce`). It composes by strictest, never approves, remains metadata-only/reasoning-blind, fails closed synchronously, and charges structured parse failures. Bypass auto-approves deterministic data_egress. Calls use store:false without prompt_cache_retention. Tests use llm-mock/fakes; no real OpenAI calls or live zyBooks run occurred. No .env* file was read by the agent, no credentials were written, and no other worktree was touched.

Every task passed full `pnpm typecheck`, `pnpm lint`, and `git diff --check` before its commit. Suites ran on coursebite through `scripts/remote-test.sh` (D48); Docker integration was available.

| Task | Commit | Tests passed before its commit |
| --- | --- | --- |
| G1 — composition and denial ledger | ed2dfeff | Observer unit 11/11, including 2,000 monotonicity property cases |
| G2 — provenance and data_egress | ddaa4cb7 | Agent unit 633/633; loop DB 116/116 |
| G3 — triggers and metadata input | 8bd46b1b | Agent/Observer unit 659/659; deterministic trigger p50 <1ms |
| G4 — reviewer, billing and mock | 22d14bf7 | Agent/Observer/mock/contracts-server unit 725/725 |
| G5 — loop decisions and restore | 58278f35 | Agent/Observer unit 677/677; loop DB 188/188 |
| G6 — trajectory watcher and holds | f88e0655 | Agent/Observer unit 687/687; loop DB 192/192 |
| G7 — dashboard and authenticated alerts | 012db074 | Observability unit 19/19; real OpenObserve alerts 4/4 |
| G8 — production wiring and Shadow defaults | ae5238a6 | Broad unit 2,066/2,066; DB integration 364/364; security 2/2; real-slot behaviour 17/17; production image checks |

The fresh-context review used GPT-6 Astra because mandated Opus5.5 was unavailable. Its full report is preserved verbatim in [report.md](report.md). It found five material issues; all entered one test-first fix pass, with no re-review:

1. Blocked first off-allowlist acts consumed their trigger. Successful execution now records actuation; refusals retain eligibility.
2. An earlier approval card discarded later turn verdicts. Outcomes, the turn ledger baseline and explicit unavailable-review override scope now survive cards/restart. A person's override clears only that turn's unavailable Guard constraints; each policy gate still applies.
3. Sleeps/restarts forgot elevated risk and post-injection history. Migration0018 adds a bounded, schema-validated runs.guard_state checkpoint, saved in the same transaction as steps/events. The checkpoint retains only trajectory codes, counters, origins and pending card warnings; restore does not replay already completed reviews.
4. hasNews and resume counted one human denial twice. hasNews is read-only; resume ingests the decision once.
5. Watcher costs/holds could be lost on release. The worker stops new reviews, settles bounded in-flight work and checkpoints received usage/holds before releasing a live lease. Lease loss aborts background work without writes. Restored holds precede resumed actions.

The fix pass also pinned two additional security/cost failures: raw exact-match goal redaction now occurs before JSON escaping, and watcher-owned verdicts do not increment the every-ten-triggered-turn counter. A restored hold received during a person's wait was separately tested before any action runs. Each regression was observed RED before its fix, then GREEN.

Review-fix commit: **6022ef8efc078accf45e9f84507941e8372c7b23**.

Final verification:

| Check | Result |
| --- | --- |
| Full pnpm typecheck / lint / diff check | PASS |
| Broad unit (agent, observer, contracts, db, web, bench, llm-mock) | 2,069/2,069 |
| Docker DB + loop integration | 322/322 |
| Web run and benchmark service integration | 36/36 |
| Fresh lifecycle + step-store integration after interface cleanup | 69/69 (overlaps the DB/loop suite) |
| Exact-match Guard canary security | 2/2 |
| Real-slot run behaviour | 17/17 |
| Production agent/audio image, local OCR and Pulse egress checks | PASS |
| Real OpenObserve alert delivery (G7; untouched by fix pass) | 4/4 |

Migration0017 sets Shadow as the DB default;0018 persists the Guard checkpoint. Both have generated drizzle journal/snapshots. Applied0015/16 were untouched. The plan's unused carriesQuery initializer was removed to satisfy current lint; no behavior change.

The initial final behaviour command used a stale path and found no tests; it was corrected to tests/behaviour/runs.behaviour.test.ts and passed. The first final DB command's stale web filters did not select the web services; their actual paths were run separately (36/36). These runner corrections did not weaken assertions or skip verification.

## Rulings and plan deviations, in order

1. Ruling: User requires shadow default, overrides plan/spec enforce default. No cache-retention parameter per amended D52. Next migration is 0017 if necessary. Codex trailer replaces plan trailer.

2. Task G2: Ruling: plan's read_page args {} fail current strict schema; use mode:text, sinceHash:null, offset:null. Fixture destination other.fixtures.test is D51 same-site allowed; use outside.other.test for an off-allowlist destination. Cost if wrong: tests would target a different scenario, not changed production rules.

3. Task G2: Ruling: on restore ingest latest function act result in addition to transcript: act outputs are transcribed only at next decide. Restart regression RED→GREEN confirms this closes the gap. Tests: remote agent unit 633/633; run-loop integration 116/116 after fixture fixes. Full typecheck/lint awaiting final completion before commit.

4. Task G4: Ruling: parse errors now use Foundation StructuredParseError and billedUsageOf, preserving both stages' usage; plan's Zod/SyntaxError-only catch would lose spend. Guard mock routing uses existing scenarioTag and records nonce so data-policy behaviour requests can see Guard calls. Cost if wrong: billing or test association only; covered by regressions.

5. Task G5: Ruling: loop retains personOnly on reapproval (plan omitted it); shared test harness moves setup without changing original116 tests. Guard uses current approval mode, reconciles ledger to actual applied decisions, resets consecutive on a quiet turn, and treats run-level denial-limit as a hold. The old architecture test's exact approval-boundary allowlist includes guard.ts/types.ts, while all hard-invariant components remain barred from modes. These corrections preserve intended behavior; cost if wrong is extra/incorrect approval or counting, covered by tests except run-level limit (review explicitly).

6. Task G6: Ruling: StepStore forwards all generated committed events (not only commit.events), and completed act events include the acted page URL so origins exist. Watcher queues in-flight detector hits and verdict events, updates current mode/scope, and drains on completion to charge late spend and honor holds. Test harness captures guards instead of a test-only RunLoop method. Cost if wrong: missing holds/spend or bounded completion delay; pinned tests cover each correction.

7. Task G8: Ruling: user Shadow default overrides spec/plan enforce default and Shadow acknowledgement prerequisite. New runs default Shadow across API/DB/bench; optional observerShadowAcknowledged remains accepted for existing clients. Generated0017_guard_shadow_default plus drizzle journal/snapshot; applied0015/16 untouched. Cost if wrong: weaker default rollout; explicitly user-authorized.

8. Task G8: Ruling: current harness main attempts use benchmarks.start (not the plan's supposed create-run body); extend the shared BenchmarkRef with optional observerMode and forward it through web's start service; verify runs receive it directly. Reports include rollout and tolerate missing rollout in historical records. Cost if wrong: requested bench mode lost; passthrough/DB tests cover it.

9. Task G8: Ruling: the plan's uppercase canary is already scrubbed by generic redactForTitle, so it cannot test the exact-match trip; use a lowercase canary to exercise that trip without weakening assertions. Real-slot harness opts into real Guard wiring and validates GuardInput/TrajectoryDigest, store:false and retention omission. Cost if wrong: insufficient security coverage; two canary and real-slot gates pin it.

10. Final: Ruling: Opus5.5 is not a callable model here; required fresh-context final review uses GPT-6 Astra (most capable available). Cost if wrong: reviewer quality difference; review remains independent, read-only and persisted.

11. Final: Ruling: durable Guard state needs an atomic checkpoint, beyond the plan's denial ledger. Add a bounded, schema-validated runs.guard_state JSON checkpoint and migration0018; retain only trajectory codes, trigger counters, origins and pending card warning. StepStore stages metadata in its transaction, starts asynchronous work only after commit. Cost if wrong: extra JSON writes or restart behavior; targeted restore/lifecycle regressions cover it.

12. Final: Ruling: unavailable review approval covers that turn's unavailable Guard constraints only; policy gates still apply to every action. Persist outcomes and override scope in the existing pending approve-step checkpoint. Cost if wrong: over-broad human override; multi-action/restart/changed-target tests gate it.

13. Final: Ruling: after a person approves denial_limit, reset both thresholds as the plan's DenialLedger specifies; a total of20 otherwise causes an immediate permanent re-hold on every next turn. Cost if wrong: another20 blocked items before a new total-limit hold; explicit human continuation remains required and Guard never approves.

14. Final: Ruling: reviewer declined C/U/E/D and UI cards/badges; leave them for the later runs the user required. Cost if wrong: those surfaces remain unfinished until those tracks land.

15. Final: Ruling: reviewer declined real-model detection quality and production latency; do not claim either from mocks, and make no unauthorized live calls. Cost if wrong: production false positives/negatives or latency surprises.

16. Final: Ruling: reviewer declined screenshot-only provenance; retain the spec's documented limitation. Cost if wrong: text learned only through screenshots may not be recognized as cross-origin egress.

17. Final: Ruling: reviewer declined organization-level OpenAI retention settings; keep the operator-owned setting outside this branch, with store:false enforced and unsupported cache retention omitted. Cost if wrong: account-level retention differs from operator expectations.

18. Final: Ruling: reviewer declined a complete re-audit of merged Foundation/migrations0015/16; leave them untouched and verify integration/role/migration tests instead. Cost if wrong: an unrelated pre-existing Foundation flaw remains.

The first ruling's risks are a weaker default rollout (explicitly authorized), standard OpenAI prompt caching rather than the unsupported retention setting, and different commit attribution. The restore-provenance ruling's risk is a missed duplicate/late tool output; the restart regression covers it. All other cost-if-wrong statements remain in the preserved ledger.

## Left undone

No Track G task or material review finding remains undone. Deferred minors: none. Tracks C, U, E and D remain for later runs as requested. No deployment, live model efficacy evaluation, live zyBooks benchmark or operator retention configuration was performed. Screenshot-only provenance remains the documented limitation. A hard process crash or lease loss cannot guarantee accounting for provider charges that were never received; the worker accounts for received usage before release wherever its lease permits.
