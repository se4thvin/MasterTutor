# Observability: Design Spec

_Decision D50 (`orchestration/STATE.md`), approved by the user on 2026-10-08, including the Web Push amendment. This spec supersedes `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` §14 ("no OTel in v1"). Everything else in that spec still applies. `CLAUDE.md` is binding._

**Plan:** `docs/superpowers/plans/2026-10-08-observability.md`.

## 1. Goal and scope

The owner should be able to see what MasterTutor is doing, how well and at what cost, and be told when something goes wrong. Telemetry must never slow the product down, break it, or leak anything sensitive.

In scope:

- OpenTelemetry (traces, metrics, logs) in the two Node backends, `web` (Next.js server) and `agent`, through one shared package.
- Container logs from the processes we do not instrument: browser slots (n.eko and Chromium), `pdf-worker`, `audio-capture` and `docling`.
- An OTel Collector that scrubs telemetry, maps base telemetry to product telemetry, derives RED metrics and tail-samples.
- OpenObserve for storage, search and dashboards. Its data lives in our Garage.
- A dashboard at `/observability` for the owner only, behind MasterTutor sign-in.
- Alerts in two places: inside the app (a banner and an Alerts list) and on the owner's iPhone through Web Push sent by MasterTutor itself.

Out of scope:

- Browser (client-side) telemetry, RUM and session replay.
- Distributed context propagation. `web` and `agent` never call each other (spec §3.1 rule 1), so there is no cross-service trace to stitch together. See §7.4.
- Uptime probes from outside the host.
- ntfy or any other relay. D50 dropped it in favour of Web Push.

## 2. Binding requirements (D50)

| # | Requirement |
|---|---|
| R1 | One shared telemetry package sets up the OTel Node SDK once per process, with only the instrumentations we need. |
| R2 | A typed `instrument()` wrapper is applied at the minimum number of product seams. Product attribute and metric names are defined once. |
| R3 | pino is bridged to OTel logs. Every line carries `trace_id`, `span_id` and `run_id` when they exist. stdout stays JSON for Dokploy. |
| R4 | An OTel Collector with `memory_limiter`, `batch`, a second scrub pass, a base-to-product transform, a `spanmetrics` connector and tail sampling that keeps all errors and slow steps. It also collects container logs without the Docker socket. |
| R5 | OpenObserve is pinned by digest, stores its data in Garage (its own bucket and least-privilege key), is internal-only and resource-bounded. Retention: logs 30 d, traces 15 d, metrics 90 d. Dashboards are code. |
| R6 | `/observability` is for the owner only, behind MasterTutor sign-in through Traefik ForwardAuth. OpenObserve's own login is never shown. |
| R7 | Alerts are code: error spikes, `model_request_rejected`, failed runs, slot crash loops and spend jumps. They are delivered in the app and by Web Push (VAPID, iPhone Home Screen app, iOS 16.4+, HTTPS only). |
| R8 | Telemetry never blocks or breaks the product. Export is bounded and non-blocking, drops are counted, failures are contained, crash handlers flush, and shutdown flushes. |
| R9 | No secrets, page text, screenshots or prompts appear in telemetry. This is enforced by an attribute allowlist with tests, plus the collector scrub pass. |
| R10 | Hot paths stay lean. Budget: p50 overhead per agent step under 2 ms, measured by a test. |
| R11 | The bench stack and the remote runner suites gain telemetry, but no test depends on the telemetry stack being up. |

## 3. What already exists and is reused

| Existing item | Path | How this design uses it |
|---|---|---|
| pino logger factory and redaction paths | `packages/contracts/src/server/logger.ts` (`createLogger`, `REDACT_PATHS`) | Unchanged API. It gains a correlation mixin and a second stream that feeds OTel logs, after pino has redacted the line (§9). |
| Logger tests | `packages/contracts/src/server/logger.test.ts` | Extended. Redaction must still hold with the bridge on. |
| Run error codes and the D35 mapping | `apps/agent/src/runtime/errors.ts` (`ModelUnavailable.code`, `interruptionOf`), `apps/agent/src/loop/worker.ts` (`agent_error`, `control_restore_failed`, `kill_switch`) | `errorCodeOf()` reads `error.code` first, so `model_request_rejected`, `model_unavailable` and `model_rate_limited` reach spans unchanged. `interruptionOf` marks takeovers and kills as interruptions, not errors. |
| Model fallback and rejection classification | `apps/agent/src/llm/caller.ts` (`ModelCaller.call`, `classifyModelError`) | Becomes the model seam (§8). |
| Token pricing | `apps/agent/src/llm/pricing.ts` (`costUsd`, `TokenUsage`) | Supplies the cost attribute on model spans. No second price table. |
| Run events, the product's domain events | `packages/contracts/src/events.ts` (`RunEvent`), `packages/db/src/queries/events.ts` (`emitRunEvent`, the single writer for agent and web) | One seam records approvals, takeovers, slot leases, budget hits, downloads, blocks, filing, fallbacks, errors and run endings (§8). |
| Approval decider constants | `packages/contracts/src/approval.ts` (`POLICY_DECIDER`, `BYPASS_DECIDER`, `isPersonDecider`) | Map `decidedBy` to `person`, `policy` or `bypass`. A user id never becomes telemetry. |
| Run usage | `apps/agent/src/loop/step-store.ts` (`RunPatch.usage`, `StepStore.commit`) | Spend is the change in `runs.usage.usd`, counted after the step transaction commits, so the metric matches the database. Compaction spend is included. |
| `/healthz` | `apps/web/app/healthz/route.ts`, `apps/agent/src/health.ts` | Unchanged. Health spans are dropped by the collector. Agent slot and run gauges reuse `listBrowserSlots` and `Supervisor.activeRuns`, which `/healthz` already reads. |
| The single OpenAI wrapper | `packages/contracts/src/server/openai.ts` (`createOpenAI`) | Not modified. Its fetch calls are traced by the undici instrumentation. Propagation is off, so no trace header ever reaches OpenAI (D38). |
| Compose conventions | `compose.yml` (`x-node-runtime`, `x-node-health`, internal networks), `compose.prod.yml` (`x-logging`, `:prod` tags, memory/CPU/pids bounds, external `mastertutor-cdp`) | New services follow the same anchors, bounds and hardening. |
| D47 production rules | `tests/compose/prod-mode.ts` (`prodModeProblems`, `WORKERS`), `tests/compose/prod-overlay.int.test.ts` | Extended with telemetry rules. Workers keep their exact networks and empty env. Only their log driver changes. |
| Traefik ForwardAuth wiring | `compose.prod.yml` (`x-live-middlewares`), `packages/contracts/src/live.ts` (`liveForwardAuthAddress`, `DEFAULT_CDP_SUBNET_PREFIX`), `apps/web/app/api/live/auth/route.ts` | `/observability` uses the same pattern: ForwardAuth to web's static cdp address `.11`, with helpers in contracts. |
| Host network scripts | `infra/host/create-cdp-network.sh`, `infra/host/attach-traefik.sh` | Generalised to create and attach the new `mastertutor-obs` network (§12). |
| Garage bootstrap | `packages/storage/src/garage-admin.ts` (`bootstrapGarage`), `packages/storage/src/bin/garage-init.ts` | Called a second time for the `observability` bucket and its own key. No new admin code. |
| Secret generation | `scripts/env-init.ts` (`generateSecrets`), `scripts/deploy/check-env.ts` | Generate and check the new secrets and the `observability` profile. |
| Env parsing | `packages/contracts/src/env.ts` (`WebEnv`, `AgentEnv`, `GarageInitEnv`, `parseEnv`) | Extended. A new `ObservabilityInitEnv` follows the same style. |
| Web auth and session helpers | `apps/web/lib/server/viewer.ts` (`getViewer`), `apps/web/lib/server/rpc/require-viewer.ts`, `apps/web/lib/server/rpc/workspace-scope.ts`, `packages/db/src/queries/workspace.ts` | The owner check is one new query, `memberRoleOf`, plus an `ownerScoped` middleware that builds on `workspaceScoped`. |
| Same-origin guard | `apps/web/lib/server/rpc/same-origin.ts` | RPC writes for alerts and push go through the existing RPC route, so they keep it. |
| Kill banner | `apps/web/components/shell/kill-banner.tsx` | The alert banner follows the same pattern and sits beside it in `app-shell.tsx`. |
| oRPC contract and fixture router | `packages/contracts/src/api/contract.ts`, `apps/web/lib/fixtures/router.ts`, `apps/web/lib/server/rpc/live-router.ts` | A new `alerts` namespace is added to the contract and implemented in both routers. |
| Remote runner | `scripts/remote-test.sh`, `scripts/remote-test/run-on-host.sh` | Gains an `observability` suite. Other suites can opt in with `MT_CI_TELEMETRY=1`. |
| Bench stack | `tests/bench/compose.local.yml` | Gains the `observability` profile and the local `mastertutor-obs` network. |
| DB grants | `packages/db/sql/grants.sql` | `agent_role` is excluded from the two new tables. |
| ESLint import bans | `eslint.config.js` | One new ban: `@opentelemetry/*` may be imported only by `packages/telemetry` and `packages/contracts/src/server/log-bridge.ts`. |

