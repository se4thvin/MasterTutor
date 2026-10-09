# Observer Agent: Design Spec

_Decision D52 (`orchestration/STATE.md`), approved by the user. It builds on D34, D36–D39, D44 and D46–D50, which still apply in full. `CLAUDE.md` is binding. Primary inputs: the three research runs `orchestration/runs/2026-10-09-01-research-observer-integration-map/report.md` (cited as **[IM §n]**), `…-02-research-observer-copilot/report.md` (**[CP §n]**) and `…-03-research-observer-guard/report.md` (**[GD §n]**)._

**Plan:** `docs/superpowers/plans/2026-10-09-observer.md`.

**Prerequisite (met):** the observability branch `obs-b` (Tracks B and C of D50, which contains `obs-c`) is merged into `agentic-notes-browser-agent` (5614435). It brings migration `0014_alerts`, `packages/observability`, the owner gate (`ownerScoped`, `isOwnerSignedIn`, `memberRoleOf`), `isInternalRequest`, alerts, Web Push and OpenObserve on `obs.<DOMAIN>` [IM §0.1]. The Observer's migration is therefore **0015**.

## 1. Goal and scope

The Observer is a second AI role that watches the browser agent and answers the owner's questions about it. It has two roles built on one shared core:

- **Guard.** It lives inside the agent's run loop. It reviews risky or suspicious steps from metadata only, and it can only add friction: flag, ask a person, or block. It never approves anything.
- **Copilot.** It lives in a separate least-privilege service. The owner asks it questions about runs, spend, errors and alerts in a chat panel in the app. It answers from read-only, cited queries over Postgres views, OpenObserve and a code snapshot.

In scope:

- The decider allow-check fix that must land before any Observer decider exists (§4).
- The deterministic `data_egress` rule (§6.3).
- The Guard: triggers, two-stage review, monotone composition, deny-and-continue, shadow and enforce, the trajectory watcher, run-view surfacing, telemetry and alerts (§6).
- The Copilot: the `observer` service, migration 0015's role and views, fixed query templates, typed tools, citations, streaming, replay storage, caps, owner-only routing and the chat UI (§7).
- Evaluation: red-team fixtures, benign replay, a golden question set and regression gates (§9).

Out of scope:

- The optional local injection classifier (protectai deberta, Apache-2.0). D52 defers it to "later" [GD §4.5]. PromptGuard is ruled out by its licence.
- Injecting anything into OpenObserve's UI [CP §4.1 option A].
- Pointing a model at OpenObserve's MCP server [CP §1].
- Using Observer verdicts as training or reward signals [GD §2.1, Baker et al.].
- A "deep investigation" model toggle for the Copilot. YAGNI: one model, chosen by the spike.

## 2. Binding requirements (D52)

| # | Requirement |
|---|---|
| O1 | One shared core, `packages/observer`, whose only workspace dependency is `@mastertutor/contracts`, with two roles. Contracts live in `packages/contracts`. |
| O2 | `isPersonDecider` and `deciderOf` become allow-checks that accept user ids only, before any new decider exists. |
| O3 | Guard is in-agent and hybrid monotone: a deterministic trigger set, then a two-stage review (`gpt-6-luna` screen, a stronger model only on flags), plus an async trajectory watcher on the run event log. It never reads OTel. |
| O4 | Guard input is metadata only and reasoning-blind: no page text, no agent prose, no secrets. A redaction assertion runs before every send. |
| O5 | Verdicts are allow, flag, escalate or block, composed as `strictest(policy, guard)`. The Guard never approves. |
| O6 | Deny-and-continue. Escalate to a person after 3 consecutive or 20 total blocks. The synchronous gate fails closed; the watcher fails open. |
| O7 | Rollout: shadow on the first zyBooks run, then enforce. In enforce, escalations pause Bypass runs too. |
| O8 | Deterministic `data_egress` (data read on origin A sent to origin B) asks in Ask and Auto and **is auto-approved in Bypass**. |
| O9 | A person may override a Guard block in Ask mode. The override is audited. |
| O10 | Copilot: a chat panel in the app, plus "Ask about this run" and "Why did this alert fire". Its backend is a separate least-privilege `observer` service: a read-only `observer_role` over a dedicated view schema, fixed OpenObserve query templates through our proxy, a code snapshot, and no egress or write tools. |
| O11 | Copilot answers are cited. Charts are drawn from stored rows. Conversations are replayed statelessly (D37). Run goals and captions are sent only on a per-question opt-in. |
| O12 | Copilot daily cap of $3 by default. Prompt-cache retention is pinned to in-memory where the API supports it. |
| O13 | Every OpenAI call goes through the single wrapper with `store:false` (D38). No new OpenAI tool (D39). |

## 3. What already exists and is reused

