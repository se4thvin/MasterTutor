# Phase 0 final whole-branch review (8e8152d..3448ce1)

Reviewer: final whole-branch seat. Read-only on the checkout.

Method: I reviewed in passes:
1. Infra: compose, slot image, Dockerfile, env.
2. Contracts.
3. DB: schema, migrations, grants and queries.
4. Storage, agent and web.
5. Cross-checks against the spec (§3, §4, §5.2, §9, §10, §12, §13) and the downstream plans (B1, B3, B6, Phase 7–10).

Verification I ran:
- `pnpm test`: 142/142 pass.
- `pnpm typecheck` and `pnpm lint`: clean.
- `drizzle-kit generate` into a temporary copy of `migrations/`: "No schema changes", so there is no drift between the schema and the migrations.
- Two scratch Postgres 17 experiments on column-grant upserts (results below).
- Inspection of the n.eko base image (uid, PulseAudio and home-directory contents).

## Strengths

- **Contracts are the single source.**
  - DB enums come from the contracts tuples (`schema/enums.ts`).
  - The slot-name CHECK reuses `SLOT_NAME_PATTERN.source`.
  - Every service env is a contracts schema, and `compose-config.int.test.ts` parses each service's real compose env through it.
  - `parseEnv` names keys and never values.
- **Secret placement matches spec §13 exactly.**
  - The test asserts value-based S3 key placement.
  - The slot unsets its raw n.eko secrets before `exec`.
  - `agent` runs as `node` with `cap_drop: ALL` and `no-new-privileges`.
- **Slot isolation has two layers.** Each side enforces it:
  - INPUT default-DROP with per-port source allow-lists;
  - OUTPUT REJECT for private and special ranges;
  - IPv6 closed twice;
  - `ip_range .128/25`, which keeps dynamic IPs off `.10`–`.12`.

  Slot-to-slot and slot-to-backend paths are blocked even if one side's rules are lost.
- **DB.**
  - Grants are idempotent, reapplied on every migrate inside one transaction, and backed by real-role integration tests.
  - `vault_audit` is append-only, enforced by grants plus UPDATE, DELETE and TRUNCATE triggers.
  - The folder depth and cycle trigger takes an advisory lock.
  - The first-owner race is closed with `pg_advisory_xact_lock`, and a concurrent test covers it.
- **Smoke probes are specific.** They accept exit codes 7 and 28, `ECONNREFUSED`, and getent exit 2, not "any failure".
- **The handoff notes for later phases are good**: CDP by IP, PulseAudio in B4, presigned URLs in B2, fixtures egress.

## Issues

### Critical

None.

### Important

**I1. Every slot restart wipes the shared `downloads` volume, including other slots' in-flight runs.**
- **Where:** `apps/browser-slot/bin/slot-entrypoint:100-101`, with `find /tmp/chromium-profile /downloads -mindepth 1 -delete`.
- **Why it happens:** `compose.yml:41-42` mounts one `downloads` volume into all six slots and `agent`, and spec §10.2.9 writes to `/downloads/<runId>/`.
- **Impact:**
  - Slots restart on every release (spec §5.2.5). Each release, sleep or crash of any slot deletes every other run's not-yet-uploaded download.
  - With concurrent runs this is data loss.
- **Contradictions:**
  - The D7 ruling: "shared downloads volume is not wiped by slot restart; B1/B6 delete /downloads/<runId>".
  - B1 plan Amendment C (`phase-b1-runtime-core.md:5602`), which assumes the volume survives.
- **How it slipped through:** Task 14 fix round 1 added the wipe to satisfy the Task 14 review. `verify.sh` runs one slot, so it cannot see the cross-slot effect. This is the cross-task collision.
- **Fix:**
  - Drop `/downloads` from the `find` on line 101. Keep the `mkdir` and `chown`.
  - Remove `/downloads` from the marker loop in `verify.sh:113,124`.
  - Rely on B1 Amendment C to delete `/downloads/<runId>` on release.
  - Alternative: give each slot its own volume (`downloads-N`), mounted at `/downloads` in the slot and at `/downloads/browser-N` in `agent`. Then the wipe stays safe and slots cannot see each other's files. That changes spec §10.2.9's path, so it needs a ruling.