## 4. Architecture

```
 web (Next.js) ─┐  OTLP/HTTP (protobuf)        ┌──────────── otel-collector ────────────┐
 agent ─────────┼──── network: telemetry ─────▶│ otlp ─▶ memory_limiter ─▶ filter/health  │
                │                              │   ─▶ attributes/scrub ─▶ transform/scrub │
 browser-N ─┐   │                              │   ─▶ transform/product ─┬▶ spanmetrics ──┼─▶ metrics
 pdf-worker ┤ docker fluentd log driver        │                        └▶ forward ─▶     │
 audio-cap. ┤ (daemon → 127.0.0.1:24224) ─────▶│ fluentforward          tail_sampling ─▶   │
 docling ───┘                                  │   ─▶ scrub ─▶ transform ─▶ batch          │
                                               └───────────────┬──────────────────────────┘
                                                OTLP/HTTP, basic auth (ingest user)
                                                               ▼ network: observe
                         Traefik ── /observability ──▶ openobserve ──S3──▶ garage (bucket: observability)
                         (ForwardAuth → web .11,        │  network: observe-store
                          owner only, injects            │
                          viewer credentials)            └─ alert webhook ──▶ web /api/alerts/webhook
                                                                               ├─▶ alerts table (in-app)
                                                                               └─▶ Web Push (VAPID) ─▶ iPhone
```

### 4.1 Services

| Service | Image | Profile | Networks | Ports | Secrets |
|---|---|---|---|---|---|
| `otel-collector` | `otel/opentelemetry-collector-contrib:0.162.0@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6` | `observability` | `telemetry`, `observe`, `obs-ingest` | `127.0.0.1:24224` (fluent forward, loopback only, D45) | `OBSERVE_INGEST_PASSWORD` |
| `openobserve` | `openobserve/openobserve:v1.0.4@sha256:d4a878fac1f6c56003764f7f2a1625668917388f167e222c8c810de3f54c56ba` | `observability` | `observe`, `observe-store`, `observe-edge` (prod: external `mastertutor-obs`) | none | `OBSERVE_ROOT_PASSWORD`, `S3_OBSERVE_ACCESS_KEY_ID`, `S3_OBSERVE_SECRET_ACCESS_KEY` |
| `observability-init` | `mastertutor/node-runtime` (reused) | `observability` | `observe` | none | `OBSERVE_ROOT_PASSWORD`, `OBSERVE_VIEWER_PASSWORD`, `OBSERVE_INGEST_PASSWORD`, `ALERT_WEBHOOK_SECRET` |

Choosing the contrib image over a custom OCB build: a custom build means a Go toolchain, a builder manifest and a gigabyte-class module cache on a host with about 20 GB free (D35). The contrib image is pinned by digest, needs no build step, and only the components named in the config are ever instantiated. We can revisit if image size becomes a problem.

OpenObserve is AGPL-3.0. We run the unmodified upstream image as a separate service and copy none of its code, which is consistent with D20.

### 4.2 Networks

| Network | Internal | Members | Why |
|---|---|---|---|
| `telemetry` | yes | web, agent, otel-collector | The apps' only route to the collector. |
| `observe` | yes | otel-collector, openobserve, observability-init, web | Collector → OpenObserve export. OpenObserve → web alert webhook. The init job reaches the OpenObserve API. |
| `observe-store` | yes | openobserve, garage | OpenObserve's only route to its S3 bucket. It never sees Postgres. |
| `observe-edge` (prod: external `mastertutor-obs`) | yes | openobserve, Traefik | Traefik's only route to OpenObserve. Slots are never on it. |
| `obs-ingest` | no | otel-collector | Needed only to publish the loopback port that the Docker daemon's fluentd driver connects to. Docker cannot publish a port from a container on internal networks only. |

Slots, `pdf-worker`, `audio-capture` and `docling` join no new network. Their existing network rules (`WORKERS` in `tests/compose/prod-mode.ts`) are untouched.

### 4.3 Module dependency map

```
@mastertutor/contracts      (leaf: zod, pino; server/log-bridge.ts uses @opentelemetry/api + api-logs only)
   ▲        ▲        ▲          ▲
   │        │        │          │
telemetry  storage  observability   (each depends on contracts only)
   ▲
   │
  db  ──────────────▶ contracts
   ▲
apps/agent ─▶ contracts, db, storage, sealing, telemetry
apps/web   ─▶ contracts, db, storage, sealing, telemetry (server code only)
```