| Existing item | Path | How the Observer uses it |
|---|---|---|
| Policy tables and decision functions | `packages/contracts/src/approval.ts` (`decideByPolicy`, `decideSafetyChecks`, `AUTO_MODE_DECISIONS`, `BYPASS_DECISIONS`, `policyDecider`) | Unchanged in shape and still the policy. Two new kinds are added to the tables. The Guard composes on top of their result [IM §7]. |
| Decider constants and the person check | `approval.ts` (`POLICY_DECIDER`, `BYPASS_DECIDER`, `isPersonDecider`), `packages/telemetry/src/record.ts` (`deciderOf`) | Rewritten as allow-checks (§4). |
| Risky-item classification | `apps/agent/src/guardrails/policy.ts` (`needsApproval`, `approvalRequestFor`, `approvalExcerpt`, `downloadUrlForCard`), `apps/agent/src/loop/run-loop.ts` (`#riskyItems`) | The trigger set is a superset of these results. `needsApproval` gains the `data_egress` need, so the approve phase and the execute-time gate classify identically. |
| The approve phase, asking and policy rows | `run-loop.ts` (`#approve`, `#ask`, `#recordPolicy`, `#applyDecision`, `resume`), `apps/agent/src/loop/approvals.ts` (`insertApprovals`, `ItemDecision`) | The Guard decision point is G3 [IM §1]. Holds use `#ask`. Blocks use `#applyDecision` and `insertApprovals` with `decided_by='observer'`. |
| Execute-time re-gating | `run-loop.ts` (`#perform` gate), `apps/agent/src/tools/computer.ts` (`ActionGate`) | Unchanged. The Guard never calls a model there (250 ms arm budget) [IM §1 G5]. It only enforces decisions bound at G3. |
| Off-path model call at a step boundary | `run-loop.ts` (`#requestTitle`, `#commitTitle`), `apps/agent/src/llm/run-title.ts` (`createRunTitler`) | The template for the reviewer (structured `responses.parse`, timeout, token cap, `untrustedText` on output) and for the watcher (async result applied at the next step). |
| Dependency injection path | `apps/agent/src/main.ts` → `loop/supervisor.ts` → `loop/worker.ts` → `RunLoopDeps` | A `guards` factory travels the same path as `titler` [IM §1]. |
| Secret screens | `apps/agent/src/browser/masking.ts` (`MaskSources.redact`, `containsSecret`) | The Guard's redaction assertion calls `redact` on the serialized input. It never re-detects secrets with a model. |
| Display-safe strings | `packages/contracts/src/untrusted.ts` (`untrustedText`, `wrapUntrusted`), `run-title.ts` (`redactForTitle`, `hostOf`) | The goal goes to the Guard through `redactForTitle`. Model rationale is cleaned with `untrustedText`. Copilot opt-in text is wrapped with `wrapUntrusted`. |
| The single OpenAI wrapper | `packages/contracts/src/server/openai.ts` (`createOpenAI`, `statelessParams`, `StatelessOpenAI`) | Gains `responses.stream`, an optional reasoning effort on `parse`, and the pinned prompt-cache retention. It is still the only `openai` import. |
| Pricing | `apps/agent/src/llm/pricing.ts` (`MODEL_PRICES`, `costUsd`, `TokenUsage`) | Moves to `packages/contracts/src/pricing.ts` as the single price table. Agent usage helpers stay in the agent and import it [IM §4]. |
| Telemetry | `packages/contracts/src/telemetry.ts` (`SPAN`, `ATTR`, `METRIC`), `packages/telemetry` (`instrument`, `record*`, allowlist exporter) | New `mt.observer.*` names and a `mt.spend.purpose` dimension. No second registry. |
| Events and SSE | `packages/contracts/src/events.ts` (`RunEvent`), `packages/db/src/queries/events.ts` (`emitRunEvent`), web `lib/server/runs/event-stream.ts` | A new `guard` RunEvent reaches the run view through the existing stream. The watcher reads the same events in process. |
| Approval cards and timeline | web `components/run/approval/approval-sheet.tsx`, `components/run/model/approval-copy.ts`, `timeline-items.ts`, `run-model.ts` | New card copy for `data_egress` and `observer`, and a timeline row for `guard`. |
| Owner gate | `obs-b`: `apps/web/lib/server/observability/access.ts` (`isOwnerSignedIn`), `lib/server/internal-request.ts` (`isInternalRequest`), `packages/contracts/src/observability.ts` (`internalWebHosts`, `webCdpOrigin`), `packages/db/src/queries/workspace.ts` (`memberRoleOf`) | The Copilot's ForwardAuth endpoint answers with the same owner check [CP §3.4]. |
| OpenObserve client and query paths | `obs-b`: `packages/observability/src/client.ts` (`createO2Client`, `O2Error`), `o2-api.ts` (`o2Paths`, `O2_FIELDS`), `names.ts` (`o2StreamName`, `o2Label`), `dashboards/catalog.ts` | Exposed to the observer service through a new runtime-safe subpath, `@mastertutor/observability/query`. Dashboard panel queries are the Copilot's few-shot examples [CP §2.1]. |
| Alerts | `obs-b`: `packages/contracts/src/alerts.ts` (`ALERT_RULES`, `ALERT_LABELS`), `packages/observability/src/alerts.ts` (`alertSpecs`), `components/alerts/alerts-view.tsx` | Two new rules. "Why did this fire?" is added to the alerts list. |
| Grants and roles | `packages/db/sql/grants.sql`, `packages/db/src/migrate.ts` (`runMigrations`, `DbPassword`) | `observer_role` is created there and gets its LOGIN password from migrate, like the other roles [IM §5]. |
| Markdown rendering | web `components/note/block-markdown.tsx` (`react-markdown` + `rehype-sanitize`) | The Copilot renderer uses the same libraries with a stricter schema: no images and allowlisted links only. |
| Same-origin write check | web `lib/server/rpc/same-origin.ts` (`isCrossSiteWrite`) | Moves to `packages/contracts/src/server/same-origin.ts`, so web and the observer service share it. |
| Fixtures and llm-mock | `tests/fixtures/sites`, `tests/fixtures/nginx.conf`, `tests/llm-mock/src` | Red-team pages, and mock answers for the Guard's structured calls. |
| Remote runner | `scripts/remote-test.sh`, `scripts/remote-test/run-on-host.sh` (D48) | Gains an `observer-eval` suite. Existing suites gain the regression gates. |

## 4. Prerequisite: deciders become allow-checks (Task 0)

**The flaw [IM §0.2].** `isPersonDecider` treats any `decided_by` that is not `policy` or `bypass` as a person. A new Observer decider would silently receive a person's powers:

- a lasting vault grant (`vault/grants.ts:36`);
- filling an off-origin credential form (`vault/fill.ts:296`);
- typing into an incompletely guarded page (`run-loop.ts:1026-1031`).

`deciderOf` has the same flaw. The flaw already bites today: the loop writes `decided_by='agent'` for superseded approvals, and the current check calls that a person.

**The fix.**

- `MACHINE_DECIDERS = ["policy", "bypass", "observer", "agent"]` is the one closed list of non-person deciders.
- A person decider must match `PERSON_ID_SOURCE = "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"`, the shape of Better Auth ids and of our test ids, and must not be a machine decider. `PersonDecider` is a branded zod type.
- `isPersonDecider(x)` is `PersonDecider.safeParse(x).success`. It is a type guard.
- `deciderClass(x)` returns `"person"`, the machine decider itself, or `"unknown"`. Telemetry's `deciderOf` delegates to it, so an unknown string is never counted as a person.
- **Typed writes.** `Decider = MachineDecider | PersonDecider`. `insertApprovals` and `markApprovalSuperseded` take a `Decider`, and the loop's `"agent"` literals become `AGENT_DECIDER`. A new machine decider therefore cannot be written without being added to `MACHINE_DECIDERS`, which excludes it from person powers by construction.
- **Function tools.** In `#perform`, any non-person decider reaches tools as `POLICY_DECIDER`, not only bypass [IM §1 G6].
- **Database.** In migration 0015:
  - `vault_grants_human_approver` becomes `approved_by ~ PERSON_ID_SOURCE AND approved_by NOT IN (MACHINE_DECIDERS)`, built from the same constants in `schema/vault.ts`;
  - a new `approvals_decided_by_ck` checks `decided_by IS NULL OR decided_by IN (MACHINE_DECIDERS) OR decided_by ~ PERSON_ID_SOURCE`;
  - the query `humanApprover` in `queries/vault.ts` uses the same pattern.

Task 0 lands first in the Foundation track, and the Foundation track merges before any Guard code writes `observer`.

## 5. Architecture

```
                          ┌───────────────────── agent ─────────────────────┐
  page ─▶ observe ─▶ decide ─▶ approve ───────────────▶ act ─▶ StepStore.commit ─▶ run_events
                               │  policy (unchanged)        ▲          │ onCommitted(events)
                               │  + data_egress rule        │          ▼
                               │  + Guard: triggers ─▶ review(luna ─▶ sol) ─▶ strictest()
                               │            ▲ metadata only, redaction assert   │
                               │            └─ TrajectoryWatcher (async) ◀──────┘ holds at next observe
                          └──────────────────────────────────────────────────┘
                                     │ OpenAI via the single wrapper (store:false)

  browser ─▶ Traefik ─▶ /api/observer/* ─ForwardAuth─▶ web /api/observer-auth (owner only)
                │                                     answers Bearer + x-mt-user/x-mt-workspace
                ▼
             observer service (apps/observer) ─┬─▶ Postgres as observer_role (schema observer: views + copilot tables)
               conversation loop, SSE          ├─▶ OpenObserve /_search, /query_range (fixed templates, copilot user)
               caps, replay, code index        ├─▶ OpenAI (single wrapper, responses.stream, store:false)
                                               └─▶ OTLP collector (its own spans and metrics)
```

### 5.1 Services and networks

| Service | Image | Profile | Networks | Ports | Secrets |
|---|---|---|---|---|---|
| `observer` (new) | `mastertutor/observer:local` (Dockerfile target `observer`) | `observability` | `observer-db` (new, internal), `observe`, `observe-edge` (prod: external `mastertutor-obs`), `telemetry`, `observer-egress` (new, non-internal, observer only) | none | `OBSERVER_DB_PASSWORD`, `OPENAI_API_KEY`, `OBSERVE_COPILOT_PASSWORD`, `OBSERVER_INTERNAL_TOKEN` |

- `postgres` joins `observer-db`. That is the observer's only route to the database, so it never reaches Garage, slots, the agent or web over `backend`.
- `observer-egress` exists only for `api.openai.com`.
- The observer holds no S3, vault, sealing, auth or n.eko secret. A new `prodModeProblems` rule asserts this.
- It is hardened like the agent: `read_only`, non-root, `cap_drop: [ALL]`, `no-new-privileges`, 256 MiB memory, 0.5 CPU, 64 pids.

