---
run_id: 2026-10-09-01-research-observer-integration-map
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

## Observer integration map (branch `agentic-notes-browser-agent` @ 1625e81, plus `obs-b`/`obs-c`)

I read the code directly and wrote no files. Line numbers below are for the current branch unless a file is marked `obs-b:`.

---

### 0. Facts that shape the whole design

1. **`obs-b` already contains `obs-c`.** `git merge-base --is-ancestor obs-c obs-b` returns true. `obs-b` (77642a7) has merged main and renamed alerts to **`0014_alerts.sql`**. `obs-c` on its own still has **`0013_alerts.sql`**, which clashes with main's `0013_run_titles`. Merge `obs-b`, not `obs-c`. **The Observer migration is therefore 0015.**
2. **`isPersonDecider` works by exclusion** (`packages/contracts/src/approval.ts:144-146`). Any `decided_by` that is not `policy` or `bypass` counts as a person. If an Observer decider (for example `"observer"`) were written without changing this, it would silently get a person's powers:
   - a lasting vault grant (`apps/agent/src/vault/grants.ts:36`);
   - filling an off-origin credential form (`vault/fill.ts:296`);
   - typing into an incompletely guarded page (`run-loop.ts:1026-1031`).

   `deciderOf` has the same flaw (`packages/telemetry/src/record.ts:24-28`): it would count Observer decisions as `"person"`. The vault `CHECK` constraints are lists too: `packages/db/src/schema/vault.ts:67`, `packages/db/src/queries/vault.ts:521`, and migration `0006`. **This is the single biggest risk.**
3. **The `observability` package is deliberately never imported by a running service.** That rule is in the spec (§4.3) and enforced by `packages/telemetry/src/boundaries.test.ts:22-26`. Reusing its OpenObserve client or `o2Paths.search` in web means amending that rule.
4. **OpenObserve OSS has no least-privilege roles.** `obs-b:packages/observability/src/o2-api.ts`: "custom roles not allowed", and `O2_ROLES` are all `admin`. A Copilot can never be handed the OpenObserve credential. Least privilege has to come from a server-side query proxy that only runs fixed query templates.
5. **The web image has no source code** (Dockerfile stage `web` copies `.next/standalone` only). `.dockerignore` excludes `docs`, `orchestration`, `*.md`, `.env*` and `.git`. "Read-only code access" for the Copilot needs a build-time artefact.

---

### 1. Agent pipeline seams, where a Guard verdict can gate a step

Phases live in `apps/agent/src/loop/run-loop.ts`. Each phase is one `run_steps` row and one `mt.step` span.