**I2. `agent` cannot reach n.eko on 8080, but the agent-side `NekoLiveView` needs it.**
- **Where:** `compose.yml:22` sets `NEKO_ALLOWED_IPS: .11,.12`, and `slot-entrypoint:81-82` allows 8080 only from those IPs.
- **What needs it:**
  - Spec §10.1 puts `NekoLiveView` (give/take control, clipboard toggle) in `apps/agent/src/live`, using the admin member that only `agent` can derive.
  - The B6 plan's admin client calls `http://browser-N:8080` (`phase-b6-live-view.md:2116`).
- **Why tests won't catch it:** B6's test helper sets `NEKO_ALLOWED_IPS` equal to the agent IP (`:1810`), so the tests pass in isolation and break only in Compose.
- **Root cause:** spec §3.1 rule 3 ("Only web and Traefik may connect to 8080") contradicts §10.1.
- **Fix:**
  - Add `${CDP_SUBNET_PREFIX:-172.30.231}.10` to `NEKO_ALLOWED_IPS`.
  - Add a positive smoke probe: agent → `browser-1:8080/health` returns 200.
  - Amend spec §3.1 rule 3 to "agent, web and Traefik".

**I3 (plan, not code). The B6 plan replaces `slot-entrypoint` with a pre-fix copy, which would silently revert the Task 14 hardening.**
- **Where:** `phase-b6-live-view.md:1551-1625`, which says "replace the whole file".
- **What the copy drops:**
  - the INPUT default-DROP policy (it goes back to per-port DROP over ACCEPT);
  - the IPv6 sysctl and ip6tables closure;
  - the `SLOT_EGRESS_ALLOW_CIDRS` and mux-port validation;
  - the 192.0.0.0/24, 192.0.2.0/24, 198.18/15 and 240/4 REJECTs;
  - the `/home/neko` and `/tmp` wipes.
- **Fix:** before B6 runs, rewrite that step as a delta against the current file:
  - add TURN minting;
  - add port 9224;
  - set the `user` profile's `can_host` to false.

  Also check the B6 `verify.sh` replacement in the same way.

### Minor

- **M1. `NET_ADMIN` stays in the slot's bounding set after the iptables setup** (`compose.yml:31-32`). Root in a slot (supervisord) could flush the slot's rules or ARP-spoof `.10` on `cdp`. Hardening: exec supervisord through `setpriv --bounding-set=-net_admin,-net_raw` (or `capsh`). This needs a chained exploit, so it is low priority.
- **M2. Redaction misses some secret-bearing keys** (`packages/contracts/src/server/logger.ts:6-18`).
  - Missing keys: `apiKey`, `secretAccessKey`, `privateKey`, `DATABASE_URL`/`databaseUrl` and `adminToken`.
  - Redaction reaches only one level deep.
  - `*.code` (spec-mandated) also redacts `err.code`, so Postgres and `ECONNREFUSED` codes are hidden. That will hurt benchmark debugging. Consider redacting `otp`/`code` only under tool-args paths, and amend spec §9.
- **M3. `web` lacks `cap_drop: [ALL]` and `no-new-privileges`** (`compose.yml:117-158`). It is reachable from the internet; `agent` has both.
- **M4. The vault alias regex is hand-written in SQL** (`schema/vault.ts:29`), duplicating contracts `Alias`. The same goes for `folders_name_valid` versus `FolderName`. Reuse `.source`, as was done for slots (D4).
- **M5. A trap for B3:** `web_role` has no SELECT on `vault_secrets.sealed`, so `ON CONFLICT DO UPDATE SET sealed = excluded.sealed` fails with "permission denied" (verified on pg17). A parameter in `SET` works. B3's `putVaultSecret` already uses a parameter. Add a one-line comment in `grants.sql` so no one "simplifies" it to `excluded`.
- **M6. A one-slot test stack can never start a queued run** under spec §5.2.3 (one idle slot must remain). Phase 7 sets `BROWSER_SLOTS=browser-1,browser-2`. B1's slot integration tests must not use the Phase 0 overlay as is.
- **M7. `DEFAULT_SLOT_COUNT` is dead and a second source** (`constants.ts:15`). `parseBrowserSlots` is used only by its test.