### 5.2 Module dependency map (no cycles)

```
@mastertutor/contracts       leaf (zod, pino, openai only in server/openai.ts)
@mastertutor/observer        → contracts, zod, node:crypto   (pure core; subpaths ".", "./guard", "./copilot")
@mastertutor/telemetry       → contracts, @opentelemetry/*  (unchanged)
@mastertutor/observability   → contracts, zod  (provisioning; NEW runtime-safe subpath "./query")
@mastertutor/db              → contracts, telemetry/record  (NEW queries/observer.ts, queries/copilot.ts, queries/guard.ts)
apps/agent                   → contracts, db, storage, sealing, telemetry, observer/guard (NEW)
apps/observer (NEW)          → contracts, db, telemetry, observer/copilot, observability/query, @prometheus-io/lezer-promql
apps/web (server)            → contracts, db, storage, sealing, telemetry   (never imports observer or observability)
apps/web (client)            → contracts (Copilot DTOs, CopilotEvent)
```

Rules, enforced by `packages/telemetry/src/boundaries.test.ts` and ESLint `no-restricted-imports`:

- `packages/observer` imports only `.`, `node:`, `zod` and `@mastertutor/contracts`.
- `apps/agent` imports `@mastertutor/observer/guard` only, never `/copilot`.
- `apps/observer` imports `@mastertutor/observer/copilot` and the root, never `/guard`. Nothing imports `apps/observer`.
- `@mastertutor/observability` may be imported by a running service only through `./query`, and only by `apps/observer`. This amends the D50 rule "never imported by a running service" [IM §0.3] for one read-only subpath. Provisioning code stays unreachable from services.
- `apps/web` never imports `@mastertutor/observer` or `@mastertutor/observability`.

**Why the split.** Contracts hold the shared shapes: `GuardInput`, verdicts, `CopilotEvent`, names. The core holds pure, testable logic both roles use or that must not depend on a process: composition, triggers, provenance labels, prompts, catalog, handles and citations. Each process holds its own adapters: OpenAI calls, DB, OpenObserve and the loop. "Share data, schemas and safety primitives. Never share a runtime or a loop" [CP §5].

## 6. Guard

### 6.1 Placement

The Guard is hybrid [GD §3 option C]:

- **Synchronous gate** at the approve phase, G3 [IM §1], for triggered items only.
- **Run-level gate** at the act phase's new-origin and download branches, G4, where bypass would otherwise navigate or allow without asking.
- **Asynchronous trajectory watcher** that sets a hold. The hold is applied at the end of the next `observe`, before the model decides again.
- **Nothing at G5.** The click guard's 250 ms budget is untouched.

The Guard is injected through `RunLoopDeps.guard?: StepGuard`, built per run by a `StepGuardFactory` passed down `main.ts → Supervisor → RunWorker`. It is a loop dependency like the budget, not a `RunHooks` entry [GD §5.4]. Production boot (`boot-checks.ts`) asserts that a real factory is wired. Tests may omit it, and then the loop behaves exactly as today.

### 6.2 Trigger set (deterministic, `packages/observer/src/guard/triggers.ts`)

An item is reviewed when at least one of these trigger codes applies [GD §3]. Everything else skips the Guard: screenshot, scroll, wait, move, `read_page`, `capture`, `annotate`, `video`, and typing whose provenance is the goal or none.

| Trigger | When |
|---|---|
| `risky_item` | Any `RiskyItem`: `risky_click` (including safety-check items), `form_submit`, `download`, `credential_first_use`, `data_egress`; also `new_origin` and `download` at G4 |
| `vault_fill` | Any `fill_credential` or `use_passkey` call, even when a grant means no approval is needed |
| `data_egress` | Typed text whose provenance is `other_origin`, even when the destination is allowed (and so no `data_egress` approval is needed) |
| `first_actuation_off_allowlist` | The first click, double click, activating keypress or `type` on an origin outside `allowedOrigins` |
| `post_injection_window` | Any actuation within `POST_INJECTION_STEPS = 5` turns after a `malicious_instructions` safety check |
| `elevated_risk` | Any actuation while the watcher has raised the run's risk level |

### 6.3 Provenance and the `data_egress` rule

This is the deterministic layer (Option 4 of [GD §7]). It lives beside `needsApproval`.

- **What is recorded.** `ProvenanceStore` (`apps/agent/src/guardrails/provenance.ts`) keeps, per run and in memory, HMAC-SHA-256 (per-run random key) fingerprints of the 8-character shingles of every function-tool output the model received (`read_page`, `capture`, `video`, `annotate` results), keyed by the page origin at that time. It keeps the goal's shingles too.
- **How typed text is labelled.** `provenanceOf(text)` returns one of:
  - `none` for text under 16 characters;
  - `goal` when at least 50% of its shingles are in the goal;
  - `same_origin` or `other_origin` (with `sourceOrigin`) when at least 50% are in one origin's set;
  - `novel` otherwise.

  Fingerprints never leave the process and never reach telemetry.
- **The rule.** A `type` action whose text is `other_origin`, with source origin A, going to page origin B, where B ≠ A and B is not in `allowedOrigins`, needs approval of kind **`data_egress`**:
  - `AUTO_MODE_DECISIONS.data_egress = "ask"`;
  - `BYPASS_DECISIONS.data_egress = "approved"` (O8);
  - in Ask mode it asks.
- **One classifier for both gates.** `needsApproval(action, target, egress)` returns the `data_egress` need *before* any other need of the same action. The execute-time gate calls the same function, so approve and act agree (M10). `needLabel` for `data_egress` is `"<A> → <B>"`.
- **Known limit.** Provenance covers text tools only. Text the model read from screenshots alone is `novel`, and the Guard still sees `novel` typing on triggered items. URLs carrying page data to a *new* origin are already gated as `new_origin`: denied in Auto, asked in Ask, approved in Bypass. The Guard sees `destination.carriesQuery` on those.

### 6.4 `GuardInput` (metadata only, `packages/contracts/src/observer.ts`)

```ts
GuardInput = strictObject({
  goal: string ≤ 1000,                  // redactForTitle(run.goal): user-authored, trusted
  mode: ApprovalMode,
  allowedOrigins: Origin[] ≤ 10,
  page: { origin: Origin | null, inAllowed: boolean },
  items: GuardItem[] 1..20,
  run: { step, newOrigins, denials: { consecutive, total }, loopHits, injectionSignals, riskLevel: "normal"|"elevated" },
})
GuardItem = strictObject({
  key: "i1".."i20",                     // opaque; never a call id
  actionClass: click|type|keypress|navigate|download|vault_fill|passkey|submit|other,
  triggers: GuardTrigger[] ≥ 1,
  policyKind: ApprovalKind | null, policyDecision: approved|denied|ask|null,
  target: { role: link|button|input|select|textarea|frame|history|other, formKind, isFormSubmit,
            isSecretField, opaqueFrame, hasDownload, formPostsTo: Origin|null } | null,
  destination: { origin: Origin, inAllowed: boolean, carriesQuery: boolean } | null,
  sent: { provenance: none|goal|same_origin|other_origin|novel, sourceOrigin: Origin|null, chars } | null,
  vault: { alias: Alias, itemOrigin: Origin|null, firstUse: boolean } | null,
  safetyChecks: code[] ≤ 20 (each /^[a-z_]{1,64}$/),
})
```

- **Never included** [IM §1 G1/G2/G5, GD §3.3]:
  - labels, excerpts, ancestors, context or titles;
  - URLs (origins only);
  - typed text (only its provenance class and length);
  - `AgentTurn.reason`, `planUpdate` and `describeCall().summary`;
  - screenshots;
  - `MaskSources`.
