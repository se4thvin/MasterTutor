# Pre-flight conflict scan: Phase 0 foundations plan

Plan: `docs/superpowers/plans/2026-10-05-phase-0-foundations.md` (17 tasks). Spec: §3, §4, §13, §16.
Scanned 2026-10-05 on the dev box (macOS arm64, Docker Desktop 28.5.1, Node 24.4.1, no pnpm on PATH). Read-only with respect to the repo.

## How this was checked

Besides reading, every code block in the plan was extracted verbatim into a scratch replica (outside the repo, in the session scratchpad) and run.
The only manual edits were the ones the plan itself says to make (`index.ts` appends, the three `drizzle-kit generate` migrations, the `0000`/`0002` SQL bodies).

| Check | Result |
|---|---|
| `pnpm install` (via `npx pnpm@10.34.6`), all pinned versions exist on npm | pass |
| `pnpm test` (unit) | 135 of 137 pass; 2 fail (F4) |
| `pnpm test:int` db (migrate, security, library, queries), storage (garage, s3), web auth, compose-config | 41 of 41 pass (real Postgres and Garage via Testcontainers) |
| `drizzle-kit generate` x3 | pass; `0001_init.sql` has 27 `CREATE TABLE`; no contracts loader error |
| `pnpm typecheck` | fails (F6, F8) |
| `pnpm lint` | fails, 1 error (F5) |
| `pnpm format:check` | fails, 47 files (F7) |
| `pnpm audit --prod --audit-level high` | pass (1 moderate) |
| `next build` for `apps/web` | fails (F1, F2); passes once both are fixed |
| `apps/browser-slot/test/verify.sh` | passes, all 12 checks (one is vacuous, D1) |
| `scripts/compose-smoke.sh` (`pnpm smoke`) | fails (F3); passes after F3 is fixed, "SMOKE OK" |
| `env -i node apps/agent/src/main.ts` | prints EnvError with keys only; Node type stripping works through the pnpm workspace symlinks |

All containers, networks and volumes from the runs were removed, and so were the three `mastertutor/*` images.

## Findings (ranked)

### Blocking: fails as written