| # | Seam | File:line | Data available with no secrets | Fit for the Guard |
|---|---|---|---|---|
| G0 | `RunLoop.step()` dispatcher (Seam 1) | `run-loop.ts:307-320` | phase, run id, `#run` (`approvalMode`, `toolProfile`, `budget`, `usage`, `allowedOrigins`, `plan`) | **Step-boundary hook for async verdicts.** It follows the run-title pattern: `#requestTitle` (342) runs off-path, `#commitTitle` (358) applies the result at the next `step()`. A late Guard "pause" lands here and turns into a run-level ask. |
| G1 | `#observe` | `run-loop.ts:490-523` | `Observation` (`loop/loop-browser.ts:21-33`): origin, `domHash`, phash, captcha, signIn, scroll, `screenshot.withheld`/`masked` count, loop-detector verdict, budget-exceeded | Existing pauses (captcha, signIn, stuck, budget). A Guard pause slots in beside them. **Exclude** `url` (it can carry tokens; use origin), `title` (page text) and the PNG. |
| G2 | `#decide` commit | `run-loop.ts:565-728` (commit 688) | parsed calls: tool names, action *types*, call count, `turn.status`, `needHuman`, model, usage delta, fallback | Records only. **Exclude** `turn.reason`, `planUpdate`, `describeCall().summary` and typed `text` (all model output, possibly page-derived). |
| **G3** | **`#approve` decision point** | `run-loop.ts:828-907`; decision at **852-856**: `toPerson ? "ask" : safetyChecks ? decideSafetyChecks(...) : decideByPolicy(mode, kind)` | `RiskyItem` (139-152): request kind, item id, safety-check *codes*, target path; `originAllowed`, `approvalMode` | **The primary gate.** Combine as `final = mostRestrictive(policy, guard)`. The Guard may only escalate (approved→ask, or anything→denied) and never relax. That keeps D44 true by construction. |
| G3a | `#riskyItems` classifier | `run-loop.ts:753-826` | Each risky item. Function calls go through `browser.functionApproval` (vault `fillApproval`, `vault/fill.ts:104-129`) | Only *risky* items reach G3. To gate a non-risky action (for example a Guard-flagged plain click), the Guard needs its own item and request kind (§3). |
| G4 | Policy-only decisions in act | new_origin `run-loop.ts:1179-1225` (decision 1187); download `1227-1253` (decision 1230); `#recordPolicy` 954 | blocked origin, `downloadUrlForCard` (scrubbed) | Same `mostRestrictive` wrapper. In bypass the new-origin branch also *navigates* (1205-1213), so it should go through the Guard. |
| G5 | Execution-time gate (TOCTOU), the click guard | `#perform` gate `run-loop.ts:998-1037`; `ActionGate`/`GateVerdict` `tools/computer.ts:24-36`; `armClickGuard`/`armTypingGuard` `browser/input-guard.ts:235-248`; refusals `UNGUARDED_CLICK_REFUSAL`/`UNRESPONSIVE_REFUSAL` → `#personNext` (1043) | live `TargetDescription` (`browser/page-helpers.ts:5-45`): tag, path, `formKind`, `isFormSubmit`, `isSecretField`, `opaqueFrame`, `download` | **Do not add a model call here** (it runs per action, inside the click guard's 250 ms arm budget, `input-guard.ts:7`). It only enforces verdicts already bound at G3, re-checked by kind, label, path and context, as approvals are today. **Exclude** `label`, `excerpt`, `ancestors` and `context` (page text; `context` becomes a digest only). |
| G6 | Function-tool approval mapping | `run-loop.ts:1086-1097` | decision `kind` and `decidedBy` | This already maps `BYPASS_DECIDER` to `POLICY_DECIDER` before tools see it. An Observer decider needs the same mapping (or the general fix in §0.2). |
| G7 | `resume()` after a decision | `run-loop.ts:1296-1462` | pending approval, decision row | A Guard request kind needs its own branch, like budget (1341), download (1375) and new_origin (1398), unless it is item-bound and falls through to the generic item path (1419-1460). |

**Hard invariants that must stay independent of any Guard verdict.** None of these consult the approval mode today, so the Guard cannot loosen them; leave them that way.
- **Secret screen (local, exact match, no model):**
  - `MaskSources` (`browser/masking.ts:17-62`), `containsSecret`/`redactDeep` (64-79);
  - pixel screen `screenPixels`/`screenLines` (`browser/pixel-screen.ts:209, 369`), `screened()` (`browser/screenshot.ts:131-152`), `pixelsAreClean` (`browser/local-ocr.ts:151`).
  - The Guard should see only the *outcome*: `screenshot.withheld` and the `masked` count. It must never be handed `MaskSources`.
- **Vault fill pinning:** `fillCredential` (`vault/fill.ts:231+`) refuses `origin_mismatch` and `frame_mismatch`, and an off-origin `postsTo` needs a person's approval of a card naming that destination (`fill.ts:285-302`).
- **Network policy:** `installNetworkPolicy` (`browser/network-policy.ts:203-277`). The allowlist is read through `options.allowedOrigins()`; private and SSRF ranges are always blocked.
- **Kill switch, takeover and control lock:** `ControlGuard.assertAgent` (`browser/guard.ts:36-40`), `#assertAgentControl` (`run-loop.ts:736-742`).
- **Safety checks:** `decideSafetyChecks` (`approval.ts:167-181`). `malicious_instructions` always waits for a person.

**Where to inject.** The composition root is `apps/agent/src/main.ts:85-93`. It already injects `titler: createRunTitler(openai)` through `Supervisor` (`loop/supervisor.ts:39,196`) → `RunWorker` (`worker.ts:46,253`) → `RunLoopDeps` (`run-loop.ts:117-133`). Add an optional `guard?: StepGuard` to `RunLoopDeps` the same way. Without it, the guard is a no-op, matching today's behaviour. `RunHooks` (`loop/hooks.ts`) is the wrong place: it is per-phase extension points with single-owner rules.

---

### 2. Run events, step store, SSE and approval cards: how a verdict reaches the person

- **Write path:** `StepStore.commit` (`loop/step-store.ts:154-167`, Seam 5) → `emitRunEvents` → `emitRunEvent` (`packages/db/src/queries/events.ts:24-39`). The latter inserts `run_events`, calls `pg_notify('run_event')` and `recordRunEvent` (Seam 6).
- **SSE:** `apps/web/lib/server/runs/event-stream.ts:73+` (LISTEN `run_event`). The contracts are `packages/contracts/src/run-stream.ts` and `events.ts:37-129`.
- **Cards:** web `apps/web/components/run/approval/approval-sheet.tsx` and `model/approval-copy.ts:80,116` (switch on `request.kind`).
- **A person's decision:** `decideRunApproval` (`apps/web/lib/server/runs/service.ts:249-297`). It already refuses non-person actors via `isPersonDecider` (254).

**Recommended surfacing** (reuse rather than a parallel channel):
- **Item-level block or hold** (G3/G4): the run asks a person through the existing `#ask` (`run-loop.ts:909-951`). The request carries a Guard reason *code*.
- **Run-level pause** (G0/G1): `#ask` with `item: null`, like budget and new_origin.
- **Advisory, no pause:** a new `RunEvent` type, for example `{type:"guard", verdict, code}`. It shows on the timeline and is counted by `recordRunEvent`.

Each path needs these edits:
- `ApprovalKind` additions (`enums.ts:51-58`) make the compiler force edits to `AUTO_MODE_DECISIONS`/`BYPASS_DECISIONS` (`approval.ts:107-132`; both should be `"ask"` for a Guard kind), `riskOf` (`run-loop.ts:181-190`) and web `approval-copy.ts`.
- The Postgres enum `approval_kind` (`0001_init.sql:1`) needs `ALTER TYPE ... ADD VALUE`, as in `0004_approval_mode_bypass.sql`.
- A new `RunEvent` variant goes in `events.ts:37-128`, the `RUN_EVENT_TYPES` list, `recordRunEvent` (`record.ts:39-93`), and the web stream model `components/run/model/run-model.ts`.
- Telemetry: `APPROVAL_DECIDERS` (`contracts/src/telemetry.ts:91`) gains `"observer"`, and `deciderOf` maps it explicitly.

---

### 3. Telemetry (Track A): in-process versus stream, with latency

The package is `packages/telemetry`. Its public surface is `instrument()` (`src/instrument.ts:84-116`), `record*` (`src/record.ts`), and names in `packages/contracts/src/telemetry.ts` (SPAN 25-33, ATTR 36-77, METRIC 234-382). The allowlist is `EXPORTABLE_ATTRIBUTES` (185) plus `LOG_FIELDS` (195), enforced by `AllowlistSpanExporter` (`src/allowlist.ts`).

**The `instrument()` seams.** The task said eight; the spec §7.3 table lists ten (9 and 10 are web). In code:
1. `run-loop.ts:307` `mt.step`
2. `run-loop.ts:975` `mt.tool` (computer)
3. `tools/registry.ts:57-63` `mt.tool` (function)
4. `llm/caller.ts:91-112` `mt.model.request`
5. `step-store.ts:154-167` `mt.step.commit` plus `recordSpend`/`recordRunFailure`
6. `db/queries/events.ts:36` `recordRunEvent`
7. `slots/pool.ts:113-115` `mt.slot.reset`
8. `loop/worker.ts:324-348` `mt.takeover`

**Paths a Guard could consume, and their cost:**

| Path | Latency | Loss | Verdict |
|---|---|---|---|
| **In-process, synchronous** (the `RiskyItem` and `Observation` the loop already holds, at G3 and G1) | Microseconds for rules; one model call adds about 1-5 s (judged from caller retries and backoff) | none | **The only path that may gate.** |
| In-process, async off-path (title pattern; applied at the next `step()`) | 0 on the hot path; the verdict lands a step or more later | none | Model-based "pause the run" advisories |
| DB `LISTEN run_event` (as the SSE route does) | ms after commit | none | Good for an out-of-process Guard worker; cannot stop a step that is already running |
| OTel stream → Collector → OpenObserve | SDK batch 2 s (`processors.ts:19`), collector `batch` timeout 2 s, `tail_sampling decision_wait: 20s` (`obs-b:infra/otel/collector.yaml:27-30, 90-91`), spanmetrics flush 30 s, gauges 30 s | **Lossy by design**: bounded queue drops (`queue_full`), tail-sampling baseline drops. The agent is not on the `observe` network, only `telemetry` | **Never for gating.** Copilot and retrospective analysis only. |

**Telemetry for the Guard itself.** Add `SPAN.guard = "mt.guard"` with ATTR `mt.guard.verdict`, `mt.guard.code` and `mt.guard.mode` (enums only). Add it to the spanmetrics dimensions (`SPANMETRIC_DIMENSIONS`, 390-401). The collector-YAML pin test then forces the collector config to be updated too.

---

### 4. OpenAI wrapper, MODELS, budget and spend attribution

- **Single factory:** `createOpenAI` and `statelessParams` (`packages/contracts/src/server/openai.ts:45-51, 137+`). `store:false` is forced and identifiers are stripped. ESLint bans every other `openai` import (`eslint.config.js:91-105, 158-161`).
  - Agent client: `apps/agent/src/llm/openai.ts` → `main.ts:37`.
  - Web client: `apps/web/lib/server/openai.ts` ("query embeddings only", D36).
- **`MODELS`:** `packages/contracts/src/constants.ts:5-16` (`agentPrimary`, `agentFallback`, `filing`, `runTitle`, `transcription`, `embeddings`). Add `observerGuard` and `observerCopilot` here, probably `gpt-6-luna` for the Guard.
- **Pattern to copy:** `createRunTitler` (`apps/agent/src/llm/run-title.ts:62-83`). It uses `responses.parse` with a zod schema, `maxOutputTokens`, `AbortSignal.timeout`, `untrustedText` on output, and returns `{usage}`.
- **Pricing gap:** `MODEL_PRICES` (`apps/agent/src/llm/pricing.ts:21-36`) holds only the two agent models. Every other model falls back to astra's price (luna titles are over-charged). It also lives in `apps/agent`, so web (the Copilot) cannot use it. **Move pricing to `packages/contracts` (one source of truth, principle 6) before the Copilot charges spend.**
- **Spend attribution:**
  - **Guard:** charge the run, like the title. `addUsage` into `#run.usage` at a step boundary (`run-loop.ts:358-369`) → StepStore → `recordSpend` (`step-store.ts:158-161`). It then counts toward the run budget and the D46 $500 cap.
  - **Copilot:** there is no run. `recordSpend` feeds `mt.spend.usd`, which has no dimensions (`telemetry.ts:333-339`), and the `spend_jump` alert reads it. Either add a `mt.spend.source` dimension (run | guard | copilot) or a separate counter, plus a DB ledger and cap for Copilot spend (§5).
- **D36/D38 decisions to put to the user:** web's OpenAI use grows beyond query embeddings, and Copilot prompts must carry metadata only (no goal text or page text; reuse `redactForTitle`-style scrubbing in `contracts/src/run-title.ts`).

---

### 5. Postgres: an `observer` role

- **Today:** `packages/db/sql/grants.sql` is re-applied on every migration (`packages/db/src/migrate.ts:20-37`). It creates `web_role` and `agent_role` and uses a **deny-list loop over `public`** (23-32), so new public tables are granted to both automatically. Existing column-level read patterns to copy: `vault_secrets`, `otp_codes` and `browser_sessions` column `SELECT` for web (40-44), and `session(user_id, expires_at)` for the agent (47). `obs-b` adds `alerts` and `push_subscriptions` to the agent's exclusion list.
- **Proposal: migration `0015_observer.sql`.**
  - Create schema `observer` with `security_barrier` views exposing derived, safe columns only.
  - `observer_role` is `NOLOGIN` in `grants.sql`, given LOGIN with a password in `migrate.ts` like the others (a new `OBSERVER_DB_PASSWORD` through `DbPassword`, `env:init` and `scripts/deploy/check-env.ts`).
  - Grants: `GRANT USAGE ON SCHEMA observer` and `SELECT` on its views only; no `public` usage.
  - `ALTER ROLE observer_role SET default_transaction_read_only = on, statement_timeout = '5s'`.
  - Because the views live outside `public`, the deny-list loop never touches them.
- **Views (allow-list):**
  - `runs` → id, workspace_id, status, wait_reason, controller, approval_mode, tool_profile, model, budget, usage, slot_name, last_activity_at, `error->>'code'`, finished_at, created_at.
  - `run_steps` → run_id, seq, phase, state, usage, created_at.
  - `approvals` → id, run_id, step_seq, kind, status, decider *class* (CASE policy/bypass/observer/agent/person), decided_at, created_at.
  - `run_events` → id, run_id, type, created_at.
  - `browser_slots` → name, state, restarted_at.
  - `downloads` → run_id, bytes, pending, by_user, kept_at, discarded_at.
  - `alerts` → rule, fired_at, acknowledged_at.
- **Must stay excluded:**
  - vault: `vault_items`, `vault_secrets`, `vault_grants`, `vault_audit`, `otp_codes`;
  - sessions and auth: `browser_sessions`, `user`, `session`, `account`, `verification`, `push_subscriptions`;
  - `run_transcript`;
  - page text: `notes`, `note_blocks`, `sources`, `assets`;
  - from `runs`: goal, title, plan, current_url, previous_response_id, `allowed_origins` (decide whether origins count as metadata);
  - from `run_steps`: action, result, caption, url, screenshot_key;
  - from `approvals`: request, edit, raw decided_by (user ids);
  - `run_events.payload`.
- **Optional Guard state** (if verdicts are stored beyond `approvals` and `run_events`): put a `guard_verdicts` or `copilot_usage` table in 0015 too. It inherits the deny-list grants automatically, so check it is not over-granted.
- **Who connects as `observer_role`:** web's Copilot API only, with a second `postgres()` pool. The agent's Guard needs no new role: it works in-process on loop data and writes through the existing StepStore as `agent_role`.

---

### 6. Web app and `/observability` (Track C, in `obs-b`)

- **Owner gate:**
  - `isSignedInOwner` → `isOwnerSignedIn` (`obs-b:apps/web/lib/server/observability/access.ts`);
  - `decideObservability` (`authorize.ts`) and the `ownerScoped` oRPC middleware (`obs-b:apps/web/lib/server/rpc/owner-scope.ts`);
  - the hand-off route `obs-b:apps/web/app/observability/route.ts` (signed one-minute ticket);
  - OpenObserve on `obs.<DOMAIN>` (`observabilityOrigin`, `observabilityRouterRule` in `obs-b:packages/contracts/src/observability.ts`), with the `mt_obs_session` cookie scoped to that host only.
- **Network:** web is on `observe` (`obs-b:compose.yml:174-180`), so it can reach `http://openobserve:5080/observability`. The agent is not.
- **Copilot placement:**
  - **API:** an owner-only oRPC namespace `copilot.*` in `packages/contracts/src/api/contract.ts`, mirroring how `obs-b` adds `alerts.*`. Handlers in `apps/web/lib/server/rpc/copilot.ts` use `ownerScoped`.
  - **Streaming answers:** a route handler `apps/web/app/api/copilot/route.ts` (SSE, like `runs/event-stream.ts`), with the same owner check.
  - **UI:** on the *app* host, for example `apps/web/app/(app)/settings/observability/` or a panel next to "Open dashboards". Do not inject it into OpenObserve's UI on `obs.<DOMAIN>`: that is a separate origin with admin-equivalent scripts.
  - **Alerts:** the Copilot can read `alerts` (owner rows) and offer "explain this alert" from `obs-b:components/alerts/alerts-view.tsx`. Push payloads stay fixed labels only (`contracts/src/alerts.ts:81-95`). The Copilot must never write into a push.

---

### 7. Package placement and dependency edges (no cycles)

```
contracts (leaf) ◀── observer-contracts live HERE: packages/contracts/src/observer.ts
   ▲    ▲     ▲
telemetry  storage  observability(provisioning; + read-only query templates?)
   ▲
  db ──▶ contracts, telemetry/record
   ▲
packages/observer  ──▶ contracts only (pure: rules, verdict combiner, input scrubber, prompt builders)
   ▲                ▲
apps/agent           apps/web (server only)
 (Guard adapter:      (Copilot: tools over observer_role DB pool,
  guardrails/observer.ts, OpenObserve query proxy, code index; LLM via
  LLM via agent openai)  web openai)
```

- **`packages/observer`** imports `contracts` (and `zod`) only.
  - It contains no DB, no OpenAI and no OTel. Adapters live in the apps, so the boundary stays swappable (principle 5).
  - Add a `boundaries.test.ts` case: "observer imports only contracts and zod".
  - Its tests can import `@mastertutor/contracts/testing`.
- **Agent adapter:** `apps/agent/src/guardrails/observer.ts`, beside `budget.ts`, `loop-detector.ts` and `policy.ts`. It builds `GuardInput` from `RiskyItem` and `Observation`, then calls the pure rules plus an optional async model judge (via `StatelessOpenAI.responses.parse`).
- **Copilot server code:** `apps/web/lib/server/copilot/*`.
  - DB queries belong in `packages/db/src/queries/observer.ts`, reading the views. db already depends on contracts and telemetry, so there is no cycle.
  - OpenObserve queries: either (a) move `o2Paths.search`/`promQuery` and the client into a small runtime-safe module and lift the "never imported by a running service" rule for web only, or (b) duplicate nothing and add a `@mastertutor/observability/query` export. Both need an explicit spec amendment.
- **Do not** put Observer logic in `contracts/approval.ts` beyond a pure combiner. `decideByPolicy` stays the policy and unchanged.

---

### 8. New contracts needed (all in `packages/contracts`)

1. **`observer.ts`.**
   - `GuardInput`: a strict zod object. It holds run id, phase, approval mode, tool profile, origin (not URL), item kind, action *types*, function tool name, safety-check *codes*, `TargetDescription` flags (`formKind`, `isFormSubmit`, `isSecretField`, `opaqueFrame`, has-download), screenshot withheld/masked, loop-detector state, and usage/budget ratios. **No labels, excerpts, args, typed text, URLs or titles.**
   - `GuardVerdict = {decision: "allow"|"hold"|"deny", code: GuardCode}`, where `GuardCode` is an enum (it doubles as the telemetry and error code).
   - `GUARD_MODES` (off | advise | enforce), set per run or per workspace setting.
2. **`approval.ts`.**
   - `OBSERVER_DECIDER = "observer"`.
   - Rewrite `isPersonDecider` as an allow-check: `UserId.safeParse(decidedBy).success`, or an explicit exclusion of `{policy, bypass, observer, agent}`.
   - A pure `restrict(policy: PolicyDecision, guard: GuardVerdict): PolicyDecision` that never returns a looser result than `policy`.
3. **`enums.ts`.** Either a new `ApprovalKind` `"guard_hold"` (run-level or item-level, `"ask"` in every mode table) or reuse existing kinds with a guard flag on the request. A new kind is cleaner for cards and telemetry.
4. **`events.ts`.** A `RunEvent` `{type:"guard", decision, code}` for advisories.
5. **`telemetry.ts`.** `SPAN.guard`, ATTR `mt.guard.*`, `"observer"` in `APPROVAL_DECIDERS`, and a spend-source dimension or a separate Copilot spend metric.
6. **`constants.ts`.** `MODELS.observerGuard` and `MODELS.observerCopilot`. Move model prices here.
7. **`api/contract.ts`.** A `copilot.*` namespace. `CopilotQuestion` is capped text; `CopilotAnswer` carries cited table, panel or file references.
8. **`env.ts`.** `OBSERVER_DB_PASSWORD` for web and migrate, plus Copilot limits.

---

### 9. Risks

- **Decider confusion:** see §0.2. Fix `isPersonDecider` and `deciderOf` first, add the vault `CHECK` value, and add tests. These must ship before any Observer decision row exists.
- **Hot-path latency:** a synchronous model call per step roughly doubles step time and cost. Keep G3 synchronous rules deterministic. Run the model judge async (title pattern), or only on risky items in `enforce` mode with a short timeout. On timeout, `ask` in `ask` mode (fail closed). In bypass mode it is still unresolved whether a Guard timeout should block; that needs a user decision.
- **Fail-closed versus D50 "telemetry never blocks".** The Guard is *not* telemetry. It must not read from the OTel pipeline, and a Guard failure must never break the run unless the user chose `enforce`.
- **Prompt injection into the Guard:** any page-derived string in `GuardInput` lets the page steer the Guard. The strict schema plus enums-only is the defence. Model output (reason, plan) is also untrusted.
- **Bypass semantics (D44):** the Guard may only tighten. A Guard hold in bypass mode is a new behaviour the user should confirm, especially for the D46 benchmark.
- **Coupling:** keep `decideByPolicy` pure and unchanged. Add the combiner and inject the Guard through `RunLoopDeps`, so tests can run without it.
- **Copilot data exposure:** OpenObserve credentials are admin-equivalent (§0.4). Logs carry `origin`, `alias` and `reason` fields (`LOG_FIELDS`). Decide whether vault aliases and origins may go to OpenAI.
- **Code index:** must exclude `.env*`, `orchestration/` and fixtures holding test credentials. Build it from `git ls-files` at image build with the same ignore rules. It also grows the web image.
- **Migration ordering:** 0014 is `obs-b`'s; `obs-c` alone is still at 0013. The `approval_kind` `ADD VALUE` cannot run inside a transaction block that also uses the new value. Keep it in its own statement and migration, as 0004 does.

---

### 10. Reuse; do not recreate

| Need | Reuse |
|---|---|
| Step-boundary async verdict | `#requestTitle`/`#commitTitle` (`run-loop.ts:342-369`) |
| Pausing for a person | `#ask` (909), `#wait` (418-431), `resume()` branches |
| Recording an automatic decision | `#recordPolicy` (954), `insertApprovals` (`loop/approvals.ts:58-82`) |
| Classification data | `RiskyItem`, `needsApproval` (`guardrails/policy.ts:36-90`), `TargetDescription` |
| Display-safe strings | `approvalExcerpt`, `downloadUrlForCard`, `cleanExcerpt` (`guardrails/policy.ts`), `untrustedText`/`wrapUntrusted` (`contracts/untrusted.ts`) |
| Secret handling | `MaskSources.redact`/`redactDeep`. Pass outcomes only; never re-detect secrets with a model |
| LLM call shape | `StatelessOpenAI.responses.parse` plus the `run-title.ts` template |
| Spans and metrics | `instrument()`, `record*`, `ATTR`/`SPAN`/`METRIC` registry, allowlist exporter |
| Events, SSE, cards | `emitRunEvent`, `run-stream.ts`, the SSE route, `approval-sheet.tsx`/`approval-copy.ts` |
| Owner gating | `ownerScoped`, `isSignedInOwner`, `decideObservability` (`obs-b`) |
| OpenObserve queries | `o2Paths.search`/`promQuery`, `createO2Client` (`obs-b:packages/observability`), behind fixed templates |
| Grants pattern | column-level grants in `grants.sql`, plus the `migrate.ts` LOGIN password flow and `DbPassword` |
| Boundary enforcement | `packages/telemetry/src/boundaries.test.ts`, ESLint `no-restricted-imports` blocks |