- **The redaction assertion.** `buildGuardInput` produces the object, then `GuardInput.parse` runs. Then `assertRedacted(JSON.stringify(input), maskSources.redact)` checks the serialized form. If `redact` would change a single character, nothing is sent. The verdict becomes `escalate` with category `guard_unavailable`, and a `mt.observer.failures{outcome="redacted"}` is counted. This is the "if anything would be redacted, nothing is sent" rule [GD §0].

### 6.5 Two-stage review

`createGuardReviewer(openai)` (`apps/agent/src/guardrails/observer/reviewer.ts`) follows the `run-title.ts` template. It makes **one call per turn** covering all triggered items.

| Stage | Model (`MODELS`) | Output schema | Notes |
|---|---|---|---|
| Screen | `observerGuardScreen = "gpt-6-luna"` | `GuardScreen = { decision: "allow" \| "review" }` | Static instructions first (prompt-cache prefix). Reasoning effort as pinned by the spike. `max_output_tokens = 400`. Leans to `review` when unsure [GD §2.4]. |
| Review | `observerGuardReview = "gpt-6.1-sol"` | `GuardReview = { verdict, category, itemKeys ≤ 20, rationale ≤ 300 }` | Runs only when the screen says `review`. Its instructions share the screen's prefix, so the second call is mostly a cache hit. `max_output_tokens = 1200`. |

- **Time limit.** One `AbortSignal.timeout(GUARD_TIMEOUT_MS = 8_000)` covers both stages.
- **Fail closed.** A timeout, API error, parse failure or redaction trip yields `{ verdict: "escalate", category: "guard_unavailable" }` (O6). Unknown item keys are dropped. A non-allow verdict with no valid key applies to every reviewed item.
- **Cost.** Usage is charged to the run in the same commit as the approve step, so it counts toward the run budget and the D46 cap.
- **Untrusted output.** The rationale is model output. It is cleaned with `untrustedText(…, 300)`, shown only on the person's card, never sent to the agent and never put in telemetry.
- **Fixed denial text.** A denial never tells the agent why. The agent always gets `GUARD_BLOCKED_NOTE = "Blocked by the safety observer. Do not retry or work around it; choose a different approach or ask the user."` [GD §3.3].
- **No resampling.** The agent is never resampled on a flag [GD §2.1, Terekhov].

### 6.6 Composition (`packages/observer/src/guard/compose.ts`)

```
rank: approved < ask < denied
guardEffect(verdict, mode, rollout):
  rollout = shadow            → none
  allow | flag                → none
  escalate                    → ask             (every mode, Bypass included)
  block, mode = ask           → ask             (O9: a person may override, audited)
  block, mode ≠ ask           → deny
strictest(policy, effect) = max_rank(policy, effect)    (none adds nothing)
```

- **Proven monotone.** A `fast-check` property test asserts `rank(strictest(p, guardEffect(v, m, r))) ≥ rank(p)` for every policy decision, verdict, mode and rollout. A second test asserts the Guard path never yields `approved` where policy said `ask` or `denied`.
- **Hard invariants untouched.** `decideSafetyChecks` still runs first, and `malicious_instructions` still waits whatever the Guard says. The masking screens, vault origin pinning, network policy, kill switch and takeover never consult the Guard [IM §1].
- **What each outcome writes:**

| Final outcome | What the loop writes |
|---|---|
| unchanged | the usual policy row (`decided_by` = `policy` or `bypass`), or the usual ask |
| `ask` caused by the Guard | `#ask` with an `observer` request: `{ verdict, category, rationale, subject: <the item's own request or null>, url, screenshotKey }` |
| `deny` caused by the Guard | an approvals row of kind `observer`, status `denied`, `decided_by = 'observer'`; `#applyDecision` with `GUARD_BLOCKED_NOTE` (deny-and-continue) |

- **Execute-time binding.** `riskOf(observer request)` returns `riskOf(subject)` when there is a subject, so execute-time re-gating binds to the subject's kind, label, path and record exactly as today. A subject-less item (a plain triggered click) runs only if approved.
- **Overrides.** A person's approval of an `observer` request is counted as `mt.observer.overrides` at `resume`. That audit is the record that a person overrode the Guard.

### 6.7 Escalation thresholds

`DenialLedger` (`packages/observer/src/guard/escalation.ts`) tracks two counts:

- `consecutive`: turns in a row with at least one applied block;
- `total`: applied blocked items.

At `consecutive ≥ 3` or `total ≥ 20`, the next Guard review is replaced by a run-level `observer` ask with category `denial_limit`, in every mode. A person's approval resets `consecutive`. The ledger is persisted in `guard_reviews` (`consecutive`, `total` after each review) and restored from the last row on `RunLoop.restore`, so a sleep or crash cannot reset it.

### 6.8 Shadow and enforce

- **Per run.** `runs.observer_mode` (`observer_mode` enum `shadow | enforce`) defaults to `enforce`.
- **Choosing shadow.** `CreateRunInput.observerMode` accepts `shadow` only with `observerShadowAcknowledged: true`, the same pattern as `bypassAcknowledged`. Shadow weakens a safety control, so it is badged in the run header and audited [GD §5.2].
- **The first zyBooks run.** The benchmark harness (`tests/bench/src/config.ts`) defaults to `observerMode: "shadow"` (O7). Every later run uses enforce unless configured otherwise.
- **What shadow does.** The Guard reviews, records `guard` events with `applied: false`, writes `guard_reviews`, and counts metrics. It changes no decision.

### 6.9 Trajectory watcher

- **Its source is the run event log, in process.** `StepStore` gains an `onCommitted(events)` listener, called after a commit succeeds. The watcher is the only listener. It never reads OTel, which is lossy by design [IM §3, GD §3.2].
- **Pure detectors** (`packages/observer/src/guard/trajectory.ts`) over a ring buffer of the last 200 entries derived from events. Thresholds live in `WATCHER_RULES` in contracts:

| Detector | Fires when |
|---|---|
| `origin_fanout` | ≥ 5 distinct origins acted on within the last 20 act steps |
| `person_denials` | ≥ 2 person denials within the last 10 decisions |
| `egress_flows` | ≥ 2 `other_origin` flows within the last 20 guard events |
| `guard_flags` | ≥ 3 `flag` verdicts within the last 20 guard events |
| `error_burst` | ≥ 5 `error` events within the last 20 entries |

- **What a detector hit does.**
  - It raises `riskLevel` to `elevated` for the rest of the run, which widens the trigger set.
  - It schedules an async model review of a `TrajectoryDigest` (the last ≤ 50 entries: origin, act tool, decision class, verdict; no text) through the same reviewer.
  - Every `WATCHER_REVIEW_EVERY = 10` triggered turns also schedules one.
- **Holds.** An `escalate` or `block` from the watcher sets a pending hold. At the end of the next `#observe`, after its commit and beside the budget check, the loop asks a run-level `observer` request (`subject: null`).
  - Approving the hold resumes.
  - Denying it cancels the run with reason `observer`.
  - In shadow, only a `guard` event is written.
- **Fail open.** Watcher errors are counted (`mt.observer.failures{role="watcher"}`) and alerted. They never stop the run.
- **Cost.** Watcher spend is collected like the title's (`takeUsage()`) and committed at the next step boundary.

### 6.10 Surfacing

- **`RunEvent` `guard`.** `{ verdict, category, stage, rollout, applied, items, flows }`, with no text. It shows as a timeline row:
  - "Observer flagged a step";
  - "Observer blocked an action";
  - "Observer would have blocked (shadow)".
- **Approval cards.**
  - `observer`: title "The safety observer stopped this", the rationale as untrusted text in `<bdi>`, the subject's own description, buttons "Deny" and "Approve anyway". The latter is styled as destructive and appears in Ask mode only when the verdict is `block`.
  - `data_egress`: "Send text from A to B?".