## Triage of deferred minors

**Fix now (cheap, and later phases build on them):**
1. **Delete `DEFAULT_SLOT_COUNT`** (Task 1–6). It is dead, and B1 could pick the wrong source.
2. **Add negative tests for `strictSchemaProblems`** (Task 1–6): optional field, nested optional, `.default()`, non-object root. It is the only guard on the model-facing schemas B1 is about to use, and today nothing proves it can fail.
3. **Anchor the verify `--no-sandbox` pgrep** to `^/usr/lib/chromium/chromium` (Task 14). `verify.sh` is already being edited for I1, and line 89's non-vacuity check is currently vacuous because pgrep matches its own `sh -c`.
4. **Add a guard for the `grants.sql` deny-list** (Task 7–9): an integration assertion that `web_role` has no SELECT on any `bytea` column in `public`. It costs one query and turns plan note 8 into a test before B3.

**Fix before Phase 9 (deploy):**
- Garage key re-import when a secret is rotated under the same ID. Today the health check fails with a misleading cause.
- Pin CI actions to SHAs and set `persist-credentials: false`. Merging to main fires the Dokploy webhook.

**Leave deferred:**
- the EventId and `Count` duplicates;
- the env no-echo test breadth (Zod 4 messages carry no input);
- `browser-safety` lint gaps;
- the `embedPath` and `ReadPageResult.url` looseness;
- the folder lock on `NEW.workspace_id` only;
- the `rejects.toThrow()` message;
- logger header paths untested;
- the `REDACT_PATHS` tuple type;
- the unused `./migrate` subpath;
- origin-test breadth;
- the probe.test `expect` placement;
- verify's use of `SYS_PTRACE`;
- the seccomp doc and sha pin;
- `URLBlocklist` extras;
- loopback egress;
- `KEY=""` being treated as set;
- the smoke port-check strength;
- agent CRUD on `vault_*`.

## Benchmark-run notes (real-site login through the vault)

These are not blocking. The path is sound:
- Egress, DNS and IPv4 work; IPv6 is off.
- The vault origin is exact (D8), so `https://learn.zybooks.com` matches the main frame.
- Auto mode approves `credential_first_use` and `risky_click` but denies downloads (so I1 won't fire there).
- `PasswordManagerEnabled` is false.

Watch two things:
- `DefaultPopupsSetting: 2` blocks popup-based SSO. zyBooks uses email and password, so this is fine.
- Every release restarts the slot, so session reuse depends on the B3 `storageState` sealing.

## Declined to judge

- **Dokploy production topology:** Traefik joining `cdp` at `.12`, and `web` joining `dokploy-network`. That is B6/Phase 9 scope, and plan note 4 already flags it.
- **Presigned URLs pointing at `garage:3900`.** Plan note 5 already hands this to B2.
- **PulseAudio TCP 4713.** The base image loads only the unix socket (`/tmp/pulseaudio.socket`), so 4713 has no listener yet. Plan note 3 hands it to B4.
- **The `user` member's `can_host:true` while the agent is in control.** B6 changes the profile.
- **Raw n.eko secrets visible to root in a slot** through `docker exec` and healthcheck process env. This is inherent to spec §13's placement, and the Task 14 ruling accepted it.
- **Better Auth after-hook transaction semantics.** The C+D fix round's integration tests cover them, and I did not re-run integration tests.
- **The OpenAI strict-mode keyword subset.** B1 uses `zodResponsesFunction`.

## Assessment

**Ready to merge: with fixes.**
- **Code fixes:** I1 and I2 are each a line or two of code plus a test edit.
- **Plan amendment:** I3 must be amended before B6 is dispatched.
- **Deferred minors:** apply the four fix-now items in the same small round.

Otherwise the foundation is consistent across contracts, DB and env, the secrets are placed correctly, and the isolation claims hold in both directions.
