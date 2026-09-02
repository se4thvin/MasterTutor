# Benchmarks: protocol (D32, D34, D44, D46, D47)

The user's acceptance test (D32): the agent signs into zyBooks and completes the participation
activities in reading assignments 1–5, with **no takeover**, on both capability tracks:
- `computer_use`: masked screenshots plus `computer`, `fill_credential` and `use_passkey`;
- `browser_use`: the full tool set, including `read_page` and `capture`.

## Rules
1. **Credentials (D34).**
   - The user types the credential into the Vault UI themselves (the zyBooks username and password): alias `zybooks`, origin `https://learn.zybooks.com`, fields username and password.
   - The orchestrator never asks for the credential, never receives it in chat and never types it.
   - It never goes into a file, command, env var, commit, log, record, ticket or plan.
   - The harness refuses `ZYBOOKS*` env vars. `pnpm bench vault-check --suite zybooks` checks the item and the saved-session state without starting a run.
2. **Prod-like only (D47).**
   - zyBooks runs only on the prod-like stack (`scripts/bench-local.sh`): `compose.yml` + `compose.prod.yml` + the domain/TLS-only `tests/bench/compose.local.yml`; production builds; real `gpt-6-astra` through the D38 wrapper; real sign-up, Vault, sandbox, network policy and download gate.
   - The harness refuses to start unless its prod-mode preflight passes. It observes and grades only.
   - `--mock` and `bench-mock` test the harness, never a benchmark.
3. **Bypass mode (D44, D46).**
   - Every zyBooks run uses `--approval-mode bypass --acknowledge-bypass`.
   - Bypass never lifts the hard invariants: a `malicious_instructions` check still pauses; vault fills happen only on the exact origin.
   - A safety check that bypass or policy approves at once is logged `auto_approved (decided_by=bypass)` and listed in the record; it is never counted as a stop or used to classify a failure. Only a check the run waits on is a stop.
   - A bypass-approved `new_origin` is a breach and is reported (P10b-22).