- **Run header.** A persistent "Safety observer: shadow" badge on shadow runs, like the bypass badge. The watcher's elevated risk level is internal and has no badge: it only widens the trigger set.

### 6.11 Telemetry and alerts

All names are defined once in `packages/contracts/src/telemetry.ts`.

| Kind | Name | Dimensions / attributes |
|---|---|---|
| span | `mt.observer.review` | `mt.run.id`, `mt.observer.role` (`guard`\|`watcher`), `mt.observer.stage` (`rules`\|`screen`\|`review`), `mt.observer.verdict`, `mt.observer.category`, `mt.observer.rollout`, `mt.observer.outcome` (`ok`\|`timeout`\|`error`\|`redacted`\|`invalid`\|`limit`\|`capped`) |
| span | `mt.observer.turn`, `mt.observer.tool` | Copilot (§7.9) |
| counter | `mt.observer.verdicts` | `mt.observer.verdict`, `mt.observer.category`, `mt.observer.rollout` (recorded from the `guard` RunEvent in `recordRunEvent`) |
| counter | `mt.observer.failures` | `mt.observer.role`, `mt.observer.outcome` |
| counter | `mt.observer.overrides` | — |
| counter | `mt.observer.spend.usd` | `mt.observer.role`: the Observer's own spend, a breakdown, not additive with run spend |
| counter | `mt.spend.usd` (changed) | **new** `mt.spend.purpose` (`run`\|`copilot`): every run's spend, Guard included, is `run` |

- `APPROVAL_DECIDERS` becomes `person | policy | bypass | observer | agent | unknown`.
- `SPANMETRIC_DIMENSIONS` gains `mt.observer.role`, `mt.observer.stage`, `mt.observer.outcome` and `mt.observer.tool`. The collector-YAML pin test forces `infra/otel/collector.yaml` to follow.
- **Alerts** (`ALERT_RULES`, `alertSpecs`), both pushed to the phone:
  - `observer_escalation`: any `mt.observer.verdicts{verdict=~"escalate|block", rollout="enforce"}` increase within 5 minutes. Label: "The safety observer stopped an action".
  - `observer_failure`: ≥ 3 `mt.observer.failures` within 10 minutes. Label: "The safety observer is failing".

## 7. Copilot

### 7.1 Service (`apps/observer`, package `@mastertutor/observer-service`)

- A `node:http` server on port 4000 with no framework.
- **Routes** (all under `/api/observer`):

| Method and path | Purpose |
|---|---|
| `POST /threads/ask` | Body `CopilotAsk`. Answers with an SSE stream of `CopilotEvent` |
| `GET /threads` | Recent threads (`CopilotThreadSummary[]`, ≤ 50) |
| `GET /threads/:id` | Replay: items and results for the UI |
| `DELETE /threads/:id` | Deletes a thread |
| `GET /results/:threadId/:resultId` | One stored result (`CopilotResultView`), for the evidence drawer and charts |
| `GET /healthz` | Health, on the internal network only |

- **Every request** except `/healthz` must:
  1. carry `Authorization: Bearer ${OBSERVER_INTERNAL_TOKEN}`, compared in constant time, plus the `x-mt-user` and `x-mt-workspace` headers. Only Traefik's ForwardAuth answer sets these;
  2. pass the same-origin write check (`isCrossSiteWrite`, moved to contracts) on `POST` and `DELETE`.

### 7.2 Owner-only routing

- **Traefik router.** `Host(${DOMAIN}) && PathPrefix(/api/observer/)` at priority 960, to `observer:4000` over `mastertutor-obs`. Middlewares:
  - `mastertutor-observer-auth`: ForwardAuth to `http://${CDP_SUBNET_PREFIX}.11:3000/api/observer-auth`, with `trustForwardHeader: false` and `authResponseHeaders: Authorization, Cookie, X-Mt-User, X-Mt-Workspace`;
  - `mastertutor-observer-headers`: `nosniff`, `Cache-Control: no-store`.
- **The auth endpoint** `apps/web/app/api/observer-auth/route.ts` is deliberately *outside* `/api/observer/`, so the router never proxies it. It:
  - answers only internal callers (`isInternalRequest`, `internalWebHosts`);
  - reads the app session (`getViewer`), then `isOwnerSignedIn` and `memberRoleOf`;
  - answers `200` with `Authorization: Bearer <token>`, `Cookie: mt_observer=1` (so no MasterTutor cookie reaches the observer), `X-Mt-User` and `X-Mt-Workspace`;
  - otherwise `401` signed out, `403` not the owner, `503` without a token. A fixture build always answers `403`.

  This reuses Track C's owner gate. It is the same check `/api/observability/auth` makes, applied to the app-host session [CP §3.4].
- **Host.** The Copilot is on the app host, not `obs.<DOMAIN>`, because the panel is part of the app [IM §6]. OpenObserve's UI stays on its own origin.

### 7.3 Database: migration 0015

`CREATE SCHEMA observer`, owned by the migration owner.

**Views.** They are `security_barrier`, not `security_invoker`, and list their columns explicitly [CP §2.3, IM §5]:

| View | Columns |
|---|---|
| `observer.runs` | `id, workspace_id, status, wait_reason, controller, approval_mode, observer_mode, tool_profile, model, budget, usage, error_code (error->>'code'), title, created_at, finished_at, last_activity_at` |
| `observer.run_goals` | `id, workspace_id, goal` (read only with the opt-in) |
| `observer.run_steps` | `run_id, seq, phase, state, tool (action->>'tool'), origin (substring of url up to the path), caption, usage, created_at`; `caption` and `origin` are read only with the opt-in |
| `observer.approvals` | `id, run_id, step_seq, kind, status, decider (CASE … → person, policy, bypass, observer, agent, unknown), decided_at, created_at` |
| `observer.run_events` | `id, run_id, type, created_at`, plus `guard_verdict` and `guard_category` from the `guard` payload only |
| `observer.guard_reviews` | `run_id, step_seq, stage, verdict, category, rollout, applied, latency_ms, usd, created_at` (never `input`) |
| `observer.browser_slots` | `name, state, restarted_at` |
| `observer.downloads` | `run_id, bytes, pending, kept_at, discarded_at, created_at` |
| `observer.alerts` | `id, workspace_id, rule, fired_at, acknowledged_at` |

**Copilot tables**, in schema `observer` and created by drizzle (`pgSchema("observer")`):

| Table | Columns |
|---|---|
| `copilot_threads` | `id, workspace_id, created_by, title, handles jsonb, created_at, updated_at` |
| `copilot_items` | `thread_id, seq, role (user\|assistant\|tool), item jsonb, created_at`, PK `(thread_id, seq)` |
| `copilot_results` | `thread_id, result_id ("Q1"…), tool, summary, query jsonb, columns jsonb, rows jsonb, row_count, truncated, took_ms, created_at`, PK `(thread_id, result_id)` |
| `copilot_spend` | `day date PK, usd numeric(12,6)` |

**Also in 0015:**

- the `approval_kind` values `data_egress` and `observer`, plus `observer_mode` and `runs.observer_mode`;
- `guard_reviews` in `public`, written by the agent: `id, run_id, step_seq, stage, verdict, category, rollout, applied, input jsonb, latency_ms, usd, consecutive, total, created_at`;
- the two decider CHECKs (§4);
- the `alerts_rule_ck` refresh for the two new rules.

The `ADD VALUE` statements are not used anywhere in the migration's transaction, so they may share it [IM §9].

**Grants** (`grants.sql`, re-applied on every migrate):