| # | Task(s) | Finding | Evidence | Suggested ruling |
|---|---|---|---|---|
| F1 | 13 | `apps/web/app/layout.tsx` contains a stray line ``</```tsx`` between `</body>` and `</html>`. This is a copy error in the plan text. | plan line 6922 | Delete that line. |
| F2 | 8, 13 | `@mastertutor/db` root `index.ts` re-exports `migrate.ts`, which has `new URL("../migrations", import.meta.url)`. Turbopack treats it as an asset and the web build dies: "Module not found: Can't resolve '../migrations'", import trace `healthz/route.ts` to `db.ts` to `db/index.ts` to `migrate.ts`. | `next build` run | Do not export `./migrate.ts` from the db index (only `bin/migrate.ts` and `testing.ts` import it, by relative path). Verified: the build then succeeds and `.next/standalone/apps/web/server.js` exists. |
| F3 | 15, 16 | `agent`, `migrate` and `garage-init` all have `image: mastertutor/node-runtime:local` plus the same `build:`. `docker compose up --build` and `compose:test build` build the tag three times in parallel; Docker Desktop's containerd store fails with `image "docker.io/mastertutor/node-runtime:local": already exists`, so `pnpm smoke` stops at "stack did not become healthy". | smoke run 1 | Put `build:` on one service only (for example `migrate`); the other two keep `image:` only. Verified: smoke then passes end to end. Also fix the Task 15 test text, which only checks `image`. |
| F4 | 10 | Unit tests 1 and 2 of `garage-admin.test.ts` cannot pass. The fake `fetch` asserts `Authorization: Bearer` on every call, but `waitForHealthy` calls `/health` with no headers. The assertion throws inside the fake, `.catch(() => null)` swallows it, and the loop polls for 30 s, so the test times out at 5 s. Test 3 passes. | unit run | In the fake, skip the auth assertion when `op === "/health"` (Garage's `/health` is unauthenticated), or assert on the other calls only. |
| F5 | 10 | `pnpm lint` error `no-useless-assignment` at `garage-admin.ts:66` (`let json: unknown = null;` is overwritten on both paths). ESLint 10 recommended enables this rule. | lint run | Use `let json: unknown;` (or return from the `try`). |
| F6 | 7 | `pnpm typecheck` TS2677 in `schema.test.ts`: `.filter((value): value is PgTable => is(value, PgTable))`. The predicate type must be assignable to the parameter type. | typecheck run | `Object.values(schema).filter((value) => is(value, PgTable)) as PgTable[]`. |
| F7 | 7 to 17 | Format drift. Only Tasks 1 and 6 run prettier. Replica `format:check` fails on 47 files (long lines in contracts, db, storage, agent, tests). Task 15 Step 7 runs `format:check`; its fix `pnpm format` rewrites files outside Task 15's `git add` list, which are left dirty. Task 17 CI `format:check` fails on the first push. | format run | Add `pnpm format` before the commit step of every task (or one `style:` commit before Task 15 that stages everything formatted). |
| F8 | 8, 12 | `pnpm typecheck` TS2345: `syncBrowserSlots(tx, slots)` where `tx` is `TransactionSql`. The plan gives the fix only as a fallback note. It also breaks the agent typecheck (the agent imports db). | typecheck run | Make it the default: `sql: Sql \| TransactionSql`. |

### Defects a reviewer would reject

| # | Task(s) | Finding | Suggested ruling |
|---|---|---|---|
| D1 | 14 | `verify.sh` "raw secrets scrubbed" asserts nothing. `docker exec` cannot read the n.eko process's `/proc/PID/environ` ("Permission denied" was printed during the run), so `grep -q` sees empty input and the check always passes. | Fail when the read fails (`pipefail` plus an explicit `test -r`), and give the verify container `--cap-add SYS_PTRACE` so it can read, or replace it with an `ls /proc/1/environ`-independent check. |
| D2 | 13 | Review Focus #3 and the Self-Review table claim Task 13's test covers racing first sign-ups. It only runs sign-ups sequentially. The `before` hook is check-then-insert (`hasAnyUser` then insert), so two concurrent first sign-ups can both pass and create two users while sign-up is "closed". The single-owner workspace is still guaranteed by the advisory lock in Task 9. | Either take the same advisory lock in the hook, or reword the Review Focus to "one owner workspace" and accept the extra user. Add a concurrent test either way. |
| D3 | 7 to 15 | Every "scoped" run is unscoped. `pnpm test -- packages/db` and `pnpm test:int -- tests/compose` forward a literal `--`, and vitest ignores the filter. Observed: `test:int -- packages/db` also ran `tests/compose`. | Use `pnpm exec vitest run --project integration <path>` or drop the `--`. |
| D4 | 8, 10, 11, 15 | Verbatim duplicated logic: `z.array(SlotName).min(1).parse([...x])` in both `migrate.ts` and `syncBrowserSlots`; the six-slot list literal in `env-init.ts`, `.env.example` and twice in `compose.yml` (next to `DEFAULT_SLOT_COUNT`); `UUID_RE` in `keys.ts` re-implements contracts `Uuid` although storage depends on contracts; the `WEB`/`AGENT` key specs repeated in `garage.int`, `s3.int` and `garage-init.ts`. | Low priority. At least drop the second slot parse and import `Uuid` in keys.ts. |
| D5 | 16 | The negative probes pass on any failure: web to slot:9223 exits 0 on timeout, refusal or DNS error; the slot to web, metadata and `getent postgres` checks pass on any non-zero exit. The positive controls (agent probe, web to n.eko) keep this tolerable. | Optional: assert curl exit 7 or 28. |
| D6 | 1, 4, 11 | Small interface mismatches. `Uuid` (`z.uuid()`) accepts uppercase, but `OpenLiveResult.embedPath` and `keys.ts` `UUID_RE` accept lowercase only, so `livePath(upper)` passes and the result schema then rejects it. | Lowercase in `livePath`, or one shared lowercase `Uuid`. |
| D7 | 14, 15 | The `downloads` volume is shared by all slots and not wiped on restart, so "fresh profile" covers only the profile tmpfs. This matches spec §10.2.9 (agent deletes the local copy), so it is a note for B1, not a bug. | Add a B1 test that `/downloads/<runId>` is gone after release. |
| D8 | spec §4 vs 1 | Spec §4 says vault `origin` is "scheme + eTLD+1 + port"; the plan stores exact `scheme://host[:port]`. D34 (`https://learn.zybooks.com`) supports the plan. | Record as a deviation. |