- `@mastertutor/telemetry` → `@mastertutor/contracts` (names, `RunEvent`, `Usage`, decider constants, the log bridge's `enableLogBridge` and `withRunId`).
- `@mastertutor/db` → `@mastertutor/telemetry` (one call in `emitRunEvent`). This is new. The telemetry package does not depend on db, so there is no cycle.
- `@mastertutor/observability` (provisioning only) → `@mastertutor/contracts`. It is never imported by a running service. It runs as a one-shot job, like `garage-init`.
- `@mastertutor/contracts` imports no workspace package (unchanged).
- Client code in `apps/web` never imports `@mastertutor/telemetry` (an ESLint ban, like the existing server-contracts ban).

**Where the names live.** Product span, attribute and metric names are in `packages/contracts/src/telemetry.ts`, exported as `@mastertutor/contracts/telemetry`. There are three reasons:

1. The log bridge in `contracts/src/server` needs the run-id key. Putting the names in the telemetry package would make contracts depend on it, which is a cycle.
2. Contracts is the repo's declared single source of truth for anything shared across process boundaries (CLAUDE.md principle 6). These names are a contract between the SDK, the collector config, the dashboards and the alerts, and both `telemetry` and `observability` read them.
3. The file is plain constants and types with no runtime dependency, so the contracts leaf stays light.

The collector YAML cannot import TypeScript, so a unit test asserts that the YAML's `spanmetrics` namespace and dimensions match the registry, and that every name in a dashboard or alert exists in it.

## 5. Product telemetry contract (`packages/contracts/src/telemetry.ts`)

Everything is prefixed `mt.`. All names are lowercase, dotted and stable. Renaming one is a breaking change to the dashboards and alerts.

### 5.1 Spans

| Constant | Name | Where | Ends as error when |
|---|---|---|---|
| `SPAN.step` | `mt.step` | each `RunLoop.step` phase | the phase throws (an interruption is not an error) |
| `SPAN.modelRequest` | `mt.model.request` | each `ModelCaller.call` (its retries included) | `ModelUnavailable` or `ContextOverflow` |
| `SPAN.tool` | `mt.tool` | each function tool (`ToolRegistry.run`) and each computer call (`RunLoop` act) | the tool fails or is refused |
| `SPAN.stepCommit` | `mt.step.commit` | `StepStore.commit` (the step transaction, which stands in for DB instrumentation, §7.2) | the commit throws (`LeaseLost`, `RunChanged`) |
| `SPAN.slotReset` | `mt.slot.reset` | `SlotPool.#reset` | the slot does not restart in time |
| `SPAN.takeover` | `mt.takeover` | handing the browser to the person (`RunWorker.#holdForUser`) and taking it back | `takeover_failed` or `control_restore_failed` |
| `SPAN.alertDelivery` | `mt.alert.delivery` | the webhook fan-out in web | every push fails |

### 5.2 Attributes (allowlisted; value types are fixed in the TypeScript type `AttributeValues`)

| Constant | Name | Type | Notes |
|---|---|---|---|
| `runId` | `mt.run.id` | uuid string | High cardinality: an attribute only, never a metric dimension |
| `stepPhase` | `mt.step.phase` | `observe\|decide\|approve\|act` | |
| `stepOutcome` | `mt.step.outcome` | `continue\|waiting\|completed\|failed\|cancelled` | an interrupted step carries `mt.interruption` instead |
| `interruption` | `mt.interruption` | `InterruptCause` | `takeover`, `cancel`, `kill`, `shutdown`, `lease_lost`, `crash` |
| `modelName` | `mt.model.name` | string ≤ 64 | the model actually used |
| `modelFallback` | `mt.model.fallback` | boolean | |
| `modelAttempts` | `mt.model.attempts` | int | |
| `tokensInput` / `tokensCached` / `tokensOutput` | `mt.model.tokens.input` / `.cached` / `.output` | int | |
| `costUsd` | `mt.model.cost_usd` | number | from `costUsd()` |
| `tokenType` | `mt.model.token_type` | `input\|cached\|output` | metric dimension only |
| `toolName` | `mt.tool.name` | `ToolName` | |
| `toolOutcome` | `mt.tool.outcome` | `ok\|tool_error\|stale_ref\|failed\|unavailable\|refused` | |
| `actionTypes` | `mt.action.types` | string[] ≤ 16 | computer action types only (`click`, `type`, …), never typed text |
| `errorCode` | `mt.error.code` | `^[a-z][a-z0-9_]{0,63}$` | product error code, never a message |
| `approvalKind` | `mt.approval.kind` | `ApprovalRequest["kind"]` | |
| `approvalStatus` | `mt.approval.status` | `ApprovalStatus` | |
| `approvalDecider` | `mt.approval.decider` | `person\|policy\|bypass` | never a user id |
| `vaultAlias` | `mt.vault.alias` | vault alias | never a value, field content or origin |
| `captureFidelity` | `mt.capture.fidelity` | `Fidelity` | |
| `captureCoverage` | `mt.capture.coverage` | number 0..1 | |
| `slotName` | `mt.slot.name` | `browser-N` | |
| `slotOutcome` | `mt.slot.outcome` | `leased\|released\|ok\|timeout` | |
| `takeoverOutcome` | `mt.takeover.outcome` | `ok\|takeover_failed\|control_restore_failed` | |
| `controlHolder` | `mt.control.holder` | `Controller` | |
| `runStatus` | `mt.run.status` | `RunStatus` | |
| `blockType` / `blockOrigin` | `mt.block.type` / `mt.block.origin` | `BlockType` / `BlockOrigin` | |
| `downloadState` | `mt.download.state` | `pending\|ready` | |
| `filedBy` | `mt.filed_by` | `FiledBy` | |
| `alertRule` | `mt.alert.rule` | `AlertRule` | |
| `pushOutcome` | `mt.push.outcome` | `sent\|gone\|failed\|refused` | |
| `slotState` | `mt.slot.state` | `SlotState` | gauge dimension |
| `telemetrySignal` | `mt.telemetry.signal` | `traces\|metrics\|logs` | |
| `dropReason` | `mt.telemetry.drop_reason` | `queue_full\|export_failed\|not_allowed` | `not_allowed` counts attributes removed by the allowlist |
| `dependency` | `mt.dependency` | `openai\|s3\|docling\|pdf-worker\|audio-capture\|neko\|push` | set by the collector only |
| `service` | `mt.service` | `browser-N\|pdf-worker\|audio-capture\|docling` | set by the collector on container log lines only |

The base (non-product) attributes the SDK may export are in `BASE_ATTRIBUTES`: `http.request.method`, `http.response.status_code`, `server.address`, `server.port`, `url.scheme`, `error.type`, `network.protocol.version`, `http.route`, `next.route`, `next.span_type`, `next.span_name`, `exception.type`. Every other attribute is dropped before export and the drop is counted (`mt.telemetry.dropped{reason=not_allowed}`). URLs (`url.full`, `url.path`, `url.query`, `http.target`) are never exported, because S3 keys can carry filenames and query strings can carry anything.

### 5.3 Metrics

| Constant | Name | Kind | Unit | Dimensions | Recorded at |
|---|---|---|---|---|---|
| `runsEnded` | `mt.runs.ended` | counter | `{run}` | `mt.run.status` | `emitRunEvent` (`status` with a terminal status) |
| `runFailures` | `mt.run.failures` | counter | `{run}` | `mt.error.code` | `StepStore.commit` after a commit with `transition.to = "failed"` |
| `runErrors` | `mt.run.errors` | counter | `{error}` | `mt.error.code` | `emitRunEvent` (`error`) |
| `approvalsRequested` | `mt.approvals.requested` | counter | `{approval}` | `mt.approval.kind` | `emitRunEvent` |
| `approvalsResolved` | `mt.approvals.resolved` | counter | `{approval}` | `mt.approval.status`, `mt.approval.decider` | `emitRunEvent` |
| `controlChanges` | `mt.control.changes` | counter | `{change}` | `mt.control.holder` | `emitRunEvent` |
| `slotLeases` | `mt.slot.leases` | counter | `{lease}` | `mt.slot.outcome` | `emitRunEvent` (`slot`) |
| `blocksAdded` | `mt.blocks.added` | counter | `{block}` | `mt.block.type`, `mt.block.origin` | `emitRunEvent` |
| `downloads` | `mt.downloads` | counter | `{download}` | `mt.download.state` | `emitRunEvent` |
| `downloadSize` | `mt.download.size` | histogram | `By` | `mt.download.state` | `emitRunEvent` |
| `budgetHits` | `mt.budget.hits` | counter | `{hit}` | — | `emitRunEvent` (`budget`) |
| `modelFallbacks` | `mt.model.fallbacks` | counter | `{fallback}` | `mt.model.name` | `emitRunEvent` |
| `notesFiled` | `mt.notes.filed` | counter | `{note}` | `mt.filed_by` | `emitRunEvent` |
| `modelTokens` | `mt.model.tokens` | counter | `{token}` | `mt.model.name`, `mt.model.token_type` | `ModelCaller.call` |
| `spendUsd` | `mt.spend.usd` | counter | `USD` | — | `StepStore.commit` (the change in `runs.usage.usd`, after the commit) |
| `slots` | `mt.slots` | observable gauge | `{slot}` | `mt.slot.state` | agent (reads `listBrowserSlots`) |
| `activeRuns` | `mt.runs.active` | observable gauge | `{run}` | — | agent (`Supervisor.activeRuns`) |
| `sseConnections` | `mt.sse.connections` | up-down counter | `{connection}` | — | web SSE route (open and close only) |
| `alertsReceived` | `mt.alerts.received` | counter | `{alert}` | `mt.alert.rule` | web webhook |
| `pushSends` | `mt.push.sends` | counter | `{push}` | `mt.push.outcome` | web push sender |
| `telemetryDropped` | `mt.telemetry.dropped` | counter | `{item}` | `mt.telemetry.signal`, `mt.telemetry.drop_reason` | the SDK's own export path |

**Derived by the collector** (`spanmetrics`, namespace `mt.span`): `mt.span.calls` and `mt.span.duration` (histogram, ms). Dimensions are `service.name`, `span.name`, `status.code` and the `SPANMETRIC_DIMENSIONS` list: `mt.step.phase`, `mt.step.outcome`, `mt.tool.name`, `mt.tool.outcome`, `mt.model.name`, `mt.error.code`, `mt.capture.fidelity`, `mt.slot.name`, `mt.takeover.outcome`, `mt.dependency`. Spanmetrics run before tail sampling, so RED counts cover 100% of spans.

OpenObserve stores each metric as a stream with dots replaced by underscores (`mt.runs.ended` → `mt_runs_ended`). That mapping is one function, `o2StreamName()`, in `packages/observability`.

## 6. The telemetry package (`packages/telemetry`, `@mastertutor/telemetry`)

### 6.1 Public interface

```ts
// register.ts: preloaded with `node --import ./packages/telemetry/src/register.ts` (agent);
//              called from apps/web/instrumentation.ts (web).
export function startTelemetry(options: StartOptions): TelemetryHandle;
export interface StartOptions { service: "web" | "agent"; env: TelemetryEnv; crash: "exit" | "observe"; log: Log }
export interface TelemetryHandle { flush(timeoutMs?: number): Promise<void>; shutdown(timeoutMs?: number): Promise<void> }
export function getTelemetry(): TelemetryHandle;       // the process's handle (no-op before start)

// instrument.ts
export function instrument<T>(
  name: SpanName,
  attributes: ProductAttributes,
  work: (span: ProductSpan) => Promise<T>,
  options?: { expected?(error: unknown): string | null }, // returns the interruption cause
): Promise<T>;
export interface ProductSpan { set(attributes: ProductAttributes): void; fail(code: string): void }
export function errorCodeOf(error: unknown): string;

// record.ts: typed recorders (metrics only; names come from contracts)
export function recordRunEvent(event: RunEvent): void;
export function recordRunFailure(code: string): void;
export function recordSpend(usd: number): void;
export function recordModelTokens(model: string, tokens: { input: number; cached: number; output: number }): void;
export function recordSseConnection(delta: 1 | -1): void;
export function recordAlertReceived(rule: AlertRule): void;
export function recordPush(outcome: PushOutcome): void;
export function observeAgentGauges(source: { slotStates(): Promise<SlotState[]>; activeRuns(): number }): void;
```

Every function works with no SDK running: OTel's API is a no-op until a provider is registered. This means the unit, integration and behaviour suites need no changes and never touch a collector.

### 6.2 Dependencies (exact versions, nothing wholesale)

| Package | Version | Why |
|---|---|---|
| `@opentelemetry/api` | 1.9.1 | API (also used by the contracts log bridge) |
| `@opentelemetry/api-logs` | 0.223.0 | Logs API (also used by the contracts log bridge) |
| `@opentelemetry/sdk-trace-node` | 2.12.0 | Tracer provider with AsyncLocalStorage context |
| `@opentelemetry/sdk-trace-base` | 2.12.0 | `ReadableSpan`, `SpanExporter` types |
| `@opentelemetry/sdk-metrics` | 2.12.0 | Meter provider and periodic reader |
| `@opentelemetry/sdk-logs` | 0.223.0 | Logger provider |
| `@opentelemetry/resources` | 2.12.0 | Resource attributes |
| `@opentelemetry/core` | 2.12.0 | `ExportResultCode` |
| `@opentelemetry/exporter-trace-otlp-proto` | 0.223.0 | OTLP/HTTP protobuf |
| `@opentelemetry/exporter-metrics-otlp-proto` | 0.223.0 | OTLP/HTTP protobuf |
| `@opentelemetry/exporter-logs-otlp-proto` | 0.223.0 | OTLP/HTTP protobuf |
| `@opentelemetry/instrumentation` | 0.223.0 | `registerInstrumentations` |
| `@opentelemetry/instrumentation-http` | 0.223.0 | Outgoing `node:http(s)`: the AWS SDK's S3 calls |
| `@opentelemetry/instrumentation-undici` | 0.33.0 | Outgoing `fetch`: OpenAI, docling, pdf-worker, audio-capture, n.eko admin, Web Push |

**Not used:** `@opentelemetry/sdk-node` (it pulls in every exporter), `auto-instrumentations-node`, `instrumentation-pg`, `instrumentation-aws-sdk`.

- **pg:** our driver is `postgres` (postgres.js 3.4.9, `packages/db/src/client.ts`), not `pg`. `instrumentation-pg` would instrument nothing, and no OTel instrumentation exists for postgres.js. The hot DB path, the per-step transaction, is covered by the `mt.step.commit` span instead. Hand-wrapping postgres.js's lazy query objects would be invasive and fragile.
- **aws-sdk:** S3 traffic is already covered as HTTP client spans (`server.address = garage`), and the collector names them `s3 GET`, `s3 PUT` and so on (§10). `instrumentation-aws-sdk` patches the SDK's module graph, which Next bundles in web. It would add a second patching mechanism for little gain.

### 6.3 Startup

- If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, `startTelemetry` registers nothing and returns a no-op handle. Test stacks leave it unset.
- Resource: `service.name` (`web` or `agent`), `service.namespace=mastertutor`, `deployment.environment.name` (`MT_DEPLOYMENT`).
- Traces: `NodeTracerProvider` with one `BoundedSpanProcessor` around an `AllowlistSpanExporter` around `OTLPTraceExporter` (`/v1/traces`, 5 s timeout). `register()` is called with an empty composite propagator (§7.4).
- Metrics: `MeterProvider` with a `PeriodicExportingMetricReader` (30 s interval, 5 s timeout) around a counting wrapper of `OTLPMetricExporter`.
- Logs: `LoggerProvider` with one `BoundedLogProcessor` around `OTLPLogExporter`. Then `enableLogBridge()` turns on the pino → OTel stream.
- Instrumentations: `HttpInstrumentation({ ignoreIncomingRequestHook: () => true, requireParentforOutgoingSpans: true })` and `UndiciInstrumentation({ requireParentforSpans: true })`. Only calls made inside a product span are traced, which keeps background noise (heartbeats, storage pings) out. Next.js creates its own server spans in web.
- Agent: preloaded with `node --import ./packages/telemetry/src/register.ts apps/agent/src/main.ts`, so the instrumentations are registered before the AWS SDK first requires `node:http`. `register.ts` parses `TelemetryEnv` from `process.env`. `main.ts` then calls `getTelemetry()` to flush on shutdown.
- Web: `apps/web/instrumentation.ts` `register()` calls `startTelemetry({ service: "web", crash: "observe" })` for the Node runtime. `next.config.ts` adds the OTel packages to `serverExternalPackages`, so the instrumentations patch real `node:http`.

## 7. Behaviour rules

### 7.1 Never block, never break (R8)

- **Bounded queues.** Spans and log records go into `BoundedBatcher` (§6.3), which holds at most 2,048 items. When the queue is full, `add()` drops the item and counts it as `queue_full`. It never awaits. A timer (2 s, `unref`) and the 512-item batch size trigger an export, with at most one export in flight. A failed or timed-out export counts its items as `export_failed`. Metrics are aggregated in memory, so they are bounded by cardinality; a failed metric export counts 1.
- **Drops are counted** in `mt.telemetry.dropped` and logged at most once a minute to stdout (module `telemetry`; the bridge skips that module, so it cannot loop).
- **Exceptions are contained.** Every SDK callback that our code supplies (the processors, the exporter wrappers, the bridge stream, the gauge callbacks) catches its own exceptions. `instrument()` always runs `work`. If starting a span throws, the work runs without one.
- **Errors on spans.** `instrument()` sets `mt.error.code = errorCodeOf(error)`, sets the status to ERROR with that code as its message, and adds an `exception` event whose only attribute is `exception.type = error.name`. It never calls `recordException`, which would copy the message and stack, and a message can quote page text. Interruptions (`interruptionOf`) set `mt.interruption` and leave the status UNSET.
- **Crash handlers.** In `crash: "exit"` mode (agent), an `uncaughtException` listener (which also receives unhandled rejections in Node's default `throw` mode) logs `errorCode: "uncaught_exception"` with `origin` and `err: error.name`, flushes with a 2 s cap, prints the error to stderr as Node does today, and calls `process.exit(1)`. That is today's behaviour plus a log line and a flush. In `crash: "observe"` mode (web), Next.js owns the process: we add only an `uncaughtExceptionMonitor` listener plus a flush in the background, so the default behaviour is unchanged.
- **Shutdown flush.** The agent's `shutdown()` calls `getTelemetry().shutdown(3000)` before `process.exit(0)`. That fits inside the 30 s `stop_grace_period`. Web adds no `SIGTERM` listener: Next.js owns that signal, and a second listener could hold the process open. At most one 2 s batch is lost when web stops.
- **Tests with the collector down.** A unit test sends spans to a closed port: `instrument()` latency stays within budget and the drop counter rises. A remote suite runs the prod-like stack with the endpoint set and the collector stopped, and checks that a run still completes.

### 7.2 Traces are per step, not per run

A run can last hours and sleep and wake many times. One trace per run would defeat tail sampling, which waits a bounded time (20 s) for a trace to finish. So each `mt.step` span is a trace root carrying `mt.run.id`. Model, tool, commit and HTTP spans nest under it. The run view in OpenObserve is a filter on `mt.run.id`. Takeovers and slot resets are their own short roots.

### 7.3 Seams (where `instrument()` is applied)

| # | File | Seam | Span or record |
|---|---|---|---|
| 1 | `apps/agent/src/loop/run-loop.ts` | `RunLoop.step(signal)` (the phase dispatcher) | `mt.step` (phase, outcome, run id) |
| 2 | `apps/agent/src/loop/run-loop.ts` | `#execute` computer branch | `mt.tool` (`computer`, action types, ok/refused) |
| 3 | `apps/agent/src/tools/registry.ts` | `ToolRegistry.run` | `mt.tool` for function tools, plus attributes declared by the tool (§7.5) |
| 4 | `apps/agent/src/llm/caller.ts` | `ModelCaller.call` | `mt.model.request` (model, fallback, attempts, tokens, cost, rejection code) and `mt.model.tokens` |
| 5 | `apps/agent/src/loop/step-store.ts` | `StepStore.commit` | `mt.step.commit`, and after it commits, `mt.spend.usd` and `mt.run.failures` |
| 6 | `packages/db/src/queries/events.ts` | `emitRunEvent` | every run-event metric (§5.3): approvals, takeovers, slot leases, budget, downloads, blocks, filing, fallbacks, errors, run endings |
| 7 | `apps/agent/src/slots/pool.ts` | `SlotPool.#reset` | `mt.slot.reset` |
| 8 | `apps/agent/src/loop/worker.ts` | `RunWorker.#holdForUser` give and take-back | `mt.takeover` |
| 9 | `apps/web/lib/server/runs/event-stream.ts` | SSE open and close | `mt.sse.connections` |
| 10 | `apps/web/lib/server/alerts/deliver.ts` (new) | webhook fan-out | `mt.alert.delivery`, `mt.alerts.received`, `mt.push.sends` |

No tool is wrapped individually. Vault fills and captures show up through seam 3. Approvals, the policy decision point, downloads, budget hits and slot leases all show up through seam 6, because every decision and every hand-over is already a `RunEvent` written by `emitRunEvent`, for both agent and web.

One caveat on seam 6: `emitRunEvent` runs inside its caller's transaction, so a rolled-back transaction can still have counted its events. Rollbacks after an event is written are rare (a lost lease mid-commit). The counts are monitoring signals, not ledgers, so this is acceptable. Spend and run failures, which do need to match the database, are recorded only after commit (seam 5).

### 7.4 No context propagation

`register()` gets an empty propagator. No `traceparent` header is ever added to outgoing requests: not to OpenAI (D38 forbids sending identifiers), not to Apple's push service, and not to sites the agent's tools fetch. Nothing in our topology needs propagation (§1).

### 7.5 Tool-declared attributes

`Tool` (`apps/agent/src/tools/types.ts`) gains an optional field:

```ts
/** Allowlisted span attributes for this call; never page text, values or arguments verbatim. */
telemetry?(args: A, result: R): ToolAttributes;
```

`ToolAttributes` (in `@mastertutor/contracts/telemetry`) is `Pick<ProductAttributes, "mt.vault.alias" | "mt.capture.fidelity" | "mt.capture.coverage" | "mt.error.code">`. The TypeScript type limits each tool to these keys. `register()` erases the generics as it already does. Only `capture` (fidelity, coverage), `fill_credential` and `use_passkey` (alias, plus the vault's own result code) declare it. The registry applies it only after a run returns. A returned `mt.error.code` marks the call `tool_error`, because the vault tools return their failures instead of throwing.

## 8. What the dashboards can answer

| Dashboard | Panels (all queries in `packages/observability/src/dashboards/*.ts`) |
|---|---|
| System health | Collector and OpenObserve up; span error rate by `service.name`; HTTP client p95 by `mt.dependency`; `mt.telemetry.dropped` by signal and reason; container log errors by service |
| Runs and agent | Runs ended by status; active runs; step p50/p95 by phase; step outcomes; tool calls, error rate and p95 by `mt.tool.name`; approvals requested by kind; approvals resolved by decider; takeovers by outcome |
| Model and spend | Spend per hour and per day; tokens by model and type; model request p95; fallbacks; rejections by `mt.error.code`; budget hits |
| Capture fidelity | Captures by fidelity; mean coverage; blocks added by type and origin; notes filed by agent or user |
| Slots and live view | Slots by state; slot leases; slot reset p95 and timeouts by slot; takeover outcomes and latency; SSE connections; browser container log errors |
| Errors | Run failures by code; run errors by code; error spans by `span.name` and code; app log errors (stream `mastertutor`); container log errors (stream `containers`) |

## 9. Logs

- `createLogger` (`packages/contracts/src/server/logger.ts`) keeps its options and its redaction. It gains:
  - a pino `mixin` that adds `trace_id` and `span_id` (from the active span) and `run_id` (from the context key set by `instrument()` when it receives `mt.run.id`), only when they exist;
  - a `pino.multistream` with two streams. One is stdout, synchronous as today (or `options.destination` in tests). The other is the bridge stream from `log-bridge.ts`.
- The bridge stream receives each line **after** pino has serialised and redacted it. Until `enableLogBridge()` is called it returns at once, so there is no parse cost without the SDK. Once enabled, it parses the line and emits an OTel `LogRecord`: severity from pino's level, body from `msg`, attributes from the remaining fields minus `level`, `time`, `msg`, `pid` and `hostname`. It emits in the caller's context, so the record carries trace and span ids. It skips lines whose `module` is `telemetry`.
- stdout JSON is unchanged apart from the three new fields, so Dokploy's log viewer keeps working.
- App logs go to the OpenObserve stream `mastertutor`. Container logs (slots with n.eko and Chromium, `pdf-worker`, `audio-capture`, `docling`) go to the stream `containers`.

**Container logs without the Docker socket.** In `compose.prod.yml` these services switch from `json-file` to Docker's `fluentd` log driver, configured as follows:

- `fluentd-address: 127.0.0.1:24224` and `fluentd-async: "true"`, so a container starts and runs even while the collector is down;
- `mode: non-blocking` with `max-buffer-size: 4m`, so logging never blocks the process;
- `tag: mt.{{.Name}}`.

Docker's dual-logging cache, bounded by `cache-max-size: 10m` and `cache-max-file: "3"`, keeps `docker logs` and Dokploy's viewer working.

The collector's `fluentforward` receiver listens on that loopback port. We rejected the alternatives:

- Mounting `/var/lib/docker/containers` read-only would expose every tenant's logs on the shared host (D41, D45).
- The Docker socket would be root-equivalent.
- Wrapping third-party entrypoints with `tee` would break signal handling.

## 10. Collector (`infra/otel/collector.yaml`)

**Receivers:**

- `otlp` (HTTP only, `0.0.0.0:4318`, 4 MiB body cap);
- `fluentforward` (`0.0.0.0:24224`).

**Processors:**

- `memory_limiter` (check every 1 s, limit 400 MiB, spike 100 MiB). The container is limited to 512 MiB.
- `filter/health` drops spans for the `/healthz` route.
- `attributes/scrub` deletes any attribute whose key matches `(?i).*(password|passwd|secret|token|cookie|authorization|api[_-]?key|otp|totp|sealed|pin)$`.
- `transform/scrub` is the second secret-scrub pass. It replaces values matching any of these patterns with `****`, in span and log attributes and in log bodies. The YAML writes `\s` and `\.` as POSIX classes, so escaping cannot change a pattern's meaning:
  - `(?i)bearer\s+[a-z0-9._~+/-]+=*`
  - `sk-[A-Za-z0-9_-]{16,}`
  - `eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`
  - `(?i)basic\s+[a-z0-9+/]{8,}=*`
  - `(NEKO_SESSION|live_slot|better-auth\.[a-z_]+)=[^;\s]+`
- `transform/product` maps base telemetry to product telemetry:
  - It sets `mt.dependency` from `server.address`: `api.openai.com` → `openai`, `garage` → `s3`, `docling`, `pdf-worker`, `audio-capture`, `browser-N` → `neko`, and Apple/FCM/Mozilla push hosts → `push`.
  - It renames HTTP client spans to `<dependency> <METHOD>`.
  - It deletes `url.full`, `url.path`, `url.query` and `http.target`, a defence in depth behind the SDK allowlist.
  - For container logs, it sets `mt.service` from `container_name` (`/<project>-browser-3-1` → `browser-3`).
- `tail_sampling` (decision wait 20 s, 20,000 traces in memory) keeps every trace that:
  - has an ERROR span;
  - has any `mt.error.code`;
  - lasts longer than 15 s;
  - or falls in the 10% probabilistic sample.
- `batch` (1,024 items, 2 s timeout, 2,048 maximum).

**Connectors:**

- `spanmetrics` (namespace `mt.span`; buckets 5, 25, 100 and 250 ms, then 1, 2.5, 5, 15 and 60 s; dimensions from §5.3; flush every 30 s);
- `forward/sample`.

**Exporters:**

- `otlphttp/openobserve` (`http://openobserve:5080/api/default`, `basicauth/openobserve` extension with the ingest user, sending queue of 2,000, retries for at most 120 s), used for traces and metrics;
- `otlphttp/app-logs`, which adds `stream-name: mastertutor`;
- `otlphttp/container-logs`, which adds `stream-name: containers`.

**Pipelines:**

| Pipeline | Receivers | Processors | Exporters |
|---|---|---|---|
| `traces/ingest` | otlp | memory_limiter, filter/health, attributes/scrub, transform/scrub, transform/product | spanmetrics, forward/sample |
| `traces/sample` | forward/sample | tail_sampling, batch | otlphttp/openobserve |
| `metrics` | otlp, spanmetrics | memory_limiter, attributes/scrub, batch | otlphttp/openobserve |
| `logs/app` | otlp | memory_limiter, attributes/scrub, transform/scrub, batch | otlphttp/app-logs |
| `logs/containers` | fluentforward | memory_limiter, transform/scrub, transform/product, batch | otlphttp/container-logs |

The collector's own metrics (`service.telemetry.metrics`, level `basic`) are pushed to its own OTLP receiver, so its export failures and queue sizes appear in the system-health dashboard. Its health check (`health_check` extension on `:13133`) is used by the compose healthcheck through the image's `healthcheck` subcommand. If the pinned image lacks that subcommand, the spike task (Task B1) records the fallback. The container is hardened:

- `read_only` root filesystem;
- uid 10001;
- `cap_drop: [ALL]`;
- `no-new-privileges`;
- 512 MiB of memory, 0.5 CPU and 128 pids.

## 11. OpenObserve

- **Storage.** Local mode with S3 storage:
  - `ZO_LOCAL_MODE=true`, `ZO_LOCAL_MODE_STORAGE=s3`;
  - `ZO_S3_SERVER_URL=http://garage:3900`, `ZO_S3_REGION_NAME=garage`, `ZO_S3_BUCKET_NAME=observability`;
  - its own key `S3_OBSERVE_*`, which has read/write on `observability` and no access to `mastertutor`. The web and agent keys have no access to `observability`. `bootstrapGarage` already applies this split per key.
- **Local state.** WAL and metadata live on the `openobserve-data` volume, which Dokploy's volume backup covers.
- **Lockdown:**
  - `ZO_TELEMETRY=false` (no phone-home; it also has no egress);
  - `ZO_BASE_URI=/observability`, `ZO_WEB_URL=${PUBLIC_URL}/observability`;
  - `ZO_COOKIE_SECURE_ONLY=true`;
  - `ZO_COMPACT_DATA_RETENTION_DAYS=90`, the global default. That is the metrics retention.
- **Per-stream retention**, set by the provisioner: `mastertutor` and `containers` logs 30 d, `default` traces 15 d.
- **Bounds** (compose.prod.yml): 2 GiB of memory, 1 CPU, 256 pids, `json-file` logging like every other service. No published ports.
- **Users.** All three are created by the provisioner:
  - `root@mastertutor.internal` is used only by `observability-init`;
  - `ingest@mastertutor.internal` is used only by the collector;
  - `viewer@mastertutor.internal` has its credentials injected by ForwardAuth (§12).

  The minimum role for each comes from the pinned image's API. The spike task records it.
- **Provisioning is code**, in `packages/observability`. The one-shot `observability-init` job runs `node packages/observability/src/bin/observability-init.ts`. It is idempotent:
  1. wait for `/healthz`;
  2. create or update the users;
  3. create the streams and set retention;
  4. upsert the alert destination and template;
  5. upsert the six dashboards by title;
  6. upsert the alerts by name.

  Dashboards and alerts are typed TypeScript objects that import their names from `@mastertutor/contracts/telemetry`. A small builder turns them into OpenObserve's JSON. Nothing is hand-edited in the UI. If the owner edits a dashboard in the UI, the next deploy overwrites it.
- **API contract test.** `packages/observability/src/o2-api.int.test.ts` runs the pinned image and pins every endpoint and payload the provisioner uses. A digest bump that changes the API fails it.

## 12. `/observability` access (owner only)

- **Routing.** Traefik router `mastertutor-observability`: `Host(${DOMAIN}) && PathPrefix(/observability/)`, priority 900 (below `/live`'s 1000), to service `openobserve:5080` over the `mastertutor-obs` network. The router's middlewares are:
  1. `mastertutor-observability-auth`, a ForwardAuth to `http://${CDP_SUBNET_PREFIX}.11:3000/api/observability/auth`, with `trustForwardHeader: false` and `authResponseHeaders: Authorization, Cookie`;
  2. `mastertutor-live-headers` (reused: `frame-ancestors 'self'`, nosniff).

  A bare `/observability` path is redirected to `/observability/` by a `redirectregex` middleware on the same router.
- **The auth endpoint** (`apps/web/app/api/observability/auth/route.ts`) uses the existing `getViewer()` and the new `memberRoleOf(db, userId)`:
  - signed out → `302` to `/sign-in?next=/api/observability/enter` (via `signInPathFor`, `apps/web/lib/auth/next-path.ts`);
  - signed in but not the owner → `403`;
  - owner → `200` with `Authorization: Basic base64(viewer:OBSERVE_VIEWER_PASSWORD)` and `Cookie: mt_obs=1`.

  Traefik copies both onto the upstream request. The browser's own `Authorization` header and every MasterTutor cookie (session, `live_slot`) are replaced, so OpenObserve never sees them. A fixture build always answers `403`, as `/api/live/auth` does.
- **OpenObserve's client-side session gate.** OpenObserve's UI router sends the browser to its `/login` page unless its local user-info record exists (`web/src/router/index.ts`, `getDecodedUserInfo`). Task B1 pins the exact mechanism against the digest. The design is:
  - the auth endpoint's `Authorization` header authenticates every API call;
  - an owner-only web route, `GET /api/observability/enter`, writes OpenObserve's local user-info record for the viewer identity (identity only, no secret) and redirects to `/observability/web/`;
  - the Alerts page's "Open dashboards" link points at `/api/observability/enter`.

  The owner never sees OpenObserve's login form. If the pinned UI also requires its session cookie, the fallback is Traefik's `addAuthCookiesToResponse: [auth_tokens]`: the auth endpoint mints a `Path=/observability/; HttpOnly; Secure; SameSite=Strict` cookie. That cookie is only useful behind the same ForwardAuth, because OpenObserve has no other ingress. A Playwright test in the `observability` suite (Task F1) signs in as the owner, opens a provisioned dashboard and fails on any `/login` redirect, so a digest bump that breaks this is caught.
- **Never public without our auth.** OpenObserve publishes no port, and its only ingress is the ForwardAuth router. A test asserts that the router carries the auth middleware and that `openobserve` has no `ports`.
- **Host step (needs user approval, D41).** Two steps, both following existing patterns and both deferred with the deploy (D42):
  - `infra/host/create-obs-network.sh` creates the external internal network `mastertutor-obs`, mirroring `create-cdp-network.sh`;
  - `attach-traefik.sh` gains `--network obs`, which attaches Traefik to it with no fixed IP, because nothing filters on Traefik's address there.

## 13. Alerts

### 13.1 Rules (code: `packages/observability/src/alerts.ts`, names in `packages/contracts/src/alerts.ts`)

| `AlertRule` | Fires when (evaluated every 1 min by OpenObserve) | Phone? |
|---|---|---|
| `error_spike` | ≥ 20 error-level records in the app log stream `mastertutor` within 5 min (container errors are a dashboard panel: their lines have no reliable level) | yes |
| `model_request_rejected` | `mt.run.failures{mt.error.code="model_request_rejected"}` increases within 5 min | yes |
| `run_failed` | `mt.runs.ended{mt.run.status="failed"}` increases within 5 min | yes |
| `slot_crash_loop` | ≥ 3 `mt.slot.reset` spans with status ERROR for the same `mt.slot.name` within 10 min (from `mt.span.calls`) | yes |
| `spend_jump` | `mt.spend.usd` increase over 60 min > `SPEND_ALERT_USD_PER_HOUR` (default 25) | yes |

Each rule has a 30-minute silence after it fires.

### 13.2 Delivery: OpenObserve → web

- OpenObserve's alert destination is a webhook: `POST http://web:3000/api/alerts/webhook` over the `observe` network. It sends `Authorization: Bearer ${ALERT_WEBHOOK_SECRET}` and the template body `{"rule":"{alert_name}","firedAt":"{alert_trigger_time}"}`. Task B1 pins the template variable names.
- The webhook route (`apps/web/app/api/alerts/webhook/route.ts`) runs these checks in order, all fail-closed:
  1. `ALERT_WEBHOOK_SECRET` must be set, else `404`.
  2. The request must carry no `X-Forwarded-For` or `X-Forwarded-Host`, else `404`. Traefik always adds these, so a public request is refused before auth, and the route behaves as if it does not exist publicly.
  3. Constant-time bearer compare, else `401`.
  4. Body of at most 4 KiB, parsed with `AlertWebhookBody`; the rule must be in `ALERT_RULES`; else `400`.
  5. Insert the alert into `alerts`, deduplicated per rule within 10 minutes.
  6. Answer `202` at once and deliver after the response (Next's `after()`).
- Only the rule name and the time are stored. OpenObserve free text, counts and query results never reach the DB or the phone.

### 13.3 In-app

- Table `alerts`: `id`, `workspace_id`, `rule`, `fired_at`, `acknowledged_at`, `acknowledged_by`, `created_at`.
- RPC namespace `alerts`, owner only:
  - `list` (newest first, keyset pages);
  - `active` (unacknowledged, at most 5);
  - `acknowledge`;
  - `pushConfig`;
  - `subscribe`;
  - `unsubscribe`.
- `AlertBanner` sits in `app-shell.tsx` beside `KillBanner`. It is shown to the owner only while there are unacknowledged alerts, and links to `/settings/alerts`. It is fetched on mount and on window focus with React Query, with no interval polling. Web Push covers real-time delivery.
- Page `/settings/alerts`: the list, with Acknowledge and a deep-link anchor per alert (`#alert-<id>`).

### 13.4 Web Push

- **Library choice.** We implement RFC 8291 (message encryption, `aes128gcm`) and RFC 8292 (VAPID ES256 JWT) on `node:crypto` in `apps/web/lib/server/push/`, about 150 lines. The usual library, `web-push` 3.6.7, was last released in 2024 and brings five transitive dependencies (`asn1.js`, `http_ece`, `https-proxy-agent`, `jws`, `minimist`) for work that Node's ECDH, HKDF, AES-GCM and ECDSA (`dsaEncoding: "ieee-p1363"`) already do. Correctness is pinned by RFC 8291 Appendix A's published test vector and by verifying our JWT with `node:crypto`.
- **Keys.** `pnpm env:init` generates a P-256 pair: `VAPID_PUBLIC_KEY` (base64url, 65-byte uncompressed point) and `VAPID_PRIVATE_KEY` (base64url, 32-byte scalar). The private key exists only in web's env. `VAPID_SUBJECT` is `${PUBLIC_URL}`.
- **Subscriptions.** Table `push_subscriptions`: `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `created_at`. Only the owner can subscribe.
  - The endpoint must be `https:` and its host must end with one of `push.apple.com`, `fcm.googleapis.com`, `push.services.mozilla.com` or `notify.windows.com`. This allowlist is the SSRF guard, because the server POSTs to this URL.
  - Keys are validated: `p256dh` is a 65-byte uncompressed point, `auth` is 16 bytes.
- **Sending.** For each owner subscription, in parallel:
  - `POST` with `TTL: 3600`, `Urgency: high`, `Content-Encoding: aes128gcm` and `Authorization: vapid t=…, k=…`;
  - a 5 s timeout;
  - `404` or `410` deletes the subscription (outcome `gone`); any other non-2xx is `failed`.
- **Payload.** The only fields, by design (`PushPayload` in contracts):

  ```json
  {"title":"MasterTutor","body":"<rule label, e.g. A run failed>","url":"/settings/alerts#alert-<id>"}
  ```

  It never carries secrets, page text, run goals or run content.
- **Client.**
  - `apps/web/app/manifest.ts` (name, `display: "standalone"`, icons from `app/icon.tsx` and `app/apple-icon.tsx`, which are generated with Next's built-in `ImageResponse`, so no image files or dependencies are added).
  - `/sw.js` is served by a route handler (`apps/web/app/sw.js/route.ts`), so the web image needs no `public/` directory. It has two handlers:
    - `push` → `showNotification(title, { body, data: { url }, tag: "mt-alert" })`;
    - `notificationclick` → focus or open the URL, same origin only.
- **Settings → Notifications** (owner only). States are evaluated in order:
  1. Not a secure context (the local stack on `http://localhost`): "Phone alerts need the deployed HTTPS site. Alerts still appear here in the app."
  2. iOS and not standalone (`navigator.standalone !== true`): "On iPhone, add MasterTutor to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on phone alerts."
  3. `pushConfig.available` is false (no VAPID keys): "Phone alerts aren't set up on this server."
  4. Otherwise a toggle. On: register `/sw.js`, `Notification.requestPermission()`, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, then `alerts.subscribe`. Off: `subscription.unsubscribe()` and `alerts.unsubscribe`.
- **Degradation.** Without VAPID keys or HTTPS, in-app alerts work unchanged and the push sender is never called. Tests cover both (Task C6, Task C7).

## 14. Security summary (R9)

| Threat | Control | Test |
|---|---|---|
| Secret, page text, prompt or screenshot in a span attribute | TypeScript `ProductAttributes` limits keys and value types; `AllowlistSpanExporter` drops every other key; `instrument()` never records messages or stacks; tool attributes limited to four keys (`ToolAttributes`) | `allowlist.test.ts` (unknown keys dropped and counted); `apps/agent/src/telemetry.security.test.ts` (a canary password, page text, prompt and a PNG pass through seams 1–5 with an in-memory exporter; the canary appears in no exported span, log or metric) |
| Secret in a log line | Existing pino redaction runs before the bridge (unchanged); collector `attributes/scrub` and `transform/scrub` | `logger.test.ts` extended (bridge sees redacted lines only); `collector-config.int.test.ts` (scrub patterns applied to a sample) |
| Trace ids to third parties | Empty propagator | `start.test.ts`: an outgoing request inside a span carries no `traceparent` |
| `/observability` reachable without our auth | OpenObserve has no ports; its only router has ForwardAuth; owner check; fixture builds deny | `apps/web/lib/server/observability/authorize.test.ts`; `prod-overlay.int.test.ts`; `observability` suite Playwright check |
| Forged alerts | Webhook refuses forwarded requests, then checks a constant-time bearer and a strict schema | `webhook.test.ts` |
| SSRF through a push endpoint | https plus a push-service host allowlist; 5 s timeout; no redirects followed (`redirect: "error"`) | `packages/contracts/src/alerts.test.ts`, `apps/web/lib/server/push/send.test.ts` |
| Push content leak | `PushPayload` schema with three fields; the body comes from a fixed label table | `deliver.test.ts` |
| Over-broad keys | Separate Garage key and bucket; separate ingest, viewer and root users; agent has no grants on `alerts` or `push_subscriptions`; workers keep empty env | `packages/storage/src/garage.int.test.ts`, `packages/db/src/queries/alerts.int.test.ts`, `prod-mode.test.ts` |
| Telemetry stack lateral movement | Internal networks per hop (§4.2); collector and OpenObserve hardened and bounded | `prod-overlay.int.test.ts` |

## 15. Performance budget (R10)

- **Budget:** p50 added latency per agent step is under 2 ms, and p99 is under 5 ms, with the SDK on and exporting to an unreachable endpoint.
- **Test:** `packages/telemetry/src/overhead.int.test.ts` times a step envelope with the real SDK exporting to a closed port, over 2,000 iterations. The envelope is exactly what one agent step adds: one `mt.step`, `mt.model.request`, `mt.tool` and `mt.step.commit` span, three run-event recordings, token and spend records, and two log lines through the bridge. It asserts p50 under 2 ms and p99 under 5 ms. Timing a whole `RunLoop` step would put Postgres and model jitter, at millisecond scale, into the measurement. `apps/agent/src/loop/run-loop-telemetry.int.test.ts` then proves the seams produce those spans on a real loop. Both run in the integration suite on the remote host (D48).
- **Micro budget:** `instrument()` adds under 50 µs at p50 per span (`packages/telemetry/src/instrument.bench.test.ts`, unit suite, 10,000 iterations).
- **Hot-path rules:**
  - no span per screencast frame or per SSE event;
  - no span inside the secret screen;
  - the log bridge does no work until it is enabled;
  - every recorder is a single `add()` on a pre-created instrument.

## 16. Local, CI and bench (R11)

- **Test stacks** (`compose.test.yml`, the e2e, smoke, ui and behaviour suites) do not enable the `observability` profile and leave `OTEL_EXPORTER_OTLP_ENDPOINT` empty. Nothing changes for them.
- **Production** (`compose.prod.yml`) sets `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` for web and agent. `check-env` requires `COMPOSE_PROFILES` to include `observability`, plus all new secrets.
- **Bench** (`tests/bench/compose.local.yml`, D47) runs with `COMPOSE_PROFILES=pdf,observability`. Its local Traefik also joins the local `mastertutor-obs` network.

  The workers' log driver is reset to `json-file` locally. Docker Desktop's daemon runs in a VM where `127.0.0.1:24224` is not the collector, so there are no container logs on the Mac, which is acceptable for a bench.
- **Remote runner:**
  - A new suite, `scripts/remote-test.sh observability`, runs `tests/observability/*.int.test.ts` against a prod-like stack with the profile on:
    - pipeline end to end: a run's spans, logs and metrics arrive in OpenObserve;
    - an alert fires and reaches web;
    - ForwardAuth is owner-only;
    - the collector-down resilience check;
    - the o2 API contract.
  - Other stack suites opt in with `MT_CI_TELEMETRY=1`, which adds the profile and the endpoint. By default they stay off.

## 17. Changes to existing files

| Area | Files | Change |
|---|---|---|
| Contracts | `packages/contracts/src/telemetry.ts` (new), `alerts.ts` (new), `server/log-bridge.ts` (new), `server/logger.ts`, `server/index.ts`, `env.ts`, `live.ts` (exports `webCdpOrigin`), `observability.ts` (new: OpenObserve constants and the `/observability` routing helpers), `api/contract.ts`, `index.ts`, `package.json` | names, alert contracts, bridge, env, helpers, `alerts` RPC namespace |
| Telemetry | `packages/telemetry/**` (new) | SDK, `instrument()`, recorders, crash handlers |
| Observability | `packages/observability/**` (new) | OpenObserve client, provisioning, dashboards, alerts, `observability-init` |
| DB | `packages/db/src/schema/alerts.ts` (new), `schema/index.ts`, `migrations/0013_alerts.sql` (generated), `sql/grants.sql`, `src/queries/alerts.ts` (new), `src/queries/workspace.ts` (`memberRoleOf`), `src/queries/events.ts`, `src/index.ts`, `package.json` | tables, grants, queries, seam 6 |
| Storage | `packages/storage/src/bin/garage-init.ts` | second bucket and key |
| Agent | `src/main.ts`, `src/loop/run-loop.ts`, `src/loop/step-store.ts`, `src/loop/worker.ts`, `src/llm/caller.ts`, `src/tools/registry.ts`, `src/tools/types.ts`, `src/capture/capture-tool.ts`, `src/vault/tools.ts`, `src/slots/pool.ts`, `package.json` | seams 1–5, 7, 8, tool attributes, gauges, shutdown flush |
| Web | `instrumentation.ts`, `next.config.ts`, `package.json`, `lib/server/env.ts` (unchanged API), `lib/server/runs/event-stream.ts`, `lib/server/rpc/owner-scope.ts` (new), `lib/server/rpc/alerts.ts` (new), `lib/server/rpc/live-router.ts`, `lib/server/alerts/*` (new), `lib/server/push/*` (new), `lib/fixtures/router.ts`, `app/api/observability/auth/route.ts` (new), `app/api/observability/enter/route.ts` (new), `app/api/alerts/webhook/route.ts` (new), `app/manifest.ts`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/sw.js/route.ts`, `lib/push/service-worker.ts` (new), `app/(app)/settings/alerts/page.tsx` (new), `components/alerts/*` (new), `components/shell/app-shell.tsx`, `components/settings/settings-view.tsx`, `styles/shell.css` | access, alerts, push, PWA |
| Compose | `compose.yml`, `compose.prod.yml`, `tests/bench/compose.local.yml` | services, networks, env, logging |
| Infra | `infra/otel/collector.yaml` (new), `infra/host/create-obs-network.sh` (new), `infra/host/attach-traefik.sh`, `infra/deploy-runbook.md` | collector config, host steps, runbook |
| Tests and scripts | `tests/compose/prod-mode.ts`, `prod-mode.test.ts`, `prod-overlay.int.test.ts`, `tests/observability/**` (new), `scripts/env-init.ts`, `scripts/deploy/check-env.ts`, `scripts/remote-test.sh`, `scripts/remote-test/run-on-host.sh`, `scripts/README.md`, `eslint.config.js`, `vitest.config.ts` | rules, suites, secrets, bans |

## 18. Decisions the user should know about

1. **No DB auto-instrumentation.** The driver is postgres.js, not `pg`, and no OTel instrumentation exists for it. The step transaction gets its own span (`mt.step.commit`) instead.
2. **No aws-sdk instrumentation.** S3 calls are traced as HTTP spans and named by the collector.
3. **No trace propagation**, so no `traceparent` reaches OpenAI or anyone else (D38).
4. **Traces are per step, not per run.** Runs are found by `mt.run.id`.
5. **Container logs use Docker's fluentd log driver** to a loopback-only collector port. The collector therefore gets one non-internal network.
6. **Web Push is implemented on `node:crypto`** instead of the `web-push` package.
7. **A new external network, `mastertutor-obs`, and a Traefik attach** are host steps that need approval, deferred with the deploy (D42).
8. **OpenObserve's UI requires a client-side session record.** An owner-only entry route seeds it, and the exact mechanism is pinned by a spike against the digest. OpenObserve is AGPL and is run unmodified.
9. **Dashboard edits made in the UI are overwritten on the next deploy**, because dashboards are code.