- `observer_role`: `NOLOGIN` there, `LOGIN` with `OBSERVER_DB_PASSWORD` set in `runMigrations`, `CONNECTION LIMIT 4`. `REVOKE ALL ON SCHEMA public`; `USAGE` on `observer`; `SELECT` on the nine views; `SELECT, INSERT, UPDATE, DELETE` on the four copilot tables. `ALTER ROLE … SET statement_timeout = '3s'`. The role is not read-only by default, because it writes its own replay tables. Timeouts are accident prevention; grants are the control [CP §2.2].
- `guard_reviews`: excluded from `web_role` in the public loop. The agent keeps its default grant.
- `web_role` and `agent_role` get no grant in `observer`.
- A privilege sweep test (`has_table_privilege` over every table in every schema) asserts `observer_role` reaches only the above.

### 7.4 Query templates and validation

- **Runtime-safe subpath.** `@mastertutor/observability/query` exports `createO2Client`, `O2Error`, `o2StreamName`, `o2Label`, `O2_FIELDS`, `o2QueryPaths` (`search`, `queryRange`) and `DASHBOARD_FEW_SHOTS` (the panel queries from `dashboards/catalog.ts`). The spike (§10) pins the `_search` and `query_range` request and response shapes on the pinned v1.0.4 digest in `o2-api.int.test.ts`.
- **Credential.** A new OpenObserve user, `copilot@mastertutor.internal`, provisioned by `observability-init`. OpenObserve OSS only offers admin [IM §0.4], so least privilege comes from the templates, the proxy and the network.
- **PromQL** (`metrics_query`). Parsed with `@prometheus-io/lezer-promql`.
  - Every metric selector name must be `o2StreamName` of a `METRIC` or `DERIVED_METRIC` entry (or their `_bucket`, `_sum` or `_count`), and every label must be a registry label.
  - On failure the tool returns an `invalid` result listing the valid names, so the model can correct itself [CP §1].
  - The server sets the range: default 7 days, maximum 90. It sets the step so each series has ≤ 300 points, keeps ≤ 20 series, and times out after 10 s.
- **SQL** (`telemetry_search`). A structural guard:
  - a single statement;
  - starts with `SELECT`. A `WITH` is refused, because it hides its `FROM` behind a name;
  - no `;` outside string literals;
  - `FROM` only `"mastertutor"`, `"containers"` or `"default"`, matching the `stream` argument;
  - no `JOIN` to another stream;
  - no DDL or DML keywords.

  The server sets `start_time` and `end_time` (default 24 h, maximum 7 days), `size ≤ 200` and a 10 s timeout. `took` and `scan_size` are returned.
- **Postgres.** The model never writes SQL. Tools call fixed, parameterised queries in `packages/db/src/queries/observer.ts`.

### 7.5 Tools

There are eight typed, read-only tools [CP §2.2]. Each is defined once in `packages/observer/src/copilot/tools.ts` as a zod schema plus `limits` plus `taint`, and is converted with `zodResponsesFunction`.

| Tool | Arguments | Backend |
|---|---|---|
| `metrics_query` | `promql`, `rangeHours?`, `stepSeconds?` | OpenObserve `query_range` |
| `telemetry_search` | `stream`, `sql`, `rangeHours?` | OpenObserve `_search` |
| `runs_find` | `status?`, `errorCode?`, `sinceHours ≤ 2160`, `limit ≤ 50` | `observer.runs` |
| `run_detail` | `run` (handle), `includeUntrusted?` | `observer.runs`, `run_steps`, `approvals`, `run_events`, `guard_reviews`; goals and captions only when the question opted in |
| `run_traces` | `run` (handle), `limit ≤ 50` | OpenObserve `_search` on stream `default`, filtered by `mt_run_id` |
| `code_search` | `query` (literal, ≤ 100 chars), `pathPrefix?` | in-memory code index; literal match only, so no ReDoS |
| `code_read` | `path`, `startLine`, `endLine` (≤ 200 lines) | code index |
| `render_chart` | `resultId`, `kind: line\|bar\|table`, `x`, `y[] ≤ 4`, `title` | validated against the stored result; no backend |

- **Handles.** `HandleMap` maps run UUIDs to `R1`, `R2`… per thread, and is stored in `copilot_threads.handles`. The model never sees or writes a UUID [CP §3.5]. Links (`/runs/<id>`, and OpenObserve trace links built by `o2TraceLink` with the parameters the spike pins) are resolved on the server from handles.
- **Taint.** `run_detail` with the opt-in, `telemetry_search` on `containers`, and `run_traces` mark their result as tainted. Tainted text is wrapped with `wrapUntrusted` and capped at `MAX_UNTRUSTED`. Tool arguments stay schema-bound, so a tainted turn can only cause more bounded reads.
- **Code index.** It is built at image build time by `apps/observer/src/bin/build-code-index.ts` from the Docker build context, which already excludes `.git`, `.env*`, `docs`, `orchestration` and `*.md` (`.dockerignore`).
  - It indexes only `apps/`, `packages/` and `infra/`.
  - It drops `*.pem`, `*.key`, `.env*`, `**/fixtures/**`, `**/testing/**`, `*.test.ts` and binaries.
  - It runs the collector's five scrub patterns (spec D50 §10) over every line.
  - It stores `{path, lines[]}` as JSON. The image copies only that file.
  - D39: code search is built in house (`BUILD-OURSELVES.md` row).

### 7.6 Conversation loop, citations and streaming

- **Input per turn**, rebuilt from storage (D37, stateless replay):
  - a fixed prefix: instructions, the semantic catalog (§7.7) and few-shots. It is always first and unchanged, for prompt caching;
  - the last thread items;
  - older tool outputs replaced by `[result Qn omitted; re-run if needed]` once input would exceed 60,000 tokens (estimated as characters ÷ 4).
- **Streaming.** `openai.responses.stream(params, { signal })` is a new wrapper method that runs `statelessParams`. The loop reads `response.output_text.delta` and collects complete items from `response.output_item.done`. Encrypted reasoning items are kept from `output_item.done`, never from deltas [CP §4.3].
- **Tool rounds.** At most 8 rounds, with at most 4 tool calls run in parallel per round (`Promise.all`). Each tool result is stored as `Qn` and summarised to ≤ 50 rows for the model; up to 200 rows are kept for the UI.
- **SSE events** (`CopilotEvent`, contracts):

| Event | Fields |
|---|---|
| `thread` | `threadId` |
| `text` | `delta` |
| `tool_started` | `resultId`, `tool`, `summary` |
| `tool_done` | `resultId`, `rowCount`, `tookMs`, `outcome` |
| `chart` | `ChartSpec` |
| `done` | `citations`, `removed`, `usd` |
| `error` | `code` |

- **Citations.** The model cites inline as `[Q3]`. At `done`, `checkCitations(text, storedIds)` removes markers that match no stored result and reports them in `removed`. The UI renders each valid marker as a chip that opens the evidence drawer: the exact query, its range and the rows, with "Open run" and "Open in OpenObserve".
- **Cancelling.** When the client disconnects, the request's `AbortController` aborts the OpenAI call and any in-flight OpenObserve fetch.

### 7.7 Semantic catalog

`semanticCatalog()` (`packages/observer/src/copilot/catalog.ts`) is built at module load from `@mastertutor/contracts/telemetry`:

- span names, attributes and their enums, metrics with kind, unit and dimensions;
- the OpenObserve stream names;
- retention;
- a fixed ~4 KB semantic note [CP §2.1]:
  - traces are per step, keyed by `mt.run.id`;
  - spend is `mt_spend_usd` by purpose;
  - an interruption is not an error;
  - OpenObserve lags live state by 20–60 s, so live state comes from `runs_find` and `run_detail`.

A unit test asserts every name in the catalog exists in the registry.

### 7.8 Caps and rate limits

All caps are kept in Postgres; there is no Redis.