## Per-pair rows

"Match" = the producer's exact names and signatures equal what the consumer uses.

| Producer (task) | Consumer (task) | Interface | Result |
|---|---|---|---|
| 1 | 2 | `Uuid, Sha256Hex, IsoDateTime, BlockType, BlockOrigin, AgentTurnStatus, NeedHuman` | Match |
| 1 | 3 | `Alias, ElementRef, Origin, Sha256Hex, Uuid, VIEWPORT`, enums `ANNOTATE_KINDS, CredentialField, Fidelity, VideoOp` | Match |
| 2 | 3 | `Budget, Usage` in `ApprovalRequest.budget` variant | Match |
| 1, 3 | 4 | `ApprovalRequest, ToolName, NOTIFY_MAX_BYTES, WakeReason, SlotName`; 13 event types | Match |
| 1 | 5 | `SlotName, Base64Key32, BucketName, DbPassword, GarageKeyId, GarageSecret, PostgresUrl` | Match |
| 1 to 5 | 6 | DTOs reuse `ApprovalRequest, StepAction, NoteBlock, OpenLiveResult, ApprovalDecisionInput, Budget, Usage, Plan` | Match |
| 1 to 6 | 7 | JSON column types `Budget, Usage, Plan, Anchor, ApprovalRequest, ApprovalEdit, RunEvent, RunError, ScrollPosition, ImapConfig`; enum tuples; `DEFAULT_BUDGET, EMPTY_USAGE, MODELS, DEFAULT_CONCURRENCY, EMBEDDING_DIMENSIONS` | Match (all exported; `schema.test` pg-enum sync passes) |
| 6 | 7 | DTO fields vs table columns (`RunSummary`, `NoteSummary`, `BenchmarkRunView`, `VaultAuditView`, `SettingsView`) | Match by name and type; not mechanically linked |
| 7 | 8 | table and column names used by `0002_triggers.sql` and `grants.sql` | Match (security and library int tests pass) |
| 8 | 8 (internal) | `syncBrowserSlots(sql: Sql, ...)` called with `tx: TransactionSql` | **Mismatch** (F8) |
| 8 | 13 | db root `index.ts` re-exports `migrate.ts`; web bundles `@mastertutor/db` | **Mismatch** (F2) |
| 8 | 9 | `startTestDatabase`, grants let `web_role` read `browser_slots` for the concurrency subselect | Match |
| 9 | 12, 13 | `getMaxConcurrency(db)`, `listBrowserSlots(db, names)`, `ensureWorkspaceMember(db, userId)`, `hasAnyUser(db)` | Match |
| 5 | 8, 10, 12, 13 | `MigrateEnv`, `GarageInitEnv`, `AgentEnv`, `WebEnv`, `parseEnv`, `createLogger` | Match |
| 5 | 14 | `deriveNekoPassword` vs bash `openssl dgst -sha256 -hmac -r`: vector `a35f74af...9ef6` | Match (Node, LibreSSL on macOS, and the n.eko login in verify.sh all agree) |
| 5 | 15 | env schemas vs compose `environment` per service | Match (compose-config test passes with `.env.test`) |
| 10 | 10 (internal) | `fakeGarage` auth assertion vs `waitForHealthy` unauthenticated `/health` | **Mismatch** (F4) |
| 10 | 11 | `bootstrapGarage`, `waitForGarageAdmin`, `startTestGarage` | Match |
| 10 | 15 | `GARAGE_ADMIN_URL=http://garage:3903`, config path `/etc/garage.toml`, `/garage status` healthcheck, `S3_WEB_*`/`S3_AGENT_*` env names | Match (smoke) |
| 3, 11 | 11 | `screenshotKey` max 1024 vs `isObjectKey` max 1024; `objectKeys.stepScreenshot` | Match |
| 11 | 12 | `createStorage(config)`, `storage.ping()` | Match |
| 12 | 14 | agent CDP by IP on `CDP_PROXY_PORT` 9223 vs slot `socat` 9223 and `/json/version` health | Match (smoke: probe-slot returns `Chrome/...`) |
| 12 | 15 | `node apps/agent/src/main.ts`, `AGENT_HEALTH_PORT=8787`, `probe-slot.ts` path in image | Match |
| 13 | 15 | `.next/standalone/apps/web/server.js`, `/healthz`, `BETTER_AUTH_URL` = `PUBLIC_URL` | Match (smoke), once F1 and F2 are fixed |
| 14 | 15 | required slot env (`SLOT_NAME, NEKO_ADMIN_SECRET, NEKO_MEMBER_SECRET, CDP_ALLOWED_IP, NEKO_ALLOWED_IPS`), `SLOT_EGRESS_ALLOW_CIDRS`, `NEKO_WEBRTC_*`, `cap_add`, seccomp path, tmpfs, `shm_size`, `/downloads` | Match (smoke; relative `seccomp=./...` works) |
| 15 | 15 (internal) | three services with the same `image` + `build` | **Mismatch** (F3) |
| 15 | 16 | `.env.test` `TEST_HTTP_PORT`, service names, overlay runs only `browser-1` vs smoke `count(browser_slots) = 1` | Match |
| 16 | 17 | CI job runs `bash scripts/compose-smoke.sh`; Task 17 interface says it consumes the `smoke` script | Harmless wording mismatch (the job has no pnpm) |
| 1, 15, 16 | 17 | root scripts `format:check, lint, typecheck, test, test:int`; `smoke` added in 16 | Match, but `format:check` fails (F7) |
| 4 | 1, 11 | uuid case (see D6) | Minor mismatch |