4. **One run, then STOP (D46).**
   - The first zyBooks invocation is the full task, once (the user's D46 ruling): EXACTLY ONE agent run, `full@browser_use` (`--once` is the default; `--retries 0`). It signs in fresh through the vault, then finds reading assignments 1–5 and their sections itself and redoes every participation activity in them. No section list is supplied, and nothing runs before it. A read-only grading run follows it (rule 9); it is grading, not a second attempt.
   - The harness writes `orchestration/benchmarks/<YYYY-MM-DD>-zybooks-<NN>/record.md` (`NN` zero-padded) and exits. Nothing loops or retries automatically.
   - Every later zyBooks invocation (baseline, reading runs, the fix loop) needs `--continue-after-review <record>`. That record must be the newest one, and a human must have set `reviewed: true`, `reviewed_by: <name>` and `authorize: <N further invocations>` in its frontmatter.
   - Each invocation writes its own record.
   - **The durable ledger** `~/.mastertutor-bench/ledger.jsonl` (outside the repo and every stack volume, under an exclusive lock) records each real invocation as `running` before its first run starts, its spend at every checkpoint, and its end. Wiping the bench stack resets nothing.
     - Any earlier zyBooks entry refuses a new zyBooks invocation without `--continue-after-review`.
     - Only one bench CLI runs at a time.
     - A crashed or killed invocation stays `running`, and every new run is refused until a person checks that run in the app and calls `pnpm bench resolve <id>`.
     - Ctrl-C (SIGINT) or SIGTERM cancels the invocation's runs through the app's normal cancel and marks the entry `cancelled` with its last recorded spend.
5. **Spend (D46, D47).**
   - The total zyBooks cap is **$500**, summed from the ledger (never from the stack's database).
   - Each run carries `--max-run-usd` (default and maximum $50 per run), enforced by the product's own per-run budget pause. Neither cap can be raised by a flag or an env variable.
   - Fixtures: $10 total.
6. **Fresh login (P10b-4/5).**
   - Before every run the harness forgets any saved zyBooks session and refuses to start if one survives.
   - `signed_in` is graded on the main run's trace.
   - Never grant a lasting zyBooks sign-in during benchmarks.
7. **Baseline (D32).**
   - Readings 1–5 are already complete on the account; the runs redo them, and the main run must have worked on every activity of every section it is graded on.
   - Run 1 has no baseline run (one full-task run, D46). Later single-reading runs do: run `pnpm bench baseline` (grading runs only) before the first of them.
   - Reading runs pass `--reuse-baseline`. An attempt then skips its own baseline verify run when a record from the same UTC day lists its spec name in `baselines_passed`, and its record cites that record in `baseline_from` (P10b-21).
   - Otherwise the attempt runs its own baseline verify run first. If the page does not show completion, the attempt is recorded as `error` (`BaselineIncomplete`).
   - Only the user may authorise `--allow-incomplete-baseline`.
8. **No site hacks.**
   - Fixes land in generic product code.
   - `tests/bench/src/no-site-hacks.test.ts` fails on any site or consent-vendor name in product source, `compose*.yml`, `infra/` or non-bench `scripts/`.
   - The only site-adjacent behaviour allowed in product code is **generic cookie/consent-banner dismissal**, by role and accessible name, with no vendor or site selectors.
   - Prompts and discovery patterns live only in `tests/bench/`.
9. **Grading.**
   - Grades come only from `read_page` tool output recorded by the agent, never from the model's claims: from a separate grading (verify) run for `full` and the readings, or from the single run for `login`.
   - The grading run discovers the reading assignments and their sections itself: from the read_page output, the harness takes each reading's entry and the section links listed under it or on its page (patterns in `tests/bench/src/suites/zybooks.ts`).
   - A listing counts only when it is provably complete: read whole (read_page reports `total`; a longer page is read in document-order pages with `offset`) and with no chapter or group still `[collapsed]` (the grading run expands them; a disclosure click is not page input). Otherwise the reading is `unknown`.
   - Each section is graded on its fullest single read_page result (most activities), split into activity blocks; challenge activities are never counted.
   - The record lists every section: reading, URL, outcome and why. The account starts complete (D32), so completion alone proves nothing: a section passes only when every participation activity is complete AND the main run's own trace shows every question answered and every animation step played in each activity. Each input is tied to its activity and question by the enclosing text the agent recorded where it landed; one click per activity is not enough.
   - A section the grading run never read, or where no activity was found, is `unknown`; `unknown` never passes. So is a reading it could not find. Any non-passing section keeps the outcome below `passed`.
   - Verify (grading) runs are read-only: they may click, type or press keys only on the sign-in page (`VerifySpec.signInUrl`). Any other page input, including one action hidden in a batch, taints the run (`error`).
   - Opening a URL through the address bar (CTRL+L, the URL, ENTER that lands on that URL) and back, forward and reload are navigation, not input. An address-bar sequence that never lands on its URL counts as input.
   - Any takeover caps the outcome at `partial`.
   - The orchestrator spot-checks the replay of every passed section (P10b-7): its inputs' screenshots by key, against the activities they were credited to.
   - If the discovery or activity patterns missed the live site, run `pnpm bench regrade <record>` (`scripts/bench-local.sh regrade <record>` on the Mac) after correcting them: it grades the finished runs again from their stored traces, with no run and no spend, and appends a `## Regrade` section.
10. **No GitHub CI e2e (D46).** e2e and `bench-mock` run locally or through `scripts/remote-test.sh`.

## Budgets

| Benchmark | Steps | USD (cap per run) | Active min |
|---|---|---|---|
| fixtures/activities (real) | 80 | 3 | 20 |
| zybooks/full (run 1) | 3000 | 50 | 600 |
| its grading run | 400 | 10 | 90 |
| zybooks/login | 40 | 2 | 10 |
| zybooks/reading-N | 900 | 50 | 180 |
| reading grading / baseline runs | 60–150 | 1–4 | 10–30 |

- The harness clamps every run to min(spec, `--max-run-usd`, what is left of $500).
- Budget hits: the fixtures suite finishes the run at once; a zyBooks budget pause waits for a person (the harness never decides it), and the human-wait timeout (20 min) then ends the run.
- If a track looks impossible within these budgets (for example `computer_use` needs more than $50 per reading after three fix rounds), stop and report the numbers to the user. Never raise a budget silently.

## Order of work
1. T22A smoke passed (`bash scripts/bench-local.sh smoke`).
2. **Run 1 (T25):** `full@browser_use`, the full task once (sign in, then readings 1–5), then its grading run, the record, then STOP. User review.
3. **After review (T25B), each step one reviewed invocation, as the review decides:**
   - fixes for the tickets run 1 raised, each re-run as one reviewed invocation;
   - `full@computer_use`, or single readings (`baseline`, then `reading-N` on each track) where a reading needs work on its own;
   - the final full run on both tracks.

## Watching a live run
- Start the harness with `run_in_background` and follow its log with Monitor.
- Open `http://localhost:18080/runs/<runId>` only AFTER the log shows both `fill_credential` steps done.
- Never open, screenshot or stream the Vault page; the live stream is unmasked (P10b-14).
- Interventions, in order of preference:
  1. Do nothing. A stall or a human wait (including a `malicious_instructions` pause) times out. The harness cancels and grades.
  2. Cancel from the run view if the run is clearly looping and burning money. Write that in the record review.
  3. **Takeover is a last resort**, only to unblock a CAPTCHA or a broken state, and only after the failure is written down. It is counted, and the run cannot pass.
- Stop and report to the user on CAPTCHA/MFA, a lockout warning, "unusual activity", or the account no longer showing readings complete.

## Failure loop (only after a review, T25B)
- **Tickets.** For each non-passing result the harness writes `tickets/BT-####.md` (T20), with frontmatter `{ticket, status: open, benchmark, track, run_id, verify_run_ids, report, created}` plus the unmet list. The review flag (`reviewed: false`) lives on the record that lists the tickets. `--mock` writes none.
- **Triage.** The orchestrator opens the replay (step screenshots by key, from the record), confirms or corrects the class, and fills in "What the agent saw vs. did" and "Generic root cause".
- **Fix.**
  - Dispatch a fixer subagent with `orchestration/briefs/bench-fix.md` and the ticket.
  - Fix-run ids are `YYYY-MM-DD-NN-fix-bt-####`.
  - The orchestrator persists each run with `python3 orchestration/tools/persist_run.py <transcript> orchestration/runs/<id> --phase fix`.
  - Fix by class:
    - perception: `read_page` coverage, screenshot timing;
    - action: CDP input, waits, scroll;
    - navigation: allowlist and URL handling;
    - auth: the vault fill path, the focused target, generic consent dismissal;
    - policy: the approval classifier;
    - budget: compaction, cheaper observation.
- **Review.** A fresh reviewer subagent checks the fix. The gate, the one list used everywhere:
  `pnpm typecheck && pnpm lint && scripts/remote-test.sh unit && scripts/remote-test.sh integration && scripts/remote-test.sh security && pnpm bench:mock`
  plus `scripts/remote-test.sh e2e` when `apps/web` changed.
- **Re-run.** Re-run the same benchmark and track with `--continue-after-review <newest reviewed record>`. Close the ticket (`status: closed`) only if the failure is gone.
- **Done.** Every `reading-1..5` is `passed` on both tracks, with zero takeovers, in one final reviewed invocation (`--track both`, without `--once`).