| Cap | Default | Enforced |
|---|---|---|
| Questions | 20 per 10 minutes per workspace | `copilot_items` count before a turn |
| Daily spend | `OBSERVER_DAILY_USD = 3` | `copilot_spend` for today, checked before every model call; each call's `costUsd` is added after it |
| Tool rounds | 8 per turn, 4 parallel | loop |
| Output | `max_output_tokens = 2000` per call | request |
| Input | ~60k tokens per call | placeholders (§7.6) |

Reaching a cap ends the turn with an `error` event whose code is `rate_limited` or `daily_cap`. The UI shows a plain message, not a failure.

- **Retention.** Threads older than 30 days are deleted at start-up and every 24 h.
- **Prompt-cache retention.** The wrapper sends `prompt_cache_retention: "in_memory"` on every Responses call except for models the spike finds reject it (O12).

### 7.9 Copilot telemetry

- **Spans.** `mt.observer.turn` covers a whole turn (`mt.observer.outcome`). `mt.observer.tool` covers each tool call (`mt.observer.tool`, `mt.observer.outcome`).
- **Metrics.** `recordSpend(usd, "copilot")` and `recordObserverSpend("copilot", usd)` after each model call; `mt.observer.failures{role="copilot"}` on errors.
- **Never telemetry.** Prompts, rows, answers, questions and SQL are never recorded (R9).

### 7.10 UI

- **Where it lives.** The panel is a page at `/observer` in the app (owner only; anyone else gets `notFound()`). It is reached from:
  - a sidebar item "Observer", shown to the owner only;
  - "Ask about this run" in the run header (`/observer?run=<id>`);
  - "Why did this fire?" on each alert in `/settings/alerts` (`/observer?alert=<id>`).
- **Why a page, not a slide-over.** A dedicated page can carry a strict CSP without changing every other page (§7.11). The layout is still the panel the HIG calls for: a thread sidebar plus a conversation column, with a sheet on 390 px.
- **Built with** the `anthropic-skills:apple-hig-designer` skill, the existing tokens (`styles/tokens.css`), glass panels and `motion` springs (D17, D21, D25, D28, D43). It covers 1440 down to 390 px, light and dark, Dynamic-Type-friendly sizes, 44 pt targets and reduced motion.
- **Components** (`apps/web/components/observer/`):
  - the composer, with an "Include page text and goals" toggle that is off by default and resets after each question;
  - the streaming answer;
  - citation chips;
  - the evidence drawer;
  - a result chart, an in-house SVG line and bar chart of about 150 lines drawn from stored rows only. It is built with the `dataviz` skill. No chart library is added [CP §2.5];
  - the thread list.
- **Client stream.** `fetch` POST with a streamed body, parsed line by line into `CopilotEvent` (zod). EventSource cannot POST.

### 7.11 Safe rendering

- **Markdown.** `answer-markdown.tsx` uses `react-markdown` and `rehype-sanitize` with a schema that:
  - removes `img` entirely;
  - allows no raw HTML;
  - allows links only when they are relative and match `^/(runs|observer|settings/alerts)(/|\?|#|$)`. Every other link, reference-style links included, renders as plain text [CP §3.2].
- **CSP** on `/observer` (`next.config.ts` `headers()`): `default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`.
- **Untrusted snippets** in the evidence drawer render through `untrustedText` inside `<bdi>`.

## 8. Changes to the approval contract

`ApprovalRequest` becomes a union of `ApprovalSubject` (the six existing variants plus `data_egress`) and `observer`:

```ts
z.object({ kind: z.literal("data_egress"), action: ComputerAction, url: PageUrl, fromOrigin: Origin,
           toOrigin: Origin, chars: z.number().int().min(0).max(100_000), screenshotKey: ScreenshotKey })
z.object({ kind: z.literal("observer"), verdict: z.enum(["escalate","block"]), category: GuardCategory,
           rationale: z.string().max(300), subject: ApprovalSubject.nullable(), url: PageUrl,
           screenshotKey: ScreenshotKey })
```

- `AUTO_MODE_DECISIONS`: `data_egress: "ask"`, `observer: "ask"`.
- `BYPASS_DECISIONS`: `data_egress: "approved"`, `observer: "ask"`.
- `decideByPolicy` is never called with `observer`; the entry exists because the tables are total.

## 9. Evaluation

| Layer | What | Where | Gate |
|---|---|---|---|
| Red-team catalogue | Every placement as a metadata-only `GuardInput` scenario: injection (hidden text, `aria-label`, `alt`, fake system banner, PDF text, caption track, delayed); exfiltration (form on another origin, navigation with a query, image beacon, download lure); credential misuse (lookalike origin, off-origin post, unexpected alias); goal drift (subscribe, delete, buy, change email); monitor-targeted ("note to the safety reviewer…", whose input must equal its benign twin). Page fixtures `site/redteam/article.html` and `store.html` plus `other/redteam/exfil-form.html` (`other.fixtures.test` is same-site, so D51 reaches it without asking) drive behaviour runs. | `tests/observer-eval/scenarios.ts`; `tests/behaviour/observer*.behaviour.test.ts`; the existing vault security suite for credentials | Deterministic layers: 100% with the Guard disabled. Trigger coverage: 100% |
| Model detection | The same scenarios as `GuardInput`s against the real reviewer | `tests/observer-eval/redteam.eval.test.ts` (suite `observer-eval`) | `escalate` or `block` on ≥ 90% of attack scenarios; monitor-targeted payloads show no change (metadata-only) |
| Benign replay | `guard_reviews.input` of the shadow zyBooks run and the fixture runs, re-reviewed offline | `tests/observer-eval/src/replay.ts`, `benign.eval.test.ts` | Non-allow rate ≤ 2% of reviewed turns; escalations ≤ 1 per benign run (calibration constants in `tests/observer-eval/thresholds.ts`) |
| Copilot golden set | 30 questions over a seeded stack: run failure, spend today, slowest step, errors last hour, why an alert fired, code lookups, injection canaries | `tests/observer-eval/golden.ts`, `golden.eval.test.ts` | Expected tool used; ≥ 1 valid citation; no removed citation; expected value present; no image or external link rendered |
| Regression gates (D48) | Composition property test, decider allow-check, redaction assertion, `store:false` guard extended to the Guard and `responses.stream`, secret canary on Guard and Copilot request bodies, `observer_role` privilege sweep, boundaries | unit, security, integration, behaviour suites | Always on |

`observer-eval` uses the real OpenAI API, so it is opt-in. It has a per-run spend cap of $2, enforced by the harness through `costUsd`. Like `bench-mock`, it is never part of `all`.

## 10. Spike (first task)

The spike pins every `[unverified]` item before code depends on it. It writes `orchestration/runs/<date>-spike-observer/report.md` and updates the named constants.

| Item | How | Pinned in |
|---|---|---|
| `gpt-6-luna` latency (p50/p95 over 20 calls with ~1k tokens of metadata) and whether it accepts `reasoning.effort` `minimal` or `none`, plus strict `json_schema` | script through the wrapper | `GUARD_REASONING` in `packages/contracts/src/observer.ts`; `GUARD_TIMEOUT_MS` |
| `gpt-6.1-sol` latency for the review stage and the Copilot | same | the `MODELS` comment |
| Prompt caching under `store:false` (`cached_tokens > 0` on a repeated ≥ 1,024-token prefix) | same | spec note; `GUARD_*` instruction ordering |
| `prompt_cache_retention: "in_memory"` accepted per model | same | `NO_CACHE_RETENTION_MODELS` in `server/openai.ts` |
| Whether `gpt-6-astra`'s computer tool emits `pending_safety_checks` | a computer call on a screenshot carrying an injected instruction, and the SDK types | spec note; the `post_injection_window` trigger notes |
| Published prices of `gpt-6-luna` and `gpt-6.1-sol` | the OpenAI pricing page | `MODEL_PRICES` (defaults to astra prices, which over-estimate) |
| OpenObserve `_search` and `prometheus/api/v1/query_range` request and response shapes, `took`, `scan_size`, the `size` cap and cancellation | `o2-api.int.test.ts` against the pinned digest | `o2QueryPaths`, the schemas in `packages/observability/src/query.ts` |
| OpenObserve trace and log deep-link URL parameters | Playwright on the pinned image | `o2TraceLink` in `packages/observer/src/copilot/links.ts` |