## Per-task rows

| Task | Self-consistent? | Notes |
|---|---|---|
| 1 | Yes | All tests pass. `.gitignore` replacement keeps the three existing entries. `git add` list covers every created file. `corepack` exists at `/opt/homebrew/bin/corepack`; fallback is fine. |
| 2 | Yes | Tests pass. |
| 3 | Yes | Tests pass, including full-width and zero-width labels and the `partialRecord` unknown-key rejections. |
| 4 | Yes | Tests pass (minor D6). |
| 5 | Yes | Tests pass. The neko vector and the key-name-only error check hold. |
| 6 | Yes | Tests pass. |
| 7 | **No** | F6 (typecheck error in its own test). `pnpm test -- packages/db` is unscoped (D3). 27 tables match the expected list. |
| 8 | **Mostly** | `drizzle-kit generate` yields 27 tables; all 32 db int tests pass. F8 (apply the fallback type by default); F2 (index export). |
| 9 | Yes | Race test passes (one owner, `concurrency` 2). |
| 10 | **No** | F4 (two unit tests time out), F5 (lint). Int test against real Garage v2.3.0 passes. |
| 11 | Yes | Keys and S3 tests pass (`keys.test`, `s3.test`, `s3.int`). D4/D6 minor. |
| 12 | Yes, after F8 | Tests pass; `env -i` boot check behaves as described. |
| 13 | **No** | F1, F2; D2. Int test (3 tests) passes and `tsc` is clean once F1 is fixed. |
| 14 | Yes, with one vacuous check | `build-profile.test` passes; the profile has 35 `SCMP_ACT_ALLOW` entries (plan expects about 30 or more); `verify.sh` passes; D1; D7. The `git add apps/browser-slot` list includes generated `chromium.json` as intended. |
| 15 | **No** | F3, F7. Compose-config tests (6) pass; the `.env.test` values satisfy every contract. `git add` list excludes files that `pnpm format` would touch (F7). |
| 16 | Yes, after F3 | All 13 checks pass. D5. |
| 17 | Yes, after F7 | `pnpm audit` currently passes; it needs network and can start failing later without any code change. The `compose-smoke` job needs no pnpm or node. |

