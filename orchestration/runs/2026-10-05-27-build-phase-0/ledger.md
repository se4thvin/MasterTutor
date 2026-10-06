# SDD ledger — plan: docs/superpowers/plans/2026-10-05-phase-0-foundations.md

Base: 8e8152d (branch houndshark)
Spec: docs/superpowers/specs/2026-10-05-agentic-notes-design.md
Note: subagents may be blocked from writing report files; if so, reports come back as replies and the controller persists them.

## Pre-flight scan
Full table: preflight.md (run by a sonnet scanner that executed the plan's code in a scratch replica).

Rulings:
- Ruling: F1 T13 stray "</```tsx" line in layout.tsx: delete it — copy defect — none.
- Ruling: F2 T8/T13 db root index must NOT re-export migrate.ts (import.meta.url breaks next build); migrate is reachable only via its bin/subpath — verified by scanner — if wrong, web build fails (caught by T13 build step).
- Ruling: F3 T15 only ONE service (migrate) carries `build:` for mastertutor/node-runtime:local; agent and garage-init reuse the image tag — Docker Desktop "image already exists" — if wrong, smoke fails at build.
- Ruling: F4 T10 fake fetch must not assert the auth header on GET /health — plan test bug — none.
- Ruling: F5 T10 `let json: unknown;` (no useless assignment) — lint — none.
- Ruling: F6 T7 schema.test.ts uses `as PgTable[]` instead of a type predicate — TS2677 — none.
- Ruling: F7 every task runs `pnpm format` before committing — prettier drift breaks T15 format:check and CI — none.
- Ruling: F8 T8/T12 `syncBrowserSlots(sql: Sql | TransactionSql, ...)` — TS2345 — none.
- Ruling: D1 T14 verify.sh secrets-scrub check must fail on read error; run it with `--cap-add SYS_PTRACE` (or read via `docker exec -u root`) so it really asserts — a check that asserts nothing is a defect — slower verify only.
- Ruling: D2 T13 first-sign-up gate uses a Postgres advisory transaction lock (pg_advisory_xact_lock) around check+insert, plus a concurrent (Promise.all) sign-up test asserting exactly one 200 — security: second owner — none.
- Ruling: D3 all tasks run focused tests with `pnpm exec vitest run --project <proj> <path>` (not `pnpm test -- path`) — filter was ignored — none.
- Ruling: D4 one source for slot defaults/parse and UUID: export `DEFAULT_BROWSER_SLOTS` + `parseBrowserSlots` from contracts and reuse contracts `Uuid` in keys.ts — CLAUDE.md principle 6 — none.
- Ruling: D5 T16 negative probes assert the specific blocked-connection outcome (curl exit 7/28 or ECONNREFUSED/timeout), not any failure — weak test — none.
- Ruling: D6 normalize UUIDs to lowercase at the contract boundary (Uuid transform toLowerCase) — mismatch — none.
- Ruling: D7 shared `downloads` volume is not wiped by slot restart (matches spec); B1/B6 must delete /downloads/<runId> on release + test it — carried to B6 plan — leak of a prior run's download if missed.
- Ruling: D8 vault origin = exact scheme+host+port (plan), deviating from spec §4 "eTLD+1" — stricter pinning, matches D34 (`https://learn.zybooks.com`) — a site that logs in on a sibling subdomain needs a second alias.
- Ruling: execution batching — dispatch implementers per task GROUP (A: T1–6 contracts, B: T7–9 db, C: T10–11 storage, D: T12–13 agent+web, E: T14 slot image, F: T15–17 compose/smoke/CI) with one task review per group — cost/time control on a 17-task foundation; same-package tasks share context — a defect inside a group is reviewed later than per-task (still before the next group).

## Execution
Group A (T1–6): dispatched implementer aef77c2c09d6c9f8e (sonnet), BASE 8e8152d
Group A: implementer DONE_WITH_CONCERNS (commits 91ed02a..fd4c990; 100 tests). Deviations: Uuid uses .overwrite for lowercase; SlotList moved to constants.ts. Branch is agentic-notes-browser-agent (worktree renamed; not houndshark).
Group A: review dispatched a35363300e8236adb (sonnet), package review-8e8152d..fd4c990.diff
Group A (Tasks 1–6): complete (commits 8e8152d..fd4c990, review clean — Approved, 0 Critical/Important)
Task 1-6: minor (deferred): EventId regex x3 (events/notify/dto); Count defined twice; DEFAULT_BROWSER_SLOTS vs DEFAULT_SLOT_COUNT two sources + misleading comment; env no-echo test only covers Secret; strictSchemaProblems untested + ignores additionalProperties; browser-safety lint misses bare builtins/server; embedPath loose regex; ReadPageResult.url any scheme.
Ruling: minor #5 REDACT_PATHS missing totp/pin/otp/imap_password/passkey/token/cookie is security-relevant (secrets in logs) — fold the fix into Group B's dispatch (derive from CREDENTIAL_FIELDS/VAULT_SECRET_FIELDS + tests) — if skipped, a logged {otp} leaks.
Group B (T7–9 + logger redaction fix): dispatched implementer a341df0d761b60f21 (sonnet), BASE fd4c990
Group B: implementer DONE (commits e8ed880..42f8a3b; 107 unit + 29 int). Ruling: logger also redacts `username` — usernames are emails (PII) and vault-bound; keep — cost: less debuggable auth logs.
Group B review: Needs fixes — 3 Important (D4 slot parse duplicated; D4 slot regex hand-written in SQL; D8 origin columns unvalidated). Fix round 1/5 dispatched to a341df0d761b60f21 (FIX_BASE 42f8a3b).
Group B ⚠️ resolved: runs.slot_name UNIQUE → B1 must null it on release (sent to B1 plan writer); agent CRUD on vault_grants/approvals intended for now.
Task 7-9: minor (deferred): grants.sql web_role deny-list (prefer allow-list); agent full CRUD on vault_grants/vault_items (restrict if web writes grants); folder trigger locks only NEW.workspace_id; password test rejects.toThrow() with no message; logger req/res.headers paths untested; REDACT_PATHS lost literal tuple type; ./migrate subpath unused.
Group B: fix round 1/5 (3 addressed, 0 open; commits 42f8a3b..ff8a106)
Group B (Tasks 7–9): complete (commits fd4c990..ff8a106, review clean)
Task 7: minor (deferred): origin rejecting tests cover only runs/vault_items/sources
Ruling: merge groups C (T10–11) and D (T12–13) into one dispatch — independent packages, same review gate — cost/time; a defect is reviewed together. Groups C+D: dispatched a35fbf64b76dc5a1c (sonnet), BASE ff8a106
Groups C+D: implementer DONE_WITH_CONCERNS (commits 93bc71c..956de8d; 136 unit + 37 int; next build ok). Sign-up race fixed via ensureWorkspaceMember({joinExisting}) + WorkspaceClosedError; loser row deleted, 403.
Groups C+D: review dispatched aa79a047e50eac43e (sonnet), package review-ff8a106..956de8d.diff
Groups C+D review: Needs fixes — 2 Important (orphan user + sign-up lockout on after-hook failure; D2 test lacks session/account=1 asserts). Fix round 1/5 dispatched to a35fbf64b76dc5a1c (FIX_BASE 956de8d).
Task 10-13: minor (deferred): garage key re-import on rotated secret w/ same id; probe.test expect inside handler; before fast-path partial duplication (justified).
Groups C+D: fix round 1/5 (2 addressed, 0 open; commit 2f47526)
Groups C+D (Tasks 10–13): complete (commits ff8a106..2f47526, review clean)
Task 14: dispatched ab86f83c90be38d31 (sonnet), BASE 2f47526
Task 14: implementer DONE (commit 29926a6; verify.sh 12/12 on Docker Desktop, sandbox on)
Task 14 review: Needs fixes — 4 Important (no IPv6 filtering; ingress deny-list over ACCEPT; restart not fully fresh: /downloads, ~/.pki; derived n.eko pw in env).
Ruling: Task 14 Important 4 — HMAC-derived n.eko member passwords in n.eko env accepted: per-slot derived (not raw secrets), page JS cannot read env, 8080 ingress-restricted — cost if wrong: a process-level compromise of the slot yields n.eko admin for that slot only (it already has the browser).
Ruling: carry `sysctls: net.ipv6.conf.all.disable_ipv6: 1` into Task 15's x-browser-slot anchor.
Task 14: fix round 1/5 dispatched to ab86f83c90be38d31 (FIX_BASE 29926a6).
Task 14: minor (deferred): verify uses SYS_PTRACE not present in prod; seccomp lifts namespace-flag restriction (document + sha256 pin of Moby profile); policies.json URLBlocklist lacks view-source/chrome://inspect; loopback egress open (needed for n.eko).
Task 14: fix round 1 done (commit 61dba1e; verify 14/14; IPv6 closed via ip6tables fallback on Docker Desktop)
Task 14: fix round 1/5 (5 addressed, 0 open; commit 61dba1e)
Task 14: complete (commits 2f47526..61dba1e, review clean)
Task 14: minor (deferred): verify --no-sandbox pgrep pattern matches its own sh (anchor ^/usr/lib/chromium/chromium)
Group F (T15–17): dispatched ae9a9698077bdc37e (sonnet), BASE 02952f0 (note: HEAD includes orchestrator docs commits)
Group F: implementer DONE (commits 032b05d,84b4837,6e7b21c; SMOKE OK; 142 unit + 7 compose int)
Group F review: Needs fixes — 1 Important (plan-mandated: vacuous S3_AGENT_SECRET_ACCESS_KEY negative assert).
Ruling: Group F Important (plan-mandated) — replace with value-based S3 key placement assertions; spec least-privilege (§3.1 rule 6) outranks the plan text — cost: none.
Group F: fix round 1/5 dispatched to ae9a9698077bdc37e (also atomic .env write + compose comment).
Task 15-17: minor (deferred): CI actions pinned to major tags + persist-credentials default; KEY="" treated as set; smoke port check weak; no red phase (verbatim tests).
Group F: fix round 1/5 (3 addressed, 0 open; commit 3448ce1)
Group F (Tasks 15–17): complete (commits 02952f0..3448ce1, review clean)
All Phase 0 tasks complete. Final whole-branch review next.
Final review (opus): ready to merge with fixes — I1 slot restart wipes shared /downloads; I2 agent cannot reach n.eko 8080; I3 B6 plan replaces hardened slot-entrypoint with an older copy.
Ruling: I3 — when dispatching B6, instruct implementers to apply B6's slot changes (TURN creds, port 9224 idle probe, can_host:false, scrubbed TURN_SECRET) as edits to the CURRENT hardened slot-entrypoint/verify.sh, never as wholesale replacement — cost if missed: loss of IPv6 closure/default-drop hardening.
Final fix wave dispatched (I1, I2 + spec §3.1 amendment, minors: DEFAULT_SLOT_COUNT, strictSchemaProblems tests, pgrep anchor, web_role bytea test).
Deferred to Phase 9: garage key re-import on rotation; CI SHA pins + persist-credentials:false.
Final fix wave done (221fe16, 901ea66). Ruling: Phase 7–10 plan's DEFAULT_SLOT_COUNT import → use DEFAULT_BROWSER_SLOTS.length (constant deleted) — carry into Phase 7 dispatch.
Final fix wave: re-review clean (all 6 addressed). PHASE 0 COMPLETE (8e8152d..901ea66).