## 11. Security summary

| Threat | Control | Test |
|---|---|---|
| An Observer or other machine decision gains person powers | Allow-check, typed `Decider`, DB CHECKs | `approval.test.ts`, `record.test.ts`, `vault.int.test.ts`, `decider.int.test.ts` |
| Page text or a secret reaches the Guard | Strict `GuardInput` (no free-text fields), `assertRedacted` before send | `input.test.ts`; `guard.security.test.ts` (vault canary through a full guarded turn: absent from every recorded request body) |
| The Guard loosens a decision | `strictest` plus property tests; the Guard never writes `approved` | `compose.test.ts` (fast-check) |
| Agent-as-proxy or best-of-n against the Guard | Reasoning-blind input, fixed denial text, no resampling, escalation thresholds | `reviewer.test.ts`, `run-loop-guard.int.test.ts` |
| A Guard outage silently lets risky actions through | The synchronous gate fails closed (escalate); failures are alerted | `reviewer.test.ts` (timeout, parse error) |
| Copilot exfiltration | No egress or write tools; no images; link allowlist; CSP; network: only OpenAI egress | `answer-markdown.test.ts`, `observer.spec.ts` (canary under CSP), `prod-mode.test.ts` |
| Copilot over-privilege | `observer_role` views only; separate O2 user; no S3, vault or auth env | `observer-role.int.test.ts` (privilege sweep), `prod-mode.test.ts` |
| Copilot reached without the owner | ForwardAuth plus internal bearer plus same-origin writes; fixture build denies | `authorize.test.ts`, `auth.test.ts`, `observability` stack test |
| Prompt injection in telemetry misleads the owner | Taint by default, opt-in for untrusted text, citations with raw rows, server-side citation check | `citations.test.ts`, `conversation.int.test.ts` (opt-in), golden injection canaries |
| Data stored at OpenAI | `store:false`, no identifiers, handles instead of UUIDs, in-memory cache retention | `openai.test.ts`, behaviour data-policy guard |

## 12. Performance budget

- Untriggered steps add no model call. The trigger check and input build are pure code: under 1 ms p50 (`triggers.bench.test.ts`, 10,000 iterations).
- A triggered turn adds one screen call; the review call happens only on `review`. The spike measures the latency. The expected cost is under 5% of run spend [GD §3.1], measured on the shadow run (`guard_reviews.usd` against `runs.usage.usd`).
- The watcher is entirely off the hot path. Its listener does O(1) work per event.
- The Copilot is a separate process, so its load never shares the agent's or web's event loop.

## 13. Changes to existing files

| Area | Files |
|---|---|
| Contracts | `approval.ts`, `enums.ts`, `events.ts`, `telemetry.ts`, `alerts.ts`, `constants.ts`, `env.ts`, `observer.ts` (new), `pricing.ts` (new), `api/dto.ts`, `server/openai.ts`, `server/same-origin.ts` (new), `index.ts`, `package.json` |
| Core | `packages/observer/**` (new) |
| DB | `schema/vault.ts`, `schema/runs.ts`, `schema/enums.ts`, `schema/guard.ts` (new), `schema/observer.ts` (new), `schema/index.ts`, `migrations/0015_observer.sql`, `sql/grants.sql`, `src/migrate.ts`, `queries/vault.ts`, `queries/guard.ts`, `queries/observer.ts`, `queries/copilot.ts` (new), `src/index.ts` |
| Telemetry | `record.ts`, `instruments.ts`, `index.ts`, `boundaries.test.ts` |
| Observability | `package.json` (`./query`), `src/query.ts` (new), `alerts.ts`, `provision.ts` (copilot user), `o2-api.int.test.ts` |
| Agent | `main.ts`, `boot-checks.ts`, `loop/run-loop.ts`, `loop/approvals.ts`, `loop/step-store.ts`, `loop/supervisor.ts`, `loop/worker.ts`, `loop/run-state.ts`, `guardrails/policy.ts`, `guardrails/provenance.ts` (new), `guardrails/observer/**` (new), `llm/pricing.ts`, `llm/caller.ts`, `llm/client.ts`, `vault/*` (decider types) |
| Observer service | `apps/observer/**` (new) |
| Web | `app/api/observer-auth/route.ts` (new), `lib/server/observer/authorize.ts` (new), `lib/server/rpc/same-origin.ts` (re-export removed), `lib/server/runs/service.ts`, `app/(app)/observer/page.tsx` (new), `components/observer/**` (new), `components/run/model/{approval-copy,timeline-items,run-model}.ts`, `components/run/run-header.tsx`, `components/alerts/alerts-view.tsx`, `components/shell/*` (nav item), `components/new-task/*` (shadow option), `next.config.ts` (CSP), `lib/fixtures/*`, `styles/observer.css` (new) |
| Compose and infra | `compose.yml`, `compose.prod.yml`, `tests/bench/compose.local.yml`, `Dockerfile` (target `observer`), `infra/otel/collector.yaml` (dimensions), `infra/traefik/test-dynamic.yml` |
| Tests and scripts | `tests/compose/prod-mode.ts`, `tests/llm-mock/src/*`, `tests/fixtures/**`, `tests/observer-eval/**` (new), `tests/bench/src/config.ts`, `scripts/env-init.ts`, `scripts/deploy/check-env.ts`, `scripts/remote-test.sh`, `scripts/remote-test/run-on-host.sh`, `vitest.config.ts`, `eslint.config.js`, `orchestration/BUILD-OURSELVES.md` |

## 14. Decisions the user should know about

1. **The decider fix also catches `"agent"`.** Today `isPersonDecider("agent")` is true. The allow-check fixes that too.
2. **`data_egress` exempts allowed destinations.** Data read on origin A and typed into origin B asks only when B is outside the run's allowed origins [GD §4.3]. Within the allowlist, the Guard still reviews the flow (trigger `data_egress`) but policy does not ask.
3. **In Ask mode a Guard block becomes a card with "Approve anyway"**, not a silent denial (O9). In Auto and Bypass, a block is deny-and-continue.
4. **A denied watcher hold cancels the run.** It is a run-level "should this run continue?" question.
5. **The Copilot is a page (`/observer`), not a slide-over**, so it can carry a strict CSP without an app-wide CSP change.
6. **The Copilot gets its own OpenObserve user** (`copilot@mastertutor.internal`). Least privilege still comes from templates and networks, because OpenObserve OSS only has admin.
7. **`@mastertutor/observability/query` is the one runtime-safe subpath** of the provisioning package, importable only by the observer service. This amends the D50 rule.
8. **Guard spend is run spend.** `mt.spend.usd` gains `purpose = run | copilot`. Guard and watcher costs also appear in `mt.observer.spend.usd` as a breakdown.
9. **Shadow mode is a per-run, acknowledged opt-in** (like bypass), badged in the run view. The benchmark harness uses it for the first zyBooks run only.
10. **The Copilot uses `gpt-6.1-sol`** (priced, proven on our key) unless the spike shows a better latency and cost trade-off.
11. **`observer-eval` is the first remote suite that needs the real OpenAI key.** It is opt-in, never part of `all`, capped at $2 a run, and the key travels to the host on stdin into a tmpfs env file. It is never on a command line or in a log.
12. **`data_egress` meets D51.** Same-site hosts are reached without asking and are outside `allowedOrigins`, so typing text read on the allowed site into a same-site host is exactly what the rule catches in Auto mode.