## Environment hazards (macOS arm64, Docker Desktop 28.5.1)

| Item | Status |
|---|---|
| `sysctl kernel.apparmor_restrict_unprivileged_userns=0` | Linux only. Not needed here (the sandbox check passes under the custom seccomp profile). Correctly confined to the CI job and the "Linux host" notes. No action. |
| iptables inside the slot on Docker Desktop | Works: ingress by IP, private egress REJECT, DNS and internet kept (`verify.sh`, `smoke`). |
| seccomp profile path | The moby profile URL (`moby/profiles seccomp/v0.2.4`) returns 200. `docker compose config` keeps `seccomp=./apps/browser-slot/seccomp/chromium.json` and the stack starts, so the relative path resolves from the compose file. |
| `--ip` and static IPs on networks | Work: verify.sh (172.30.239.x, `--internal`) and compose `cdp` .10/.11/.12 with `ip_range` .128/25. No overlap with existing Docker networks (`bridge` 172.17, `yummi_default` 172.18). |
| n.eko image architecture | `ghcr.io/m1k1o/neko/chromium:3.1.6` is already pulled and is aarch64, Debian 13. `curl, openssl, pgrep, pkill, xdotool, bash` are present; `socat` and `iptables` are installed by the plan's Dockerfile. Chromium's sandbox is on (renderer in its own user namespace). |
| containerd image store | F3: duplicate `build:` for one tag fails. |
| pnpm not installed | `corepack enable pnpm` should work (Homebrew path is user-writable); `npm i -g pnpm@10.34.6` is the plan's fallback. `npx -y pnpm@10.34.6` also worked. |
| macOS bash 3.2 and LibreSSL | `verify.sh` and `compose-smoke.sh` run fine on bash 3.2.57; LibreSSL's `openssl dgst -sha256 -hmac -r` gives the same digest as Node. |
| Testcontainers | Works with no `DOCKER_HOST` set; Postgres, Garage and Ryuk pulled without changes. |
| Disk | `df /` shows 72 GiB free, more than the plan's 19 GB. The plan's `docker builder prune -f` and `docker image prune -f` also remove the user's other build cache and dangling images (a `yummi-*` stack is present). Harmless but worth knowing. A `yummi-brain-web` container publishes 8787 and 5433 on the host; no clash with 18080 or 5900x. |
| Image pulls not cached | `traefik:v3.7.13`, `busybox:1.37`, `curlimages/curl:8.22.0` all exist and pulled on first use. The Garage image is 93 MB (plan says about 20 MB). |
| `.DS_Store` | An untracked `.DS_Store` already exists at the repo root. `git add <dir>` in later tasks can stage nested ones. Add `.DS_Store` to the Task 1 `.gitignore`. |
| Existing root `.env` | Present (182 bytes, git-ignored). `pnpm env:init` is additive and Compose uses `--env-file .env.test`, so it is not read or overwritten. |

## Spec cross-check (§3, §4, §13, §16)

- §3.1 networks, ports, roles, secrets, N=6 slot anchor, `BROWSER_SLOTS`, concurrency boot check, web read-only and agent read/write Garage keys: all present. Confirmed by the compose-config test and the smoke run.
- §3.2 "DB types re-exported through contracts": deliberately not done, recorded in the plan as a deviation (cycle).
- §4 tables: all 25 spec tables plus `benchmarks` and `benchmark_runs` are present (27 in total); constraints (folders unique, depth 8, no cycles, audit append-only, wait-reason check) pass their int tests. Only deviation: D8.
- §13 and §16 Phase 0: stack boots healthy and slot CDP is reachable only from `agent`. Confirmed by `smoke` once F3 is fixed. Traefik exists only in the test overlay by design (plan note 4).
- Not in Phase 0 and recorded: docling, coturn, PulseAudio ACL (B4), per-slot live routers (B6).
