# Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenTelemetry to the web and agent backends, run a collector and OpenObserve on our own host, serve owner-only dashboards at `/observability`, and deliver alerts in the app and by Web Push. Telemetry must never slow down, break or leak from the product.

**Architecture:**

- One shared package, `@mastertutor/telemetry`, sets up the OTel SDK once per process. It exports through bounded queues, applies an attribute allowlist, and exposes a typed `instrument()` wrapper. That wrapper is applied at eight product seams in the agent and web; `emitRunEvent` is the seam for every domain event.
- Product names live once, in `@mastertutor/contracts/telemetry`.
- A collector scrubs, maps and samples, then exports to OpenObserve, which stores its data in Garage. Dashboards and alerts are TypeScript, provisioned by a one-shot job.
- `/observability` sits behind a Traefik ForwardAuth answered by web.
- OpenObserve calls a web webhook. Web stores the alert and sends a Web Push, implemented with `node:crypto`.

**Tech Stack:**

- OpenTelemetry JS: API 1.9.1, SDK 2.12.0, experimental 0.223.0, `instrumentation-undici` 0.33.0.
- `otel/opentelemetry-collector-contrib:0.162.0` (pinned by digest).
- `openobserve/openobserve:v1.0.4` (pinned by digest).
- Next.js 16, oRPC 1.15, Drizzle 0.45, postgres.js 3.4, Vitest 5, Playwright 1.63, pnpm 10.34.6, Node 24.

**Spec:** `docs/superpowers/specs/2026-10-08-observability-design.md`. D50 in `orchestration/STATE.md` is the decision. `CLAUDE.md` is binding. Executors read all three. Section numbers below (§N) refer to the spec.

## Global Constraints

- The OpenAI API is the only paid service. Everything here is self-hosted and open source: no SaaS, no ntfy, no ntfy.sh relay, no hosted push relay.
- Image pins:
  - `otel/opentelemetry-collector-contrib:0.162.0@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6`
  - `openobserve/openobserve:v1.0.4@sha256:d4a878fac1f6c56003764f7f2a1625668917388f167e222c8c810de3f54c56ba`
- OTel package versions, exact:
  - `@opentelemetry/api` 1.9.1;
  - `@opentelemetry/api-logs`, `sdk-logs`, `exporter-*-otlp-proto`, `instrumentation` and `instrumentation-http`: 0.223.0;
  - `sdk-trace-node`, `sdk-trace-base`, `sdk-metrics`, `resources`, `core` and `context-async-hooks`: 2.12.0;
  - `instrumentation-undici` 0.33.0.
- Never add these: `@opentelemetry/sdk-node`, `auto-instrumentations-node`, `instrumentation-pg`, `instrumentation-aws-sdk`, `web-push`.
- Only `packages/telemetry/**` and `packages/contracts/src/server/log-bridge.ts` may import `@opentelemetry/*` (ESLint, Task A7). Client code in `apps/web` never imports `@mastertutor/telemetry`.
- No telemetry attribute, log field, metric dimension or push payload may carry:
  - a secret;
  - page text or a prompt;
  - a screenshot;
  - a URL path or query;
  - a user id or email;
  - an error message or stack.

  Only `errorCodeOf()` codes.
- No trace context is propagated: the propagator is empty, so no `traceparent` is ever sent (D38).
- Telemetry is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. No test stack sets it, and no test may require the collector or OpenObserve except the opt-in `observability` remote suite.
- Queues: at most 2,048 items, batches of 512, 2 s interval, 5 s export timeout, one export in flight. Metric export every 30 s.
- Overhead budget: under 2 ms p50 and 5 ms p99 per agent step; `instrument()` under 50 µs p50.
- Retention: logs 30 d (streams `mastertutor` and `containers`), traces 15 d (stream `default`), metrics 90 d (global).
- New published host port: `127.0.0.1:24224` only (D45: loopback only). OpenObserve publishes nothing.
- Push payload is exactly `{ title: "MasterTutor", body: <fixed rule label>, url: "/settings/alerts#alert-<uuid>" }`.
- Web Push needs HTTPS. Without VAPID keys or HTTPS, in-app alerts still work and the push sender is never called.
- Every test suite runs on the Dokploy host through `scripts/remote-test.sh <suite>` (D48). Never loosen timeouts, retries or assertions.
- Never read `.env*` files. Write test-only keys into `.env.test` only by appending with `cat >>`, and only where a task says so.
- Commit with explicit pathspecs (`git commit -- <paths>`). Other agents share the repo.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VBPg8LB4dBTSYr8jHzmPLg
  ```

## Review Focus

Each line below names an input or condition the spec implies and that no other test exercises, with the behaviour a person expects. Each one's pinning test is added to the task named.

1. **A burst of log lines while the collector is down** (a run looping on errors). stdout keeps every line, the OTel side drops and counts, and logging never blocks. Pinned in Task A3, test "stdout keeps every line while the bridge drops".
2. **OpenObserve sends the same alert twice**, through its retries or overlapping evaluations. One alert row and one push within 10 minutes. Pinned in Task C4, test "a repeated rule within 10 minutes is one alert and one push".
3. **A phone subscription expires at the push service** (HTTP 410), or the owner reinstalls the app. The subscription is deleted, other subscriptions still get the push, and there is no retry storm. Pinned in Task C4, test "a 410 deletes that subscription and the others still get it".
4. **A non-owner member** opens `/observability`, calls `alerts.*`, or posts to the webhook through the public domain. They get 403 or FORBIDDEN, or 404 for the webhook through Traefik, and never any data. Pinned in Task C2 (ForwardAuth), Task C5 (RPC) and Task C4 (forwarded webhook).
5. **Two runs log at the same time** on interleaved async steps. Each line's `run_id` is the run whose step wrote it, never the other. Pinned in Task A4, test "concurrent runs keep their own run_id".

## Module dependency map (no cycles)

```
@mastertutor/contracts      leaf; src/server/log-bridge.ts → @opentelemetry/api, @opentelemetry/api-logs (API only)
@mastertutor/telemetry      → contracts, @opentelemetry/* (SDK)
@mastertutor/observability  → contracts, zod                      (one-shot provisioning; never imported by a service)
@mastertutor/storage        → contracts (unchanged)
@mastertutor/db             → contracts, telemetry (NEW: subpath "./record" only, in queries/events.ts)
apps/agent                  → contracts, db, storage, sealing, telemetry (NEW)
apps/web (server code)      → contracts, db, storage, sealing, telemetry (NEW; subpaths ".", "./record", "./instrument")
apps/web (client code)      → contracts (alerts DTOs, observability paths), never telemetry
```

Rules:

- `telemetry` must never import `db`, `storage` or an app. `observability` must never import `telemetry`, `db` or an app.
- Task A7 adds a test that fails on any edge not listed above (`packages/telemetry/src/boundaries.test.ts`).

### Existing modules touched, and how

| Module | Change | Task |
|---|---|---|
| `packages/contracts/src/env.ts` | `TelemetryEnv`; web VAPID, webhook and viewer keys; `GarageInitEnv` observe bucket; `ObservabilityInitEnv` | 0 |
| `packages/contracts/src/live.ts` | `liveForwardAuthAddress` delegates to a new exported `webCdpOrigin` | 0 |
| `packages/contracts/src/index.ts`, `package.json` | export `alerts.ts`, `observability.ts`; subpath `./telemetry` | 0 |
| `packages/contracts/src/server/logger.ts`, `server/index.ts`, `package.json` | correlation mixin and bridge stream; export the bridge; OTel API dependencies | A1 |
| `packages/db/src/queries/events.ts`, `package.json` | `emitRunEvent` calls `recordRunEvent` | A6 |
| `apps/agent/src/loop/run-loop.ts` | `step()` and the computer branch of `#execute` wrapped | A5 |
| `apps/agent/src/llm/caller.ts` | `call()` wrapped; tokens recorded | A5 |
| `apps/agent/src/tools/registry.ts`, `tools/types.ts` | `run()` wrapped; optional `Tool.telemetry` | A5 |
| `apps/agent/src/capture/capture-tool.ts`, `vault/tools.ts` | declare `telemetry` | A5 |
| `apps/agent/src/loop/step-store.ts` | `commit()` wrapped; spend and failures recorded after commit | A6 |
| `apps/agent/src/slots/pool.ts`, `loop/worker.ts` | `#reset` and the takeover give and take-back wrapped | A6 |
| `apps/agent/src/main.ts`, `package.json` | gauges, shutdown flush, dependency | A6 |
| `apps/web/instrumentation.ts`, `next.config.ts` | start telemetry; externals | A7 |
| `apps/web/package.json`, `next.config.ts` (`transpilePackages`) | telemetry dependency | A4 |
| `apps/web/lib/server/runs/event-stream.ts` | SSE gauge | A7 |
| `eslint.config.js` | OTel import ban | A7 |
| `packages/storage/src/bin/garage-init.ts` | second bucket and key | B2 |
| `scripts/env-init.ts`, `scripts/deploy/check-env.ts` | new secrets and profile rules | B2 |
| `compose.yml`, `compose.prod.yml`, `tests/bench/compose.local.yml` | services, networks, env, log driver, labels | B7 |
| `tests/compose/prod-mode.ts`, `prod-mode.test.ts`, `prod-overlay.int.test.ts` | telemetry rules | B7 |
| `infra/host/attach-traefik.sh`, `infra/deploy-runbook.md` | `--network obs`; runbook | B7 |
| `scripts/remote-test.sh`, `scripts/remote-test/run-on-host.sh`, `scripts/README.md`, `scripts/remote-test.test.ts` | `observability` suite, `MT_CI_TELEMETRY` | F1 |
| `packages/db/src/schema/index.ts`, `src/index.ts`, `sql/grants.sql`, `src/queries/workspace.ts` | alerts tables, exports, agent exclusion, `memberRoleOf`, `onlyWorkspaceId` | C1 |
| `packages/contracts/src/api/contract.ts` | `alerts` namespace | C5 |
| `apps/web/lib/server/rpc/live-router.ts`, `lib/fixtures/router.ts`, `types.ts`, `seed.ts` | `alerts` procedures | C5 |
| `apps/web/components/shell/app-shell.tsx`, `components/settings/settings-view.tsx`, `styles/shell.css`, `styles/settings.css` | banner, Notifications section, Alerts link | C6 |

## Parallel tracks

| Track | Tasks (in order) | Can start after | Owner of these files |
|---|---|---|---|
| **0: Shared contracts** | 0 | — | `packages/contracts/src/{telemetry,alerts,observability,env,live,index}.ts`, contracts `package.json` exports |
| **A: SDK and instrumentation** | A1 → A2 → A3 → A4 → (A5 ∥ A6) → A7 | Task 0 | `packages/telemetry/**`, contracts `server/**`, agent seams, web wiring, `db/queries/events.ts`, `eslint.config.js` |
| **B: Collector, OpenObserve, provisioning, compose** | B1 → (B2 ∥ B3) → B4 → (B5 ∥ B6) → B7 | Task 0 (B7 also needs A3 and C2) | `packages/observability/**`, `infra/**`, compose files, `tests/compose/**`, `scripts/env-init.ts`, `scripts/deploy/**`, `packages/storage/src/bin/garage-init.ts` |
| **C: Access, alerts, Web Push** | C1 → (C2 ∥ C3) → C4 → C5 → C6 → C7 | Task 0 (C4 also needs A4) | `packages/db/src/{schema/alerts.ts,queries/alerts.ts,queries/workspace.ts,index.ts}`, `grants.sql`, web routes, push, alerts UI, `contract.ts`, fixtures |
| **F: End to end** | F1 | A7, B7, C7 | `tests/observability/*.int.test.ts` (stack), remote-test scripts |

So three tracks (A, B, C) run in parallel after Task 0, each with its own implementer. A merge conflict can only happen in `pnpm-lock.yaml`. Resolve it by taking either side and running `pnpm install` before committing the merge.

## File structure (new files)

```
packages/contracts/src/telemetry.ts            names: SPAN, ATTR, METRIC, value types, allowlists (Task 0)
packages/contracts/src/alerts.ts               AlertRule, labels, webhook body, push DTOs and payload (Task 0)
packages/contracts/src/observability.ts        OpenObserve constants, /observability routing helpers (Task 0)
packages/contracts/src/server/log-bridge.ts    pino → OTel logs, correlation mixin, run-id context key (A1)

packages/telemetry/
  package.json, tsconfig.json
  src/index.ts           public exports
  src/batcher.ts         BoundedBatcher: bounded, non-blocking, counts drops (A2)
  src/processors.ts      BoundedSpanProcessor, BoundedLogProcessor, CountingMetricExporter, exportOnce (A2)
  src/allowlist.ts       AllowlistSpanExporter (A2)
  src/instruments.ts     lazily created metric instruments from METRIC (A2)
  src/self.ts            countDropped (+ rate-limited warn) (A2)
  src/handle.ts          TelemetryHandle, NOOP, get/set current (A3)
  src/start.ts           startTelemetry (A3)
  src/crash.ts           installCrashHandlers (A3)
  src/register-agent.ts  `node --import` preload for the agent (A3)
  src/instrument.ts      instrument(), ProductSpan, errorCodeOf (A4)
  src/record.ts          typed recorders and agent gauges (A4)
  src/testing.ts         installTestTelemetry (A4)
  src/overhead.int.test.ts, src/boundaries.test.ts (A4, A7)

packages/observability/
  package.json, tsconfig.json
  src/index.ts
  src/o2-api.ts          every OpenObserve endpoint and payload shape, pinned by the contract test (B1)
  src/client.ts          createO2Client, O2Error, waitForO2 (B1)
  src/names.ts           o2StreamName, o2Label (B1)
  src/provision.ts       users, streams and retention, destination and template (B4)
  src/dashboards/build.ts, src/dashboards/*.ts   six dashboards as code (B5)
  src/alerts.ts          five alert rules as code (B6)
  src/bin/observability-init.ts                  one-shot job (B7)
  src/o2-api.int.test.ts                         contract test against the pinned image (B1)

packages/db/src/schema/alerts.ts, packages/db/src/queries/alerts.ts, packages/db/migrations/0013_alerts.sql (C1)

apps/web/lib/server/rpc/owner-scope.ts, lib/server/rpc/alerts.ts (C2, C5)
apps/web/lib/server/observability/authorize.ts, enter-page.ts (C2)
apps/web/app/api/observability/auth/route.ts, app/api/observability/enter/route.ts (C2)
apps/web/lib/server/push/{base64url,vapid,encrypt,send}.ts (C3, C4)
apps/web/lib/server/alerts/{webhook,deliver,read-capped}.ts, app/api/alerts/webhook/route.ts (C4)
apps/web/app/manifest.ts, app/icon.tsx, app/apple-icon.tsx, public/sw.js (C6)
apps/web/components/alerts/{alert-banner,alerts-view,notifications-group,push-support}.tsx|ts (C6)
apps/web/app/(app)/settings/alerts/page.tsx (C6)

infra/otel/collector.yaml (B3)
infra/host/create-obs-network.sh (B7)
tests/observability/collector-config.test.ts, collector-config.int.test.ts (B3)
tests/observability/1-access.int.test.ts, 2-pipeline.int.test.ts, 3-resilience.int.test.ts, stack.ts, compose.observability.yml (F1)
scripts/observability-stack.sh (F1)
apps/web/e2e/alerts.spec.ts (C7)
```

---

## Task 0: Shared contracts (names, alerts, OpenObserve constants, env)

**Files:**
- Create: `packages/contracts/src/telemetry.ts`, `packages/contracts/src/telemetry.test.ts`
- Create: `packages/contracts/src/alerts.ts`, `packages/contracts/src/alerts.test.ts`
- Create: `packages/contracts/src/observability.ts`, `packages/contracts/src/observability.test.ts`
- Create: `packages/contracts/src/env-observability.test.ts`
- Modify: `packages/contracts/src/env.ts`, `packages/contracts/src/live.ts` (the `liveForwardAuthAddress` block), `packages/contracts/src/index.ts`, `packages/contracts/package.json`

**Interfaces:**
- Consumes: `enums.ts` (`StepPhase`, `ApprovalKind`, `ApprovalStatus`, `BlockType`, `BlockOrigin`, `Controller`, `Fidelity`, `FiledBy`, `RunStatus`, `SlotState`, `MemberRole`), `tools.ts` (`ToolName`), `primitives.ts` (`Uuid`, `IsoDateTime`), `env.ts` (`Common` fields, `Secret`), `live.ts` (`DEFAULT_CDP_SUBNET_PREFIX`).
- Produces:
  - `@mastertutor/contracts/telemetry`:
    - `SPAN`, `SpanName`, `ATTR`, `AttributeName`, `AttributeValues`, `ProductAttributes`, `ToolAttributes`;
    - `STEP_OUTCOMES`, `TOOL_OUTCOMES`, `APPROVAL_DECIDERS`, `SLOT_OUTCOMES`, `TAKEOVER_OUTCOMES`, `DOWNLOAD_STATES`, `PUSH_OUTCOMES`, `TOKEN_TYPES`, `TELEMETRY_SIGNALS`, `DROP_REASONS`, `DEPENDENCIES` with their `*Name` types (`ToolOutcome`, `ApprovalDecider`, `SlotOutcome`, `TakeoverOutcome`, `PushOutcome`, `TelemetrySignal`, `DropReason`);
    - `ERROR_CODE_PATTERN`, `BASE_ATTRIBUTES`, `EXPORTABLE_ATTRIBUTES`, `MetricSpec`, `METRIC`, `METER_NAME`, `TRACER_NAME`, `SPANMETRICS_NAMESPACE`, `DERIVED_METRIC`, `SPANMETRIC_DIMENSIONS`, `LOG_STREAMS`, `TRACE_STREAM`, `RETENTION_DAYS`.
  - `@mastertutor/contracts` (root): `ALERT_RULES`, `AlertRule`, `ALERT_LABELS`, `AlertWebhookBody`, `MAX_ALERT_WEBHOOK_BYTES`, `ALERT_DEDUPE_MINUTES`, `AlertView`, `AlertRef`, `PUSH_SERVICE_HOST_SUFFIXES`, `isPushServiceEndpoint(url: string): boolean`, `PushSubscriptionInput`, `PushEndpointRef`, `PushConfig`, `PushPayload`, `alertPushPayload(alert: { id: string; rule: AlertRule }): PushPayload`.
  - `@mastertutor/contracts` (root): `OBSERVE_BASE_PATH`, `OBSERVE_ORG`, `OBSERVE_USERS`, `OBSERVE_UI_SESSION`, `OBSERVABILITY_PATH`, `OBSERVABILITY_AUTH_PATH`, `OBSERVABILITY_ENTER_PATH`, `observabilityRouterRule(host: string): string`, `observabilityForwardAuthAddress(prefix?: string): string`, `OBSERVE_INTERNAL_URL`.
  - `live.ts`: `webCdpOrigin(prefix?: string): string`.
  - `env.ts`:
    - `DEPLOYMENTS`, `TelemetryEnv` (`OTEL_EXPORTER_OTLP_ENDPOINT?`, `MT_DEPLOYMENT`);
    - `WebEnv` gains `OTEL_EXPORTER_OTLP_ENDPOINT?`, `MT_DEPLOYMENT`, `VAPID_PUBLIC_KEY?`, `VAPID_PRIVATE_KEY?`, `ALERT_WEBHOOK_SECRET?`, `OBSERVE_VIEWER_PASSWORD?`;
    - `AgentEnv` gains the two telemetry keys;
    - `GarageInitEnv` gains `S3_OBSERVE_BUCKET` (default `observability`), `S3_OBSERVE_ACCESS_KEY_ID?`, `S3_OBSERVE_SECRET_ACCESS_KEY?`;
    - `ObservabilityInitEnv`.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/src/telemetry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ATTR,
  BASE_ATTRIBUTES,
  DERIVED_METRIC,
  EXPORTABLE_ATTRIBUTES,
  METRIC,
  SPAN,
  SPANMETRIC_DIMENSIONS,
  SPANMETRICS_NAMESPACE,
} from "./telemetry.ts";

const NAME = /^mt(\.[a-z][a-z0-9_]*)+$/;

describe("product telemetry names (spec §5)", () => {
  it("are mt.-prefixed, lowercase, dotted and unique", () => {
    const names = [
      ...Object.values(SPAN),
      ...Object.values(ATTR),
      ...Object.values(METRIC).map((metric) => metric.name),
      ...Object.values(DERIVED_METRIC),
    ];
    for (const name of names) expect(name, name).toMatch(NAME);
    expect(new Set(Object.values(ATTR)).size).toBe(Object.values(ATTR).length);
    expect(new Set(Object.values(METRIC).map((m) => m.name)).size).toBe(
      Object.values(METRIC).length,
    );
  });

  it("never uses a run id, a URL or a user as a metric dimension", () => {
    const dimensions = [
      ...Object.values(METRIC).flatMap((metric) => metric.dimensions),
      ...SPANMETRIC_DIMENSIONS,
    ];
    expect(dimensions).not.toContain(ATTR.runId);
    expect(dimensions).not.toContain(ATTR.vaultAlias);
    for (const dimension of dimensions)
      expect(Object.values(ATTR) as string[]).toContain(dimension);
  });

  it("exports no URL, header or message attribute", () => {
    for (const key of EXPORTABLE_ATTRIBUTES) {
      expect(key, key).not.toMatch(/^url\.|^http\.target$|header|message|stack|user/);
    }
    expect(BASE_ATTRIBUTES).toContain("server.address");
    expect(EXPORTABLE_ATTRIBUTES.has(ATTR.runId)).toBe(true);
  });

  it("derives span metrics under one namespace", () => {
    expect(DERIVED_METRIC.spanCalls).toBe(`${SPANMETRICS_NAMESPACE}.calls`);
    expect(DERIVED_METRIC.spanDuration).toBe(`${SPANMETRICS_NAMESPACE}.duration`);
  });
});
```

`packages/contracts/src/alerts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ALERT_LABELS,
  ALERT_RULES,
  AlertWebhookBody,
  PushPayload,
  PushSubscriptionInput,
  alertPushPayload,
  isPushServiceEndpoint,
} from "./alerts.ts";

const P256DH = `B${"A".repeat(86)}`;
const AUTH = "A".repeat(22);

describe("alerts contracts (spec §13)", () => {
  it("has a short label for every rule", () => {
    for (const rule of ALERT_RULES) expect(ALERT_LABELS[rule].length).toBeLessThanOrEqual(80);
  });

  it("accepts only {rule} from the webhook", () => {
    expect(AlertWebhookBody.safeParse({ rule: "run_failed" }).success).toBe(true);
    expect(AlertWebhookBody.safeParse({ rule: "run_failed", text: "x" }).success).toBe(false);
    expect(AlertWebhookBody.safeParse({ rule: "anything" }).success).toBe(false);
  });

  it("allows push endpoints on the known push services over https only (SSRF guard)", () => {
    expect(isPushServiceEndpoint("https://web.push.apple.com/QGuR")).toBe(true);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isPushServiceEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(
      true,
    );
    for (const bad of [
      "http://web.push.apple.com/x",
      "https://push.apple.com.evil.test/x",
      "https://evilpush.apple.com.attacker/x",
      "https://user:pw@web.push.apple.com/x",
      "https://web.push.apple.com:8443/x",
      "https://169.254.169.254/latest",
      "https://localhost/x",
      "not a url",
    ])
      expect(isPushServiceEndpoint(bad), bad).toBe(false);
  });

  it("validates subscription keys by shape", () => {
    const ok = { endpoint: "https://web.push.apple.com/x", keys: { p256dh: P256DH, auth: AUTH } };
    expect(PushSubscriptionInput.safeParse(ok).success).toBe(true);
    expect(
      PushSubscriptionInput.safeParse({ ...ok, keys: { p256dh: "short", auth: AUTH } }).success,
    ).toBe(false);
  });

  it("builds a payload with a fixed label and a deep link only", () => {
    const payload = alertPushPayload({
      id: "11111111-1111-4111-8111-111111111111",
      rule: "run_failed",
    });
    expect(payload).toEqual({
      title: "MasterTutor",
      body: "A run failed",
      url: "/settings/alerts#alert-11111111-1111-4111-8111-111111111111",
    });
    expect(PushPayload.safeParse({ ...payload, goal: "x" }).success).toBe(false);
  });
});
```

`packages/contracts/src/observability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { liveForwardAuthAddress } from "./live.ts";
import {
  OBSERVABILITY_AUTH_PATH,
  observabilityForwardAuthAddress,
  observabilityRouterRule,
} from "./observability.ts";

describe("/observability routing (spec §12)", () => {
  it("targets web's static cdp address like the live ForwardAuth", () => {
    expect(observabilityForwardAuthAddress()).toBe(
      `http://172.30.231.11:3000${OBSERVABILITY_AUTH_PATH}`,
    );
    expect(liveForwardAuthAddress("10.9.8")).toBe("http://10.9.8.11:3000/api/live/auth");
    expect(() => observabilityForwardAuthAddress("10.9")).toThrow();
  });

  it("matches /observability and its subtree only", () => {
    expect(observabilityRouterRule("mt.example.com")).toBe(
      "Host(`mt.example.com`) && PathRegexp(`^/observability(/|$)`)",
    );
    expect(() => observabilityRouterRule("bad host`")).toThrow();
  });
});
```

`packages/contracts/src/env-observability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GarageInitEnv, ObservabilityInitEnv, TelemetryEnv, WebEnv, parseEnv } from "./env.ts";

const secret = "s".repeat(40);
const web = {
  DATABASE_URL: "postgres://web_role:pw@postgres:5432/mastertutor",
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: "https://mt.example.com",
  VAULT_PUBLIC_KEY: Buffer.alloc(32, 1).toString("base64"),
  NEKO_MEMBER_SECRET: secret,
  LIVE_COOKIE_SECRET: secret,
  OPENAI_API_KEY: "k",
  S3_ENDPOINT: "http://garage:3900",
  S3_ACCESS_KEY_ID: `GK${"a".repeat(24)}`,
  S3_SECRET_ACCESS_KEY: "b".repeat(64),
};

describe("observability env (D50)", () => {
  it("leaves telemetry off unless an endpoint is set", () => {
    expect(parseEnv(TelemetryEnv, {})).toEqual({ MT_DEPLOYMENT: "production" });
    expect(() => parseEnv(TelemetryEnv, { OTEL_EXPORTER_OTLP_ENDPOINT: "ftp://x" })).toThrow();
  });

  it("needs both VAPID keys or neither, and never names their values", () => {
    expect(parseEnv(WebEnv, web).VAPID_PUBLIC_KEY).toBeUndefined();
    const half = { ...web, VAPID_PUBLIC_KEY: `B${"x".repeat(86)}` };
    try {
      parseEnv(WebEnv, half);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("VAPID_PRIVATE_KEY");
      expect(String(error)).not.toContain("x".repeat(86));
    }
  });

  it("provisions the observe bucket only with both keys", () => {
    const base = {
      GARAGE_ADMIN_URL: "http://garage:3903",
      GARAGE_ADMIN_TOKEN: secret,
      S3_WEB_ACCESS_KEY_ID: `GK${"1".repeat(24)}`,
      S3_WEB_SECRET_ACCESS_KEY: "1".repeat(64),
      S3_AGENT_ACCESS_KEY_ID: `GK${"2".repeat(24)}`,
      S3_AGENT_SECRET_ACCESS_KEY: "2".repeat(64),
    };
    expect(parseEnv(GarageInitEnv, base).S3_OBSERVE_BUCKET).toBe("observability");
    expect(() =>
      parseEnv(GarageInitEnv, { ...base, S3_OBSERVE_ACCESS_KEY_ID: `GK${"3".repeat(24)}` }),
    ).toThrow(/S3_OBSERVE_SECRET_ACCESS_KEY/);
  });

  it("parses the provisioner env with safe defaults", () => {
    const env = parseEnv(ObservabilityInitEnv, {
      OBSERVE_ROOT_PASSWORD: secret,
      OBSERVE_INGEST_PASSWORD: secret,
      OBSERVE_VIEWER_PASSWORD: secret,
      ALERT_WEBHOOK_SECRET: secret,
    });
    expect(env.OBSERVE_URL).toBe("http://openobserve:5080/observability");
    expect(env.ALERT_WEBHOOK_URL).toBe("http://web:3000/api/alerts/webhook");
    expect(env.SPEND_ALERT_USD_PER_HOUR).toBe(25);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/contracts/src/telemetry.test.ts packages/contracts/src/alerts.test.ts packages/contracts/src/observability.test.ts packages/contracts/src/env-observability.test.ts`
Expected: FAIL. The modules `./telemetry.ts`, `./alerts.ts` and `./observability.ts` are not found.

- [ ] **Step 3: Write `packages/contracts/src/alerts.ts`**

```ts
import { z } from "zod";
import { IsoDateTime, Uuid } from "./primitives.ts";

/** Alert rules (spec §13.1). Their definitions live in packages/observability/src/alerts.ts. */
export const ALERT_RULES = [
  "error_spike",
  "model_request_rejected",
  "run_failed",
  "slot_crash_loop",
  "spend_jump",
] as const;
export const AlertRule = z.enum(ALERT_RULES);
export type AlertRule = z.infer<typeof AlertRule>;

/** The only words a phone ever shows for an alert (spec §13.4): fixed, never alert content. */
export const ALERT_LABELS: Record<AlertRule, string> = {
  error_spike: "Errors spiked",
  model_request_rejected: "The model rejected a request",
  run_failed: "A run failed",
  slot_crash_loop: "A browser slot keeps crashing",
  spend_jump: "Spend jumped",
};

/** OpenObserve's webhook body (its template is in packages/observability). Extra keys are refused. */
export const AlertWebhookBody = z.strictObject({ rule: AlertRule });
export type AlertWebhookBody = z.infer<typeof AlertWebhookBody>;
export const MAX_ALERT_WEBHOOK_BYTES = 4_096;
/** A rule firing again within this window is the same alert: one row, one push. */
export const ALERT_DEDUPE_MINUTES = 10;

export const AlertView = z.object({
  id: Uuid,
  rule: AlertRule,
  label: z.string().max(80),
  firedAt: IsoDateTime,
  acknowledgedAt: IsoDateTime.nullable(),
});
export type AlertView = z.infer<typeof AlertView>;
export const AlertRef = z.object({ id: Uuid });
export type AlertRef = z.infer<typeof AlertRef>;

/** Hosts the server may POST a push to (the SSRF guard, spec §13.4). */
export const PUSH_SERVICE_HOST_SUFFIXES = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
] as const;

export function isPushServiceEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "")
    return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** PushSubscription.toJSON(): p256dh is a 65-byte uncompressed P-256 point, auth 16 bytes (base64url). */
export const PushSubscriptionInput = z.object({
  endpoint: z.string().max(2_048).refine(isPushServiceEndpoint, "Not a supported push service"),
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/, "Expected a P-256 public key"),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Expected a 16-byte auth secret"),
  }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;
export const PushEndpointRef = z.object({ endpoint: z.string().min(1).max(2_048) });
export type PushEndpointRef = z.infer<typeof PushEndpointRef>;

/** Whether this server can send pushes (VAPID keys and HTTPS), and the key browsers subscribe with. */
export const PushConfig = z.object({ available: z.boolean(), publicKey: z.string().nullable() });
export type PushConfig = z.infer<typeof PushConfig>;

/** Everything a push carries (spec §13.4): never secrets, page text, goals or run content. */
export const PushPayload = z.strictObject({
  title: z.literal("MasterTutor"),
  body: z.string().max(80),
  url: z.string().regex(/^\/settings\/alerts#alert-[0-9a-f-]{36}$/),
});
export type PushPayload = z.infer<typeof PushPayload>;

export function alertPushPayload(alert: { id: string; rule: AlertRule }): PushPayload {
  return PushPayload.parse({
    title: "MasterTutor",
    body: ALERT_LABELS[alert.rule],
    url: `/settings/alerts#alert-${Uuid.parse(alert.id)}`,
  });
}
```

- [ ] **Step 4: Write `packages/contracts/src/telemetry.ts`**

```ts
/**
 * Product telemetry names (D50, spec §5): the one source for span, attribute and metric names used
 * by @mastertutor/telemetry, infra/otel/collector.yaml, the dashboards and the alerts. Renaming one
 * breaks dashboards and alerts; tests pin the collector YAML and the provisioning code to this file.
 * Plain constants and types only: no runtime dependency.
 */
import type { AlertRule } from "./alerts.ts";
import type {
  ApprovalKind,
  ApprovalStatus,
  BlockOrigin,
  BlockType,
  Controller,
  Fidelity,
  FiledBy,
  RunStatus,
  SlotState,
  StepPhase,
} from "./enums.ts";
import type { ToolName } from "./tools.ts";

export const TRACER_NAME = "mastertutor";
export const METER_NAME = "mastertutor";

export const SPAN = {
  step: "mt.step",
  modelRequest: "mt.model.request",
  tool: "mt.tool",
  stepCommit: "mt.step.commit",
  slotReset: "mt.slot.reset",
  takeover: "mt.takeover",
  alertDelivery: "mt.alert.delivery",
} as const;
export type SpanName = (typeof SPAN)[keyof typeof SPAN];

export const ATTR = {
  runId: "mt.run.id",
  stepPhase: "mt.step.phase",
  stepOutcome: "mt.step.outcome",
  interruption: "mt.interruption",
  modelName: "mt.model.name",
  modelFallback: "mt.model.fallback",
  modelAttempts: "mt.model.attempts",
  tokensInput: "mt.model.tokens.input",
  tokensCached: "mt.model.tokens.cached",
  tokensOutput: "mt.model.tokens.output",
  costUsd: "mt.model.cost_usd",
  tokenType: "mt.model.token_type",
  toolName: "mt.tool.name",
  toolOutcome: "mt.tool.outcome",
  actionTypes: "mt.action.types",
  errorCode: "mt.error.code",
  approvalKind: "mt.approval.kind",
  approvalStatus: "mt.approval.status",
  approvalDecider: "mt.approval.decider",
  vaultAlias: "mt.vault.alias",
  captureFidelity: "mt.capture.fidelity",
  captureCoverage: "mt.capture.coverage",
  slotName: "mt.slot.name",
  slotOutcome: "mt.slot.outcome",
  takeoverOutcome: "mt.takeover.outcome",
  controlHolder: "mt.control.holder",
  runStatus: "mt.run.status",
  blockType: "mt.block.type",
  blockOrigin: "mt.block.origin",
  downloadState: "mt.download.state",
  filedBy: "mt.filed_by",
  alertRule: "mt.alert.rule",
  pushOutcome: "mt.push.outcome",
  slotState: "mt.slot.state",
  telemetrySignal: "mt.telemetry.signal",
  dropReason: "mt.telemetry.drop_reason",
  /** Set by the collector's transform/product only (spec §10). */
  dependency: "mt.dependency",
  /** Set by the collector on container log lines (browser-N, pdf-worker, audio-capture, docling). */
  service: "mt.service",
} as const;
export type AttributeName = (typeof ATTR)[keyof typeof ATTR];

export const STEP_OUTCOMES = ["continue", "waiting", "completed", "failed", "cancelled"] as const;
export type StepOutcomeName = (typeof STEP_OUTCOMES)[number];
export const TOOL_OUTCOMES = [
  "ok",
  "tool_error",
  "stale_ref",
  "failed",
  "unavailable",
  "refused",
] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];
export const APPROVAL_DECIDERS = ["person", "policy", "bypass"] as const;
export type ApprovalDecider = (typeof APPROVAL_DECIDERS)[number];
export const SLOT_OUTCOMES = ["leased", "released", "ok", "timeout"] as const;
export type SlotOutcome = (typeof SLOT_OUTCOMES)[number];
export const TAKEOVER_OUTCOMES = ["ok", "takeover_failed", "control_restore_failed"] as const;
export type TakeoverOutcome = (typeof TAKEOVER_OUTCOMES)[number];
export const DOWNLOAD_STATES = ["pending", "ready"] as const;
export type DownloadState = (typeof DOWNLOAD_STATES)[number];
export const PUSH_OUTCOMES = ["sent", "gone", "failed", "refused"] as const;
export type PushOutcome = (typeof PUSH_OUTCOMES)[number];
export const TOKEN_TYPES = ["input", "cached", "output"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];
export const TELEMETRY_SIGNALS = ["traces", "metrics", "logs"] as const;
export type TelemetrySignal = (typeof TELEMETRY_SIGNALS)[number];
export const DROP_REASONS = ["queue_full", "export_failed", "not_allowed"] as const;
export type DropReason = (typeof DROP_REASONS)[number];
export const DEPENDENCIES = [
  "openai",
  "s3",
  "docling",
  "pdf-worker",
  "audio-capture",
  "neko",
  "push",
] as const;
export type Dependency = (typeof DEPENDENCIES)[number];

/** A product error code: what instrument() records instead of a message (spec §7.1). */
export const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** The value type of every product attribute: the TypeScript half of the allowlist (spec §5.2). */
export interface AttributeValues {
  "mt.run.id": string;
  "mt.step.phase": StepPhase;
  "mt.step.outcome": StepOutcomeName;
  "mt.interruption": string;
  "mt.model.name": string;
  "mt.model.fallback": boolean;
  "mt.model.attempts": number;
  "mt.model.tokens.input": number;
  "mt.model.tokens.cached": number;
  "mt.model.tokens.output": number;
  "mt.model.cost_usd": number;
  "mt.model.token_type": TokenType;
  "mt.tool.name": ToolName;
  "mt.tool.outcome": ToolOutcome;
  "mt.action.types": string[];
  "mt.error.code": string;
  "mt.approval.kind": ApprovalKind;
  "mt.approval.status": ApprovalStatus;
  "mt.approval.decider": ApprovalDecider;
  "mt.vault.alias": string;
  "mt.capture.fidelity": Fidelity;
  "mt.capture.coverage": number;
  "mt.slot.name": string;
  "mt.slot.outcome": SlotOutcome;
  "mt.takeover.outcome": TakeoverOutcome;
  "mt.control.holder": Controller;
  "mt.run.status": RunStatus;
  "mt.block.type": BlockType;
  "mt.block.origin": BlockOrigin;
  "mt.download.state": DownloadState;
  "mt.filed_by": FiledBy;
  "mt.alert.rule": AlertRule;
  "mt.push.outcome": PushOutcome;
  "mt.slot.state": SlotState;
  "mt.telemetry.signal": TelemetrySignal;
  "mt.telemetry.drop_reason": DropReason;
  "mt.dependency": Dependency;
  "mt.service": string;
}
export type ProductAttributes = Partial<AttributeValues>;

/** What a tool may add to its span (spec §7.5): never arguments, page text or values. */
export type ToolAttributes = Pick<
  ProductAttributes,
  "mt.vault.alias" | "mt.capture.fidelity" | "mt.capture.coverage" | "mt.error.code"
>;

/** Base (non-product) attributes the SDK may export; every other key is dropped (spec §5.2). */
export const BASE_ATTRIBUTES = [
  "http.request.method",
  "http.response.status_code",
  "server.address",
  "server.port",
  "url.scheme",
  "error.type",
  "network.protocol.version",
  "http.route",
  "next.route",
  "next.span_type",
  "next.span_name",
  "exception.type",
] as const;
export const EXPORTABLE_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ATTR),
  ...BASE_ATTRIBUTES,
]);

export interface MetricSpec {
  name: string;
  kind: "counter" | "histogram" | "updown" | "gauge";
  unit: string;
  description: string;
  dimensions: readonly AttributeName[];
}

const metric = (spec: MetricSpec) => spec;
export const METRIC = {
  runsEnded: metric({
    name: "mt.runs.ended",
    kind: "counter",
    unit: "{run}",
    description: "Runs that reached a terminal status",
    dimensions: [ATTR.runStatus],
  }),
  runFailures: metric({
    name: "mt.run.failures",
    kind: "counter",
    unit: "{run}",
    description: "Runs that failed, by error code",
    dimensions: [ATTR.errorCode],
  }),
  runErrors: metric({
    name: "mt.run.errors",
    kind: "counter",
    unit: "{error}",
    description: "Error events shown in a run",
    dimensions: [ATTR.errorCode],
  }),
  approvalsRequested: metric({
    name: "mt.approvals.requested",
    kind: "counter",
    unit: "{approval}",
    description: "Approvals asked for",
    dimensions: [ATTR.approvalKind],
  }),
  approvalsResolved: metric({
    name: "mt.approvals.resolved",
    kind: "counter",
    unit: "{approval}",
    description: "Approvals decided",
    dimensions: [ATTR.approvalStatus, ATTR.approvalDecider],
  }),
  controlChanges: metric({
    name: "mt.control.changes",
    kind: "counter",
    unit: "{change}",
    description: "Browser control handed between agent and person",
    dimensions: [ATTR.controlHolder],
  }),
  slotLeases: metric({
    name: "mt.slot.leases",
    kind: "counter",
    unit: "{lease}",
    description: "Slot leases and releases",
    dimensions: [ATTR.slotOutcome],
  }),
  blocksAdded: metric({
    name: "mt.blocks.added",
    kind: "counter",
    unit: "{block}",
    description: "Note blocks written",
    dimensions: [ATTR.blockType, ATTR.blockOrigin],
  }),
  downloads: metric({
    name: "mt.downloads",
    kind: "counter",
    unit: "{download}",
    description: "Downloads pending or stored",
    dimensions: [ATTR.downloadState],
  }),
  downloadSize: metric({
    name: "mt.download.size",
    kind: "histogram",
    unit: "By",
    description: "Download sizes",
    dimensions: [ATTR.downloadState],
  }),
  budgetHits: metric({
    name: "mt.budget.hits",
    kind: "counter",
    unit: "{hit}",
    description: "Run budgets reached",
    dimensions: [],
  }),
  modelFallbacks: metric({
    name: "mt.model.fallbacks",
    kind: "counter",
    unit: "{fallback}",
    description: "Switches to the fallback model",
    dimensions: [ATTR.modelName],
  }),
  notesFiled: metric({
    name: "mt.notes.filed",
    kind: "counter",
    unit: "{note}",
    description: "Notes filed into a folder",
    dimensions: [ATTR.filedBy],
  }),
  modelTokens: metric({
    name: "mt.model.tokens",
    kind: "counter",
    unit: "{token}",
    description: "Agent model tokens",
    dimensions: [ATTR.modelName, ATTR.tokenType],
  }),
  spendUsd: metric({
    name: "mt.spend.usd",
    kind: "counter",
    unit: "USD",
    description: "Committed run spend",
    dimensions: [],
  }),
  slots: metric({
    name: "mt.slots",
    kind: "gauge",
    unit: "{slot}",
    description: "Browser slots by state",
    dimensions: [ATTR.slotState],
  }),
  activeRuns: metric({
    name: "mt.runs.active",
    kind: "gauge",
    unit: "{run}",
    description: "Runs this agent is driving",
    dimensions: [],
  }),
  sseConnections: metric({
    name: "mt.sse.connections",
    kind: "updown",
    unit: "{connection}",
    description: "Open run event streams",
    dimensions: [],
  }),
  alertsReceived: metric({
    name: "mt.alerts.received",
    kind: "counter",
    unit: "{alert}",
    description: "Alerts received from OpenObserve",
    dimensions: [ATTR.alertRule],
  }),
  pushSends: metric({
    name: "mt.push.sends",
    kind: "counter",
    unit: "{push}",
    description: "Web Push deliveries",
    dimensions: [ATTR.pushOutcome],
  }),
  telemetryDropped: metric({
    name: "mt.telemetry.dropped",
    kind: "counter",
    unit: "{item}",
    description: "Telemetry items or attributes dropped",
    dimensions: [ATTR.telemetrySignal, ATTR.dropReason],
  }),
} as const;

/** The collector's spanmetrics connector (spec §5.3, §10). */
export const SPANMETRICS_NAMESPACE = "mt.span";
export const DERIVED_METRIC = { spanCalls: "mt.span.calls", spanDuration: "mt.span.duration" } as const;
export const SPANMETRIC_DIMENSIONS = [
  ATTR.stepPhase,
  ATTR.stepOutcome,
  ATTR.toolName,
  ATTR.toolOutcome,
  ATTR.modelName,
  ATTR.errorCode,
  ATTR.captureFidelity,
  ATTR.slotName,
  ATTR.takeoverOutcome,
  ATTR.dependency,
] as const satisfies readonly AttributeName[];

export const LOG_STREAMS = { app: "mastertutor", containers: "containers" } as const;
export const TRACE_STREAM = "default";
export const RETENTION_DAYS = { logs: 30, traces: 15, metrics: 90 } as const;
```

Note: `STEP_OUTCOMES` lists `StepOutcome.kind` values. An interrupted step carries `mt.interruption` instead (spec §7.1).

- [ ] **Step 5: Write `packages/contracts/src/observability.ts` and export `webCdpOrigin` from `live.ts`**

In `packages/contracts/src/live.ts`, replace the `liveForwardAuthAddress` function with:

```ts
/** web's static address on cdp (D41): the name `web` can resolve to another app on Dokploy's network. */
export function webCdpOrigin(cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX): string {
  const octets = cdpSubnetPrefix.split(".");
  const valid =
    octets.length === 3 && octets.every((o) => /^[0-9]{1,3}$/.test(o) && Number(o) <= 255);
  if (!valid) throw new TypeError("Invalid CDP subnet prefix");
  return `http://${cdpSubnetPrefix}.11:3000`;
}

/**
 * ForwardAuth target by web's static cdp address (D41): on Dokploy's shared network the name `web`
 * can resolve to another app's container, so the live routers never use it.
 */
export function liveForwardAuthAddress(
  cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX,
): string {
  return `${webCdpOrigin(cdpSubnetPrefix)}${LIVE_AUTH_PATH}`;
}
```

Create `packages/contracts/src/observability.ts`:

```ts
import { DEFAULT_CDP_SUBNET_PREFIX, webCdpOrigin } from "./live.ts";

/** OpenObserve serves its UI and API under this prefix (ZO_BASE_URI, spec §11). */
export const OBSERVE_BASE_PATH = "/observability";
export const OBSERVE_ORG = "default";
/** OpenObserve's base URL on the internal `observe` network. */
export const OBSERVE_INTERNAL_URL = `http://openobserve:5080${OBSERVE_BASE_PATH}`;
/** Its three users (spec §11): root for provisioning, ingest for the collector, viewer for the owner. */
export const OBSERVE_USERS = {
  root: "root@mastertutor.internal",
  ingest: "ingest@mastertutor.internal",
  viewer: "viewer@mastertutor.internal",
} as const;
/**
 * Where OpenObserve's UI keeps its client-side session record, and its shape (spec §12). Pinned by
 * packages/observability/src/o2-api.int.test.ts (Task B1) against the image digest.
 */
export const OBSERVE_UI_SESSION = {
  storage: "localStorage",
  key: "userInfo",
  /** The record is base64(JSON) of this identity: no secret. */
  identity: { email: OBSERVE_USERS.viewer, name: "Owner", role: "admin" },
} as const;

export const OBSERVABILITY_PATH = `${OBSERVE_BASE_PATH}/`;
export const OBSERVABILITY_AUTH_PATH = "/api/observability/auth";
export const OBSERVABILITY_ENTER_PATH = "/api/observability/enter";

/** Traefik rule for the OpenObserve router: /observability and its subtree only. */
export function observabilityRouterRule(host: string): string {
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new TypeError("Invalid router host");
  return `Host(\`${host}\`) && PathRegexp(\`^${OBSERVE_BASE_PATH}(/|$)\`)`;
}

export function observabilityForwardAuthAddress(
  cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX,
): string {
  return `${webCdpOrigin(cdpSubnetPrefix)}${OBSERVABILITY_AUTH_PATH}`;
}
```

- [ ] **Step 6: Extend `packages/contracts/src/env.ts`**

Add these after the `S3Access` block:

```ts
export const DEPLOYMENTS = ["production", "bench", "test", "development"] as const;
/** Telemetry is off unless an endpoint is set (spec §6.3); test stacks never set it. */
const Telemetry = {
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  MT_DEPLOYMENT: z.enum(DEPLOYMENTS).default("production"),
};
export const TelemetryEnv = z.object(Telemetry);
export type TelemetryEnv = z.infer<typeof TelemetryEnv>;

const VapidPublicKey = z
  .string()
  .regex(/^B[A-Za-z0-9_-]{86}$/, "Expected a base64url uncompressed P-256 public key");
const VapidPrivateKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Expected a base64url 32-byte P-256 private key");

/** Both members of a key pair, or neither (names the missing key, never a value). */
const paired =
  (a: string, b: string) => (env: Record<string, unknown>, ctx: z.RefinementCtx) => {
    if ((env[a] === undefined) !== (env[b] === undefined))
      ctx.addIssue({
        code: "custom",
        path: [env[a] === undefined ? a : b],
        message: `set together with ${env[a] === undefined ? b : a}`,
      });
  };
```

Replace `WebEnv` with:

```ts
/** web: encryption-only vault key, member-only n.eko secret, read-only S3 key (spec §13). */
export const WebEnv = z
  .object({
    ...Common,
    ...Telemetry,
    DATABASE_URL: PostgresUrl,
    BETTER_AUTH_SECRET: Secret,
    BETTER_AUTH_URL: z.url(),
    AUTH_SIGNUP_OPEN: Flag,
    VAULT_PUBLIC_KEY: Base64Key32,
    NEKO_MEMBER_SECRET: Secret,
    LIVE_COOKIE_SECRET: Secret,
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_BASE_URL: z.url().optional(),
    ...S3Access,
    /** Web Push (spec §13.4): unset means in-app alerts only. */
    VAPID_PUBLIC_KEY: VapidPublicKey.optional(),
    VAPID_PRIVATE_KEY: VapidPrivateKey.optional(),
    /** OpenObserve's alert webhook bearer (spec §13.2): unset means the webhook does not exist. */
    ALERT_WEBHOOK_SECRET: Secret.optional(),
    /** The viewer user ForwardAuth injects for /observability (spec §12): unset means unavailable. */
    OBSERVE_VIEWER_PASSWORD: Secret.optional(),
    /** Test-only: serve the in-memory fixture API (apps/web/lib/fixtures). Never set in compose files. */
    WEB_FIXTURE_API: Flag,
  })
  .superRefine(paired("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"));
export type WebEnv = z.infer<typeof WebEnv>;
```

In `AgentEnv`, add `...Telemetry,` after `...Common,`.

Replace `GarageInitEnv` with:

```ts
/** garage-init one-shot: admin API token, the two service keys, and OpenObserve's own bucket and key. */
export const GarageInitEnv = z
  .object({
    ...Common,
    GARAGE_ADMIN_URL: z.url(),
    GARAGE_ADMIN_TOKEN: Secret,
    S3_BUCKET: BucketName.default("mastertutor"),
    S3_WEB_ACCESS_KEY_ID: GarageKeyId,
    S3_WEB_SECRET_ACCESS_KEY: GarageSecret,
    S3_AGENT_ACCESS_KEY_ID: GarageKeyId,
    S3_AGENT_SECRET_ACCESS_KEY: GarageSecret,
    S3_OBSERVE_BUCKET: BucketName.default("observability"),
    S3_OBSERVE_ACCESS_KEY_ID: GarageKeyId.optional(),
    S3_OBSERVE_SECRET_ACCESS_KEY: GarageSecret.optional(),
    GARAGE_CAPACITY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 ** 3),
  })
  .superRefine(paired("S3_OBSERVE_ACCESS_KEY_ID", "S3_OBSERVE_SECRET_ACCESS_KEY"));
export type GarageInitEnv = z.infer<typeof GarageInitEnv>;
```

Then add:

```ts
/** observability-init one-shot (spec §11): provisions OpenObserve's users, streams, dashboards, alerts. */
export const ObservabilityInitEnv = z.object({
  ...Common,
  OBSERVE_URL: z.url().default("http://openobserve:5080/observability"),
  OBSERVE_ROOT_PASSWORD: Secret,
  OBSERVE_INGEST_PASSWORD: Secret,
  OBSERVE_VIEWER_PASSWORD: Secret,
  ALERT_WEBHOOK_SECRET: Secret,
  ALERT_WEBHOOK_URL: z.url().default("http://web:3000/api/alerts/webhook"),
  SPEND_ALERT_USD_PER_HOUR: z.coerce.number().positive().max(1_000).default(25),
});
export type ObservabilityInitEnv = z.infer<typeof ObservabilityInitEnv>;
```

If `tsc` reports a use of `WebEnv.shape` or `GarageInitEnv.shape` elsewhere (they are now refined objects), use `WebEnv.def` there instead. `git grep -n "WebEnv.shape\|GarageInitEnv.shape"` must return nothing at HEAD.

- [ ] **Step 7: Export the new modules**

In `packages/contracts/src/index.ts`, append:

```ts
export * from "./alerts.ts";
export * from "./observability.ts";
```

In `packages/contracts/package.json` `exports`, add `"./telemetry": "./src/telemetry.ts"`.

- [ ] **Step 8: Run the tests and typecheck**

Run: `scripts/remote-test.sh unit packages/contracts`, then `pnpm typecheck`.
Expected: PASS, and no type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/telemetry.ts packages/contracts/src/telemetry.test.ts packages/contracts/src/alerts.ts packages/contracts/src/alerts.test.ts packages/contracts/src/observability.ts packages/contracts/src/observability.test.ts packages/contracts/src/env-observability.test.ts packages/contracts/src/env.ts packages/contracts/src/live.ts packages/contracts/src/index.ts packages/contracts/package.json
git commit -m "feat(contracts): telemetry names, alert and push contracts, observability env (D50)" -- packages/contracts
```

---
## Track A: SDK and instrumentation

### Task A1: pino → OTel log bridge in contracts

**Files:**
- Create: `packages/contracts/src/server/log-bridge.ts`
- Modify: `packages/contracts/src/server/logger.ts` (`createLogger`), `packages/contracts/src/server/index.ts`, `packages/contracts/package.json`
- Test: `packages/contracts/src/server/logger.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (`@mastertutor/contracts/server`):
  - `enableLogBridge(): void`, `disableLogBridge(): void`;
  - `withRunId(parent: Context, runId: string): Context`;
  - `logCorrelation(): { trace_id?: string; span_id?: string; run_id?: string }`;
  - `otelLogStream(service: string): DestinationStream`;
  - `BRIDGE_SKIP_MODULE = "telemetry"`.

  `createLogger`'s signature is unchanged.

- [ ] **Step 1: Add the API-only dependencies**

In `packages/contracts/package.json`, add `"@opentelemetry/api": "1.9.1"` and `"@opentelemetry/api-logs": "0.223.0"` to `dependencies`, and `"@opentelemetry/context-async-hooks": "2.12.0"` to `devDependencies`. Then run `pnpm install`.

- [ ] **Step 2: Write the failing tests** (append to `packages/contracts/src/server/logger.test.ts`)

```ts
import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { logs, type LogRecord } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterEach, beforeAll } from "vitest";
import { disableLogBridge, enableLogBridge, withRunId } from "./log-bridge.ts";

const RUN = "11111111-1111-4111-8111-111111111111";
const SPAN_CONTEXT = {
  traceId: "0af7651916cd43dd8448eb211c80319c",
  spanId: "b7ad6b7169203331",
  traceFlags: 1,
};

function captureOtel(): LogRecord[] {
  const records: LogRecord[] = [];
  logs.setGlobalLoggerProvider({ getLogger: () => ({ emit: (r) => void records.push(r) }) });
  return records;
}

describe("createLogger and the OTel bridge (spec §9)", () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });
  afterEach(() => {
    disableLogBridge();
    logs.disable();
  });

  it("adds trace_id, span_id and run_id from the active context, only when present", () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: "test", destination });
    const active = withRunId(trace.setSpanContext(ROOT_CONTEXT, SPAN_CONTEXT), RUN);
    context.with(active, () => log.info({ step: "observe" }, "step"));
    log.info("outside");
    const [inside, outside] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(inside).toMatchObject({
      trace_id: SPAN_CONTEXT.traceId,
      span_id: SPAN_CONTEXT.spanId,
      run_id: RUN,
      step: "observe",
    });
    expect(outside).not.toHaveProperty("trace_id");
    expect(outside).not.toHaveProperty("run_id");
  });

  it("bridges nothing until enabled, then only redacted lines, never the telemetry module", () => {
    const records = captureOtel();
    const { lines, destination } = capture();
    const log = createLogger({ service: "agent", destination });
    log.info({ password: "hunter2-canary" }, "before");
    expect(records).toEqual([]);
    enableLogBridge();
    context.with(trace.setSpanContext(ROOT_CONTEXT, SPAN_CONTEXT), () =>
      log.warn({ password: "hunter2-canary", alias: "zybooks", errorCode: "x_y" }, "fill"),
    );
    log.warn({ module: "telemetry", errorCode: "telemetry_dropped" }, "dropped");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      severityText: "WARN",
      body: "fill",
      attributes: { password: "[redacted]", alias: "zybooks", errorCode: "x_y", service: "agent" },
    });
    expect(JSON.stringify(records)).not.toContain("hunter2-canary");
    expect(lines).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/contracts/src/server/logger.test.ts`
Expected: FAIL. `./log-bridge.ts` is not found.

- [ ] **Step 4: Write `packages/contracts/src/server/log-bridge.ts`**

```ts
/**
 * pino → OpenTelemetry logs (D50, spec §9). The only contracts module that touches OTel, and only
 * its API packages: with no SDK registered every call is a no-op, and the stream does no work at all
 * until @mastertutor/telemetry calls enableLogBridge(). It receives each line after pino has
 * serialised and redacted it, so it can never see a secret pino removed.
 */
import { context, createContextKey, trace, type Context } from "@opentelemetry/api";
import { logs, SeverityNumber, type AnyValueMap } from "@opentelemetry/api-logs";
import type { DestinationStream } from "pino";

const RUN_ID = createContextKey("mt.run.id");
/** Lines from the telemetry package itself (drop warnings) never re-enter the bridge. */
export const BRIDGE_SKIP_MODULE = "telemetry";
const NOT_ATTRIBUTES = new Set(["level", "time", "msg", "pid", "hostname", "trace_id", "span_id"]);
const SEVERITY: Record<number, [SeverityNumber, string]> = {
  10: [SeverityNumber.TRACE, "TRACE"],
  20: [SeverityNumber.DEBUG, "DEBUG"],
  30: [SeverityNumber.INFO, "INFO"],
  40: [SeverityNumber.WARN, "WARN"],
  50: [SeverityNumber.ERROR, "ERROR"],
  60: [SeverityNumber.FATAL, "FATAL"],
};

let enabled = false;

export function enableLogBridge(): void {
  enabled = true;
}

export function disableLogBridge(): void {
  enabled = false;
}

/** The context that makes every log line inside it carry run_id (instrument() sets it). */
export function withRunId(parent: Context, runId: string): Context {
  return parent.setValue(RUN_ID, runId);
}

/** pino mixin: ids of the active span and run, only those that exist. */
export function logCorrelation(): Record<string, string> {
  const active = context.active();
  const fields: Record<string, string> = {};
  const span = trace.getSpan(active)?.spanContext();
  if (span && trace.isSpanContextValid(span)) {
    fields.trace_id = span.traceId;
    fields.span_id = span.spanId;
  }
  const runId = active.getValue(RUN_ID);
  if (typeof runId === "string") fields.run_id = runId;
  return fields;
}

/** A pino destination that emits each (already redacted) line as an OTel LogRecord. */
export function otelLogStream(service: string): DestinationStream {
  return {
    write(line: string): void {
      if (!enabled) return;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        if (record.module === BRIDGE_SKIP_MODULE) return;
        const [severityNumber, severityText] = SEVERITY[Number(record.level)] ?? [
          SeverityNumber.UNSPECIFIED,
          "UNSPECIFIED",
        ];
        const attributes: AnyValueMap = {};
        for (const [key, value] of Object.entries(record))
          if (!NOT_ATTRIBUTES.has(key)) attributes[key] = value as AnyValueMap[string];
        logs.getLogger(service).emit({
          severityNumber,
          severityText,
          body: typeof record.msg === "string" ? record.msg : "",
          attributes,
          context: context.active(),
        });
      } catch {
        // A line the bridge cannot read is still on stdout; telemetry never breaks logging.
      }
    },
  };
}
```

- [ ] **Step 5: Wire it into `createLogger`**

Replace `createLogger` in `packages/contracts/src/server/logger.ts`:

```ts
import pino, { type DestinationStream, type Logger } from "pino";
import { logCorrelation, otelLogStream } from "./log-bridge.ts";
// (keep the existing imports and SECRET_KEYS / REDACT_PATHS unchanged)

export function createLogger(options: LoggerOptions): Logger {
  const config = {
    level: options.level ?? "info",
    base: { service: options.service },
    redact: { paths: [...REDACT_PATHS], censor: "[redacted]" },
    // trace_id, span_id and run_id when a span or run is active (D50, spec §9).
    mixin: logCorrelation,
  };
  // stdout stays synchronous JSON for Dokploy; the bridge sees the same redacted line.
  const stdout = options.destination ?? pino.destination({ dest: 1, sync: true });
  return pino(
    config,
    pino.multistream([
      { level: "trace", stream: stdout },
      { level: "trace", stream: otelLogStream(options.service) },
    ]),
  );
}
```

In `packages/contracts/src/server/index.ts`, add `export * from "./log-bridge.ts";`.

- [ ] **Step 6: Run the tests**

Run: `scripts/remote-test.sh unit packages/contracts/src/server`
Expected: PASS, including the two existing redaction tests.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(contracts): bridge pino to OTel logs with trace and run ids (D50)" -- packages/contracts/src/server/log-bridge.ts packages/contracts/src/server/logger.ts packages/contracts/src/server/logger.test.ts packages/contracts/src/server/index.ts packages/contracts/package.json pnpm-lock.yaml
```

---

### Task A2: Telemetry package core: bounded batching, allowlist, instruments

**Files:**
- Create: `packages/telemetry/package.json`, `packages/telemetry/tsconfig.json`, `packages/telemetry/src/batcher.ts`, `src/processors.ts`, `src/allowlist.ts`, `src/instruments.ts`, `src/self.ts`, `src/index.ts`
- Test: `packages/telemetry/src/batcher.test.ts`, `src/allowlist.test.ts`, `src/processors.test.ts`

**Interfaces:**
- Consumes: `@mastertutor/contracts/telemetry` (`METRIC`, `METER_NAME`, `ATTR`, `EXPORTABLE_ATTRIBUTES`, `TelemetrySignal`, `DropReason`), `@mastertutor/contracts/server` (`createLogger` type).
- Produces:
  - `BoundedBatcher<T>` (`add(item)`, `flush(): Promise<void>`, `shutdown(): Promise<void>`, `size`);
  - `QueueLimits`, `DEFAULT_LIMITS = { maxQueue: 2048, maxBatch: 512, intervalMs: 2000 }`, `EXPORT_TIMEOUT_MS = 5000`;
  - `BoundedSpanProcessor(exporter, limits, onDrop)`, `BoundedLogProcessor(exporter, limits, onDrop)`, `CountingMetricExporter(inner, onFailed)`, `exportOnce(exporter, items)`;
  - `AllowlistSpanExporter(inner, onDropped: (count: number) => void)`;
  - `instruments(): Instruments` and `resetInstruments()`;
  - `type Log`, `setTelemetryLog(log: Log | null)`, `countDropped(signal, reason, count)`.

- [ ] **Step 1: Create the package**

`packages/telemetry/package.json`:

```json
{
  "name": "@mastertutor/telemetry",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": ["./src/register-agent.ts"],
  "exports": {
    ".": "./src/index.ts",
    "./record": "./src/record.ts",
    "./instrument": "./src/instrument.ts",
    "./register-agent": "./src/register-agent.ts",
    "./testing": "./src/testing.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@mastertutor/contracts": "workspace:*",
    "@opentelemetry/api": "1.9.1",
    "@opentelemetry/api-logs": "0.223.0",
    "@opentelemetry/core": "2.12.0",
    "@opentelemetry/exporter-logs-otlp-proto": "0.223.0",
    "@opentelemetry/exporter-metrics-otlp-proto": "0.223.0",
    "@opentelemetry/exporter-trace-otlp-proto": "0.223.0",
    "@opentelemetry/instrumentation": "0.223.0",
    "@opentelemetry/instrumentation-http": "0.223.0",
    "@opentelemetry/instrumentation-undici": "0.33.0",
    "@opentelemetry/resources": "2.12.0",
    "@opentelemetry/sdk-logs": "0.223.0",
    "@opentelemetry/sdk-metrics": "2.12.0",
    "@opentelemetry/sdk-trace-base": "2.12.0",
    "@opentelemetry/sdk-trace-node": "2.12.0"
  }
}
```

`packages/telemetry/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

`packages/telemetry/src/batcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BoundedBatcher } from "./batcher.ts";
import type { DropReason } from "@mastertutor/contracts/telemetry";

function harness(send: (batch: number[]) => Promise<void>, maxQueue = 4, maxBatch = 2) {
  const drops: Array<[number, DropReason]> = [];
  const batcher = new BoundedBatcher<number>({
    maxQueue,
    maxBatch,
    intervalMs: 60_000,
    send,
    onDrop: (count, reason) => drops.push([count, reason]),
  });
  return { batcher, drops };
}

describe("BoundedBatcher (spec §7.1)", () => {
  it("drops and counts when the queue is full, without waiting", () => {
    const { batcher, drops } = harness(() => new Promise<void>(() => undefined), 2, 10);
    batcher.add(1);
    batcher.add(2);
    batcher.add(3);
    expect(batcher.size).toBe(2);
    expect(drops).toEqual([[1, "queue_full"]]);
  });

  it("counts a failed export by its batch size and never throws", async () => {
    const { batcher, drops } = harness(async () => {
      throw new Error("collector down");
    });
    batcher.add(1);
    batcher.add(2);
    batcher.add(3);
    await batcher.flush();
    expect(drops).toEqual([
      [2, "export_failed"],
      [1, "export_failed"],
    ]);
    expect(batcher.size).toBe(0);
  });

  it("exports one batch at a time, in order", async () => {
    const seen: number[][] = [];
    const { batcher } = harness(async (batch) => void seen.push(batch), 10, 2);
    for (const n of [1, 2, 3, 4, 5]) batcher.add(n);
    await batcher.flush();
    expect(seen).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("flushes on shutdown and drops what arrives after", async () => {
    const seen: number[][] = [];
    const { batcher, drops } = harness(async (batch) => void seen.push(batch), 10, 5);
    batcher.add(1);
    await batcher.shutdown();
    batcher.add(2);
    expect(seen).toEqual([[1]]);
    expect(drops).toEqual([[1, "queue_full"]]);
  });
});
```

`packages/telemetry/src/allowlist.test.ts`:

```ts
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { AllowlistSpanExporter } from "./allowlist.ts";

describe("AllowlistSpanExporter (spec §5.2, §14)", () => {
  it("exports only allowlisted attributes, filters events, and counts what it dropped", async () => {
    const memory = new InMemorySpanExporter();
    let dropped = 0;
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(new AllowlistSpanExporter(memory, (n) => (dropped += n))),
      ],
    });
    const span = provider.getTracer("t").startSpan("mt.tool", {
      attributes: {
        "mt.tool.name": "capture",
        "server.address": "garage",
        "url.full": "http://garage:3900/mastertutor/downloads/r/private.pdf",
        "user.goal": "page text canary",
      },
    });
    span.addEvent("exception", {
      "exception.type": "ToolError",
      "exception.message": "the page said hunter2",
    });
    span.end();
    await provider.forceFlush();
    const [exported] = memory.getFinishedSpans();
    expect(exported!.attributes).toEqual({ "mt.tool.name": "capture", "server.address": "garage" });
    expect(exported!.events[0]!.attributes).toEqual({ "exception.type": "ToolError" });
    expect(exported!.spanContext().spanId).toBe(span.spanContext().spanId);
    expect(exported!.name).toBe("mt.tool");
    expect(dropped).toBe(3);
  });
});
```

`packages/telemetry/src/processors.test.ts`:

```ts
import { ExportResultCode } from "@opentelemetry/core";
import { BasicTracerProvider, type ReadableSpan, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { BoundedSpanProcessor, exportOnce } from "./processors.ts";

const failing: SpanExporter = {
  export: (_spans, done) => done({ code: ExportResultCode.FAILED, error: new Error("down") }),
  shutdown: async () => undefined,
};

describe("bounded processors", () => {
  it("exportOnce resolves on success and rejects on failure", async () => {
    await expect(exportOnce(failing, [])).rejects.toThrow("down");
  });

  it("counts spans an unreachable collector could not take, and onEnd never throws", async () => {
    const drops: number[] = [];
    const processor = new BoundedSpanProcessor(
      failing,
      { maxQueue: 10, maxBatch: 5, intervalMs: 60_000 },
      (count) => drops.push(count),
    );
    const provider = new BasicTracerProvider({ spanProcessors: [processor] });
    for (let i = 0; i < 3; i++) provider.getTracer("t").startSpan("s").end();
    await processor.forceFlush();
    expect(drops.reduce((a, b) => a + b, 0)).toBe(3);
    await processor.shutdown();
  });

  it("skips unsampled spans", async () => {
    const seen: ReadableSpan[] = [];
    const processor = new BoundedSpanProcessor(
      { export: (spans, done) => (seen.push(...spans), done({ code: ExportResultCode.SUCCESS })), shutdown: async () => undefined },
      { maxQueue: 10, maxBatch: 5, intervalMs: 60_000 },
      () => undefined,
    );
    processor.onEnd({ spanContext: () => ({ traceId: "a", spanId: "b", traceFlags: 0 }) } as ReadableSpan);
    await processor.forceFlush();
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/telemetry`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write the implementation**

`packages/telemetry/src/batcher.ts`:

```ts
import type { DropReason } from "@mastertutor/contracts/telemetry";

export interface BatcherOptions<T> {
  maxQueue: number;
  maxBatch: number;
  intervalMs: number;
  send(batch: T[]): Promise<void>;
  onDrop(count: number, reason: DropReason): void;
}

/**
 * A bounded, non-blocking batch queue (spec §7.1): add() never waits and never throws, a full
 * queue drops and counts, one export runs at a time, and a failed export counts its batch.
 */
export class BoundedBatcher<T> {
  readonly #options: BatcherOptions<T>;
  readonly #timer: NodeJS.Timeout;
  #queue: T[] = [];
  #inFlight: Promise<void> | null = null;
  #closed = false;

  constructor(options: BatcherOptions<T>) {
    this.#options = options;
    this.#timer = setInterval(() => void this.flush(), options.intervalMs);
    this.#timer.unref();
  }

  get size(): number {
    return this.#queue.length;
  }

  add(item: T): void {
    if (this.#closed || this.#queue.length >= this.#options.maxQueue) {
      this.#drop(1, "queue_full");
      return;
    }
    this.#queue.push(item);
    if (this.#queue.length >= this.#options.maxBatch) void this.flush();
  }

  /** Exports everything queued now, one batch at a time. Never rejects. */
  flush(): Promise<void> {
    this.#inFlight ??= this.#drain().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#timer);
    await this.flush();
  }

  async #drain(): Promise<void> {
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, this.#options.maxBatch);
      try {
        await this.#options.send(batch);
      } catch {
        this.#drop(batch.length, "export_failed");
      }
    }
  }

  #drop(count: number, reason: DropReason): void {
    try {
      this.#options.onDrop(count, reason);
    } catch {
      // Counting a drop must never throw into the product.
    }
  }
}
```

`packages/telemetry/src/processors.ts`:

```ts
import { TraceFlags } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type {
  LogRecordExporter,
  LogRecordProcessor,
  ReadableLogRecord,
  SdkLogRecord,
} from "@opentelemetry/sdk-logs";
import type { PushMetricExporter, ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { DropReason } from "@mastertutor/contracts/telemetry";
import { BoundedBatcher } from "./batcher.ts";

export interface QueueLimits {
  maxQueue: number;
  maxBatch: number;
  intervalMs: number;
}
export const DEFAULT_LIMITS: QueueLimits = { maxQueue: 2_048, maxBatch: 512, intervalMs: 2_000 };
export const EXPORT_TIMEOUT_MS = 5_000;
type OnDrop = (count: number, reason: DropReason) => void;

/** One exporter call as a promise; a non-success result rejects. */
export function exportOnce<T>(
  exporter: { export(items: T[], done: (result: ExportResult) => void): void },
  items: T[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      exporter.export(items, (result) =>
        result.code === ExportResultCode.SUCCESS
          ? resolve()
          : reject(result.error ?? new Error("export failed")),
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error("export threw"));
    }
  });
}

export class BoundedSpanProcessor implements SpanProcessor {
  readonly #exporter: SpanExporter;
  readonly #batcher: BoundedBatcher<ReadableSpan>;

  constructor(exporter: SpanExporter, limits: QueueLimits, onDrop: OnDrop) {
    this.#exporter = exporter;
    this.#batcher = new BoundedBatcher({ ...limits, onDrop, send: (b) => exportOnce(exporter, b) });
  }

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    if ((span.spanContext().traceFlags & TraceFlags.SAMPLED) !== 0) this.#batcher.add(span);
  }

  forceFlush(): Promise<void> {
    return this.#batcher.flush();
  }

  async shutdown(): Promise<void> {
    await this.#batcher.shutdown();
    await this.#exporter.shutdown().catch(() => undefined);
  }
}

export class BoundedLogProcessor implements LogRecordProcessor {
  readonly #exporter: LogRecordExporter;
  readonly #batcher: BoundedBatcher<ReadableLogRecord>;

  constructor(exporter: LogRecordExporter, limits: QueueLimits, onDrop: OnDrop) {
    this.#exporter = exporter;
    this.#batcher = new BoundedBatcher({ ...limits, onDrop, send: (b) => exportOnce(exporter, b) });
  }

  onEmit(record: SdkLogRecord): void {
    this.#batcher.add(record);
  }

  forceFlush(): Promise<void> {
    return this.#batcher.flush();
  }

  async shutdown(): Promise<void> {
    await this.#batcher.shutdown();
    await this.#exporter.shutdown().catch(() => undefined);
  }
}

/** Metrics are aggregated in memory (bounded by cardinality); a failed push is counted once. */
export class CountingMetricExporter implements PushMetricExporter {
  readonly #inner: PushMetricExporter;
  readonly #onFailed: () => void;
  readonly selectAggregationTemporality: PushMetricExporter["selectAggregationTemporality"];
  readonly selectAggregation: PushMetricExporter["selectAggregation"];

  constructor(inner: PushMetricExporter, onFailed: () => void) {
    this.#inner = inner;
    this.#onFailed = onFailed;
    this.selectAggregationTemporality = inner.selectAggregationTemporality?.bind(inner);
    this.selectAggregation = inner.selectAggregation?.bind(inner);
  }

  export(metrics: ResourceMetrics, done: (result: ExportResult) => void): void {
    try {
      this.#inner.export(metrics, (result) => {
        if (result.code !== ExportResultCode.SUCCESS) this.#onFailed();
        done(result);
      });
    } catch (error) {
      this.#onFailed();
      done({ code: ExportResultCode.FAILED, error: error instanceof Error ? error : undefined });
    }
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }
}
```

If `tsc` reports that `@opentelemetry/sdk-logs` 0.223.0 names the emitted record type differently from `SdkLogRecord`, use the type that `LogRecordProcessor.onEmit` declares in `node_modules/@opentelemetry/sdk-logs/build/src/LogRecordProcessor.d.ts`. No other change.

`packages/telemetry/src/allowlist.ts`:

```ts
import type { Attributes } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { EXPORTABLE_ATTRIBUTES } from "@mastertutor/contracts/telemetry";

function allowed(attributes: Attributes, onDropped: (count: number) => void): Attributes {
  const kept: Attributes = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(attributes)) {
    if (EXPORTABLE_ATTRIBUTES.has(key)) kept[key] = value;
    else dropped += 1;
  }
  if (dropped > 0) onDropped(dropped);
  return kept;
}

/**
 * The runtime half of the attribute allowlist (spec §5.2): every span leaves with product and
 * listed base attributes only; links are dropped (we never link traces). The span itself is not
 * mutated: a view over it with filtered attributes is exported.
 */
export class AllowlistSpanExporter implements SpanExporter {
  readonly #inner: SpanExporter;
  readonly #onDropped: (count: number) => void;

  constructor(inner: SpanExporter, onDropped: (count: number) => void) {
    this.#inner = inner;
    this.#onDropped = onDropped;
  }

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    const views = spans.map(
      (span) =>
        Object.create(span, {
          attributes: { value: allowed(span.attributes, this.#onDropped), enumerable: true },
          events: {
            value: span.events.map((event) => ({
              ...event,
              attributes: event.attributes ? allowed(event.attributes, this.#onDropped) : undefined,
            })),
            enumerable: true,
          },
          links: { value: [], enumerable: true },
        }) as ReadableSpan,
    );
    this.#inner.export(views, done);
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush?.() ?? Promise.resolve();
  }
}
```

`packages/telemetry/src/instruments.ts`:

```ts
import { metrics, type Counter, type Histogram, type UpDownCounter } from "@opentelemetry/api";
import { METER_NAME, METRIC, type MetricSpec } from "@mastertutor/contracts/telemetry";

export interface Instruments {
  runsEnded: Counter;
  runFailures: Counter;
  runErrors: Counter;
  approvalsRequested: Counter;
  approvalsResolved: Counter;
  controlChanges: Counter;
  slotLeases: Counter;
  blocksAdded: Counter;
  downloads: Counter;
  downloadSize: Histogram;
  budgetHits: Counter;
  modelFallbacks: Counter;
  notesFiled: Counter;
  modelTokens: Counter;
  spendUsd: Counter;
  sseConnections: UpDownCounter;
  alertsReceived: Counter;
  pushSends: Counter;
  telemetryDropped: Counter;
}

let cache: Instruments | null = null;

/**
 * Metric instruments, created from METRIC on first use after the meter provider is set. The OTel
 * metrics API has no proxy provider, so startTelemetry() calls resetInstruments() after it
 * registers one; before that every recorder writes to the no-op meter.
 */
export function instruments(): Instruments {
  if (cache) return cache;
  const meter = metrics.getMeter(METER_NAME);
  const counter = (spec: MetricSpec) =>
    meter.createCounter(spec.name, { unit: spec.unit, description: spec.description });
  cache = {
    runsEnded: counter(METRIC.runsEnded),
    runFailures: counter(METRIC.runFailures),
    runErrors: counter(METRIC.runErrors),
    approvalsRequested: counter(METRIC.approvalsRequested),
    approvalsResolved: counter(METRIC.approvalsResolved),
    controlChanges: counter(METRIC.controlChanges),
    slotLeases: counter(METRIC.slotLeases),
    blocksAdded: counter(METRIC.blocksAdded),
    downloads: counter(METRIC.downloads),
    downloadSize: meter.createHistogram(METRIC.downloadSize.name, {
      unit: METRIC.downloadSize.unit,
      description: METRIC.downloadSize.description,
    }),
    budgetHits: counter(METRIC.budgetHits),
    modelFallbacks: counter(METRIC.modelFallbacks),
    notesFiled: counter(METRIC.notesFiled),
    modelTokens: counter(METRIC.modelTokens),
    spendUsd: counter(METRIC.spendUsd),
    sseConnections: meter.createUpDownCounter(METRIC.sseConnections.name, {
      unit: METRIC.sseConnections.unit,
      description: METRIC.sseConnections.description,
    }),
    alertsReceived: counter(METRIC.alertsReceived),
    pushSends: counter(METRIC.pushSends),
    telemetryDropped: counter(METRIC.telemetryDropped),
  };
  return cache;
}

export function resetInstruments(): void {
  cache = null;
}
```

`packages/telemetry/src/self.ts`:

```ts
import type { createLogger } from "@mastertutor/contracts/server";
import { ATTR, type DropReason, type TelemetrySignal } from "@mastertutor/contracts/telemetry";
import { instruments } from "./instruments.ts";

export type Log = ReturnType<typeof createLogger>;
const WARN_EVERY_MS = 60_000;
let log: Log | null = null;
let lastWarn = Number.NEGATIVE_INFINITY;

export function setTelemetryLog(next: Log | null): void {
  log = next;
}

/** Counts dropped telemetry and says so on stdout at most once a minute (module telemetry, unbridged). */
export function countDropped(signal: TelemetrySignal, reason: DropReason, count: number): void {
  if (count <= 0) return;
  try {
    instruments().telemetryDropped.add(count, {
      [ATTR.telemetrySignal]: signal,
      [ATTR.dropReason]: reason,
    });
    const now = Date.now();
    if (log && reason !== "not_allowed" && now - lastWarn >= WARN_EVERY_MS) {
      lastWarn = now;
      log.warn(
        { module: "telemetry", errorCode: "telemetry_dropped", signal, reason, count },
        "telemetry dropped",
      );
    }
  } catch {
    // Never throws into the product.
  }
}
```

`packages/telemetry/src/index.ts` (it grows in A3 and A4):

```ts
export { BoundedBatcher } from "./batcher.ts";
export { AllowlistSpanExporter } from "./allowlist.ts";
export { DEFAULT_LIMITS, type QueueLimits } from "./processors.ts";
export type { Log } from "./self.ts";
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `scripts/remote-test.sh unit packages/telemetry`, then `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry
git commit -m "feat(telemetry): bounded batching, attribute allowlist and metric instruments (D50)" -- packages/telemetry pnpm-lock.yaml
```

---

### Task A3: `startTelemetry`, the agent preload and crash handlers

**Files:**
- Create: `packages/telemetry/src/handle.ts`, `src/start.ts`, `src/crash.ts`, `src/register-agent.ts`
- Modify: `packages/telemetry/src/index.ts`
- Test: `packages/telemetry/src/start.test.ts`, `src/crash.test.ts`

**Interfaces:**
- Consumes: A1 (`enableLogBridge`, `disableLogBridge`, `createLogger`), A2 (processors, allowlist, `resetInstruments`, `countDropped`, `setTelemetryLog`, `Log`), Task 0 (`TelemetryEnv`, `TRACER_NAME`).
- Produces:
  - `startTelemetry(options: StartOptions): TelemetryHandle`;
  - `StartOptions { service: "web" | "agent"; env: TelemetryEnv; crash: CrashMode; log: Log; limits?: QueueLimits }`;
  - `TelemetryHandle { enabled: boolean; flush(timeoutMs?): Promise<void>; shutdown(timeoutMs?): Promise<void> }` (neither ever rejects);
  - `getTelemetry(): TelemetryHandle`;
  - `CrashMode = "exit" | "observe"`;
  - `installCrashHandlers(mode, log, flush?)`;
  - preload file `packages/telemetry/src/register-agent.ts`.

- [ ] **Step 1: Write the failing tests**

`packages/telemetry/src/start.test.ts`:

```ts
import { createServer, type IncomingHttpHeaders, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { trace } from "@opentelemetry/api";
import { createLogger } from "@mastertutor/contracts/server";
import { TRACER_NAME } from "@mastertutor/contracts/telemetry";
import { afterEach, describe, expect, it } from "vitest";
import { getTelemetry, startTelemetry } from "./start.ts";

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}
const silent = createLogger({ service: "test", level: "silent" });

afterEach(async () => {
  await getTelemetry().shutdown();
});

describe("startTelemetry (spec §6.3, §7)", () => {
  it("does nothing without an endpoint", () => {
    const handle = startTelemetry({
      service: "agent",
      env: { MT_DEPLOYMENT: "test" },
      crash: "observe",
      log: silent,
    });
    expect(handle.enabled).toBe(false);
    expect(trace.getTracer(TRACER_NAME).startSpan("s").isRecording()).toBe(false);
  });

  it("exports spans and never sends a traceparent anywhere (D38)", async () => {
    const paths: string[] = [];
    const seen: IncomingHttpHeaders[] = [];
    const collector = await listen((req, res) => {
      paths.push(req.url ?? "");
      req.resume().on("end", () => res.writeHead(200).end());
    });
    const target = await listen((req, res) => {
      seen.push(req.headers);
      res.end("ok");
    });
    const handle = startTelemetry({
      service: "agent",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, MT_DEPLOYMENT: "test" },
      crash: "observe",
      log: silent,
    });
    expect(handle.enabled).toBe(true);
    await trace.getTracer(TRACER_NAME).startActiveSpan("mt.tool", async (span) => {
      await (await fetch(target.url)).text();
      span.end();
    });
    await handle.flush(5_000);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty("traceparent");
    expect(seen[0]).not.toHaveProperty("tracestate");
    expect(paths).toContain("/v1/traces");
    collector.close();
    target.close();
  });

  it("stdout keeps every line while the bridge drops (collector down, Review Focus 1)", async () => {
    const lines: string[] = [];
    const log = createLogger({
      service: "agent",
      destination: { write: (line: string) => void lines.push(line) },
    });
    const handle = startTelemetry({
      service: "agent",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9", MT_DEPLOYMENT: "test" },
      crash: "observe",
      log,
      limits: { maxQueue: 50, maxBatch: 25, intervalMs: 60_000 },
    });
    const started = performance.now();
    for (let i = 0; i < 5_000; i++) log.info({ i }, "burst");
    const perLineMs = (performance.now() - started) / 5_000;
    await handle.flush(6_000);
    expect(lines.filter((line) => line.includes('"msg":"burst"'))).toHaveLength(5_000);
    expect(lines.some((line) => line.includes('"errorCode":"telemetry_dropped"'))).toBe(true);
    expect(perLineMs).toBeLessThan(0.2);
  });
});
```

`packages/telemetry/src/crash.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const CRASH = new URL("./crash.ts", import.meta.url).href;
const script = (mode: "exit" | "observe", fault: string) => `
import { installCrashHandlers } from ${JSON.stringify(CRASH)};
const log = {
  fatal: (o) => console.log(JSON.stringify(o)),
  error: (o) => console.log(JSON.stringify(o)),
};
installCrashHandlers(${JSON.stringify(mode)}, log, async () => { console.log("flushed"); });
setTimeout(() => { ${fault} }, 0);
`;
const run = (mode: "exit" | "observe", fault = 'throw new TypeError("boom page text");') =>
  spawnSync(process.execPath, ["--input-type=module", "-e", script(mode, fault)], {
    encoding: "utf8",
  });

describe("crash handlers (spec §7.1)", () => {
  it("exit mode logs the code, flushes, prints as Node does and exits 1", () => {
    const result = run("exit");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"errorCode":"uncaught_exception"');
    expect(result.stdout).toContain('"err":"TypeError"');
    expect(result.stdout).toContain("flushed");
    expect(result.stdout).not.toContain("boom page text");
    expect(result.stderr).toContain("TypeError");
  });

  it("an unhandled rejection takes the same path in exit mode", () => {
    const result = run("exit", 'Promise.reject(new RangeError("nope"));');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"origin":"unhandledRejection"');
    expect(result.stdout).toContain('"err":"RangeError"');
  });

  it("observe mode logs and leaves Node's own behaviour unchanged", () => {
    const result = run("observe");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"errorCode":"uncaught_exception"');
    expect(result.stderr).toContain("boom page text");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/telemetry/src/start.test.ts packages/telemetry/src/crash.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

`packages/telemetry/src/handle.ts`:

```ts
export interface TelemetryHandle {
  readonly enabled: boolean;
  /** Exports what is queued, waiting at most timeoutMs. Never rejects. */
  flush(timeoutMs?: number): Promise<void>;
  /** Flushes and stops, waiting at most timeoutMs. Never rejects. */
  shutdown(timeoutMs?: number): Promise<void>;
}

export const NOOP_HANDLE: TelemetryHandle = {
  enabled: false,
  flush: async () => undefined,
  shutdown: async () => undefined,
};

let current: TelemetryHandle = NOOP_HANDLE;

export function getTelemetry(): TelemetryHandle {
  return current;
}

export function setTelemetry(handle: TelemetryHandle): void {
  current = handle;
}

/** Waits for work, at most `ms`; never rejects. */
export function within(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
    work.then(
      () => (clearTimeout(timer), resolve()),
      () => (clearTimeout(timer), resolve()),
    );
  });
}
```

`packages/telemetry/src/crash.ts`:

```ts
import { inspect } from "node:util";
import { getTelemetry } from "./handle.ts";

export type CrashMode = "exit" | "observe";
type CrashLog = { fatal(fields: object, message: string): void; error(fields: object, message: string): void };

const nameOf = (error: unknown) =>
  error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "unknown";
let installed = false;

/**
 * Crash handling (spec §7.1). "exit" (agent): log the code, flush (≤ 2 s), print the error as Node
 * does and exit 1, which is today's behaviour plus a log line and a flush; with Node's default
 * --unhandled-rejections=throw, rejections arrive here too. "observe" (web): Next.js owns the
 * process, so only a monitor listener is added and nothing about exiting changes.
 */
export function installCrashHandlers(
  mode: CrashMode,
  log: CrashLog,
  flush: () => Promise<void> = () => getTelemetry().flush(2_000),
): void {
  if (installed) return;
  installed = true;
  if (mode === "observe") {
    process.on("uncaughtExceptionMonitor", (error, origin) => {
      log.error({ errorCode: "uncaught_exception", origin, err: nameOf(error) }, "uncaught exception");
      void flush().catch(() => undefined);
    });
    return;
  }
  let crashing = false;
  process.on("uncaughtException", (error, origin) => {
    if (crashing) process.exit(1);
    crashing = true;
    log.fatal({ errorCode: "uncaught_exception", origin, err: nameOf(error) }, "uncaught exception");
    void flush()
      .catch(() => undefined)
      .finally(() => {
        process.stderr.write(`${inspect(error)}\n`);
        process.exit(1);
      });
  });
}
```

`packages/telemetry/src/start.ts`:

```ts
import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { CompositePropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { TelemetryEnv } from "@mastertutor/contracts";
import { disableLogBridge, enableLogBridge } from "@mastertutor/contracts/server";
import type { TelemetrySignal } from "@mastertutor/contracts/telemetry";
import { AllowlistSpanExporter } from "./allowlist.ts";
import { installCrashHandlers, type CrashMode } from "./crash.ts";
import { NOOP_HANDLE, getTelemetry, setTelemetry, within, type TelemetryHandle } from "./handle.ts";
import { resetInstruments } from "./instruments.ts";
import {
  BoundedLogProcessor,
  BoundedSpanProcessor,
  CountingMetricExporter,
  DEFAULT_LIMITS,
  EXPORT_TIMEOUT_MS,
  type QueueLimits,
} from "./processors.ts";
import { countDropped, setTelemetryLog, type Log } from "./self.ts";

export { getTelemetry, type TelemetryHandle } from "./handle.ts";

export interface StartOptions {
  service: "web" | "agent";
  env: TelemetryEnv;
  crash: CrashMode;
  log: Log;
  /** Test seam; production uses DEFAULT_LIMITS. */
  limits?: QueueLimits;
}

const drops = (signal: TelemetrySignal) => (count: number, reason: "queue_full" | "export_failed") =>
  countDropped(signal, reason, count);

/**
 * Sets up the OTel SDK once per process (spec §6.3). Without OTEL_EXPORTER_OTLP_ENDPOINT it
 * registers nothing. Propagation is off (spec §7.4). Any failure leaves telemetry off, never the
 * process down.
 */
export function startTelemetry(options: StartOptions): TelemetryHandle {
  installCrashHandlers(options.crash, options.log);
  const endpoint = options.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (getTelemetry().enabled || !endpoint) return getTelemetry();
  try {
    const base = endpoint.replace(/\/+$/, "");
    const limits = options.limits ?? DEFAULT_LIMITS;
    const resource = resourceFromAttributes({
      "service.name": options.service,
      "service.namespace": "mastertutor",
      "deployment.environment.name": options.env.MT_DEPLOYMENT,
    });
    setTelemetryLog(options.log);
    const tracer = new NodeTracerProvider({
      resource,
      spanProcessors: [
        new BoundedSpanProcessor(
          new AllowlistSpanExporter(
            new OTLPTraceExporter({ url: `${base}/v1/traces`, timeoutMillis: EXPORT_TIMEOUT_MS }),
            (count) => countDropped("traces", "not_allowed", count),
          ),
          limits,
          drops("traces"),
        ),
      ],
    });
    tracer.register({ propagator: new CompositePropagator({ propagators: [] }) });
    const meter = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new CountingMetricExporter(
            new OTLPMetricExporter({ url: `${base}/v1/metrics`, timeoutMillis: EXPORT_TIMEOUT_MS }),
            () => countDropped("metrics", "export_failed", 1),
          ),
          exportIntervalMillis: 30_000,
          exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meter);
    const logger = new LoggerProvider({
      resource,
      processors: [
        new BoundedLogProcessor(
          new OTLPLogExporter({ url: `${base}/v1/logs`, timeoutMillis: EXPORT_TIMEOUT_MS }),
          limits,
          drops("logs"),
        ),
      ],
    });
    logs.setGlobalLoggerProvider(logger);
    resetInstruments();
    const unregister = registerInstrumentations({
      tracerProvider: tracer,
      meterProvider: meter,
      instrumentations: [
        // Outgoing only (the AWS SDK's S3 calls); Next.js makes web's server spans.
        new HttpInstrumentation({
          ignoreIncomingRequestHook: () => true,
          requireParentforOutgoingSpans: true,
        }),
        // fetch: OpenAI, docling, pdf-worker, audio-capture, n.eko admin, Web Push.
        new UndiciInstrumentation({ requireParentforSpans: true }),
      ],
    });
    enableLogBridge();
    setTelemetry({
      enabled: true,
      flush: (ms = 2_000) =>
        within(Promise.all([tracer.forceFlush(), meter.forceFlush(), logger.forceFlush()]), ms),
      shutdown: async (ms = 3_000) => {
        disableLogBridge();
        unregister();
        await within(Promise.all([tracer.shutdown(), meter.shutdown(), logger.shutdown()]), ms);
        metrics.disable();
        logs.disable();
        resetInstruments();
        setTelemetryLog(null);
        setTelemetry(NOOP_HANDLE);
      },
    });
  } catch (error) {
    options.log.warn(
      {
        module: "telemetry",
        errorCode: "telemetry_start_failed",
        err: error instanceof Error ? error.name : "unknown",
      },
      "telemetry disabled",
    );
  }
  return getTelemetry();
}
```

`packages/telemetry/src/register-agent.ts`:

```ts
/**
 * The agent's preload (spec §6.3): node --import ./packages/telemetry/src/register-agent.ts
 * apps/agent/src/main.ts. Instrumentations must be registered before the AWS SDK first loads
 * node:http, which happens while main.ts's imports are evaluated.
 */
import { LogLevel, TelemetryEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { startTelemetry } from "./start.ts";

startTelemetry({
  service: "agent",
  env: parseEnv(TelemetryEnv, process.env),
  crash: "exit",
  log: createLogger({ service: "agent", level: LogLevel.catch("info").parse(process.env.LOG_LEVEL) }),
});
```

Append to `packages/telemetry/src/index.ts`:

```ts
export { startTelemetry, type StartOptions } from "./start.ts";
export { getTelemetry, type TelemetryHandle } from "./handle.ts";
export { installCrashHandlers, type CrashMode } from "./crash.ts";
```

- [ ] **Step 4: Run the tests**

Run: `scripts/remote-test.sh unit packages/telemetry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src
git commit -m "feat(telemetry): start the SDK once, no propagation, crash and shutdown flush (D50)" -- packages/telemetry/src
```

---

### Task A4: `instrument()`, recorders, test harness and micro-budget

**Files:**
- Create: `packages/telemetry/src/instrument.ts`, `src/record.ts`, `src/testing.ts`, `src/overhead.int.test.ts`
- Modify: `packages/telemetry/src/index.ts`, `apps/web/package.json`, `apps/web/next.config.ts` (`transpilePackages`)
- Test: `packages/telemetry/src/instrument.test.ts`, `src/record.test.ts`, `src/instrument.bench.test.ts`

**Interfaces:**
- Consumes: A1 (`withRunId`), A2 (`instruments`, `resetInstruments`, `AllowlistSpanExporter`, processors), A3 (`startTelemetry`), Task 0 (names, `ERROR_CODE_PATTERN`, `ToolAttributes`), contracts (`RunEvent`, `POLICY_DECIDER`, `BYPASS_DECIDER`, `TERMINAL_RUN_STATUSES`, `SLOT_STATES`, `SlotState`, `AlertRule`).
- Produces:
  - `instrument<T>(name: SpanName, attributes: ProductAttributes, work: (span: ProductSpan) => Promise<T>, options?: { expected?(error: unknown): string | null }): Promise<T>`;
  - `ProductSpan { set(attributes: ProductAttributes): void; fail(code: string): void }`;
  - `errorCodeOf(error: unknown): string`, `normalizeCode(code: string): string`;
  - `recordRunEvent(event: RunEvent): void`, `recordRunFailure(code: string): void`, `recordSpend(usd: number): void`;
  - `recordModelTokens(model: string, tokens: { input: number; cached: number; output: number }): void`;
  - `recordSseConnection(delta: 1 | -1): void`, `recordAlertReceived(rule: AlertRule): void`, `recordPush(outcome: PushOutcome): void`;
  - `deciderOf(decidedBy: string): ApprovalDecider`;
  - `observeAgentGauges(source: { slotStates(): Promise<readonly SlotState[]>; activeRuns(): number }): void`;
  - `@mastertutor/telemetry/testing`: `installTestTelemetry(): TestTelemetry` with `spans()`, `metric(name)`, `logs()`, `exported()` and `shutdown()`.

- [ ] **Step 1: Write the test harness `packages/telemetry/src/testing.ts`** (used by this task's tests and later tasks)

```ts
import { context, metrics, propagation, trace, type Attributes } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { CompositePropagator } from "@opentelemetry/core";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { disableLogBridge, enableLogBridge } from "@mastertutor/contracts/server";
import { AllowlistSpanExporter } from "./allowlist.ts";
import { resetInstruments } from "./instruments.ts";

export interface MetricPoint {
  value: number;
  attributes: Attributes;
}

export interface TestTelemetry {
  /** Finished spans as exported (after the allowlist). */
  spans(): ReadableSpan[];
  /** Cumulative points of one metric (a histogram's value is its sum). */
  metric(name: string): Promise<MetricPoint[]>;
  logs(): ReturnType<InMemoryLogRecordExporter["getFinishedLogRecords"]>;
  /** Everything exported, serialised: the canary tests search it. */
  exported(): Promise<string>;
  shutdown(): Promise<void>;
}

/** In-memory SDK for tests: same allowlist, no network, no propagation. */
export function installTestTelemetry(): TestTelemetry {
  const spanExporter = new InMemorySpanExporter();
  const tracer = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new AllowlistSpanExporter(spanExporter, () => undefined))],
  });
  tracer.register({ propagator: new CompositePropagator({ propagators: [] }) });
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 3_600_000,
  });
  const meter = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(meter);
  const logExporter = new InMemoryLogRecordExporter();
  const logger = new LoggerProvider({ processors: [new SimpleLogRecordProcessor(logExporter)] });
  logs.setGlobalLoggerProvider(logger);
  resetInstruments();
  enableLogBridge();

  const latest = async () => {
    await reader.forceFlush();
    return metricExporter.getMetrics().at(-1);
  };
  return {
    spans: () => spanExporter.getFinishedSpans(),
    async metric(name) {
      const points: MetricPoint[] = [];
      for (const scope of (await latest())?.scopeMetrics ?? [])
        for (const metric of scope.metrics)
          if (metric.descriptor.name === name)
            for (const point of metric.dataPoints)
              points.push({
                value:
                  typeof point.value === "number" ? point.value : (point.value as { sum: number }).sum,
                attributes: point.attributes,
              });
      return points;
    },
    logs: () => logExporter.getFinishedLogRecords(),
    async exported() {
      return JSON.stringify({
        spans: spanExporter.getFinishedSpans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
        metrics: (await latest()) ?? null,
        logs: logExporter
          .getFinishedLogRecords()
          .map((record) => ({ body: record.body, attributes: record.attributes })),
      });
    },
    async shutdown() {
      disableLogBridge();
      await Promise.all([tracer.shutdown(), meter.shutdown(), logger.shutdown()]);
      trace.disable();
      metrics.disable();
      logs.disable();
      context.disable();
      propagation.disable();
      resetInstruments();
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/telemetry/src/instrument.test.ts`:

```ts
import { SpanStatusCode } from "@opentelemetry/api";
import { createLogger } from "@mastertutor/contracts/server";
import { SPAN } from "@mastertutor/contracts/telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorCodeOf, instrument } from "./instrument.ts";
import { installTestTelemetry, type TestTelemetry } from "./testing.ts";

class ModelUnavailable extends Error {
  readonly code = "model_request_rejected";
  constructor() {
    super("The model rejected: the page said hunter2-canary");
    this.name = "ModelUnavailable";
  }
}
class Interrupted extends Error {
  constructor(readonly why: string) {
    super(`Run interrupted: ${why}`);
    this.name = "Interrupted";
  }
}
const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";

let telemetry: TestTelemetry;
beforeEach(() => {
  telemetry = installTestTelemetry();
});
afterEach(async () => {
  await telemetry.shutdown();
});

describe("instrument (spec §7)", () => {
  it("records the span with its product attributes", async () => {
    const result = await instrument(SPAN.tool, { "mt.tool.name": "capture" }, async (span) => {
      span.set({ "mt.tool.outcome": "ok", "mt.capture.fidelity": "verified" });
      return 42;
    });
    expect(result).toBe(42);
    const [span] = telemetry.spans();
    expect(span!.name).toBe("mt.tool");
    expect(span!.attributes).toEqual({
      "mt.tool.name": "capture",
      "mt.tool.outcome": "ok",
      "mt.capture.fidelity": "verified",
    });
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("records an error by its product code only: never its message or stack", async () => {
    await expect(
      instrument(SPAN.modelRequest, {}, async () => {
        throw new ModelUnavailable();
      }),
    ).rejects.toThrow(ModelUnavailable);
    const [span] = telemetry.spans();
    expect(span!.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "model_request_rejected",
    });
    expect(span!.attributes["mt.error.code"]).toBe("model_request_rejected");
    expect(span!.events.map((e) => [e.name, e.attributes])).toEqual([
      ["exception", { "exception.type": "ModelUnavailable" }],
    ]);
    expect(await telemetry.exported()).not.toContain("hunter2-canary");
  });

  it("marks an interruption as such, not as an error", async () => {
    await expect(
      instrument(SPAN.step, { "mt.step.phase": "act" }, async () => {
        throw new Interrupted("takeover");
      }, { expected: (e) => (e instanceof Interrupted ? e.why : null) }),
    ).rejects.toThrow(Interrupted);
    const [span] = telemetry.spans();
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);
    expect(span!.attributes["mt.interruption"]).toBe("takeover");
    expect(span!.attributes).not.toHaveProperty("mt.error.code");
  });

  it("fail() records a normalised code without throwing", async () => {
    await instrument(SPAN.slotReset, {}, async (span) => span.fail("Not A Code!"));
    expect(telemetry.spans()[0]!.attributes["mt.error.code"]).toBe("unknown_error");
  });

  it("concurrent runs keep their own run_id on log lines (Review Focus 5)", async () => {
    const lines: string[] = [];
    const log = createLogger({
      service: "t",
      destination: { write: (line: string) => void lines.push(line) },
    });
    await Promise.all(
      [RUN_A, RUN_B].map((runId) =>
        instrument(SPAN.step, { "mt.run.id": runId }, async () => {
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setImmediate(resolve));
            log.info({ expected: runId }, "tick");
          }
        }),
      ),
    );
    expect(lines).toHaveLength(40);
    for (const line of lines.map((l) => JSON.parse(l) as { run_id: string; expected: string }))
      expect(line.run_id).toBe(line.expected);
  });

  it("truncates long strings and caps arrays", async () => {
    await instrument(
      SPAN.tool,
      { "mt.vault.alias": "a".repeat(500), "mt.action.types": Array(40).fill("click") },
      async () => undefined,
    );
    const [span] = telemetry.spans();
    expect((span!.attributes["mt.vault.alias"] as string).length).toBe(256);
    expect((span!.attributes["mt.action.types"] as string[]).length).toBe(16);
  });
});

describe("errorCodeOf", () => {
  it("prefers a valid code, then a snake-cased name, never a message", () => {
    expect(errorCodeOf(new ModelUnavailable())).toBe("model_request_rejected");
    expect(errorCodeOf(Object.assign(new Error("x"), { name: "ContextOverflow" }))).toBe(
      "context_overflow",
    );
    expect(errorCodeOf(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("error");
    expect(errorCodeOf("a string")).toBe("unknown_error");
    expect(errorCodeOf(null)).toBe("unknown_error");
  });
});

describe("without an SDK", () => {
  it("still runs the work", async () => {
    await telemetry.shutdown();
    expect(await instrument(SPAN.tool, {}, async () => "ran")).toBe("ran");
    telemetry = installTestTelemetry();
  });
});
```

`packages/telemetry/src/record.test.ts`:

```ts
import { BYPASS_DECIDER, POLICY_DECIDER } from "@mastertutor/contracts";
import { METRIC } from "@mastertutor/contracts/telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deciderOf, recordModelTokens, recordRunEvent, recordRunFailure, recordSpend } from "./record.ts";
import { installTestTelemetry, type TestTelemetry } from "./testing.ts";

const ID = "11111111-1111-4111-8111-111111111111";
let telemetry: TestTelemetry;
beforeEach(() => {
  telemetry = installTestTelemetry();
});
afterEach(async () => {
  await telemetry.shutdown();
});

describe("run event recorders (spec §5.3, seam 6)", () => {
  it("counts terminal statuses only", async () => {
    recordRunEvent({ type: "status", status: "running", waitReason: null, reason: null });
    recordRunEvent({ type: "status", status: "failed", waitReason: null, reason: "x" });
    expect(await telemetry.metric(METRIC.runsEnded.name)).toEqual([
      { value: 1, attributes: { "mt.run.status": "failed" } },
    ]);
  });

  it("maps deciders to person, policy or bypass, never a user id", async () => {
    expect(deciderOf(POLICY_DECIDER)).toBe("policy");
    expect(deciderOf(BYPASS_DECIDER)).toBe("bypass");
    recordRunEvent({
      type: "approval_resolved",
      approvalId: ID,
      status: "approved",
      decidedBy: "user_canary_7f3a",
    });
    const points = await telemetry.metric(METRIC.approvalsResolved.name);
    expect(points[0]!.attributes).toEqual({
      "mt.approval.status": "approved",
      "mt.approval.decider": "person",
    });
    expect(await telemetry.exported()).not.toContain("user_canary_7f3a");
  });

  it("records the approval kind and never the request's text", async () => {
    recordRunEvent({
      type: "approval_requested",
      approvalId: ID,
      request: { kind: "risky_click", label: "Delete account canary-label" } as never,
    });
    expect((await telemetry.metric(METRIC.approvalsRequested.name))[0]!.attributes).toEqual({
      "mt.approval.kind": "risky_click",
    });
    expect(await telemetry.exported()).not.toContain("canary-label");
  });

  it("ignores user messages entirely", async () => {
    recordRunEvent({ type: "user_message", text: "my secret canary note" });
    expect(await telemetry.exported()).not.toContain("canary note");
  });

  it("records downloads by state and size, and error codes normalised", async () => {
    recordRunEvent({ type: "download_ready", downloadId: ID, assetId: ID, filename: "f.pdf", bytes: 2048 });
    recordRunEvent({ type: "error", code: "Weird Code", message: "page text canary" });
    expect((await telemetry.metric(METRIC.downloadSize.name))[0]!.value).toBe(2048);
    expect((await telemetry.metric(METRIC.runErrors.name))[0]!.attributes).toEqual({
      "mt.error.code": "unknown_error",
    });
    const exported = await telemetry.exported();
    expect(exported).not.toContain("f.pdf");
    expect(exported).not.toContain("page text canary");
  });

  it("records spend, tokens and failures", async () => {
    recordSpend(0.25);
    recordSpend(0);
    recordModelTokens("gpt-6-astra", { input: 100, cached: 40, output: 10 });
    recordRunFailure("model_request_rejected");
    expect((await telemetry.metric(METRIC.spendUsd.name))[0]!.value).toBeCloseTo(0.25);
    expect(await telemetry.metric(METRIC.modelTokens.name)).toHaveLength(3);
    expect((await telemetry.metric(METRIC.runFailures.name))[0]!.attributes).toEqual({
      "mt.error.code": "model_request_rejected",
    });
  });
});
```

`packages/telemetry/src/instrument.bench.test.ts`:

```ts
import { SPAN } from "@mastertutor/contracts/telemetry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instrument } from "./instrument.ts";
import { installTestTelemetry, type TestTelemetry } from "./testing.ts";

const p50 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
let telemetry: TestTelemetry;
beforeAll(() => {
  telemetry = installTestTelemetry();
});
afterAll(async () => {
  await telemetry.shutdown();
});

describe("instrument() micro budget (spec §15)", () => {
  it("adds under 50 µs at p50 per span", async () => {
    const work = async () => 1;
    const bare: number[] = [];
    const wrapped: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      let t = performance.now();
      await work();
      bare.push(performance.now() - t);
      t = performance.now();
      await instrument(SPAN.tool, { "mt.tool.name": "read_page" }, work);
      wrapped.push(performance.now() - t);
    }
    expect(p50(wrapped) - p50(bare)).toBeLessThan(0.05);
  });
});
```

`packages/telemetry/src/overhead.int.test.ts`:

```ts
import { createLogger } from "@mastertutor/contracts/server";
import { SPAN } from "@mastertutor/contracts/telemetry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTelemetry, startTelemetry } from "./start.ts";
import { instrument } from "./instrument.ts";
import { recordModelTokens, recordRunEvent, recordSpend } from "./record.ts";

const quantile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * q)]!;
const RUN = "11111111-1111-4111-8111-111111111111";
const log = createLogger({ service: "agent", destination: { write: () => undefined } });

beforeAll(() => {
  // The collector is down (closed port): the worst case for the export path.
  startTelemetry({
    service: "agent",
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9", MT_DEPLOYMENT: "test" },
    crash: "observe",
    log,
  });
});
afterAll(async () => {
  await getTelemetry().shutdown();
});

/** Exactly what one agent step adds (spec §15): four spans, three run events, records, two log lines. */
async function stepEnvelope(): Promise<void> {
  await instrument(SPAN.step, { "mt.run.id": RUN, "mt.step.phase": "act" }, async (step) => {
    await instrument(SPAN.modelRequest, { "mt.model.name": "gpt-6-astra" }, async (span) => {
      span.set({ "mt.model.tokens.input": 1_000, "mt.model.cost_usd": 0.01 });
      recordModelTokens("gpt-6-astra", { input: 1_000, cached: 200, output: 50 });
    });
    await instrument(SPAN.tool, { "mt.tool.name": "computer" }, async (span) => {
      span.set({ "mt.tool.outcome": "ok", "mt.action.types": ["click"] });
    });
    await instrument(SPAN.stepCommit, { "mt.run.id": RUN }, async () => {
      recordRunEvent({ type: "step", seq: 1, phase: "act", state: "done", caption: null, url: null, screenshotKey: null, action: null });
      recordRunEvent({ type: "status", status: "running", waitReason: null, reason: null });
      recordRunEvent({ type: "control", holder: "agent" });
      recordSpend(0.01);
    });
    log.info({ seq: 1 }, "act done");
    log.debug({ seq: 1 }, "detail");
    step.set({ "mt.step.outcome": "continue" });
  });
}

describe("per-step telemetry overhead with the collector down (spec §15)", () => {
  it("stays under 2 ms at p50 and 5 ms at p99", async () => {
    for (let i = 0; i < 200; i++) await stepEnvelope();
    const samples: number[] = [];
    for (let i = 0; i < 2_000; i++) {
      const t = performance.now();
      await stepEnvelope();
      samples.push(performance.now() - t);
    }
    expect(quantile(samples, 0.5)).toBeLessThan(2);
    expect(quantile(samples, 0.99)).toBeLessThan(5);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/telemetry`
Expected: FAIL. `./instrument.ts` and `./record.ts` are not found.

- [ ] **Step 4: Write `packages/telemetry/src/instrument.ts`**

```ts
import { context, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { withRunId } from "@mastertutor/contracts/server";
import {
  ATTR,
  ERROR_CODE_PATTERN,
  TRACER_NAME,
  type ProductAttributes,
  type SpanName,
} from "@mastertutor/contracts/telemetry";

const MAX_STRING = 256;
const MAX_ITEMS = 16;
const MAX_ITEM = 64;

export interface ProductSpan {
  set(attributes: ProductAttributes): void;
  /** Marks the span failed with a product code (never a message) without throwing. */
  fail(code: string): void;
}

export interface InstrumentOptions {
  /** An interruption that is not a failure (takeover, kill, …): returns its cause, else null. */
  expected?(error: unknown): string | null;
}

export function normalizeCode(code: string): string {
  return ERROR_CODE_PATTERN.test(code) ? code : "unknown_error";
}

/** A product error code for any thrown value: `code` if valid, else the snake-cased name. */
export function errorCodeOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown_error";
  const { code, name } = error as { code?: unknown; name?: unknown };
  if (typeof code === "string" && ERROR_CODE_PATTERN.test(code)) return code;
  if (typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,62}$/.test(name))
    return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return "unknown_error";
}

const typeOf = (error: unknown) =>
  error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "unknown";

function clean(attributes: ProductAttributes): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (Array.isArray(value))
      out[key] = value.slice(0, MAX_ITEMS).map((item) => String(item).slice(0, MAX_ITEM));
    else out[key] = value as number | boolean;
  }
  return out;
}

function productSpan(span: Span): ProductSpan {
  return {
    set: (attributes) => {
      try {
        span.setAttributes(clean(attributes));
      } catch {
        // Telemetry never breaks the work it describes.
      }
    },
    fail: (code) => {
      const normalized = normalizeCode(code);
      span.setAttribute(ATTR.errorCode, normalized);
      span.setStatus({ code: SpanStatusCode.ERROR, message: normalized });
    },
  };
}

const NOOP_SPAN: ProductSpan = { set: () => undefined, fail: () => undefined };

/**
 * Runs `work` inside a product span (spec §7). Errors are recorded by product code only, as status
 * ERROR plus an `exception` event naming the type; recordException is never used (a message can
 * quote page text). A run id also goes on the log context, so every line inside carries run_id.
 * If the span cannot start, the work runs without one.
 */
export async function instrument<T>(
  name: SpanName,
  attributes: ProductAttributes,
  work: (span: ProductSpan) => Promise<T>,
  options: InstrumentOptions = {},
): Promise<T> {
  let started = false;
  try {
    const runId = attributes[ATTR.runId];
    const parent = runId ? withRunId(context.active(), runId) : context.active();
    return await trace
      .getTracer(TRACER_NAME)
      .startActiveSpan(name, { attributes: clean(attributes) }, parent, async (span) => {
        started = true;
        try {
          return await work(productSpan(span));
        } catch (error) {
          const expected = options.expected?.(error) ?? null;
          if (expected) span.setAttribute(ATTR.interruption, expected.slice(0, MAX_ITEM));
          else {
            productSpan(span).fail(errorCodeOf(error));
            span.addEvent("exception", { "exception.type": typeOf(error) });
          }
          throw error;
        } finally {
          span.end();
        }
      });
  } catch (error) {
    if (started) throw error;
    return work(NOOP_SPAN);
  }
}
```

- [ ] **Step 5: Write `packages/telemetry/src/record.ts`**

```ts
import { metrics } from "@opentelemetry/api";
import {
  BYPASS_DECIDER,
  POLICY_DECIDER,
  SLOT_STATES,
  TERMINAL_RUN_STATUSES,
  type AlertRule,
  type RunEvent,
  type SlotState,
} from "@mastertutor/contracts";
import {
  ATTR,
  METER_NAME,
  METRIC,
  type ApprovalDecider,
  type PushOutcome,
} from "@mastertutor/contracts/telemetry";
import { normalizeCode } from "./instrument.ts";
import { instruments } from "./instruments.ts";

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

/** Who decided an approval, as a class (spec §5.2): a user id never becomes telemetry. */
export function deciderOf(decidedBy: string): ApprovalDecider {
  if (decidedBy === POLICY_DECIDER) return "policy";
  if (decidedBy === BYPASS_DECIDER) return "bypass";
  return "person";
}

function safely(record: () => void): void {
  try {
    record();
  } catch {
    // Telemetry never breaks the write it describes (spec §7.1).
  }
}

/** Seam 6: every RunEvent written by emitRunEvent (agent and web). Text fields are never read. */
export function recordRunEvent(event: RunEvent): void {
  safely(() => {
    const m = instruments();
    switch (event.type) {
      case "status":
        if (TERMINAL.has(event.status)) m.runsEnded.add(1, { [ATTR.runStatus]: event.status });
        return;
      case "error":
        m.runErrors.add(1, { [ATTR.errorCode]: normalizeCode(event.code) });
        return;
      case "approval_requested":
        m.approvalsRequested.add(1, { [ATTR.approvalKind]: event.request.kind });
        return;
      case "approval_resolved":
        m.approvalsResolved.add(1, {
          [ATTR.approvalStatus]: event.status,
          [ATTR.approvalDecider]: deciderOf(event.decidedBy),
        });
        return;
      case "control":
        m.controlChanges.add(1, { [ATTR.controlHolder]: event.holder });
        return;
      case "slot":
        m.slotLeases.add(1, { [ATTR.slotOutcome]: event.slotName === null ? "released" : "leased" });
        return;
      case "block_added":
        m.blocksAdded.add(1, { [ATTR.blockType]: event.blockType, [ATTR.blockOrigin]: event.origin });
        return;
      case "download_pending":
      case "download_ready": {
        const state = event.type === "download_ready" ? "ready" : "pending";
        m.downloads.add(1, { [ATTR.downloadState]: state });
        m.downloadSize.record(event.bytes, { [ATTR.downloadState]: state });
        return;
      }
      case "budget":
        m.budgetHits.add(1);
        return;
      case "model_fallback":
        m.modelFallbacks.add(1, { [ATTR.modelName]: event.to.slice(0, 64) });
        return;
      case "filed":
        m.notesFiled.add(1, { [ATTR.filedBy]: event.filedBy });
        return;
      default:
        return;
    }
  });
}

export function recordRunFailure(code: string): void {
  safely(() => instruments().runFailures.add(1, { [ATTR.errorCode]: normalizeCode(code) }));
}

export function recordSpend(usd: number): void {
  if (!(usd > 0)) return;
  safely(() => instruments().spendUsd.add(usd));
}

export function recordModelTokens(
  model: string,
  tokens: { input: number; cached: number; output: number },
): void {
  safely(() => {
    const counter = instruments().modelTokens;
    const name = model.slice(0, 64);
    counter.add(tokens.input, { [ATTR.modelName]: name, [ATTR.tokenType]: "input" });
    counter.add(tokens.cached, { [ATTR.modelName]: name, [ATTR.tokenType]: "cached" });
    counter.add(tokens.output, { [ATTR.modelName]: name, [ATTR.tokenType]: "output" });
  });
}

export function recordSseConnection(delta: 1 | -1): void {
  safely(() => instruments().sseConnections.add(delta));
}

export function recordAlertReceived(rule: AlertRule): void {
  safely(() => instruments().alertsReceived.add(1, { [ATTR.alertRule]: rule }));
}

export function recordPush(outcome: PushOutcome): void {
  safely(() => instruments().pushSends.add(1, { [ATTR.pushOutcome]: outcome }));
}

/** Agent gauges (spec §5.3): read on each export (30 s), from the same sources as /healthz. */
export function observeAgentGauges(source: {
  slotStates(): Promise<readonly SlotState[]>;
  activeRuns(): number;
}): void {
  safely(() => {
    const meter = metrics.getMeter(METER_NAME);
    const slots = meter.createObservableGauge(METRIC.slots.name, {
      unit: METRIC.slots.unit,
      description: METRIC.slots.description,
    });
    const active = meter.createObservableGauge(METRIC.activeRuns.name, {
      unit: METRIC.activeRuns.unit,
      description: METRIC.activeRuns.description,
    });
    meter.addBatchObservableCallback(
      async (result) => {
        try {
          result.observe(active, source.activeRuns());
          const counts = new Map<SlotState, number>(SLOT_STATES.map((state) => [state, 0]));
          for (const state of await source.slotStates())
            counts.set(state, (counts.get(state) ?? 0) + 1);
          for (const [state, count] of counts)
            result.observe(slots, count, { [ATTR.slotState]: state });
        } catch {
          // A failed read skips this export's gauges.
        }
      },
      [slots, active],
    );
  });
}
```

Append to `packages/telemetry/src/index.ts`:

```ts
export {
  instrument,
  errorCodeOf,
  normalizeCode,
  type ProductSpan,
  type InstrumentOptions,
} from "./instrument.ts";
export {
  deciderOf,
  observeAgentGauges,
  recordAlertReceived,
  recordModelTokens,
  recordPush,
  recordRunEvent,
  recordRunFailure,
  recordSpend,
  recordSseConnection,
} from "./record.ts";
```

- [ ] **Step 6: Give web the dependency** (it is used by Track C from Task C4 on, and by A7)

In `apps/web/package.json` `dependencies`, add `"@mastertutor/telemetry": "workspace:*"`. In `apps/web/next.config.ts`, add `"@mastertutor/telemetry"` to `transpilePackages`. Run `pnpm install`.

- [ ] **Step 7: Run the tests**

Run: `scripts/remote-test.sh unit packages/telemetry`, then `scripts/remote-test.sh integration packages/telemetry/src/overhead.int.test.ts`.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/telemetry/src
git commit -m "feat(telemetry): instrument(), run-event recorders, test harness and overhead budget (D50)" -- packages/telemetry/src apps/web/package.json apps/web/next.config.ts pnpm-lock.yaml
```

---

### Task A5: Agent seams: step phases, model calls, tools

**Files:**
- Modify: `apps/agent/package.json`, `apps/agent/src/loop/run-loop.ts` (`step()`, `#execute`), `apps/agent/src/llm/caller.ts` (`ModelCaller.call`), `apps/agent/src/tools/registry.ts` (`ToolRegistry.run`), `apps/agent/src/tools/types.ts` (`Tool`, `RegisteredTool`, `register`), `apps/agent/src/capture/capture-tool.ts` (`createCaptureTool`), `apps/agent/src/vault/tools.ts` (`vaultTools`)
- Test: `apps/agent/src/tools/registry.test.ts` (append), `apps/agent/src/llm/llm.test.ts` (append)

**Interfaces:**
- Consumes: A4 (`instrument`, `recordModelTokens`, `installTestTelemetry`), Task 0 (`SPAN`, `ATTR`, `ToolAttributes`), `interruptionOf` (`apps/agent/src/runtime/errors.ts`), `costUsd` (`apps/agent/src/llm/pricing.ts`).
- Produces:
  - `Tool<A, R>.telemetry?(args: A, result: R): ToolAttributes`;
  - `RegisteredTool.telemetry?(rawArgs: unknown, result: unknown): ToolAttributes`;
  - the spans `mt.step`, `mt.model.request` and `mt.tool` with the attributes in spec §7.3 (seams 1–4).

  No public signature changes.

- [ ] **Step 1: Add the dependency**

In `apps/agent/package.json` `dependencies`, add `"@mastertutor/telemetry": "workspace:*"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

Append to `apps/agent/src/tools/registry.test.ts`. It reuses that file's `ctx()`, `fakeReadPage`, `log` and `readArgs`:

```ts
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { afterEach, beforeEach } from "vitest";

describe("ToolRegistry telemetry (seam 3)", () => {
  let telemetry: TestTelemetry;
  beforeEach(() => {
    telemetry = installTestTelemetry();
  });
  afterEach(async () => {
    await telemetry.shutdown();
  });

  it("records one mt.tool span per call with its outcome", async () => {
    const registry = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new ToolError("selector_not_found", "No element matches canary-selector");
        }),
      ],
      log,
    );
    await registry.run("read_page", readArgs, ctx());
    await registry.run("capture", {}, ctx());
    const spans = telemetry.spans().filter((s) => s.name === "mt.tool");
    expect(spans.map((s) => [s.attributes["mt.tool.name"], s.attributes["mt.tool.outcome"], s.attributes["mt.error.code"]])).toEqual([
      ["read_page", "tool_error", "selector_not_found"],
      ["capture", "unavailable", undefined],
    ]);
    expect(spans[0]!.attributes["mt.run.id"]).toBe(ctx().runId);
    expect(await telemetry.exported()).not.toContain("canary-selector");
  });

  it("adds only the attributes a tool declares, from its typed result", async () => {
    const vault = register({
      name: "fill_credential",
      args: FillCredentialArgs,
      result: FillCredentialResult,
      untrusted: false,
      run: async () => ({ error: "origin_mismatch" }) as FillCredentialResult,
      telemetry: (args, result) => ({
        "mt.vault.alias": args.alias,
        ...("error" in result ? { "mt.error.code": result.error } : {}),
      }),
    });
    const registry = new ToolRegistry([vault], log);
    await registry.run(
      "fill_credential",
      { alias: "zybooks", field: "password", target: { ref: "e1" } },
      ctx(),
    );
    const [span] = telemetry.spans();
    expect(span!.attributes).toMatchObject({
      "mt.tool.name": "fill_credential",
      "mt.vault.alias": "zybooks",
      "mt.tool.outcome": "tool_error",
      "mt.error.code": "origin_mismatch",
    });
  });

  it("an interruption is not a tool failure", async () => {
    const registry = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new Interrupted("takeover");
        }),
      ],
      log,
    );
    await expect(registry.run("read_page", readArgs, ctx())).rejects.toThrow(Interrupted);
    expect(telemetry.spans()[0]!.attributes["mt.interruption"]).toBe("takeover");
    expect(telemetry.spans()[0]!.status.code).toBe(0);
  });
});
```

If the `fill_credential` `target` shape in `FillCredentialArgs` (`packages/contracts/src/tools.ts`, `CredentialTarget`) differs from `{ ref: "e1" }`, use any value that parses; the test only checks the span.

Append to `apps/agent/src/llm/llm.test.ts`:

```ts
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";

describe("ModelCaller telemetry (seam 4)", () => {
  let telemetry: TestTelemetry;
  beforeEach(() => {
    telemetry = installTestTelemetry();
  });
  afterEach(async () => {
    await telemetry.shutdown();
  });
  const request = {
    model: MODELS.agentPrimary,
    instructions: "i",
    input: [],
    format: "agent_turn" as const,
    toolProfile: "browser_use" as const,
  };

  it("records model, attempts, tokens and cost", async () => {
    let calls = 0;
    const caller = new ModelCaller(
      {
        create: async () => {
          calls += 1;
          if (calls === 1) throw new APIError(429, undefined, "slow down", new Headers());
          return {
            id: "r",
            model: MODELS.agentPrimary,
            output: [],
            usage: { input: 1_000, cached: 200, cacheWrite: 0, output: 50 },
          };
        },
      },
      { clock: instantClock(), fallbackAfter5xx: 3 },
    );
    await caller.call(request, new AbortController().signal);
    const [span] = telemetry.spans().filter((s) => s.name === "mt.model.request");
    expect(span!.attributes).toMatchObject({
      "mt.model.name": MODELS.agentPrimary,
      "mt.model.fallback": false,
      "mt.model.attempts": 2,
      "mt.model.tokens.input": 1_000,
      "mt.model.tokens.cached": 200,
      "mt.model.tokens.output": 50,
    });
    expect(span!.attributes["mt.model.cost_usd"]).toBeGreaterThan(0);
    expect(await telemetry.metric("mt.model.tokens")).toHaveLength(3);
  });

  it("records a rejection by its code, never the API's message", async () => {
    const caller = new ModelCaller(
      {
        create: async () => {
          throw new APIError(400, undefined, "bad request quoting page-canary", new Headers());
        },
      },
      { clock: instantClock(), fallbackAfter5xx: 3 },
    );
    await expect(caller.call(request, new AbortController().signal)).rejects.toMatchObject({
      code: "model_request_rejected",
    });
    const [span] = telemetry.spans();
    expect(span!.attributes["mt.error.code"]).toBe("model_request_rejected");
    expect(await telemetry.exported()).not.toContain("page-canary");
  });
});
```

`llm.test.ts` already imports `ModelCaller`, `APIError`, `MODELS` and `instantClock` (it tests `model_request_rejected`). Add only the imports it lacks: `beforeEach` and `afterEach` from vitest. If the `APIError` constructor takes its arguments in a different order in openai 7.28, copy the construction the existing `model_request_rejected` test in that file uses.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit apps/agent/src/tools/registry.test.ts apps/agent/src/llm/llm.test.ts`
Expected: FAIL. No `mt.tool` or `mt.model.request` span is recorded, and `telemetry` is not a `Tool` property.

- [ ] **Step 4: Add `telemetry` to tools (`apps/agent/src/tools/types.ts`)**

Add `import type { ToolAttributes } from "@mastertutor/contracts/telemetry";`. In `interface Tool<A, R>`, add:

```ts
  /** Allowlisted span attributes for this call (spec §7.5): never page text, values or arguments verbatim. */
  telemetry?(args: A, result: R): ToolAttributes;
```

In `interface RegisteredTool`, add:

```ts
  telemetry?(rawArgs: unknown, result: unknown): ToolAttributes;
```

In `register()`, add a property to the returned object:

```ts
    telemetry: tool.telemetry
      ? (rawArgs, result) => {
          const args = tool.args.safeParse(rawArgs);
          const parsed = tool.result.safeParse(result);
          return args.success && parsed.success ? tool.telemetry!(args.data, parsed.data) : {};
        }
      : undefined,
```

- [ ] **Step 5: Wrap `ToolRegistry.run` (`apps/agent/src/tools/registry.ts`)**

Add these imports:

```ts
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { instrument, type ProductSpan } from "@mastertutor/telemetry/instrument";
```

Rename the existing `async run(name, args, ctx)` method to `async #invoke(name, args, ctx, span: ProductSpan)` and add the new public `run`:

```ts
  /** Seam 3 (spec §7.3): one mt.tool span per function call. */
  run(
    name: FunctionToolName,
    args: unknown,
    ctx: Omit<ToolContext, "requestWait" | "requestHandOver">,
  ): Promise<ToolRun> {
    return instrument(
      SPAN.tool,
      { [ATTR.runId]: ctx.runId, [ATTR.toolName]: name },
      (span) => this.#invoke(name, args, ctx, span),
      { expected: interruptionOf },
    );
  }
```

Inside `#invoke`, set the outcome on each return path. Behaviour is otherwise unchanged.

- Missing tool: before `return { output: JSON.stringify({ error: "tool_unavailable" }) … }`, add `span.set({ [ATTR.toolOutcome]: "unavailable" });`.
- Success: replace the `try` block's first statement with the version below, which keeps the raw result for `telemetry`. Then, before `return { output, notesChanged … }`, add the attribute block:

  ```ts
      const raw = await tool.invoke({ ...ctx, requestWait, requestHandOver }, args);
      // M13: a page can reflect a vault secret into its text; no tool result carries it out.
      const result = redactDeep(raw, this.#mask);
  ```

  ```ts
      const declared = tool.telemetry?.(args, raw) ?? {};
      span.set({ ...declared, [ATTR.toolOutcome]: declared[ATTR.errorCode] ? "tool_error" : "ok" });
      if (declared[ATTR.errorCode]) span.fail(declared[ATTR.errorCode]);
  ```

- `ToolError` branch: first add `span.set({ [ATTR.toolOutcome]: "tool_error" }); span.fail(error.code);`.
- `StaleRef` branch: first add `span.set({ [ATTR.toolOutcome]: "stale_ref" }); span.fail("stale_ref");`.
- Generic failure branch: first add `span.set({ [ATTR.toolOutcome]: "failed" }); span.fail("tool_failed");`.

- [ ] **Step 6: Declare tool attributes**

In `apps/agent/src/capture/capture-tool.ts` `createCaptureTool`, add this property to the returned tool (next to `untrusted`):

```ts
    telemetry: (_args, result) => ({
      [ATTR.captureFidelity]: result.fidelity,
      [ATTR.captureCoverage]: result.coverage,
    }),
```

Add `import { ATTR } from "@mastertutor/contracts/telemetry";`. `CaptureResult` carries `fidelity` and `coverage`, as `persistCapture` returns them. If `tsc` says otherwise, use the field names `CaptureResult` declares in `packages/contracts/src/tools.ts`.

In `apps/agent/src/vault/tools.ts` `vaultTools`, add this to both tool objects:

```ts
      telemetry: (args, result) => ({
        [ATTR.vaultAlias]: args.alias,
        ...("error" in result ? { [ATTR.errorCode]: result.error } : {}),
      }),
```

Add `import { ATTR } from "@mastertutor/contracts/telemetry";`.

- [ ] **Step 7: Wrap `ModelCaller.call` (`apps/agent/src/llm/caller.ts`)**

Add these imports:

```ts
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { instrument } from "@mastertutor/telemetry/instrument";
import { recordModelTokens } from "@mastertutor/telemetry/record";
import { interruptionOf } from "../runtime/errors.ts";
import { costUsd } from "./pricing.ts";
```

Rename the existing `async call(request, signal)` to `async #attempts(request: ModelRequest, signal: AbortSignal, onAttempt: (attempt: number) => void)`. As the first statement inside its `for` loop body, add `onAttempt(attempt);`. Then add the public method:

```ts
  /** Seam 4 (spec §7.3): one mt.model.request span covering every retry and the fallback. */
  call(request: ModelRequest, signal: AbortSignal): Promise<CallResult> {
    return instrument(
      SPAN.modelRequest,
      { [ATTR.modelName]: request.model },
      async (span) => {
        const result = await this.#attempts(request, signal, (attempt) =>
          span.set({ [ATTR.modelAttempts]: attempt }),
        );
        const tokens = result.reply.usage;
        span.set({
          [ATTR.modelName]: result.model,
          [ATTR.modelFallback]: result.fallback !== null,
          [ATTR.tokensInput]: tokens.input,
          [ATTR.tokensCached]: tokens.cached,
          [ATTR.tokensOutput]: tokens.output,
          [ATTR.costUsd]: costUsd(result.model, tokens),
        });
        recordModelTokens(result.model, tokens);
        return result;
      },
      { expected: interruptionOf },
    );
  }
```

`ModelUnavailable.code` and `ContextOverflow` (whose name becomes `context_overflow`) reach the span through `errorCodeOf`.

- [ ] **Step 8: Wrap `RunLoop.step` and computer calls (`apps/agent/src/loop/run-loop.ts`)**

Add these imports:

```ts
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { instrument } from "@mastertutor/telemetry/instrument";
```

`interruptionOf` is already imported from `../runtime/errors.ts`.

Replace `async step(signal)` with the code below. The existing `switch` moves unchanged into `#phase`:

```ts
  /** Seam 1 (spec §7.3): each phase is one mt.step span, the root of its trace (spec §7.2). */
  step(signal: AbortSignal): Promise<StepOutcome> {
    const phase = this.#next;
    return instrument(
      SPAN.step,
      { [ATTR.runId]: this.#run.id, [ATTR.stepPhase]: phase },
      async (span) => {
        const outcome = await this.#phase(phase, signal);
        span.set({ [ATTR.stepOutcome]: outcome.kind });
        if (outcome.kind === "failed") span.fail(outcome.error.code);
        return outcome;
      },
      { expected: interruptionOf },
    );
  }

  #phase(phase: Phase, signal: AbortSignal): Promise<StepOutcome> {
    switch (phase) {
      case "observe":
        return this.#observe(signal);
      case "decide":
        return this.#decide(signal);
      case "approve":
        return this.#approve(signal);
      case "act":
        return this.#act(signal);
    }
  }
```

Rename the existing `async #execute(call, signal, step)` to `async #perform(call, signal, step)` without changing its body, and add:

```ts
  /** Seam 2: computer calls get the same mt.tool span function tools get in the registry. */
  #execute(call: PendingCall, signal: AbortSignal, step: StepCollector): Promise<Executed> {
    if (call.kind !== "computer") return this.#perform(call, signal, step);
    return instrument(
      SPAN.tool,
      {
        [ATTR.runId]: this.#run.id,
        [ATTR.toolName]: "computer",
        [ATTR.actionTypes]: call.actions.map((action) => action.type),
      },
      async (span) => {
        const executed = await this.#perform(call, signal, step);
        span.set({ [ATTR.toolOutcome]: executed.ran ? "ok" : "refused" });
        return executed;
      },
      { expected: interruptionOf },
    );
  }
```

`run-loop.ts` is also edited by other agents. Find the methods by name (`async step(`, `async #execute(`), not by line number.

- [ ] **Step 9: Run the tests and typecheck**

Run: `scripts/remote-test.sh unit apps/agent`, `scripts/remote-test.sh integration apps/agent/src/loop/run-loop.int.test.ts`, then `pnpm typecheck`.
Expected: PASS. The existing loop tests are unaffected, because instrumentation is a no-op without an SDK.

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(agent): instrument step phases, model requests and tool calls (D50 seams 1-4)" -- apps/agent/package.json apps/agent/src/loop/run-loop.ts apps/agent/src/llm/caller.ts apps/agent/src/tools/registry.ts apps/agent/src/tools/types.ts apps/agent/src/capture/capture-tool.ts apps/agent/src/vault/tools.ts apps/agent/src/tools/registry.test.ts apps/agent/src/llm/llm.test.ts pnpm-lock.yaml
```

---

### Task A6: Agent seams: commits, run events, slot resets, takeovers, gauges and shutdown

**Files:**
- Modify: `packages/db/package.json`, `packages/db/src/queries/events.ts` (`emitRunEvent`)
- Modify: `apps/agent/src/loop/step-store.ts` (`StepStore.open`, `StepStore.commit`), `apps/agent/src/slots/pool.ts` (`#reset`), `apps/agent/src/loop/worker.ts` (`#holdForUser`), `apps/agent/src/main.ts`
- Test: `packages/db/src/queries/events-telemetry.int.test.ts` (new), `apps/agent/src/loop/step-store-telemetry.int.test.ts` (new), `apps/agent/src/slots/pool.test.ts` (append), `apps/agent/src/loop/worker.int.test.ts` (two assertions)

**Interfaces:**
- Consumes: A4 (`instrument`, `recordRunEvent`, `recordRunFailure`, `recordSpend`, `observeAgentGauges`, `getTelemetry`, `installTestTelemetry`).
- Produces: seams 5–8 (spec §7.3); `mt.step.commit`, `mt.slot.reset` and `mt.takeover` spans; spend and failure metrics; agent gauges; a 3 s shutdown flush. Public signatures are unchanged.

- [ ] **Step 1: Add the dependency**

In `packages/db/package.json` `dependencies`, add `"@mastertutor/telemetry": "workspace:*"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

`packages/db/src/queries/events-telemetry.int.test.ts`:

```ts
import { METRIC } from "@mastertutor/contracts/telemetry";
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { seedMember, seedRun, startTestDatabase, type TestDatabase } from "../testing.ts";
import { emitRunEvent } from "./events.ts";

let database: TestDatabase;
let owner: DbHandle;
let telemetry: TestTelemetry;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  telemetry = installTestTelemetry();
});
afterAll(async () => {
  await telemetry?.shutdown();
  await owner?.close();
  await database?.stop();
});

describe("emitRunEvent records product metrics (seam 6)", () => {
  it("counts approvals and run endings from the events both apps write", async () => {
    const { workspaceId } = await seedMember(owner.db);
    const runId = await seedRun(owner.db, { workspaceId });
    await owner.db.transaction(async (tx) => {
      await emitRunEvent(tx, runId, {
        type: "approval_requested",
        approvalId: "11111111-1111-4111-8111-111111111111",
        request: { kind: "download", url: "https://a.example/f.pdf", filename: "f.pdf" } as never,
      });
      await emitRunEvent(tx, runId, { type: "status", status: "completed", waitReason: null, reason: null });
    });
    expect((await telemetry.metric(METRIC.approvalsRequested.name))[0]!.attributes).toEqual({
      "mt.approval.kind": "download",
    });
    expect((await telemetry.metric(METRIC.runsEnded.name))[0]!.attributes).toEqual({
      "mt.run.status": "completed",
    });
    expect(await telemetry.exported()).not.toContain("f.pdf");
  });
});
```

If `ApprovalRequest`'s `download` member needs other fields, use any request that `RunEvent.parse` accepts. `emitRunEvent` parses before it records.

`apps/agent/src/loop/step-store-telemetry.int.test.ts`:

```ts
import { EMPTY_USAGE } from "@mastertutor/contracts";
import { METRIC } from "@mastertutor/contracts/telemetry";
import { createDb, runs, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { NO_SESSION_STORE, StepStore } from "./step-store.ts";

const OWNER = "telemetry-test";
let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let telemetry: TestTelemetry;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl);
  telemetry = installTestTelemetry();
});
afterAll(async () => {
  await telemetry?.shutdown();
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

async function openStore(usd: number) {
  const workspaceId = await seedWorkspace(owner.db);
  const row = await insertRun(owner.db, { workspaceId, goal: "g", status: "running", leaseOwner: OWNER });
  await owner.db.update(runs).set({ usage: { ...EMPTY_USAGE, usd } }).where(eq(runs.id, row.id));
  const store = await StepStore.open({
    db: agent.db,
    storage: createMemoryStorage(),
    sessionStore: NO_SESSION_STORE,
    owner: OWNER,
    run: row,
  });
  return { store, row };
}

describe("StepStore telemetry (seam 5)", () => {
  it("counts committed spend as the change in runs.usage.usd, after the commit", async () => {
    const { store } = await openStore(1);
    await store.commit({ run: { usage: { ...EMPTY_USAGE, usd: 1.25 } } });
    await store.commit({ run: { usage: { ...EMPTY_USAGE, usd: 1.75 } } });
    const [spend] = await telemetry.metric(METRIC.spendUsd.name);
    expect(spend!.value).toBeCloseTo(0.75);
    expect(telemetry.spans().filter((s) => s.name === "mt.step.commit")).toHaveLength(2);
  });

  it("counts a failed run by its error code", async () => {
    const { store } = await openStore(0);
    await store.commit({
      transition: {
        from: ["running"],
        to: "failed",
        waitReason: null,
        reason: "x",
        error: { code: "model_request_rejected", message: "The model rejected the request." },
      },
    });
    expect(
      (await telemetry.metric(METRIC.runFailures.name)).find(
        (p) => p.attributes["mt.error.code"] === "model_request_rejected",
      )?.value,
    ).toBe(1);
  });
});
```

`insertRun` and `seedWorkspace` are the helpers `run-loop.int.test.ts` already uses, from `apps/agent/src/testing/db.ts`. Pass the same option names that file passes.

Append to `apps/agent/src/slots/pool.test.ts`. It reuses `fakeSlot` and `fakeStore`:

```ts
import { installTestTelemetry } from "@mastertutor/telemetry/testing";

describe("slot reset telemetry (seam 7)", () => {
  it("records ok when the slot comes back and timeout when it does not", async () => {
    const telemetry = installTestTelemetry();
    const log = createLogger({ service: "test", level: "silent" });
    const config = runtimeConfig({ slotPollMs: 5, slotRestartTimeoutMs: 200 });
    const healthy = fakeSlot("old");
    await new SlotPool({
      store: fakeStore().store,
      slots: ["browser-1"],
      cdpBaseUrl: async () => "http://slot",
      control: healthy.control,
      config,
      log,
    }).reset("browser-1");
    await new SlotPool({
      store: fakeStore().store,
      slots: ["browser-2"],
      cdpBaseUrl: async () => "http://slot",
      control: { readBrowserId: async () => null, closeBrowser: async () => undefined },
      config: runtimeConfig({ slotPollMs: 5, slotRestartTimeoutMs: 30 }),
      log,
    }).reset("browser-2");
    const spans = telemetry.spans().filter((s) => s.name === "mt.slot.reset");
    expect(spans.map((s) => [s.attributes["mt.slot.name"], s.attributes["mt.slot.outcome"]])).toEqual([
      ["browser-1", "ok"],
      ["browser-2", "timeout"],
    ]);
    expect(spans[1]!.attributes["mt.error.code"]).toBe("slot_restart_timeout");
    await telemetry.shutdown();
  });
});
```

`fakeStore()` returns an object with a `store` field, as the existing tests in that file use it. If it returns the store directly, pass `fakeStore()`.

In `apps/agent/src/loop/worker.int.test.ts`, install the harness for the whole file. Add `import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";` and `let telemetry: TestTelemetry;`, set `telemetry = installTestTelemetry();` in the file's existing `beforeAll`, and add `await telemetry?.shutdown();` to its `afterAll`. Then add assertions to two existing tests:

At the end of `it("takeover during an act aborts it, holds without model calls, and hand back re-observes without retrying it", …)`:

```ts
    const takeovers = telemetry.spans().filter((s) => s.name === "mt.takeover" && s.attributes["mt.run.id"] === run.id);
    expect(takeovers.map((s) => [s.attributes["mt.control.holder"], s.attributes["mt.takeover.outcome"]])).toEqual([
      ["user", "ok"],
      ["agent", "ok"],
    ]);
```

At the end of `it("a takeover the live view cannot deliver returns control to the agent, never agent_error (F3)", …)`:

```ts
    const failed = telemetry.spans().find((s) => s.name === "mt.takeover" && s.attributes["mt.run.id"] === run.id);
    expect(failed!.attributes["mt.takeover.outcome"]).toBe("takeover_failed");
    expect(failed!.attributes["mt.error.code"]).toBe("takeover_failed");
```

Use the run variable each test already names (`run`, `claim.run` or similar).

- [ ] **Step 3: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit apps/agent/src/slots/pool.test.ts`, then `scripts/remote-test.sh integration packages/db/src/queries/events-telemetry.int.test.ts apps/agent/src/loop/step-store-telemetry.int.test.ts apps/agent/src/loop/worker.int.test.ts`
Expected: FAIL. No metrics are recorded and no `mt.step.commit`, `mt.slot.reset` or `mt.takeover` spans exist.

- [ ] **Step 4: `emitRunEvent` → `recordRunEvent` (`packages/db/src/queries/events.ts`)**

Add `import { recordRunEvent } from "@mastertutor/telemetry/record";`. In `emitRunEvent`, immediately before `return eventId;`, add:

```ts
  // Seam 6 (spec §7.3): every domain event, agent and web, counted once (never its text fields).
  recordRunEvent(payload);
```

- [ ] **Step 5: `StepStore` (`apps/agent/src/loop/step-store.ts`)**

Add these imports:

```ts
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { instrument } from "@mastertutor/telemetry/instrument";
import { recordRunFailure, recordSpend } from "@mastertutor/telemetry/record";
```

Add the field `#usd: number` and extend the private constructor's parameters with `usd: number`, assigning `this.#usd = usd;`. In `static async open(options)`, read the baseline before constructing:

```ts
    const [current] = await options.db
      .select({ usage: runs.usage })
      .from(runs)
      .where(eq(runs.id, options.run.id));
    return new StepStore(
      options,
      (steps?.value ?? -1) + 1,
      (transcript?.value ?? -1) + 1,
      current?.usage.usd ?? 0,
    );
```

Rename the existing `async commit(commit)` to `async #commitOnce(commit: StepCommit)` without changing its body, and add:

```ts
  /** Seam 5 (spec §7.3): the step transaction's span; spend and failures counted only once committed. */
  commit(commit: StepCommit): Promise<TranscriptEntry[]> {
    return instrument(SPAN.stepCommit, { [ATTR.runId]: this.#options.run.id }, async () => {
      const entries = await this.#commitOnce(commit);
      const usd = commit.run?.usage?.usd;
      if (usd !== undefined) {
        recordSpend(usd - this.#usd);
        this.#usd = usd;
      }
      if (commit.transition?.to === "failed")
        recordRunFailure(commit.transition.error?.code ?? "unknown_error");
      return entries;
    });
  }
```

- [ ] **Step 6: `SlotPool.#reset` (`apps/agent/src/slots/pool.ts`)**

Add these imports:

```ts
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { instrument } from "@mastertutor/telemetry/instrument";
```

Rename the existing `async #reset(name, { neverLeased })` to `async #restart(name: string, { neverLeased }: { neverLeased: boolean }): Promise<boolean>`. Inside it, make the success `return;` into `return true;`, and add `return false;` after the final `log.error(…)`. Then add:

```ts
  /** Seam 7: one mt.slot.reset span per recycle; a slot that misses its deadline is a failure. */
  #reset(name: string, options: { neverLeased: boolean }): Promise<void> {
    return instrument(SPAN.slotReset, { [ATTR.slotName]: name }, async (span) => {
      const restarted = await this.#restart(name, options);
      span.set({ [ATTR.slotOutcome]: restarted ? "ok" : "timeout" });
      if (!restarted) span.fail("slot_restart_timeout");
    });
  }
```

- [ ] **Step 7: Takeover give and take-back (`apps/agent/src/loop/worker.ts`, `#holdForUser`)**

Add these imports:

```ts
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { instrument } from "@mastertutor/telemetry/instrument";
```

Replace the `const given = await this.#deps.hooks.control.onUserControl(…).catch(…)` statement with:

```ts
    // Seam 8: handing the browser to the person (spec §7.3).
    const given = await instrument(
      SPAN.takeover,
      { [ATTR.runId]: this.runId, [ATTR.slotName]: slot, [ATTR.controlHolder]: "user" },
      async (span) => {
        const result = await this.#deps.hooks.control
          .onUserControl(slot, this.runId, { afterRestore })
          .catch((): UserControlResult => ({ ok: false, code: "takeover_failed" }));
        span.set({ [ATTR.takeoverOutcome]: result.ok ? "ok" : result.code });
        if (!result.ok) span.fail(result.code);
        return result;
      },
    );
```

In the same method, replace the `try { await this.#deps.hooks.control.onAgentControl(slot, this.runId); } catch { … }` block with:

```ts
        const restored = await instrument(
          SPAN.takeover,
          { [ATTR.runId]: this.runId, [ATTR.slotName]: slot, [ATTR.controlHolder]: "agent" },
          async (span) => {
            try {
              await this.#deps.hooks.control.onAgentControl(slot, this.runId);
              span.set({ [ATTR.takeoverOutcome]: "ok" });
              return true;
            } catch {
              span.set({ [ATTR.takeoverOutcome]: "control_restore_failed" });
              span.fail("control_restore_failed");
              return false;
            }
          },
        );
        if (!restored) {
          this.#deps.log.error(
            { runId: this.runId, errorCode: "control_restore_failed" },
            "could not take the live view back",
          );
          return { kind: "failed", error: CONTROL_RESTORE_FAILED };
        }
```

- [ ] **Step 8: Agent main (`apps/agent/src/main.ts`)**

Add this import:

```ts
import { getTelemetry, observeAgentGauges } from "@mastertutor/telemetry";
```

After `const supervisor = new Supervisor({…});`, add:

```ts
// D50: slot and run gauges read the same sources /healthz reads (spec §5.3).
observeAgentGauges({
  slotStates: async () =>
    (await listBrowserSlots(database.db, env.BROWSER_SLOTS)).map((slot) => slot.state),
  activeRuns: () => supervisor.activeRuns.length,
});
```

In the boot-check `catch`, before `process.exit(1)`, add `await getTelemetry().flush(2_000);`. In `shutdown()`, after `await health.close();`, add `await getTelemetry().shutdown(3_000);`. The SDK itself is started by the preload; B7 adds `--import` to the compose command.

- [ ] **Step 9: Run the tests**

Run: `scripts/remote-test.sh unit apps/agent packages/db`, then `scripts/remote-test.sh integration packages/db apps/agent/src/loop`, then `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(agent,db): instrument commits, run events, slot resets and takeovers; gauges and shutdown flush (D50 seams 5-8)" -- packages/db/package.json packages/db/src/queries/events.ts packages/db/src/queries/events-telemetry.int.test.ts apps/agent/src/loop/step-store.ts apps/agent/src/loop/step-store-telemetry.int.test.ts apps/agent/src/slots/pool.ts apps/agent/src/slots/pool.test.ts apps/agent/src/loop/worker.ts apps/agent/src/loop/worker.int.test.ts apps/agent/src/main.ts pnpm-lock.yaml
```

---

### Task A7: Web wiring, import boundaries, canary and end-to-end loop check

**Files:**
- Modify: `apps/web/instrumentation.ts`, `apps/web/next.config.ts` (`serverExternalPackages`), `apps/web/lib/server/runs/event-stream.ts` (`runEventStream`), `eslint.config.js`
- Create: `packages/telemetry/src/boundaries.test.ts`, `apps/agent/src/telemetry.security.test.ts`, `apps/agent/src/loop/run-loop-telemetry.int.test.ts`

**Interfaces:**
- Consumes: A3 (`startTelemetry`), A4 (`recordSseConnection`, `installTestTelemetry`), A5 and A6 seams.
- Produces: web telemetry (Next server spans, undici and HTTP client spans, the SSE gauge), the ESLint ban, the canary security test and the loop telemetry integration test.

- [ ] **Step 1: Write the failing tests**

`packages/telemetry/src/boundaries.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const files = (pattern: string) =>
  execFileSync("git", ["ls-files", pattern], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const imports = (file: string) =>
  [...readFileSync(new URL(file, root), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);

describe("module dependency map (plan: no cycles, spec §4.3)", () => {
  it("telemetry imports only contracts and OTel", () => {
    for (const file of files("packages/telemetry/src"))
      for (const spec of imports(file))
        expect(spec, file).toMatch(/^(\.|node:|@opentelemetry\/|@mastertutor\/contracts)/);
  });

  it("observability imports only contracts and zod", () => {
    for (const file of files("packages/observability/src"))
      for (const spec of imports(file)) expect(spec, file).toMatch(/^(\.|node:|zod$|@mastertutor\/contracts)/);
  });

  it("contracts imports no workspace package, and OTel only in the log bridge", () => {
    for (const file of files("packages/contracts/src"))
      for (const spec of imports(file)) {
        expect(spec, file).not.toMatch(/^@mastertutor\//);
        if (spec.startsWith("@opentelemetry/"))
          expect(file).toBe("packages/contracts/src/server/log-bridge.ts");
      }
  });

  it("db reaches telemetry through ./record only", () => {
    for (const file of files("packages/db/src"))
      for (const spec of imports(file).filter((s) => s.startsWith("@mastertutor/telemetry")))
        expect(spec, file).toBe("@mastertutor/telemetry/record");
  });
});
```

`apps/agent/src/telemetry.security.test.ts`:

```ts
import { FillCredentialArgs, FillCredentialResult } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { SPAN } from "@mastertutor/contracts/telemetry";
import { instrument, recordRunEvent } from "@mastertutor/telemetry";
import { installTestTelemetry } from "@mastertutor/telemetry/testing";
import { describe, expect, it } from "vitest";
import type { BrowserSession } from "./browser/session.ts";
import { NO_MASK_SOURCES } from "./browser/masking.ts";
import { APIError } from "./llm/openai.ts";
import { ModelCaller } from "./llm/caller.ts";
import { StepCollector } from "./loop/step-collector.ts";
import { instantClock } from "./runtime/clock.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { ToolError, register } from "./tools/types.ts";

const CANARY = "sk-CANARY0123456789abcdefghij";
const PAGE_TEXT = "Welcome back, CANARY-PAGE-TEXT";
const PNG = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");

describe("no secret, page text, prompt or screenshot leaves through telemetry (spec §14)", () => {
  it("canaries pass through seams 1-6 and appear nowhere in exported telemetry", async () => {
    const telemetry = installTestTelemetry();
    const log = createLogger({ service: "agent", destination: { write: () => undefined } });
    const tool = register({
      name: "fill_credential",
      args: FillCredentialArgs,
      result: FillCredentialResult,
      untrusted: false,
      run: async () => {
        throw new ToolError("needs_human", `${PAGE_TEXT} ${CANARY}`);
      },
    });
    const ctx = {
      runId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      session: { page: { url: () => `https://a.example/?token=${CANARY}` } } as unknown as BrowserSession,
      signal: new AbortController().signal,
      log,
      approval: null,
      step: new StepCollector(),
      mask: NO_MASK_SOURCES,
      slotName: "browser-1",
    };
    await instrument(SPAN.step, { "mt.run.id": ctx.runId, "mt.step.phase": "act" }, async () => {
      await new ToolRegistry([tool], log).run(
        "fill_credential",
        { alias: "zybooks", field: "password", target: { ref: "e1" } },
        ctx,
      );
      await new ModelCaller(
        {
          create: async () => {
            throw new APIError(400, undefined, `${PAGE_TEXT} prompt: ${CANARY} data:image/png;base64,${PNG}`, new Headers());
          },
        },
        { clock: instantClock(), fallbackAfter5xx: 3 },
      )
        .call(
          { model: "gpt-6-astra", instructions: CANARY, input: [], format: "agent_turn", toolProfile: "browser_use" },
          ctx.signal,
        )
        .catch(() => undefined);
      log.info({ password: CANARY, code: "123456" }, "fill attempted");
      recordRunEvent({ type: "user_message", text: CANARY });
      recordRunEvent({ type: "error", code: "needs_human", message: PAGE_TEXT });
      await instrument(SPAN.tool, { ["user.prompt" as never]: CANARY } as never, async () => undefined);
    });
    const exported = await telemetry.exported();
    for (const canary of [CANARY, "CANARY-PAGE-TEXT", PNG, "123456", "token="])
      expect(exported, canary).not.toContain(canary);
    expect(exported).toContain("mt.step");
    await telemetry.shutdown();
  });
});
```

Use the same `target` value as Task A5 Step 2. The `APIError` construction follows that step's note.

`apps/agent/src/loop/run-loop-telemetry.int.test.ts`:

```ts
import { createLogger } from "@mastertutor/contracts/server";
import { METRIC } from "@mastertutor/contracts/telemetry";
import { createDb, runs, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { ModelCaller } from "../llm/caller.ts";
import { createOpenAIModelClient } from "../llm/client.ts";
import { instantClock } from "../runtime/clock.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { FakeLoopBrowser } from "../testing/fake-loop-browser.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { withHooks } from "./hooks.ts";
import { RunLoop } from "./run-loop.ts";
import { snapshotOf } from "./run-state.ts";
import { NO_SESSION_STORE, StepStore } from "./step-store.ts";

const OWNER = "loop-telemetry";
let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let mock: LlmMock;
let telemetry: TestTelemetry;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl);
  mock = await startLlmMock();
  telemetry = installTestTelemetry();
});
afterAll(async () => {
  await telemetry?.shutdown();
  await mock?.close();
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

describe("a real loop emits the product telemetry (spec §7.3, §15)", () => {
  it("records every phase, the model request, the computer call, commits and spend", async () => {
    mock.setScenarios([
      {
        name: "t1",
        turns: [
          { outputs: [{ type: "computer", actions: [{ type: "click", x: 10, y: 20, button: "left" }] }] },
          { outputs: [{ type: "turn", status: "done", reason: "ok" }] },
        ],
      },
    ]);
    const workspaceId = await seedWorkspace(owner.db);
    const row = await insertRun(owner.db, {
      workspaceId,
      goal: "[scenario:t1] Do the task",
      status: "running",
      leaseOwner: OWNER,
    });
    const storage = createMemoryStorage();
    const [fresh] = await owner.db.select().from(runs).where(eq(runs.id, row.id));
    const loop = await RunLoop.restore(
      {
        db: agent.db,
        storage,
        caller: new ModelCaller(createOpenAIModelClient({ apiKey: "k", baseURL: `${mock.url}/v1` }), {
          clock: instantClock(),
          fallbackAfter5xx: 3,
        }),
        browser: new FakeLoopBrowser(),
        hooks: withHooks(),
        clock: instantClock(),
        config: runtimeConfig(),
        log: createLogger({ service: "test", level: "silent" }),
        store: await StepStore.open({
          db: agent.db,
          storage,
          sessionStore: NO_SESSION_STORE,
          owner: OWNER,
          run: row,
        }),
      },
      snapshotOf(fresh!),
    );
    for (let i = 0; i < 20; i++) {
      const outcome = await loop.step(new AbortController().signal);
      if (outcome.kind !== "continue") break;
    }
    const spans = telemetry.spans();
    const phases = new Set(spans.filter((s) => s.name === "mt.step").map((s) => s.attributes["mt.step.phase"]));
    expect([...phases].sort()).toEqual(["act", "approve", "decide", "observe"]);
    expect(spans.some((s) => s.name === "mt.model.request" && Number(s.attributes["mt.model.tokens.input"]) > 0)).toBe(true);
    expect(spans.some((s) => s.name === "mt.tool" && s.attributes["mt.tool.name"] === "computer")).toBe(true);
    expect(spans.some((s) => s.name === "mt.step.commit")).toBe(true);
    for (const s of spans.filter((s) => s.name === "mt.step"))
      expect(s.attributes["mt.run.id"]).toBe(row.id);
    expect((await telemetry.metric(METRIC.spendUsd.name))[0]?.value ?? 0).toBeGreaterThan(0);
    expect(await telemetry.metric(METRIC.runsEnded.name)).toEqual([
      { value: 1, attributes: { "mt.run.status": "completed" } },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/telemetry/src/boundaries.test.ts`, `scripts/remote-test.sh security apps/agent/src/telemetry.security.test.ts`, `scripts/remote-test.sh integration apps/agent/src/loop/run-loop-telemetry.int.test.ts`
Expected: the security and loop tests PASS already, because A5 and A6 are in place. They pin the behaviour. The boundaries test FAILS only if `packages/observability` has no files yet; if so, run it again after B1. Then continue.

- [ ] **Step 3: Start telemetry in web (`apps/web/instrumentation.ts`)**

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWebEnv } = await import("./lib/server/env.ts");
    const env = getWebEnv();
    // D50: Next.js owns the process, so crash handling only observes (spec §7.1).
    const [{ startTelemetry }, { createLogger }] = await Promise.all([
      import("@mastertutor/telemetry"),
      import("@mastertutor/contracts/server"),
    ]);
    startTelemetry({
      service: "web",
      env,
      crash: "observe",
      log: createLogger({ service: "web", level: env.LOG_LEVEL }),
    });
  }
}
```

In `apps/web/next.config.ts`, extend `serverExternalPackages`:

```ts
  serverExternalPackages: [
    "libsodium-wrappers",
    "libsodium",
    // D50: the instrumentations patch real node:http and undici, so these stay plain requires.
    "@opentelemetry/instrumentation",
    "@opentelemetry/instrumentation-http",
    "@opentelemetry/instrumentation-undici",
    "@opentelemetry/sdk-trace-node",
    "require-in-the-middle",
    "import-in-the-middle",
  ],
```

- [ ] **Step 4: SSE gauge (`apps/web/lib/server/runs/event-stream.ts`)**

Add `import { recordSseConnection } from "@mastertutor/telemetry/record";`. In `stop`, right after `closed = true;`, add `recordSseConnection(-1);`. In the `ReadableStream`'s `start`, right after `controller = streamController;`, add `recordSseConnection(1);`. `stop` runs at most once, because of its `if (closed) return;` guard. No per-event work is added (spec §15).

- [ ] **Step 5: ESLint ban (`eslint.config.js`)**

Add a config object (before the final prettier config):

```js
  {
    // D50: OTel only through @mastertutor/telemetry (and the contracts log bridge).
    files: ["**/*.{ts,tsx}"],
    ignores: ["packages/telemetry/**", "packages/contracts/src/server/log-bridge.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            OPENAI_IMPORTS,
            {
              group: ["@opentelemetry/*"],
              message: "Import telemetry through @mastertutor/telemetry (spec §4.3).",
            },
          ],
        },
      ],
    },
  },
```

This object replaces earlier `no-restricted-imports` settings for the files it matches. Place it before the `apps/web`, `tests/bench` and contracts blocks, so their later, more specific rule sets (which already carry `OPENAI_IMPORTS`) still win for their files. Then add the same `@opentelemetry/*` pattern to the `webImports(…)` helper's `patterns` array, so web files keep the ban.

For web client code, add this pattern to `webImports` when `server` is false, next to `SERVER_CONTRACTS_BAN`:

```js
const TELEMETRY_CLIENT_BAN = {
  group: ["@mastertutor/telemetry", "@mastertutor/telemetry/*"],
  message: "Telemetry is server-only (spec §4.3).",
};
```

Run `pnpm lint`. Fix only what the new rule reports. Nothing outside the two allowed places should import `@opentelemetry/*`.

- [ ] **Step 6: Verify the web production build still bundles cleanly**

Run: `scripts/remote-test.sh web-build`
Expected: PASS. `check:bundle` and `check:first-load` are unchanged, because nothing new reaches client bundles.

- [ ] **Step 7: Run all of Track A's suites**

Run: `scripts/remote-test.sh unit`, `scripts/remote-test.sh security`, `scripts/remote-test.sh integration packages/telemetry apps/agent/src/loop packages/db`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(web,agent): web telemetry, SSE gauge, OTel import ban, canary and loop telemetry tests (D50)" -- apps/web/instrumentation.ts apps/web/next.config.ts apps/web/lib/server/runs/event-stream.ts eslint.config.js packages/telemetry/src/boundaries.test.ts apps/agent/src/telemetry.security.test.ts apps/agent/src/loop/run-loop-telemetry.int.test.ts
```

---
## Track B: Collector, OpenObserve, provisioning, compose

### Task B1: OpenObserve client and API contract (spike against the pinned digest)

This task is the spike the spec calls for (§11, §12, §13.2). It pins every OpenObserve endpoint, payload, role name and template variable the provisioner uses, in one module, `o2-api.ts`. If a call in the contract test fails against the pinned image, fix `o2-api.ts` until it passes. No other file may hard-code an OpenObserve path. Record what changed in the commit message.

**Files:**
- Create: `packages/observability/package.json`, `tsconfig.json`, `src/index.ts`, `src/names.ts`, `src/client.ts`, `src/o2-api.ts`, `src/testing.ts`
- Test: `packages/observability/src/names.test.ts`, `src/client.test.ts`, `src/o2-api.int.test.ts`

**Interfaces:**
- Consumes: Task 0 (`OBSERVE_ORG`, `OBSERVE_USERS`, `OBSERVE_BASE_PATH`).
- Produces:
  - `o2StreamName(name: string): string`, `o2Label(name: string): string`;
  - `createO2Client(options: O2ClientOptions): O2Client`, where `O2Client.call<T>(operation, method, path, body?, schema?): Promise<T>`;
  - `O2Error(operation, status)`;
  - `waitForO2(client, timeoutMs?)`;
  - `o2Paths` (`health`, `users`, `user`, `stream`, `streamSettings`, `templates`, `template`, `destinations`, `destination`, `alerts`, `alert`, `dashboards`, `dashboard`, `jsonIngest`);
  - `O2_ROLES`, `O2_TEMPLATE_RULE_VARIABLE`, `UserList`, `AlertList`, `DashboardList`;
  - `dashboardRef(entry: unknown): { id: string; title: string; hash: string } | null`;
  - `testing.ts`: `startTestOpenObserve(): Promise<TestOpenObserve>`, `TEST_OBSERVE_ROOT_PASSWORD`, `OPENOBSERVE_IMAGE`.

- [ ] **Step 1: Create the package**

`packages/observability/package.json`:

```json
{
  "name": "@mastertutor/observability",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@mastertutor/contracts": "workspace:*",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "testcontainers": "12.2.0"
  }
}
```

`packages/observability/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Run `pnpm install`.

- [ ] **Step 2: Write the failing unit tests**

`packages/observability/src/names.test.ts`:

```ts
import { METRIC, ATTR, DERIVED_METRIC } from "@mastertutor/contracts/telemetry";
import { describe, expect, it } from "vitest";
import { o2Label, o2StreamName } from "./names.ts";

describe("OpenObserve names (spec §5.3)", () => {
  it("maps dots to underscores", () => {
    expect(o2StreamName(METRIC.runsEnded.name)).toBe("mt_runs_ended");
    expect(o2StreamName(DERIVED_METRIC.spanDuration)).toBe("mt_span_duration");
    expect(o2Label(ATTR.runStatus)).toBe("mt_run_status");
    expect(o2Label("span.name")).toBe("span_name");
  });
});
```

`packages/observability/src/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { O2Error, createO2Client } from "./client.ts";

describe("createO2Client", () => {
  it("sends basic auth and JSON, parses with the schema", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const client = createO2Client({
      baseUrl: "http://o2:5080/observability/",
      email: "root@mastertutor.internal",
      password: "pw",
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init: init! });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    const body = await client.call("listUsers", "GET", "/api/default/users", undefined, z.object({ data: z.array(z.unknown()) }));
    expect(body).toEqual({ data: [] });
    expect(seen[0]!.url).toBe("http://o2:5080/observability/api/default/users");
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("root@mastertutor.internal:pw").toString("base64")}`,
    );
  });

  it("throws O2Error with the operation and status, never the body", async () => {
    const client = createO2Client({
      baseUrl: "http://o2",
      email: "e",
      password: "secret-pw",
      fetchImpl: async () => new Response("echo secret-pw", { status: 401 }),
    });
    const error = await client.call("createUser", "POST", "/x", { a: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(O2Error);
    expect(String(error)).toBe("O2Error: OpenObserve createUser failed with HTTP 401");
  });
});
```

- [ ] **Step 3: Write the implementation**

`packages/observability/src/names.ts`:

```ts
/** OpenObserve stores metric streams and labels with dots as underscores (spec §5.3). */
export function o2StreamName(name: string): string {
  return name.replaceAll(".", "_");
}

export const o2Label = o2StreamName;
```

`packages/observability/src/client.ts`:

```ts
import { OBSERVE_ORG } from "@mastertutor/contracts";
import type { z } from "zod";

export interface O2ClientOptions {
  /** OpenObserve's base URL including ZO_BASE_URI, e.g. http://openobserve:5080/observability. */
  baseUrl: string;
  email: string;
  password: string;
  org?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type O2Method = "GET" | "POST" | "PUT" | "DELETE";

export interface O2Client {
  readonly org: string;
  call<T = unknown>(
    operation: string,
    method: O2Method,
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>,
  ): Promise<T>;
}

/** A failed OpenObserve call: the operation and status only, never a body (it can echo input). */
export class O2Error extends Error {
  readonly operation: string;
  readonly status: number;
  constructor(operation: string, status: number) {
    super(`OpenObserve ${operation} failed with HTTP ${status}`);
    this.name = "O2Error";
    this.operation = operation;
    this.status = status;
  }
}

export function createO2Client(options: O2ClientOptions): O2Client {
  const base = options.baseUrl.replace(/\/+$/, "");
  const authorization = `Basic ${Buffer.from(`${options.email}:${options.password}`).toString("base64")}`;
  const doFetch = options.fetchImpl ?? fetch;
  return {
    org: options.org ?? OBSERVE_ORG,
    async call(operation, method, path, body, schema) {
      const headers: Record<string, string> = { authorization };
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
      const text = await response.text();
      if (!response.ok) throw new O2Error(operation, response.status);
      const json: unknown = text.length > 0 ? JSON.parse(text) : null;
      return (schema ? schema.parse(json) : json) as never;
    },
  };
}

/** Polls /healthz until OpenObserve answers (one-shot startup only). */
export async function waitForO2(client: O2Client, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await client.call("health", "GET", "/healthz");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}
```

`packages/observability/src/o2-api.ts`:

```ts
/**
 * Every OpenObserve endpoint, payload shape, role and template variable the provisioner uses
 * (spec §11). Pinned by o2-api.int.test.ts against OPENOBSERVE_IMAGE: when a digest bump changes
 * the API, that test fails and this file is the only one to change.
 */
import { z } from "zod";

const e = encodeURIComponent;
export type StreamType = "logs" | "metrics" | "traces";

export const o2Paths = {
  health: () => "/healthz",
  users: (org: string) => `/api/${org}/users`,
  user: (org: string, email: string) => `/api/${org}/users/${e(email)}`,
  stream: (org: string, name: string, type: StreamType) => `/api/${org}/streams/${e(name)}?type=${type}`,
  streamSettings: (org: string, name: string, type: StreamType) =>
    `/api/${org}/streams/${e(name)}/settings?type=${type}`,
  templates: (org: string) => `/api/${org}/alerts/templates`,
  template: (org: string, name: string) => `/api/${org}/alerts/templates/${e(name)}`,
  destinations: (org: string) => `/api/${org}/alerts/destinations`,
  destination: (org: string, name: string) => `/api/${org}/alerts/destinations/${e(name)}`,
  alerts: (org: string) => `/api/v2/${org}/alerts`,
  alert: (org: string, id: string) => `/api/v2/${org}/alerts/${e(id)}`,
  dashboards: (org: string) => `/api/${org}/dashboards`,
  dashboard: (org: string, id: string, hash: string) =>
    `/api/${org}/dashboards/${e(id)}?hash=${e(hash)}`,
  jsonIngest: (org: string, stream: string) => `/api/${org}/${e(stream)}/_json`,
} as const;

/** The least role each user needs (spec §11); the open-source build has no finer roles. */
export const O2_ROLES = { ingest: "member", viewer: "member" } as const;
/** The alert template variable holding the alert's name (= our AlertRule). */
export const O2_TEMPLATE_RULE_VARIABLE = "{alert_name}";

export const UserList = z.object({ data: z.array(z.object({ email: z.string() }).loose()) });
export const AlertList = z.object({
  list: z.array(z.object({ alert_id: z.string(), name: z.string() }).loose()),
});
export const DashboardList = z.object({ dashboards: z.array(z.unknown()) });

/** One dashboard from the list endpoint: its id, title and the hash an update must quote. */
export function dashboardRef(entry: unknown): { id: string; title: string; hash: string } | null {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const version = typeof record.version === "number" ? record.version : null;
  const body = (version !== null ? record[`v${version}`] : null) ?? record;
  const inner = body as Record<string, unknown>;
  const id = inner.dashboardId ?? inner.dashboard_id ?? record.dashboard_id;
  const title = inner.title ?? record.title;
  const hash = record.hash ?? inner.hash;
  return typeof id === "string" && typeof title === "string" && typeof hash === "string"
    ? { id, title, hash }
    : null;
}
```

`packages/observability/src/testing.ts`:

```ts
import { OBSERVE_BASE_PATH, OBSERVE_USERS } from "@mastertutor/contracts";
import { GenericContainer, Wait } from "testcontainers";
import { createO2Client, type O2Client } from "./client.ts";

export const OPENOBSERVE_IMAGE =
  "openobserve/openobserve:v1.0.4@sha256:d4a878fac1f6c56003764f7f2a1625668917388f167e222c8c810de3f54c56ba";
export const TEST_OBSERVE_ROOT_PASSWORD = "test-root-password-0123456789abcdef";

export interface TestOpenObserve {
  baseUrl: string;
  root: O2Client;
  stop(): Promise<void>;
}

/** The pinned image on local disk (S3 is exercised by the observability stack suite, F1). */
export async function startTestOpenObserve(): Promise<TestOpenObserve> {
  const container = await new GenericContainer(OPENOBSERVE_IMAGE)
    .withEnvironment({
      ZO_ROOT_USER_EMAIL: OBSERVE_USERS.root,
      ZO_ROOT_USER_PASSWORD: TEST_OBSERVE_ROOT_PASSWORD,
      ZO_DATA_DIR: "/data",
      ZO_BASE_URI: OBSERVE_BASE_PATH,
      ZO_TELEMETRY: "false",
    })
    .withExposedPorts(5080)
    .withWaitStrategy(Wait.forHttp(`${OBSERVE_BASE_PATH}/healthz`, 5080))
    .withStartupTimeout(120_000)
    .start();
  const baseUrl = `http://${container.getHost()}:${container.getMappedPort(5080)}${OBSERVE_BASE_PATH}`;
  return {
    baseUrl,
    root: createO2Client({ baseUrl, email: OBSERVE_USERS.root, password: TEST_OBSERVE_ROOT_PASSWORD }),
    stop: async () => {
      await container.stop();
    },
  };
}
```

`packages/observability/src/index.ts`:

```ts
export * from "./names.ts";
export * from "./client.ts";
export * from "./o2-api.ts";
```

- [ ] **Step 4: Write the API contract test** (`packages/observability/src/o2-api.int.test.ts`)

```ts
import { OBSERVE_USERS } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createO2Client } from "./client.ts";
import { O2_ROLES, UserList, o2Paths } from "./o2-api.ts";
import { startTestOpenObserve, type TestOpenObserve } from "./testing.ts";

let o2: TestOpenObserve;
beforeAll(async () => {
  o2 = await startTestOpenObserve();
}, 180_000);
afterAll(async () => {
  await o2?.stop();
});

const PASSWORD = "ingest-password-0123456789abcdefghij";

describe("OpenObserve API contract (pinned digest, spec §11)", () => {
  it("creates a user with the pinned role and lists it", async () => {
    await o2.root.call("createUser", "POST", o2Paths.users("default"), {
      email: OBSERVE_USERS.ingest,
      password: PASSWORD,
      role: O2_ROLES.ingest,
      first_name: "ingest",
      last_name: "collector",
    });
    const users = await o2.root.call("listUsers", "GET", o2Paths.users("default"), undefined, UserList);
    expect(users.data.map((u) => u.email)).toContain(OBSERVE_USERS.ingest);
  });

  it("lets the ingest user write a log stream", async () => {
    const ingest = createO2Client({ baseUrl: o2.baseUrl, email: OBSERVE_USERS.ingest, password: PASSWORD });
    await ingest.call("ingest", "POST", o2Paths.jsonIngest("default", "mastertutor"), [
      { level: "info", msg: "contract test" },
    ]);
  });

  it("sets a stream's retention", async () => {
    await o2.root.call("streamSettings", "PUT", o2Paths.streamSettings("default", "mastertutor", "logs"), {
      data_retention: 30,
    });
  });

  it("serves the UI under the base path", async () => {
    const response = await fetch(`${o2.baseUrl}/web/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
```

Tasks B4, B5 and B6 extend this contract with their own integration tests, which use `startTestOpenObserve()` too.

- [ ] **Step 5: Run the tests, adjusting `o2-api.ts` until the contract passes**

Run: `scripts/remote-test.sh unit packages/observability`, then `scripts/remote-test.sh integration packages/observability/src/o2-api.int.test.ts`
Expected: PASS. If a call fails, read the pinned image's API (its `/observability/swagger/` page, or the v1.0.4 source at `src/handler/http/request/`). Then correct the path, payload or role in `o2-api.ts`, never in a caller.

While the container runs, also record two facts as comments in `o2-api.ts` next to `O2_ROLES`:

- whether the image has `curl` or `wget` (`docker exec <id> sh -c 'command -v curl wget'`), which Task B7's healthcheck choice depends on;
- the uid it runs as (`docker exec <id> id -u`).

- [ ] **Step 6: Commit**

```bash
git add packages/observability
git commit -m "feat(observability): OpenObserve client and API contract pinned to v1.0.4 (D50)" -- packages/observability pnpm-lock.yaml
```

---

### Task B2: Garage bucket and key, env-init and check-env

**Files:**
- Create: `packages/storage/src/garage-plan.ts`, `packages/storage/src/garage-plan.test.ts`, `scripts/lib/vapid.ts`, `scripts/lib/vapid.test.ts`
- Modify: `packages/storage/src/bin/garage-init.ts`, `packages/storage/src/index.ts`, `packages/storage/src/garage.int.test.ts` (append), `scripts/env-init.ts` (`generateSecrets`, `fillEnv`), `scripts/env-init.test.ts` (append), `scripts/deploy/check-env.ts`, `tests/deploy/check-env.int.test.ts`

**Interfaces:**
- Consumes: Task 0 (`GarageInitEnv` observe keys, `ObservabilityInitEnv`), `bootstrapGarage` (`packages/storage/src/garage-admin.ts`), `createStorage` (`packages/storage/src/s3.ts`).
- Produces:
  - `garageBuckets(env: GarageInitEnv): GarageBootstrapOptions[]`;
  - `vapidKeyPair(): { publicKey: string; privateKey: string }`, `vapidPairMatches(publicKey: string, privateKey: string): boolean`;
  - `generateSecrets()` gains `OBSERVE_ROOT_PASSWORD`, `OBSERVE_INGEST_PASSWORD`, `OBSERVE_VIEWER_PASSWORD`, `ALERT_WEBHOOK_SECRET`, `S3_OBSERVE_ACCESS_KEY_ID`, `S3_OBSERVE_SECRET_ACCESS_KEY`, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`;
  - `checkProductionEnv` requires the `observability` profile and a matching VAPID pair, and validates `observability-init`.

- [ ] **Step 1: Write the failing tests**

`packages/storage/src/garage-plan.test.ts`:

```ts
import { parseEnv, GarageInitEnv } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { garageBuckets } from "./garage-plan.ts";

const base = {
  GARAGE_ADMIN_URL: "http://garage:3903",
  GARAGE_ADMIN_TOKEN: "t".repeat(40),
  S3_WEB_ACCESS_KEY_ID: `GK${"1".repeat(24)}`,
  S3_WEB_SECRET_ACCESS_KEY: "1".repeat(64),
  S3_AGENT_ACCESS_KEY_ID: `GK${"2".repeat(24)}`,
  S3_AGENT_SECRET_ACCESS_KEY: "2".repeat(64),
};

describe("garageBuckets (spec §11)", () => {
  it("is the app bucket only without observe keys", () => {
    const plan = garageBuckets(parseEnv(GarageInitEnv, base));
    expect(plan.map((p) => [p.bucket, p.keys.map((k) => [k.name, k.read, k.write])])).toEqual([
      ["mastertutor", [["web", true, false], ["agent", true, true]]],
    ]);
  });

  it("gives OpenObserve its own bucket and a key that reaches nothing else", () => {
    const plan = garageBuckets(
      parseEnv(GarageInitEnv, {
        ...base,
        S3_OBSERVE_ACCESS_KEY_ID: `GK${"3".repeat(24)}`,
        S3_OBSERVE_SECRET_ACCESS_KEY: "3".repeat(64),
      }),
    );
    expect(plan[1]!.bucket).toBe("observability");
    expect(plan[1]!.keys.map((k) => [k.name, k.read, k.write])).toEqual([["openobserve", true, true]]);
    expect(plan[0]!.keys.map((k) => k.name)).not.toContain("openobserve");
  });
});
```

Append to `packages/storage/src/garage.int.test.ts`. It reuses `garage` and `keys`:

```ts
import { createStorage } from "./s3.ts";

describe("OpenObserve's bucket is isolated (spec §11, §14)", () => {
  it("its key reads and writes only its bucket; app keys cannot reach it", async () => {
    const observeKey = {
      name: "openobserve",
      accessKeyId: "GK333333333333333333333333",
      secretAccessKey: "3".repeat(64),
      read: true,
      write: true,
    };
    const common = { adminUrl: garage.adminUrl, adminToken: garage.adminToken, capacityBytes: 1024 ** 3 };
    await bootstrapGarage({ ...common, bucket: "mastertutor", keys });
    await bootstrapGarage({ ...common, bucket: "observability", keys: [observeKey] });
    const as = (bucket: string, key: { accessKeyId: string; secretAccessKey: string }) =>
      createStorage({ endpoint: garage.s3Endpoint, region: "garage", bucket, ...key });
    await as("observability", observeKey).put("files/x", "ok", { contentType: "text/plain" });
    await expect(as("mastertutor", observeKey).getBytes("assets/none")).rejects.toThrow();
    await expect(as("observability", keys[1]!).getBytes("files/x")).rejects.toThrow();
    await expect(as("observability", keys[0]!).getBytes("files/x")).rejects.toThrow();
  });
});
```

`scripts/lib/vapid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { vapidKeyPair, vapidPairMatches } from "./vapid.ts";

describe("VAPID keys (spec §13.4)", () => {
  it("generates a base64url P-256 pair in the env shape", () => {
    const pair = vapidKeyPair();
    expect(pair.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(pair.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(vapidPairMatches(pair.publicKey, pair.privateKey)).toBe(true);
    expect(vapidPairMatches(vapidKeyPair().publicKey, pair.privateKey)).toBe(false);
    expect(vapidPairMatches(pair.publicKey, "not-a-key")).toBe(false);
  });
});
```

Append to `scripts/env-init.test.ts`:

```ts
import { ObservabilityInitEnv } from "@mastertutor/contracts";
import { vapidPairMatches } from "./lib/vapid.ts";

describe("observability secrets (D50)", () => {
  it("generates every observability secret in its contract shape", () => {
    const s = generateSecrets();
    expect(GarageKeyId.safeParse(s.S3_OBSERVE_ACCESS_KEY_ID).success).toBe(true);
    expect(GarageSecret.safeParse(s.S3_OBSERVE_SECRET_ACCESS_KEY).success).toBe(true);
    expect(vapidPairMatches(s.VAPID_PUBLIC_KEY!, s.VAPID_PRIVATE_KEY!)).toBe(true);
    expect(
      ObservabilityInitEnv.safeParse({
        OBSERVE_ROOT_PASSWORD: s.OBSERVE_ROOT_PASSWORD,
        OBSERVE_INGEST_PASSWORD: s.OBSERVE_INGEST_PASSWORD,
        OBSERVE_VIEWER_PASSWORD: s.OBSERVE_VIEWER_PASSWORD,
        ALERT_WEBHOOK_SECRET: s.ALERT_WEBHOOK_SECRET,
      }).success,
    ).toBe(true);
  });

  it("refuses a half-present VAPID pair", () => {
    expect(() => fillEnv("VAPID_PUBLIC_KEY=Bx\n", generateSecrets())).toThrow(
      "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together",
    );
  });
});
```


In `tests/deploy/check-env.int.test.ts`, change `goodEnv()`'s `COMPOSE_PROFILES: "pdf"` to `COMPOSE_PROFILES: "pdf,observability"`, and append:

```ts
  it("requires the observability profile and a matching VAPID pair (D50)", async () => {
    const values = {
      ...goodEnv(),
      COMPOSE_PROFILES: "pdf",
      VAPID_PUBLIC_KEY: generateSecrets().VAPID_PUBLIC_KEY!,
    };
    const problems = await checkProductionEnv(envFile(values));
    expect(problems).toContain("COMPOSE_PROFILES: must include observability (D50)");
    expect(problems).toContain("VAPID_PUBLIC_KEY: does not match VAPID_PRIVATE_KEY");
    expectNoValues(problems, values);
  });

  it("reports a missing observability secret by key", async () => {
    const values = goodEnv();
    delete values.OBSERVE_ROOT_PASSWORD;
    const problems = await checkProductionEnv(envFile(values));
    expect(problems.some((p) => p.includes("OBSERVE_ROOT_PASSWORD"))).toBe(true);
    expectNoValues(problems, values);
  });
```

The second test passes once Task B7 adds `:?set OBSERVE_ROOT_PASSWORD` to `compose.prod.yml`. Until B7 lands, mark it `it.todo` and switch it back in B7, Step 6.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/storage/src/garage-plan.test.ts scripts/lib/vapid.test.ts scripts/env-init.test.ts`
Expected: FAIL. The modules are not found and the keys are missing.

- [ ] **Step 3: Write the implementation**

`packages/storage/src/garage-plan.ts`:

```ts
import type { GarageInitEnv } from "@mastertutor/contracts";
import type { GarageBootstrapOptions } from "./garage-admin.ts";

/**
 * What garage-init provisions: the app bucket with web (read) and agent (read/write) keys, and,
 * when its keys are set, OpenObserve's own bucket with a key that can reach nothing else (D50).
 */
export function garageBuckets(env: GarageInitEnv): GarageBootstrapOptions[] {
  const common = {
    adminUrl: env.GARAGE_ADMIN_URL,
    adminToken: env.GARAGE_ADMIN_TOKEN,
    capacityBytes: env.GARAGE_CAPACITY_BYTES,
  };
  const plan: GarageBootstrapOptions[] = [
    {
      ...common,
      bucket: env.S3_BUCKET,
      keys: [
        { name: "web", accessKeyId: env.S3_WEB_ACCESS_KEY_ID, secretAccessKey: env.S3_WEB_SECRET_ACCESS_KEY, read: true, write: false },
        { name: "agent", accessKeyId: env.S3_AGENT_ACCESS_KEY_ID, secretAccessKey: env.S3_AGENT_SECRET_ACCESS_KEY, read: true, write: true },
      ],
    },
  ];
  if (env.S3_OBSERVE_ACCESS_KEY_ID && env.S3_OBSERVE_SECRET_ACCESS_KEY)
    plan.push({
      ...common,
      bucket: env.S3_OBSERVE_BUCKET,
      keys: [
        {
          name: "openobserve",
          accessKeyId: env.S3_OBSERVE_ACCESS_KEY_ID,
          secretAccessKey: env.S3_OBSERVE_SECRET_ACCESS_KEY,
          read: true,
          write: true,
        },
      ],
    });
  return plan;
}
```

Replace the body of `packages/storage/src/bin/garage-init.ts` after `waitForGarageAdmin(…)` with:

```ts
// One bootstrap per bucket: the layout step is idempotent, so the second call only adds its bucket.
for (const options of garageBuckets(env)) {
  const result = await bootstrapGarage(options);
  log.info(
    { bucket: options.bucket, createdBucket: result.createdBucket, importedKeys: result.importedKeys },
    "garage ready",
  );
}
```

Import `garageBuckets` from `../garage-plan.ts`. Add `export * from "./garage-plan.ts";` to `packages/storage/src/index.ts`.

`scripts/lib/vapid.ts`:

```ts
import { createECDH, generateKeyPairSync } from "node:crypto";

/** A VAPID key pair as env values: base64url uncompressed P-256 point and 32-byte scalar (RFC 8292). */
export function vapidKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  if (!pub.x || !pub.y || !priv.d) throw new Error("VAPID key export failed");
  return {
    publicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(pub.x, "base64url"),
      Buffer.from(pub.y, "base64url"),
    ]).toString("base64url"),
    privateKey: priv.d,
  };
}

export function vapidPairMatches(publicKey: string, privateKey: string): boolean {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    return ecdh.getPublicKey().toString("base64url") === publicKey;
  } catch {
    return false;
  }
}
```

In `scripts/env-init.ts`, import `vapidKeyPair` from `./lib/vapid.ts`. In `generateSecrets()`, add before the return:

```ts
  const vapid = vapidKeyPair();
```

and add these to the returned object:

```ts
    S3_OBSERVE_ACCESS_KEY_ID: `GK${hex(12)}`,
    S3_OBSERVE_SECRET_ACCESS_KEY: hex(32),
    OBSERVE_ROOT_PASSWORD: b64url(32),
    OBSERVE_INGEST_PASSWORD: b64url(32),
    OBSERVE_VIEWER_PASSWORD: b64url(32),
    ALERT_WEBHOOK_SECRET: b64url(32),
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
```

In `fillEnv`, replace the vault-only pair check with:

```ts
  for (const [a, b] of [
    ["VAULT_PUBLIC_KEY", "VAULT_PRIVATE_KEY"],
    ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    ["S3_OBSERVE_ACCESS_KEY_ID", "S3_OBSERVE_SECRET_ACCESS_KEY"],
  ] as const) {
    if (((values.get(a) ?? "") !== "") !== ((values.get(b) ?? "") !== ""))
      throw new Error(`${a} and ${b} must be set together; fix .env by hand`);
  }
```

The existing test "refuses a half-present vault key pair" keeps its message.

In `scripts/deploy/check-env.ts`:

- import `ObservabilityInitEnv` from contracts and `vapidPairMatches` from `../lib/vapid.ts`;
- add `"observability-init": ObservabilityInitEnv,` to `SERVICE_SCHEMAS`;
- after the `pdf` profile rule, add:

```ts
  if (!profiles.includes("observability"))
    problems.push("COMPOSE_PROFILES: must include observability (D50)");
```

- after the vault key-pair check, add:

```ts
  if (has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY") &&
      !vapidPairMatches(root.VAPID_PUBLIC_KEY!, root.VAPID_PRIVATE_KEY!))
    problems.push("VAPID_PUBLIC_KEY: does not match VAPID_PRIVATE_KEY");
```

Missing secrets are reported by the existing `set X` parser once `compose.prod.yml` uses `:?set X` (Task B7).

- [ ] **Step 4: Run the tests**

Run: `scripts/remote-test.sh unit packages/storage scripts`, `scripts/remote-test.sh integration packages/storage/src/garage.int.test.ts tests/deploy/check-env.int.test.ts`
Expected: PASS. The missing-secret test is a todo until B7.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(storage,scripts): OpenObserve bucket and key, observability secrets and VAPID keys, check-env rules (D50)" -- packages/storage/src/garage-plan.ts packages/storage/src/garage-plan.test.ts packages/storage/src/bin/garage-init.ts packages/storage/src/index.ts packages/storage/src/garage.int.test.ts scripts/lib/vapid.ts scripts/lib/vapid.test.ts scripts/env-init.ts scripts/env-init.test.ts scripts/deploy/check-env.ts tests/deploy/check-env.int.test.ts
```

---

### Task B3: Collector configuration

**Files:**
- Create: `infra/otel/collector.yaml`, `tests/observability/collector-config.test.ts`, `tests/observability/collector-config.int.test.ts`

**Interfaces:**
- Consumes: Task 0 (`SPANMETRICS_NAMESPACE`, `SPANMETRIC_DIMENSIONS`, `ATTR`, `LOG_STREAMS`, `DEPENDENCIES`, `OBSERVE_USERS`).
- Produces: `infra/otel/collector.yaml`, which reads two env vars, `OBSERVE_INGEST_PASSWORD` and `OBSERVE_OTLP_ENDPOINT`. It receives OTLP/HTTP on `4318`, fluent forward on `24224`, and serves health on `13133`.

- [ ] **Step 1: Write the failing tests**

`tests/observability/collector-config.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { OBSERVE_USERS } from "@mastertutor/contracts";
import {
  ATTR,
  DEPENDENCIES,
  LOG_STREAMS,
  SPANMETRIC_DIMENSIONS,
  SPANMETRICS_NAMESPACE,
} from "@mastertutor/contracts/telemetry";
import { describe, expect, it } from "vitest";

const yaml = readFileSync(new URL("../../infra/otel/collector.yaml", import.meta.url), "utf8");
const block = (name: string) => {
  const start = yaml.indexOf(`\n  ${name}:`);
  const next = yaml.slice(start + 1).search(/\n  [a-z/_]+:|\n[a-z]+:/);
  return yaml.slice(start, next === -1 ? undefined : start + 1 + next);
};

describe("infra/otel/collector.yaml follows the names registry (spec §4.3, §10)", () => {
  it("derives span metrics under the registered namespace and dimensions", () => {
    const spanmetrics = block("spanmetrics");
    expect(spanmetrics).toContain(`namespace: ${SPANMETRICS_NAMESPACE}`);
    const dims = [...spanmetrics.matchAll(/- name: ([a-z._]+)/g)].map((m) => m[1]);
    expect(dims).toEqual([...SPANMETRIC_DIMENSIONS]);
  });

  it("uses only registered mt.* names", () => {
    const known = new Set<string>(Object.values(ATTR));
    for (const [name] of yaml.matchAll(/\bmt\.[a-z_.]+[a-z_]/g))
      if (name !== SPANMETRICS_NAMESPACE) expect(known.has(name), name).toBe(true);
  });

  it("names every dependency the registry knows and nothing else", () => {
    const set = [...yaml.matchAll(/set\(attributes\["mt\.dependency"\], "([a-z-]+)"\)/g)].map((m) => m[1]);
    expect(new Set(set)).toEqual(new Set(DEPENDENCIES));
  });

  it("sends app logs and container logs to their streams with the ingest user", () => {
    expect(yaml).toContain(`stream-name: ${LOG_STREAMS.app}`);
    expect(yaml).toContain(`stream-name: ${LOG_STREAMS.containers}`);
    expect(yaml).toContain(`username: ${OBSERVE_USERS.ingest}`);
    const envs = new Set([...yaml.matchAll(/\$\{env:([A-Z_]+)\}/g)].map((m) => m[1]));
    expect(envs).toEqual(new Set(["OBSERVE_INGEST_PASSWORD", "OBSERVE_OTLP_ENDPOINT"]));
  });

  it("keeps errors, product error codes and slow traces, then samples 10%", () => {
    const tail = block("tail_sampling");
    expect(tail).toMatch(/status_codes: \[ERROR\]/);
    expect(tail).toMatch(/key: mt\.error\.code/);
    expect(tail).toMatch(/threshold_ms: 15000/);
    expect(tail).toMatch(/sampling_percentage: 10/);
  });

  it("runs spanmetrics before tail sampling, so RED counts cover every span", () => {
    expect(yaml).toMatch(/traces\/ingest:[\s\S]*exporters: \[spanmetrics, forward\/sample\]/);
    expect(yaml).toMatch(/traces\/sample:[\s\S]*processors: \[tail_sampling, batch\]/);
  });
});
```

`tests/observability/collector-config.int.test.ts`:

```ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { GenericContainer, TestContainers, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const IMAGE =
  "otel/opentelemetry-collector-contrib:0.162.0@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6";
const CONFIG = new URL("../../infra/otel/collector.yaml", import.meta.url).pathname;
const received: Array<{ path: string; stream: string | undefined; body: string }> = [];
let sink: ReturnType<typeof createServer>;
let collector: StartedTestContainer;
let otlp: string;

beforeAll(async () => {
  sink = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c)).on("end", () => {
      const raw = Buffer.concat(chunks);
      const body = req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
      received.push({ path: req.url ?? "", stream: req.headers["stream-name"] as string | undefined, body: body.toString("latin1") });
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((r) => sink.listen(0, "0.0.0.0", r));
  const port = (sink.address() as AddressInfo).port;
  await TestContainers.exposeHostPorts(port);
  collector = await new GenericContainer(IMAGE)
    .withCopyFilesToContainer([{ source: CONFIG, target: "/etc/otelcol/config.yaml" }])
    .withCommand(["--config=/etc/otelcol/config.yaml"])
    .withEnvironment({
      OBSERVE_INGEST_PASSWORD: "ingest-password",
      OBSERVE_OTLP_ENDPOINT: `http://host.testcontainers.internal:${port}/observability/api/default`,
    })
    .withExposedPorts(4318, 13133)
    .withWaitStrategy(Wait.forHttp("/", 13133))
    .start();
  otlp = `http://${collector.getHost()}:${collector.getMappedPort(4318)}`;
}, 180_000);
afterAll(async () => {
  await collector?.stop();
  sink?.close();
});

const CANARY = "sk-CANARYCANARYCANARY0123";
const now = () => `${Date.now()}000000`;

describe("collector pipeline (spec §10)", () => {
  it("validates", async () => {
    const result = await collector.exec(["/otelcol-contrib", "validate", "--config=/etc/otelcol/config.yaml"]);
    expect(result.exitCode).toBe(0);
  });

  it("scrubs secrets, maps S3 spans, keeps errors and derives span metrics", async () => {
    await fetch(`${otlp}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceSpans: [{
          resource: { attributes: [{ key: "service.name", value: { stringValue: "agent" } }] },
          scopeSpans: [{ spans: [{
            traceId: "0af7651916cd43dd8448eb211c80319c",
            spanId: "b7ad6b7169203331",
            name: "GET",
            kind: 3,
            startTimeUnixNano: now(),
            endTimeUnixNano: now(),
            status: { code: 2 },
            attributes: [
              { key: "server.address", value: { stringValue: "garage" } },
              { key: "http.request.method", value: { stringValue: "GET" } },
              { key: "url.full", value: { stringValue: "http://garage:3900/mastertutor/x/private.pdf" } },
              { key: "mt.error.code", value: { stringValue: "s3_failed" } },
              { key: "note", value: { stringValue: `Bearer ${CANARY}` } },
              { key: "db_password", value: { stringValue: "pw-canary" } },
            ],
          }] }],
        }],
      }),
    });
    await fetch(`${otlp}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: now(), severityText: "ERROR", body: { stringValue: `key ${CANARY}` } }] }] }],
      }),
    });
    await new Promise((r) => setTimeout(r, 35_000)); // tail sampling waits 20 s; spanmetrics flush 30 s
    const traces = received.filter((r) => r.path.endsWith("/v1/traces")).map((r) => r.body).join("");
    const logs = received.filter((r) => r.path.endsWith("/v1/logs"));
    const metrics = received.filter((r) => r.path.endsWith("/v1/metrics")).map((r) => r.body).join("");
    expect(traces).toContain("s3 GET");
    expect(traces).not.toContain("private.pdf");
    expect(traces).not.toContain("pw-canary");
    expect(traces + logs.map((l) => l.body).join("")).not.toContain(CANARY);
    expect(traces).toContain("****");
    expect(logs.every((l) => l.stream === "mastertutor")).toBe(true);
    expect(metrics).toContain("mt.span.calls");
  }, 90_000);
});
```

- [ ] **Step 2: Run the unit test and watch it fail**

Run: `scripts/remote-test.sh unit tests/observability/collector-config.test.ts`
Expected: FAIL. The file does not exist.

- [ ] **Step 3: Write `infra/otel/collector.yaml`**

```yaml
# OTel Collector (D50, spec §10). Product names come from packages/contracts/src/telemetry.ts;
# tests/observability/collector-config.test.ts pins this file to them. Regexes use POSIX classes,
# not backslashes, so YAML and OTTL escaping never change their meaning.
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  basicauth/openobserve:
    client_auth:
      username: ingest@mastertutor.internal
      password: ${env:OBSERVE_INGEST_PASSWORD}

receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        max_request_body_size: 4194304
  fluentforward:
    endpoint: 0.0.0.0:24224

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 400
    spike_limit_mib: 100
  batch:
    send_batch_size: 1024
    send_batch_max_size: 2048
    timeout: 2s
  filter/health:
    error_mode: ignore
    traces:
      span:
        - attributes["http.route"] == "/healthz"
        - attributes["next.route"] == "/healthz"
  # Pass 2 of the secret scrub (pass 1 is the SDK allowlist and pino's redaction).
  attributes/scrub:
    actions:
      - pattern: (?i).*(password|passwd|secret|token|cookie|authorization|api[_-]?key|otp|totp|sealed|pin)$
        action: delete
  transform/scrub:
    error_mode: ignore
    trace_statements:
      - context: span
        statements: &scrub_attributes
          - replace_all_patterns(attributes, "value", "(?i)bearer[[:space:]]+[a-z0-9._~+/=-]+", "****")
          - replace_all_patterns(attributes, "value", "sk-[A-Za-z0-9_-]{16,}", "****")
          - replace_all_patterns(attributes, "value", "eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}", "****")
          - replace_all_patterns(attributes, "value", "(?i)basic[[:space:]]+[a-z0-9+/=]{8,}", "****")
          - replace_all_patterns(attributes, "value", "(NEKO_SESSION|live_slot|better-auth[.][a-z_]+)=[^;[:space:]]+", "****")
    log_statements:
      - context: log
        statements:
          - replace_all_patterns(attributes, "value", "(?i)bearer[[:space:]]+[a-z0-9._~+/=-]+", "****")
          - replace_all_patterns(attributes, "value", "sk-[A-Za-z0-9_-]{16,}", "****")
          - replace_all_patterns(attributes, "value", "eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}", "****")
          - replace_all_patterns(attributes, "value", "(?i)basic[[:space:]]+[a-z0-9+/=]{8,}", "****")
          - replace_all_patterns(attributes, "value", "(NEKO_SESSION|live_slot|better-auth[.][a-z_]+)=[^;[:space:]]+", "****")
          - replace_pattern(body, "(?i)bearer[[:space:]]+[a-z0-9._~+/=-]+", "****")
          - replace_pattern(body, "sk-[A-Za-z0-9_-]{16,}", "****")
          - replace_pattern(body, "eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}", "****")
          - replace_pattern(body, "(?i)basic[[:space:]]+[a-z0-9+/=]{8,}", "****")
          - replace_pattern(body, "(NEKO_SESSION|live_slot|better-auth[.][a-z_]+)=[^;[:space:]]+", "****")
  # Base telemetry → product telemetry (spec §10).
  transform/product:
    error_mode: ignore
    trace_statements:
      - context: span
        statements:
          - set(attributes["mt.dependency"], "openai") where attributes["server.address"] == "api.openai.com"
          - set(attributes["mt.dependency"], "s3") where attributes["server.address"] == "garage"
          - set(attributes["mt.dependency"], "docling") where attributes["server.address"] == "docling"
          - set(attributes["mt.dependency"], "pdf-worker") where attributes["server.address"] == "pdf-worker"
          - set(attributes["mt.dependency"], "audio-capture") where attributes["server.address"] == "audio-capture"
          - set(attributes["mt.dependency"], "neko") where IsMatch(attributes["server.address"], "^browser-[0-9]+$")
          - set(attributes["mt.dependency"], "push") where IsMatch(attributes["server.address"], "(push[.]apple[.]com|fcm[.]googleapis[.]com|push[.]services[.]mozilla[.]com|notify[.]windows[.]com)$")
          - set(name, Concat([attributes["mt.dependency"], attributes["http.request.method"]], " ")) where attributes["mt.dependency"] != nil and kind == SPAN_KIND_CLIENT
          - delete_key(attributes, "url.full")
          - delete_key(attributes, "url.path")
          - delete_key(attributes, "url.query")
          - delete_key(attributes, "http.target")
    log_statements:
      - context: log
        statements:
          - set(attributes["mt.service"], attributes["container_name"]) where attributes["container_name"] != nil
          - replace_pattern(attributes["mt.service"], "^/?[a-z0-9_.-]+?-(browser-[0-9]+|pdf-worker|audio-capture|docling)-[0-9]+$", "$$1")
  # Keep every error, every product error code and every slow trace; sample the rest at 10%.
  tail_sampling:
    decision_wait: 20s
    num_traces: 20000
    expected_new_traces_per_sec: 50
    policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: product-error-codes
        type: string_attribute
        string_attribute: { key: mt.error.code, values: [".+"], enabled_regex_matching: true }
      - name: slow
        type: latency
        latency: { threshold_ms: 15000 }
      - name: baseline
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }

connectors:
  forward/sample: {}
  spanmetrics:
    namespace: mt.span
    histogram:
      unit: ms
      explicit:
        buckets: [5ms, 25ms, 100ms, 250ms, 1s, 2500ms, 5s, 15s, 60s]
    dimensions:
      - name: mt.step.phase
      - name: mt.step.outcome
      - name: mt.tool.name
      - name: mt.tool.outcome
      - name: mt.model.name
      - name: mt.error.code
      - name: mt.capture.fidelity
      - name: mt.slot.name
      - name: mt.takeover.outcome
      - name: mt.dependency
    metrics_flush_interval: 30s

exporters:
  otlphttp/openobserve:
    endpoint: ${env:OBSERVE_OTLP_ENDPOINT}
    auth: { authenticator: basicauth/openobserve }
    sending_queue: { enabled: true, queue_size: 2000 }
    retry_on_failure: { enabled: true, max_elapsed_time: 120s }
  otlphttp/app-logs:
    endpoint: ${env:OBSERVE_OTLP_ENDPOINT}
    auth: { authenticator: basicauth/openobserve }
    headers:
      stream-name: mastertutor
    sending_queue: { enabled: true, queue_size: 2000 }
    retry_on_failure: { enabled: true, max_elapsed_time: 120s }
  otlphttp/container-logs:
    endpoint: ${env:OBSERVE_OTLP_ENDPOINT}
    auth: { authenticator: basicauth/openobserve }
    headers:
      stream-name: containers
    sending_queue: { enabled: true, queue_size: 2000 }
    retry_on_failure: { enabled: true, max_elapsed_time: 120s }

service:
  extensions: [health_check, basicauth/openobserve]
  telemetry:
    logs: { level: warn }
    # The collector's own export failures and queue sizes, through its own OTLP receiver.
    metrics:
      level: basic
      readers:
        - periodic:
            interval: 30000
            exporter:
              otlp:
                protocol: http/protobuf
                endpoint: http://localhost:4318/v1/metrics
  pipelines:
    traces/ingest:
      receivers: [otlp]
      processors: [memory_limiter, filter/health, attributes/scrub, transform/scrub, transform/product]
      exporters: [spanmetrics, forward/sample]
    traces/sample:
      receivers: [forward/sample]
      processors: [tail_sampling, batch]
      exporters: [otlphttp/openobserve]
    metrics:
      receivers: [otlp, spanmetrics]
      processors: [memory_limiter, attributes/scrub, batch]
      exporters: [otlphttp/openobserve]
    logs/app:
      receivers: [otlp]
      processors: [memory_limiter, attributes/scrub, transform/scrub, batch]
      exporters: [otlphttp/app-logs]
    logs/containers:
      receivers: [fluentforward]
      processors: [memory_limiter, transform/scrub, transform/product, batch]
      exporters: [otlphttp/container-logs]
```

The `&scrub_attributes` anchor documents that the log list repeats it. If the YAML loader rejects an unused anchor, remove the `&scrub_attributes` token.

- [ ] **Step 4: Run the tests**

Run: `scripts/remote-test.sh unit tests/observability/collector-config.test.ts`, then `scripts/remote-test.sh integration tests/observability/collector-config.int.test.ts`
Expected: PASS. If `validate` rejects a statement, fix it against OTTL 0.162 (`replace_all_patterns`, `replace_pattern`, `IsMatch`, `Concat`, `delete_key`) without weakening a pattern.

- [ ] **Step 5: Commit**

```bash
git add infra/otel tests/observability/collector-config.test.ts tests/observability/collector-config.int.test.ts
git commit -m "feat(infra): OTel Collector with scrub, product transform, spanmetrics and tail sampling (D50)" -- infra/otel tests/observability/collector-config.test.ts tests/observability/collector-config.int.test.ts
```

---

### Task B4: Provisioning: users, streams and retention, alert delivery

**Files:**
- Create: `packages/observability/src/provision.ts`, `src/provision.test.ts`, `src/provision.int.test.ts`
- Modify: `packages/observability/src/index.ts`

**Interfaces:**
- Consumes: B1 (`O2Client`, `O2Error`, `o2Paths`, `O2_ROLES`, `UserList`, `O2_TEMPLATE_RULE_VARIABLE`), Task 0 (`OBSERVE_USERS`, `LOG_STREAMS`, `TRACE_STREAM`, `RETENTION_DAYS`).
- Produces:
  - `provisionUsers(client, passwords: { ingest: string; viewer: string }): Promise<void>`;
  - `provisionStreams(client): Promise<void>`;
  - `provisionAlertDelivery(client, webhook: { url: string; secret: string }): Promise<void>`;
  - `ALERT_TEMPLATE_NAME = "mastertutor-webhook"`, `ALERT_DESTINATION_NAME = "mastertutor-web"`;
  - `alertTemplateBody(): string`.

- [ ] **Step 1: Write the failing tests**

`packages/observability/src/provision.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createO2Client } from "./client.ts";
import {
  ALERT_DESTINATION_NAME,
  ALERT_TEMPLATE_NAME,
  alertTemplateBody,
  provisionAlertDelivery,
  provisionStreams,
  provisionUsers,
} from "./provision.ts";

function fakeO2(existingUsers: string[] = []) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const client = createO2Client({
    baseUrl: "http://o2",
    email: "root",
    password: "pw",
    fetchImpl: async (url, init) => {
      const path = String(url).slice("http://o2".length);
      calls.push({ method: init!.method!, path, body: init!.body ? JSON.parse(String(init!.body)) : undefined });
      if (init!.method === "GET" && path === "/api/default/users")
        return Response.json({ data: existingUsers.map((email) => ({ email })) });
      if (init!.method === "POST" && /\/streams\//.test(path)) return new Response("exists", { status: 400 });
      return Response.json({});
    },
  });
  return { client, calls };
}

describe("provisioning (spec §11)", () => {
  it("creates missing users and updates existing ones, with the pinned roles", async () => {
    const { client, calls } = fakeO2(["ingest@mastertutor.internal"]);
    await provisionUsers(client, { ingest: "i".repeat(40), viewer: "v".repeat(40) });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/default/users",
      "PUT /api/default/users/ingest%40mastertutor.internal",
      "POST /api/default/users",
    ]);
    expect(calls[2]!.body).toMatchObject({ email: "viewer@mastertutor.internal", role: "member" });
  });

  it("sets 30 d on both log streams and 15 d on traces, creating them when needed", async () => {
    const { client, calls } = fakeO2();
    await provisionStreams(client);
    const settings = calls.filter((c) => c.path.includes("/settings"));
    expect(settings.map((c) => [c.path, c.body])).toEqual([
      ["/api/default/streams/mastertutor/settings?type=logs", { data_retention: 30 }],
      ["/api/default/streams/containers/settings?type=logs", { data_retention: 30 }],
      ["/api/default/streams/default/settings?type=traces", { data_retention: 15 }],
    ]);
  });

  it("sends only the rule name to web, with the bearer secret in a header", async () => {
    const { client, calls } = fakeO2();
    await provisionAlertDelivery(client, { url: "http://web:3000/api/alerts/webhook", secret: "s".repeat(40) });
    expect(alertTemplateBody()).toBe('{"rule":"{alert_name}"}');
    const template = calls.find((c) => c.path.includes("/templates"))!;
    expect(template.body).toMatchObject({ name: ALERT_TEMPLATE_NAME, body: alertTemplateBody() });
    const destination = calls.find((c) => c.path.includes("/destinations"))!;
    expect(destination.body).toMatchObject({
      name: ALERT_DESTINATION_NAME,
      url: "http://web:3000/api/alerts/webhook",
      method: "post",
      template: ALERT_TEMPLATE_NAME,
      headers: { Authorization: `Bearer ${"s".repeat(40)}` },
    });
  });
});
```

`packages/observability/src/provision.int.test.ts`:

```ts
import { OBSERVE_USERS } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createO2Client } from "./client.ts";
import { o2Paths } from "./o2-api.ts";
import { provisionAlertDelivery, provisionStreams, provisionUsers } from "./provision.ts";
import { startTestOpenObserve, type TestOpenObserve } from "./testing.ts";

let o2: TestOpenObserve;
beforeAll(async () => {
  o2 = await startTestOpenObserve();
}, 180_000);
afterAll(async () => {
  await o2?.stop();
});

describe("provisioning against the pinned image", () => {
  it("is idempotent and leaves a working viewer", async () => {
    const passwords = { ingest: "i".repeat(40), viewer: "v".repeat(40) };
    for (let run = 0; run < 2; run++) {
      await provisionUsers(o2.root, passwords);
      await provisionStreams(o2.root);
      await provisionAlertDelivery(o2.root, { url: "http://web:3000/api/alerts/webhook", secret: "s".repeat(40) });
    }
    const viewer = createO2Client({ baseUrl: o2.baseUrl, email: OBSERVE_USERS.viewer, password: passwords.viewer });
    await expect(viewer.call("listStreams", "GET", `/api/${viewer.org}/streams`)).resolves.toBeDefined();
    await expect(o2.root.call("health", "GET", o2Paths.health())).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/observability/src/provision.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `packages/observability/src/provision.ts`**

```ts
import { OBSERVE_USERS } from "@mastertutor/contracts";
import { LOG_STREAMS, RETENTION_DAYS, TRACE_STREAM } from "@mastertutor/contracts/telemetry";
import { O2Error, type O2Client } from "./client.ts";
import { O2_ROLES, O2_TEMPLATE_RULE_VARIABLE, UserList, o2Paths, type StreamType } from "./o2-api.ts";

export const ALERT_TEMPLATE_NAME = "mastertutor-webhook";
export const ALERT_DESTINATION_NAME = "mastertutor-web";

/** The webhook body (spec §13.2): the rule's name only, never counts, rows or query text. */
export function alertTemplateBody(): string {
  return `{"rule":"${O2_TEMPLATE_RULE_VARIABLE}"}`;
}

export async function provisionUsers(
  client: O2Client,
  passwords: { ingest: string; viewer: string },
): Promise<void> {
  const existing = new Set(
    (await client.call("listUsers", "GET", o2Paths.users(client.org), undefined, UserList)).data.map(
      (user) => user.email,
    ),
  );
  for (const [who, email] of [
    ["ingest", OBSERVE_USERS.ingest],
    ["viewer", OBSERVE_USERS.viewer],
  ] as const) {
    const body = { password: passwords[who], role: O2_ROLES[who], first_name: who, last_name: "mastertutor" };
    if (existing.has(email)) await client.call("updateUser", "PUT", o2Paths.user(client.org, email), body);
    else await client.call("createUser", "POST", o2Paths.users(client.org), { email, ...body });
  }
}

async function retention(client: O2Client, name: string, type: StreamType, days: number) {
  // Creating an existing stream is refused; that is fine, its settings are set either way.
  await client
    .call("createStream", "POST", o2Paths.stream(client.org, name, type), { data_retention: days })
    .catch((error: unknown) => {
      if (!(error instanceof O2Error) || error.status >= 500) throw error;
    });
  await client.call("streamSettings", "PUT", o2Paths.streamSettings(client.org, name, type), {
    data_retention: days,
  });
}

/** Logs 30 d, traces 15 d (spec §11); metrics use the global 90 d (ZO_COMPACT_DATA_RETENTION_DAYS). */
export async function provisionStreams(client: O2Client): Promise<void> {
  await retention(client, LOG_STREAMS.app, "logs", RETENTION_DAYS.logs);
  await retention(client, LOG_STREAMS.containers, "logs", RETENTION_DAYS.logs);
  await retention(client, TRACE_STREAM, "traces", RETENTION_DAYS.traces);
}

async function upsert(client: O2Client, kind: string, collection: string, item: string, body: object) {
  try {
    await client.call(`update${kind}`, "PUT", item, body);
  } catch (error) {
    if (!(error instanceof O2Error) || error.status !== 404) throw error;
    await client.call(`create${kind}`, "POST", collection, body);
  }
}

export async function provisionAlertDelivery(
  client: O2Client,
  webhook: { url: string; secret: string },
): Promise<void> {
  await upsert(client, "Template", o2Paths.templates(client.org), o2Paths.template(client.org, ALERT_TEMPLATE_NAME), {
    name: ALERT_TEMPLATE_NAME,
    body: alertTemplateBody(),
    type: "http",
    isDefault: false,
  });
  await upsert(
    client,
    "Destination",
    o2Paths.destinations(client.org),
    o2Paths.destination(client.org, ALERT_DESTINATION_NAME),
    {
      name: ALERT_DESTINATION_NAME,
      type: "http",
      url: webhook.url,
      method: "post",
      skip_tls_verify: false,
      template: ALERT_TEMPLATE_NAME,
      headers: { Authorization: `Bearer ${webhook.secret}` },
    },
  );
}
```

The unit test's fake answers PUT with 200, so `upsert` updates. In the integration test, the first PUT on a missing template returns 404 and falls back to POST. If the pinned image returns a different status for a missing item, adjust `upsert`'s check and record that in `o2-api.ts`.

Add `export * from "./provision.ts";` to `src/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `scripts/remote-test.sh unit packages/observability`, then `scripts/remote-test.sh integration packages/observability/src/provision.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(observability): provision users, stream retention and alert delivery (D50)" -- packages/observability/src/provision.ts packages/observability/src/provision.test.ts packages/observability/src/provision.int.test.ts packages/observability/src/index.ts
```

---

### Task B5: Dashboards as code

**Files:**
- Create: `packages/observability/src/dashboards/build.ts`, `src/dashboards/queries.ts`, `src/dashboards/catalog.ts`, `src/dashboards/upsert.ts`, `src/dashboards/dashboards.test.ts`, `src/dashboards/upsert.int.test.ts`
- Modify: `packages/observability/src/index.ts`

**Interfaces:**
- Consumes: B1 (`o2StreamName`, `o2Label`, `o2Paths`, `DashboardList`, `dashboardRef`, `O2Client`), Task 0 (`METRIC`, `ATTR`, `DERIVED_METRIC`, `SPAN`, `LOG_STREAMS`, `TRACE_STREAM`).
- Produces:
  - `Panel`, `DashboardSpec`, `toO2Dashboard(spec: DashboardSpec): Record<string, unknown>`;
  - `DASHBOARDS: readonly DashboardSpec[]` (six, titled "MasterTutor · System health", "MasterTutor · Runs and agent", "MasterTutor · Model and spend", "MasterTutor · Capture fidelity", "MasterTutor · Slots and live view" and "MasterTutor · Errors");
  - `upsertDashboards(client, dashboards?): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`packages/observability/src/dashboards/dashboards.test.ts`:

```ts
import { ATTR, DERIVED_METRIC, METRIC } from "@mastertutor/contracts/telemetry";
import { describe, expect, it } from "vitest";
import { o2Label, o2StreamName } from "../names.ts";
import { DASHBOARDS } from "./catalog.ts";
import { toO2Dashboard } from "./build.ts";

const knownStreams = new Set<string>([
  ...Object.values(METRIC).map((m) => o2StreamName(m.name)),
  ...Object.values(DERIVED_METRIC).flatMap((name) => [o2StreamName(name), `${o2StreamName(name)}_bucket`]),
]);
const knownLabels = new Set<string>([...Object.values(ATTR).map(o2Label), "span_name", "status_code", "service_name", "le"]);

describe("dashboards as code (spec §8, §11)", () => {
  it("has the six dashboards the spec names", () => {
    expect(DASHBOARDS.map((d) => d.title)).toEqual([
      "MasterTutor · System health",
      "MasterTutor · Runs and agent",
      "MasterTutor · Model and spend",
      "MasterTutor · Capture fidelity",
      "MasterTutor · Slots and live view",
      "MasterTutor · Errors",
    ]);
  });

  it("references only registered metrics and labels", () => {
    for (const dashboard of DASHBOARDS)
      for (const panel of dashboard.panels) {
        if (panel.query.type !== "promql") continue;
        for (const [token] of panel.query.expr.matchAll(/\bmt_[a-z_]+/g)) {
          const stream = knownStreams.has(token);
          const label = knownLabels.has(token);
          expect(stream || label, `${dashboard.title} / ${panel.title}: ${token}`).toBe(true);
        }
      }
  });

  it("never queries a run id, an alias or a user", () => {
    const text = JSON.stringify(DASHBOARDS.map(toO2Dashboard));
    expect(text).not.toContain(o2Label(ATTR.runId));
    expect(text).not.toContain(o2Label(ATTR.vaultAlias));
  });

  it("builds an OpenObserve dashboard with one tab and laid-out panels", () => {
    const built = toO2Dashboard(DASHBOARDS[1]!) as { title: string; tabs: Array<{ panels: unknown[] }> };
    expect(built.title).toBe("MasterTutor · Runs and agent");
    expect(built.tabs[0]!.panels.length).toBe(DASHBOARDS[1]!.panels.length);
  });
});
```

`packages/observability/src/dashboards/upsert.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DashboardList, dashboardRef, o2Paths } from "../o2-api.ts";
import { startTestOpenObserve, type TestOpenObserve } from "../testing.ts";
import { DASHBOARDS } from "./catalog.ts";
import { upsertDashboards } from "./upsert.ts";

let o2: TestOpenObserve;
beforeAll(async () => {
  o2 = await startTestOpenObserve();
}, 180_000);
afterAll(async () => {
  await o2?.stop();
});

describe("upsertDashboards against the pinned image", () => {
  it("creates six dashboards once and updates them in place", async () => {
    await upsertDashboards(o2.root);
    await upsertDashboards(o2.root);
    const list = await o2.root.call("listDashboards", "GET", o2Paths.dashboards("default"), undefined, DashboardList);
    const titles = list.dashboards.map(dashboardRef).flatMap((ref) => (ref ? [ref.title] : []));
    for (const dashboard of DASHBOARDS) expect(titles.filter((t) => t === dashboard.title)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/observability/src/dashboards`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the builder and query helpers**

`packages/observability/src/dashboards/build.ts`:

```ts
export type PanelKind = "line" | "bar" | "table" | "metric";
export type PanelQuery =
  | { type: "promql"; expr: string }
  | { type: "sql"; stream: string; streamType: "logs" | "traces"; sql: string };

export interface Panel {
  title: string;
  kind: PanelKind;
  query: PanelQuery;
}

export interface DashboardSpec {
  title: string;
  description: string;
  panels: readonly Panel[];
}

const COLUMNS = 48;
const WIDTH = 24;
const HEIGHT = 9;

/** OpenObserve's dashboard JSON (shape pinned by upsert.int.test.ts against the digest). */
export function toO2Dashboard(spec: DashboardSpec): Record<string, unknown> {
  return {
    version: 5,
    title: spec.title,
    description: spec.description,
    defaultDatetimeDuration: { type: "relative", relativeTimePeriod: "24h", startTime: 0, endTime: 0 },
    variables: { list: [] },
    tabs: [
      {
        tabId: "default",
        name: "Default",
        panels: spec.panels.map((panel, index) => ({
          id: `panel_${index + 1}`,
          type: panel.kind,
          title: panel.title,
          description: "",
          config: { show_legends: true, decimals: 2 },
          queryType: panel.query.type,
          queries: [
            {
              query: panel.query.type === "promql" ? panel.query.expr : panel.query.sql,
              customQuery: true,
              fields: {
                stream: panel.query.type === "sql" ? panel.query.stream : "",
                stream_type: panel.query.type === "sql" ? panel.query.streamType : "metrics",
                x: [],
                y: [],
                z: [],
                filter: [],
              },
              config: { promql_legend: "" },
            },
          ],
          layout: {
            x: (index % (COLUMNS / WIDTH)) * WIDTH,
            y: Math.floor(index / (COLUMNS / WIDTH)) * HEIGHT,
            w: WIDTH,
            h: HEIGHT,
            i: index + 1,
          },
        })),
      },
    ],
  };
}
```

`packages/observability/src/dashboards/queries.ts`:

```ts
import { DERIVED_METRIC, type AttributeName, type MetricSpec, type SpanName } from "@mastertutor/contracts/telemetry";
import { o2Label, o2StreamName } from "../names.ts";

const by = (labels: readonly (AttributeName | "span_name" | "service_name" | "status_code")[]) =>
  labels.length === 0
    ? ""
    : ` by (${labels.map((l) => (l.startsWith("mt.") ? o2Label(l) : l)).join(", ")})`;

/** Counter increase over a window, summed by labels. */
export function increase(metric: MetricSpec, labels: readonly AttributeName[] = [], window = "5m", filter = ""): string {
  return `sum${by(labels)} (increase(${o2StreamName(metric.name)}${filter ? `{${filter}}` : ""}[${window}]))`;
}

export function gauge(metric: MetricSpec, labels: readonly AttributeName[] = []): string {
  return `sum${by(labels)} (${o2StreamName(metric.name)})`;
}

const calls = o2StreamName(DERIVED_METRIC.spanCalls);
const duration = `${o2StreamName(DERIVED_METRIC.spanDuration)}_bucket`;
const spanFilter = (span: SpanName, extra = "") => `span_name="${span}"${extra ? `, ${extra}` : ""}`;

/** Calls per 5 min of one product span, split by labels (spanmetrics, spec §5.3). */
export function spanCalls(span: SpanName, labels: readonly (AttributeName | "status_code")[] = [], extra = ""): string {
  return `sum${by(labels)} (increase(${calls}{${spanFilter(span, extra)}}[5m]))`;
}

/** Error rate of one product span (0..1). */
export function spanErrorRate(span: SpanName, labels: readonly AttributeName[] = []): string {
  return `${spanCalls(span, labels, `status_code="STATUS_CODE_ERROR"`)} / ${spanCalls(span, labels)}`;
}

/** A latency quantile in ms of one product span. */
export function spanQuantile(q: number, span: SpanName, labels: readonly AttributeName[] = []): string {
  return `histogram_quantile(${q}, sum${by(["le" as AttributeName, ...labels])} (rate(${duration}{${spanFilter(span)}}[5m])))`;
}

/** p95 of outgoing HTTP by dependency (set by the collector). */
export function dependencyP95(): string {
  return `histogram_quantile(0.95, sum by (le, ${o2Label("mt.dependency")}) (rate(${duration}{${o2Label("mt.dependency")}!=""}[5m])))`;
}
```

In `by`, `"le"` is passed through unchanged, because it does not start with `mt.`. The cast keeps the label union small.

- [ ] **Step 4: Write `packages/observability/src/dashboards/catalog.ts`**

```ts
import { ATTR, LOG_STREAMS, METRIC, SPAN, TRACE_STREAM } from "@mastertutor/contracts/telemetry";
import type { DashboardSpec } from "./build.ts";
import { dependencyP95, gauge, increase, spanCalls, spanErrorRate, spanQuantile } from "./queries.ts";

const logErrors = (stream: string, by: string) => ({
  type: "sql" as const,
  stream,
  streamType: "logs" as const,
  sql: `SELECT histogram(_timestamp) AS x_axis_1, ${by} AS y_axis_2, count(*) AS y_axis_1 FROM "${stream}" WHERE severity_text IN ('ERROR', 'FATAL') GROUP BY x_axis_1, y_axis_2 ORDER BY x_axis_1`,
});
const containerErrors = {
  type: "sql" as const,
  stream: LOG_STREAMS.containers,
  streamType: "logs" as const,
  sql: `SELECT histogram(_timestamp) AS x_axis_1, mt_service AS y_axis_2, count(*) AS y_axis_1 FROM "${LOG_STREAMS.containers}" WHERE str_match_ignore_case(body, 'error') GROUP BY x_axis_1, y_axis_2 ORDER BY x_axis_1`,
};

export const DASHBOARDS: readonly DashboardSpec[] = [
  {
    title: "MasterTutor · System health",
    description: "Errors, dependencies and the telemetry pipeline itself (D50).",
    panels: [
      { title: "Span error rate by service", kind: "line", query: { type: "promql", expr: `sum by (service_name) (increase(mt_span_calls{status_code="STATUS_CODE_ERROR"}[5m])) / sum by (service_name) (increase(mt_span_calls[5m]))` } },
      { title: "Dependency p95 (ms)", kind: "line", query: { type: "promql", expr: dependencyP95() } },
      { title: "Telemetry dropped", kind: "bar", query: { type: "promql", expr: increase(METRIC.telemetryDropped, [ATTR.telemetrySignal, ATTR.dropReason]) } },
      { title: "Container log errors", kind: "bar", query: containerErrors },
    ],
  },
  {
    title: "MasterTutor · Runs and agent",
    description: "Runs, steps per phase, tools, approvals and takeovers.",
    panels: [
      { title: "Runs ended", kind: "bar", query: { type: "promql", expr: increase(METRIC.runsEnded, [ATTR.runStatus], "1h") } },
      { title: "Active runs", kind: "line", query: { type: "promql", expr: gauge(METRIC.activeRuns) } },
      { title: "Step p50 by phase (ms)", kind: "line", query: { type: "promql", expr: spanQuantile(0.5, SPAN.step, [ATTR.stepPhase]) } },
      { title: "Step p95 by phase (ms)", kind: "line", query: { type: "promql", expr: spanQuantile(0.95, SPAN.step, [ATTR.stepPhase]) } },
      { title: "Step outcomes", kind: "bar", query: { type: "promql", expr: spanCalls(SPAN.step, [ATTR.stepOutcome]) } },
      { title: "Tool calls", kind: "bar", query: { type: "promql", expr: spanCalls(SPAN.tool, [ATTR.toolName]) } },
      { title: "Tool error rate", kind: "line", query: { type: "promql", expr: spanErrorRate(SPAN.tool, [ATTR.toolName]) } },
      { title: "Tool p95 (ms)", kind: "line", query: { type: "promql", expr: spanQuantile(0.95, SPAN.tool, [ATTR.toolName]) } },
      { title: "Approvals requested", kind: "bar", query: { type: "promql", expr: increase(METRIC.approvalsRequested, [ATTR.approvalKind], "1h") } },
      { title: "Approvals resolved", kind: "bar", query: { type: "promql", expr: increase(METRIC.approvalsResolved, [ATTR.approvalStatus, ATTR.approvalDecider], "1h") } },
    ],
  },
  {
    title: "MasterTutor · Model and spend",
    description: "Spend, tokens, model latency, fallbacks and rejections.",
    panels: [
      { title: "Spend per hour (USD)", kind: "bar", query: { type: "promql", expr: increase(METRIC.spendUsd, [], "1h") } },
      { title: "Spend per day (USD)", kind: "metric", query: { type: "promql", expr: increase(METRIC.spendUsd, [], "24h") } },
      { title: "Tokens by model and type", kind: "line", query: { type: "promql", expr: increase(METRIC.modelTokens, [ATTR.modelName, ATTR.tokenType]) } },
      { title: "Model request p95 (ms)", kind: "line", query: { type: "promql", expr: spanQuantile(0.95, SPAN.modelRequest, [ATTR.modelName]) } },
      { title: "Fallbacks", kind: "bar", query: { type: "promql", expr: increase(METRIC.modelFallbacks, [ATTR.modelName], "1h") } },
      { title: "Model failures by code", kind: "bar", query: { type: "promql", expr: spanCalls(SPAN.modelRequest, [ATTR.errorCode], `status_code="STATUS_CODE_ERROR"`) } },
      { title: "Budget hits", kind: "bar", query: { type: "promql", expr: increase(METRIC.budgetHits, [], "1h") } },
    ],
  },
  {
    title: "MasterTutor · Capture fidelity",
    description: "Capture verdicts, blocks and filing.",
    panels: [
      { title: "Captures by fidelity", kind: "bar", query: { type: "promql", expr: spanCalls(SPAN.tool, [ATTR.captureFidelity], `mt_tool_name="capture"`) } },
      { title: "Capture p95 (ms)", kind: "line", query: { type: "promql", expr: spanQuantile(0.95, SPAN.tool, [ATTR.captureFidelity]) } },
      { title: "Blocks added", kind: "bar", query: { type: "promql", expr: increase(METRIC.blocksAdded, [ATTR.blockType, ATTR.blockOrigin], "1h") } },
      { title: "Notes filed", kind: "bar", query: { type: "promql", expr: increase(METRIC.notesFiled, [ATTR.filedBy], "1h") } },
    ],
  },
  {
    title: "MasterTutor · Slots and live view",
    description: "Slot states, leases, resets, takeovers and live streams.",
    panels: [
      { title: "Slots by state", kind: "line", query: { type: "promql", expr: gauge(METRIC.slots, [ATTR.slotState]) } },
      { title: "Slot leases", kind: "bar", query: { type: "promql", expr: increase(METRIC.slotLeases, [ATTR.slotOutcome], "1h") } },
      { title: "Slot reset p95 (ms)", kind: "line", query: { type: "promql", expr: spanQuantile(0.95, SPAN.slotReset, [ATTR.slotName]) } },
      { title: "Slot reset timeouts", kind: "bar", query: { type: "promql", expr: spanCalls(SPAN.slotReset, [ATTR.slotName], `status_code="STATUS_CODE_ERROR"`) } },
      { title: "Takeovers by outcome", kind: "bar", query: { type: "promql", expr: spanCalls(SPAN.takeover, [ATTR.takeoverOutcome]) } },
      { title: "Takeover p95 (ms)", kind: "line", query: { type: "promql", expr: spanQuantile(0.95, SPAN.takeover) } },
      { title: "Run event streams open", kind: "line", query: { type: "promql", expr: gauge(METRIC.sseConnections) } },
      { title: "Browser container errors", kind: "bar", query: containerErrors },
    ],
  },
  {
    title: "MasterTutor · Errors",
    description: "Every error by product code, span and log stream.",
    panels: [
      { title: "Run failures by code", kind: "bar", query: { type: "promql", expr: increase(METRIC.runFailures, [ATTR.errorCode], "1h") } },
      { title: "Run errors by code", kind: "bar", query: { type: "promql", expr: increase(METRIC.runErrors, [ATTR.errorCode], "1h") } },
      { title: "Error spans by code", kind: "table", query: { type: "promql", expr: `sum by (span_name, ${"mt_error_code"}) (increase(mt_span_calls{status_code="STATUS_CODE_ERROR"}[1h]))` } },
      { title: "App log errors by service", kind: "bar", query: logErrors(LOG_STREAMS.app, "service") },
      { title: "Container log errors by service", kind: "bar", query: containerErrors },
      { title: "Slow or failed traces", kind: "table", query: { type: "sql", stream: TRACE_STREAM, streamType: "traces", sql: `SELECT trace_id, operation_name, duration, mt_error_code FROM "${TRACE_STREAM}" WHERE span_status = 'ERROR' OR duration > 15000000 ORDER BY _timestamp DESC LIMIT 50` } },
    ],
  },
];
```

`packages/observability/src/dashboards/upsert.ts`:

```ts
import type { O2Client } from "../client.ts";
import { DashboardList, dashboardRef, o2Paths } from "../o2-api.ts";
import { toO2Dashboard, type DashboardSpec } from "./build.ts";
import { DASHBOARDS } from "./catalog.ts";

/** Creates each dashboard by title, or replaces it in place (UI edits are overwritten, spec §18). */
export async function upsertDashboards(
  client: O2Client,
  dashboards: readonly DashboardSpec[] = DASHBOARDS,
): Promise<void> {
  const list = await client.call("listDashboards", "GET", o2Paths.dashboards(client.org), undefined, DashboardList);
  const existing = new Map(
    list.dashboards.flatMap((entry) => {
      const ref = dashboardRef(entry);
      return ref ? [[ref.title, ref] as const] : [];
    }),
  );
  for (const spec of dashboards) {
    const body = toO2Dashboard(spec);
    const ref = existing.get(spec.title);
    if (ref) await client.call("updateDashboard", "PUT", o2Paths.dashboard(client.org, ref.id, ref.hash), body);
    else await client.call("createDashboard", "POST", o2Paths.dashboards(client.org), body);
  }
}
```

Add these to `src/index.ts`:

```ts
export * from "./dashboards/build.ts";
export { DASHBOARDS } from "./dashboards/catalog.ts";
export { upsertDashboards } from "./dashboards/upsert.ts";
```

- [ ] **Step 5: Run the tests**

Run: `scripts/remote-test.sh unit packages/observability`, then `scripts/remote-test.sh integration packages/observability/src/dashboards/upsert.int.test.ts`
Expected: PASS. If the pinned image rejects the dashboard JSON, adjust `toO2Dashboard` only, and keep the panels. If the "references only registered metrics and labels" test flags `mt_error_code` written literally in the Errors panel, replace the literal with `${o2Label(ATTR.errorCode)}`.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(observability): six dashboards as code from the names registry (D50)" -- packages/observability/src/dashboards packages/observability/src/index.ts
```

---

### Task B6: Alerts as code

**Files:**
- Create: `packages/observability/src/alerts.ts`, `src/alerts.test.ts`, `src/alerts.int.test.ts`
- Modify: `packages/observability/src/index.ts`

**Interfaces:**
- Consumes: B1 (`O2Client`, `o2Paths`, `AlertList`), B4 (`ALERT_DESTINATION_NAME`), B5 (`increase`, `spanCalls`), Task 0 (`ALERT_RULES`, `AlertRule`, `METRIC`, `ATTR`, `SPAN`, `LOG_STREAMS`).
- Produces:
  - `AlertSpec`, `alertSpecs(options: { spendUsdPerHour: number }): Record<AlertRule, AlertSpec>`;
  - `toO2Alert(rule: AlertRule, spec: AlertSpec): Record<string, unknown>`;
  - `upsertAlerts(client, options: { spendUsdPerHour: number }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`packages/observability/src/alerts.test.ts`:

```ts
import { ALERT_RULES } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { alertSpecs, toO2Alert } from "./alerts.ts";
import { ALERT_DESTINATION_NAME } from "./provision.ts";

describe("alerts as code (spec §13.1)", () => {
  const specs = alertSpecs({ spendUsdPerHour: 25 });

  it("defines exactly the contract's rules", () => {
    expect(Object.keys(specs).sort()).toEqual([...ALERT_RULES].sort());
  });

  it("uses the registered streams and thresholds", () => {
    expect(specs.run_failed.query).toEqual({ type: "promql", expr: 'sum (increase(mt_runs_ended{mt_run_status="failed"}[5m]))' });
    expect(specs.model_request_rejected.query).toMatchObject({ expr: expect.stringContaining('mt_error_code="model_request_rejected"') });
    expect(specs.spend_jump.threshold).toBe(25);
    expect(specs.slot_crash_loop.threshold).toBe(3);
    expect(specs.error_spike).toMatchObject({ threshold: 20, periodMinutes: 5 });
  });

  it("names the alert after the rule and delivers to web with a 30 min silence", () => {
    const body = toO2Alert("run_failed", specs.run_failed) as Record<string, any>;
    expect(body.name).toBe("run_failed");
    expect(body.destinations).toEqual([ALERT_DESTINATION_NAME]);
    expect(body.trigger_condition).toMatchObject({ silence: 30, period: 5, threshold: 1 });
  });
});
```

`packages/observability/src/alerts.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertAlerts } from "./alerts.ts";
import { AlertList, o2Paths } from "./o2-api.ts";
import { provisionAlertDelivery, provisionStreams } from "./provision.ts";
import { startTestOpenObserve, type TestOpenObserve } from "./testing.ts";

let o2: TestOpenObserve;
beforeAll(async () => {
  o2 = await startTestOpenObserve();
  await provisionStreams(o2.root);
  await provisionAlertDelivery(o2.root, { url: "http://web:3000/api/alerts/webhook", secret: "s".repeat(40) });
}, 180_000);
afterAll(async () => {
  await o2?.stop();
});

describe("upsertAlerts against the pinned image", () => {
  it("creates the five alerts once", async () => {
    await upsertAlerts(o2.root, { spendUsdPerHour: 25 });
    await upsertAlerts(o2.root, { spendUsdPerHour: 30 });
    const list = await o2.root.call("listAlerts", "GET", o2Paths.alerts("default"), undefined, AlertList);
    expect(list.list.map((a) => a.name).sort()).toEqual([
      "error_spike",
      "model_request_rejected",
      "run_failed",
      "slot_crash_loop",
      "spend_jump",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit packages/observability/src/alerts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `packages/observability/src/alerts.ts`**

```ts
import type { AlertRule } from "@mastertutor/contracts";
import { ATTR, LOG_STREAMS, METRIC, SPAN } from "@mastertutor/contracts/telemetry";
import type { O2Client } from "./client.ts";
import { increase, spanCalls } from "./dashboards/queries.ts";
import { o2Label } from "./names.ts";
import { AlertList, o2Paths } from "./o2-api.ts";
import { ALERT_DESTINATION_NAME } from "./provision.ts";

export interface AlertSpec {
  description: string;
  query:
    | { type: "promql"; expr: string; stream: string }
    | { type: "sql"; stream: string; sql: string };
  /** Fires when the value is at least this. */
  threshold: number;
  periodMinutes: number;
}

const SILENCE_MINUTES = 30;
const metricStream = (name: string) => o2Label(name);

/** The five alert rules (spec §13.1). Their names are AlertRule, which web validates. */
export function alertSpecs(options: { spendUsdPerHour: number }): Record<AlertRule, AlertSpec> {
  return {
    error_spike: {
      description: "20 or more error lines in the app log within 5 minutes.",
      query: {
        type: "sql",
        stream: LOG_STREAMS.app,
        sql: `SELECT count(*) AS value FROM "${LOG_STREAMS.app}" WHERE severity_text IN ('ERROR', 'FATAL')`,
      },
      threshold: 20,
      periodMinutes: 5,
    },
    model_request_rejected: {
      description: "A run failed because the model rejected its request.",
      query: {
        type: "promql",
        stream: metricStream(METRIC.runFailures.name),
        expr: increase(METRIC.runFailures, [], "5m", `${o2Label(ATTR.errorCode)}="model_request_rejected"`),
      },
      threshold: 1,
      periodMinutes: 5,
    },
    run_failed: {
      description: "A run ended as failed.",
      query: {
        type: "promql",
        stream: metricStream(METRIC.runsEnded.name),
        expr: increase(METRIC.runsEnded, [], "5m", `${o2Label(ATTR.runStatus)}="failed"`),
      },
      threshold: 1,
      periodMinutes: 5,
    },
    slot_crash_loop: {
      description: "One browser slot failed to restart 3 times within 10 minutes.",
      query: {
        type: "promql",
        stream: "mt_span_calls",
        expr: `max(${spanCalls(SPAN.slotReset, [ATTR.slotName], `status_code="STATUS_CODE_ERROR"`).replace("[5m]", "[10m]")})`,
      },
      threshold: 3,
      periodMinutes: 10,
    },
    spend_jump: {
      description: `Committed spend rose by more than $${options.spendUsdPerHour} within an hour.`,
      query: { type: "promql", stream: metricStream(METRIC.spendUsd.name), expr: increase(METRIC.spendUsd, [], "60m") },
      threshold: options.spendUsdPerHour,
      periodMinutes: 60,
    },
  };
}

/** OpenObserve v2 alert JSON (shape pinned by alerts.int.test.ts against the digest). */
export function toO2Alert(rule: AlertRule, spec: AlertSpec): Record<string, unknown> {
  const promql = spec.query.type === "promql";
  return {
    name: rule,
    description: spec.description,
    stream_type: promql ? "metrics" : "logs",
    stream_name: spec.query.stream,
    is_real_time: false,
    enabled: true,
    query_condition: promql
      ? {
          type: "promql",
          promql: spec.query.expr,
          promql_condition: { column: "value", operator: ">=", value: spec.threshold },
          conditions: null,
          sql: null,
        }
      : { type: "sql", sql: spec.query.sql, conditions: null, promql: null, promql_condition: null },
    trigger_condition: {
      period: spec.periodMinutes,
      operator: ">=",
      threshold: promql ? 1 : spec.threshold,
      frequency: 1,
      frequency_type: "minutes",
      silence: SILENCE_MINUTES,
    },
    destinations: [ALERT_DESTINATION_NAME],
    context_attributes: {},
  };
}

export async function upsertAlerts(client: O2Client, options: { spendUsdPerHour: number }): Promise<void> {
  const existing = new Map(
    (await client.call("listAlerts", "GET", o2Paths.alerts(client.org), undefined, AlertList)).list.map(
      (alert) => [alert.name, alert.alert_id] as const,
    ),
  );
  for (const [rule, spec] of Object.entries(alertSpecs(options)) as Array<[AlertRule, AlertSpec]>) {
    const body = toO2Alert(rule, spec);
    const id = existing.get(rule);
    if (id) await client.call("updateAlert", "PUT", o2Paths.alert(client.org, id), body);
    else await client.call("createAlert", "POST", o2Paths.alerts(client.org), body);
  }
}
```

For PromQL alerts, the expression's value is compared through `promql_condition`, and `trigger_condition.threshold` (1) counts the matching series. For SQL alerts, the trigger threshold is the row count. If the pinned image models this differently, fix `toO2Alert` only.

The `increase` helper produces `sum (increase(...))` when no labels are given. The unit test's expected string for `run_failed` matches that output. If the helper's spacing changes, update the test's literal to match `increase()` exactly.

Add `export * from "./alerts.ts";` to `src/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `scripts/remote-test.sh unit packages/observability`, then `scripts/remote-test.sh integration packages/observability/src/alerts.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(observability): five alert rules as code delivered to web (D50)" -- packages/observability/src/alerts.ts packages/observability/src/alerts.test.ts packages/observability/src/alerts.int.test.ts packages/observability/src/index.ts
```

---

### Task B7: Compose, the provisioning job, Traefik, host scripts and production rules

**Depends on:** B2 and B3; A3 (`register-agent.ts` exists); C2 (the routes the labels point at; only their paths from Task 0 are needed to write the labels).

**Files:**
- Create: `packages/observability/src/bin/observability-init.ts`, `infra/host/create-obs-network.sh`
- Modify:
  - `compose.yml`, `compose.prod.yml`, `tests/bench/compose.local.yml`, `scripts/bench-local.sh`, `Dockerfile` (the `runtime-build` install filter);
  - `infra/host/attach-traefik.sh`, `infra/deploy-runbook.md`;
  - `tests/compose/prod-mode.ts` (`prodModeProblems`), `tests/compose/prod-mode.test.ts`, `tests/compose/prod-overlay.int.test.ts`, `tests/deploy/host-scripts.int.test.ts`, `tests/deploy/check-env.int.test.ts` (switch the todo back).

**Interfaces:**
- Consumes: B1, B4, B5 and B6 (`createO2Client`, `waitForO2`, `provisionUsers`, `provisionStreams`, `provisionAlertDelivery`, `upsertDashboards`, `upsertAlerts`), Task 0 (`ObservabilityInitEnv`, `OBSERVE_USERS`, `observabilityRouterRule`, `observabilityForwardAuthAddress`).
- Produces:
  - services `otel-collector`, `openobserve` and `observability-init` (profile `observability`);
  - networks `telemetry`, `observe`, `observe-store`, `observe-edge` (prod: external `mastertutor-obs`) and `obs-ingest`;
  - the `fluentd` log driver on the workers in prod;
  - Traefik router `mastertutor-observability`;
  - `observabilityProblems(config)`, inside `prodModeProblems`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/compose/prod-mode.test.ts`:

```ts
describe("observability rules (D50)", () => {
  const withObservability = (): ComposeConfig => {
    const config = prodLike();
    config.services.openobserve = {
      image: "openobserve/openobserve:v1.0.4@sha256:d4a878fac1f6c56003764f7f2a1625668917388f167e222c8c810de3f54c56ba",
      environment: { ZO_TELEMETRY: "false" },
      networks: { observe: {}, "observe-store": {}, "observe-edge": {} },
      labels: {
        "traefik.http.routers.mastertutor-observability.middlewares":
          "mastertutor-observability-slash,mastertutor-observability-auth,mastertutor-live-headers",
      },
    };
    config.services["otel-collector"] = {
      ...hardened,
      ports: [{ target: 24224, published: "24224", host_ip: "127.0.0.1", protocol: "tcp" }],
      networks: { telemetry: {}, observe: {}, "obs-ingest": {} },
    };
    for (const n of ["telemetry", "observe", "observe-store", "observe-edge"]) config.networks[n] = { internal: true };
    return config;
  };

  it("accepts the observability stack as designed", () => {
    expect(prodModeProblems(withObservability())).toEqual([]);
  });

  it("refuses a public or unauthenticated OpenObserve and a collector port off loopback", () => {
    const config = withObservability();
    config.services.openobserve!.ports = [{ target: 5080, published: "5080" }];
    config.services.openobserve!.labels = {};
    config.services.openobserve!.image = "openobserve/openobserve:latest";
    config.services.openobserve!.environment = {};
    config.services["otel-collector"]!.ports = [{ target: 24224, published: "24224", host_ip: "0.0.0.0" }];
    config.networks.observe = { internal: false };
    expect(prodModeProblems(config)).toEqual([
      "openobserve.ports: must publish nothing (D50)",
      "openobserve.image: must be pinned by digest (D50)",
      "openobserve.ZO_TELEMETRY: must be false (D50)",
      "openobserve: its router must run mastertutor-observability-auth (D50)",
      "otel-collector.ports: only 127.0.0.1:24224 (D45, D50)",
      "networks.observe: must be internal (D50)",
    ]);
  });
});
```

In `tests/compose/prod-overlay.int.test.ts`, make these changes:

1. In "bounds every service's memory, CPU, processes and logs on the shared host (review I5)", replace the logging assertion with:

```ts
      if (CONTAINER_LOGS.test(name))
        expect(service.logging, name).toMatchObject({
          driver: "fluentd",
          options: {
            "fluentd-address": "127.0.0.1:24224",
            "fluentd-async": "true",
            mode: "non-blocking",
            "cache-max-size": expect.any(String),
            "cache-max-file": expect.any(String),
          },
        });
      else
        expect(service.logging, name).toMatchObject({
          driver: "json-file",
          options: { "max-size": expect.any(String), "max-file": expect.any(String) },
        });
```

   Declare it near the file's top:

```ts
/** D50: workers and slots log to the collector through Docker's fluentd driver (spec §9). */
const CONTAINER_LOGS = /^(browser-\d+|pdf-worker|audio-capture|docling)$/;
```

2. In "runs docling under the pdf profile …", change `expect(docling.logging).toMatchObject({ driver: "json-file" });` to `expect(docling.logging).toMatchObject({ driver: "fluentd" });`. In the same test, change the agent networks expectation to `["audio", "backend", "cdp", "pdf", "telemetry"]`.

3. Append:

```ts
describe("observability in production (D50)", () => {
  const obs = prod({}, ["pdf", "observability"]);

  it("routes /observability to OpenObserve only through owner ForwardAuth", () => {
    const labels = obs.services.openobserve!.labels!;
    expect(labels["traefik.http.routers.mastertutor-observability.rule"]).toBe(observabilityRouterRule("notes.example.org"));
    expect(labels["traefik.http.middlewares.mastertutor-observability-auth.forwardauth.address"]).toBe(
      observabilityForwardAuthAddress(),
    );
    expect(labels["traefik.http.middlewares.mastertutor-observability-auth.forwardauth.authResponseHeaders"]).toBe("Authorization,Cookie");
    expect(labels["traefik.docker.network"]).toBe("mastertutor-obs");
    expect(obs.services.openobserve!.ports ?? []).toEqual([]);
    expect(obs.networks["observe-edge"]).toMatchObject({ name: "mastertutor-obs", external: true });
  });

  it("points web and agent at the collector, and the agent preloads telemetry", () => {
    expect(env(obs.services.web).OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://otel-collector:4318");
    expect(env(obs.services.agent).OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://otel-collector:4318");
    expect(obs.services.agent!.command).toEqual([
      "node", "--import", "./packages/telemetry/src/register-agent.ts", "apps/agent/src/main.ts",
    ]);
  });

  it("keeps the workers' networks and empty env (final I8) while their logs reach the collector", () => {
    for (const name of ["pdf-worker", "audio-capture"]) expect(obs.services[name]!.environment ?? {}).toEqual({});
    expect(prodModeProblems(obs)).toEqual([]);
  });
});
```

Use the file's existing `prod()` and `env()` helpers. If `prod()` takes the domain differently, pass `DOMAIN=notes.example.org` the way the file's other tests do. Import `observabilityRouterRule` and `observabilityForwardAuthAddress` from `@mastertutor/contracts`.

In `tests/deploy/host-scripts.int.test.ts`, append a test following that file's existing pattern for `create-cdp-network.sh`: run `bash infra/host/create-obs-network.sh` with no arguments and expect it to print `would run: docker network create --internal mastertutor-obs` and to change nothing. Then run `bash infra/host/attach-traefik.sh --network obs` without `--yes` and expect `would run: docker network connect mastertutor-obs dokploy-traefik`. Stub `docker` the same way the file stubs it for the existing scripts.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit tests/compose/prod-mode.test.ts`, then `scripts/remote-test.sh integration tests/compose/prod-overlay.int.test.ts tests/deploy/host-scripts.int.test.ts`
Expected: FAIL. No observability rules or services exist yet.

- [ ] **Step 3: The provisioning job (`packages/observability/src/bin/observability-init.ts`)**

```ts
import { OBSERVE_USERS, ObservabilityInitEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { upsertAlerts } from "../alerts.ts";
import { createO2Client, waitForO2 } from "../client.ts";
import { upsertDashboards } from "../dashboards/upsert.ts";
import { provisionAlertDelivery, provisionStreams, provisionUsers } from "../provision.ts";

// One-shot (spec §11): idempotent, so every deploy re-applies users, retention, dashboards, alerts.
const env = parseEnv(ObservabilityInitEnv, process.env);
const log = createLogger({ service: "observability-init", level: env.LOG_LEVEL });
const root = createO2Client({ baseUrl: env.OBSERVE_URL, email: OBSERVE_USERS.root, password: env.OBSERVE_ROOT_PASSWORD });
await waitForO2(root);
await provisionUsers(root, { ingest: env.OBSERVE_INGEST_PASSWORD, viewer: env.OBSERVE_VIEWER_PASSWORD });
await provisionStreams(root);
await provisionAlertDelivery(root, { url: env.ALERT_WEBHOOK_URL, secret: env.ALERT_WEBHOOK_SECRET });
await upsertDashboards(root);
await upsertAlerts(root, { spendUsdPerHour: env.SPEND_ALERT_USD_PER_HOUR });
log.info({ dashboards: 6, alerts: 5 }, "observability ready");
```

In `Dockerfile`, in the `runtime-build` stage, change the install filter to `--filter "@mastertutor/agent..." --filter "@mastertutor/observability..."`, so `zod` is installed for the job.

- [ ] **Step 4: `compose.yml`**

In `web`:

- add to `environment`:

```yaml
      OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-}
      MT_DEPLOYMENT: ${MT_DEPLOYMENT:-production}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      ALERT_WEBHOOK_SECRET: ${ALERT_WEBHOOK_SECRET:-}
      OBSERVE_VIEWER_PASSWORD: ${OBSERVE_VIEWER_PASSWORD:-}
```

- add to `networks`: `telemetry: {}` and `observe: {}`.

In `agent`:

- set `command: ["node", "--import", "./packages/telemetry/src/register-agent.ts", "apps/agent/src/main.ts"]`;
- add `OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-}` and `MT_DEPLOYMENT: ${MT_DEPLOYMENT:-production}` to `environment`;
- add `telemetry: {}` to `networks`.

In `garage`, change `networks` to a map: `backend: {}` and `observe-store: {}`.

In `garage-init`, add to `environment`:

```yaml
      S3_OBSERVE_BUCKET: observability
      S3_OBSERVE_ACCESS_KEY_ID: ${S3_OBSERVE_ACCESS_KEY_ID:-}
      S3_OBSERVE_SECRET_ACCESS_KEY: ${S3_OBSERVE_SECRET_ACCESS_KEY:-}
```

Add these services, before `browser-1`:

```yaml
  # Telemetry pipeline (D50, spec §10). Profile `observability`: test stacks never run it, and
  # nothing waits on it; web and agent export to it only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.162.0@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6
    profiles: ["observability"]
    restart: unless-stopped
    command: ["--config=/etc/otelcol/config.yaml"]
    user: "10001:10001"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 512m
    cpus: 0.5
    pids_limit: 128
    environment:
      OBSERVE_INGEST_PASSWORD: ${OBSERVE_INGEST_PASSWORD:-}
      OBSERVE_OTLP_ENDPOINT: http://openobserve:5080/observability/api/default
    volumes:
      - ./infra/otel/collector.yaml:/etc/otelcol/config.yaml:ro
    # The Docker daemon's fluentd log driver connects here (spec §9); loopback only (D45).
    ports:
      - "127.0.0.1:24224:24224/tcp"
    networks:
      telemetry: {}
      observe: {}
      obs-ingest: {}

  # Storage, search and dashboards (spec §11). Internal only: its one route in is Traefik's
  # owner-only /observability router (compose.prod.yml).
  openobserve:
    image: openobserve/openobserve:v1.0.4@sha256:d4a878fac1f6c56003764f7f2a1625668917388f167e222c8c810de3f54c56ba
    profiles: ["observability"]
    restart: unless-stopped
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 2g
    cpus: 1
    pids_limit: 256
    environment:
      ZO_ROOT_USER_EMAIL: root@mastertutor.internal
      ZO_ROOT_USER_PASSWORD: ${OBSERVE_ROOT_PASSWORD:-}
      ZO_DATA_DIR: /data
      ZO_LOCAL_MODE: "true"
      ZO_LOCAL_MODE_STORAGE: s3
      ZO_S3_PROVIDER: s3
      ZO_S3_SERVER_URL: http://garage:3900
      ZO_S3_REGION_NAME: garage
      ZO_S3_BUCKET_NAME: observability
      ZO_S3_ACCESS_KEY: ${S3_OBSERVE_ACCESS_KEY_ID:-}
      ZO_S3_SECRET_KEY: ${S3_OBSERVE_SECRET_ACCESS_KEY:-}
      ZO_BASE_URI: /observability
      ZO_WEB_URL: ${PUBLIC_URL:?set PUBLIC_URL}/observability
      ZO_TELEMETRY: "false"
      ZO_COOKIE_SECURE_ONLY: "true"
      ZO_COMPACT_DATA_RETENTION_DAYS: "90"
    volumes:
      - openobserve-data:/data
    depends_on:
      garage-init:
        condition: service_completed_successfully
    networks:
      observe: {}
      observe-store: {}
      observe-edge: {}

  # Idempotent provisioning (spec §11): users, retention, dashboards, alerts.
  observability-init:
    <<: *node-runtime
    profiles: ["observability"]
    restart: "no"
    command: ["node", "packages/observability/src/bin/observability-init.ts"]
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
      OBSERVE_URL: http://openobserve:5080/observability
      OBSERVE_ROOT_PASSWORD: ${OBSERVE_ROOT_PASSWORD:-}
      OBSERVE_INGEST_PASSWORD: ${OBSERVE_INGEST_PASSWORD:-}
      OBSERVE_VIEWER_PASSWORD: ${OBSERVE_VIEWER_PASSWORD:-}
      ALERT_WEBHOOK_SECRET: ${ALERT_WEBHOOK_SECRET:-}
      ALERT_WEBHOOK_URL: http://web:3000/api/alerts/webhook
      SPEND_ALERT_USD_PER_HOUR: ${SPEND_ALERT_USD_PER_HOUR:-25}
    depends_on:
      openobserve:
        condition: service_started
    networks:
      - observe
```

If Task B1 recorded that the OpenObserve image runs as a non-root uid, add `user: "<that uid>"` to `openobserve`. If it recorded `curl`, add a healthcheck `["CMD", "curl", "-fsS", "http://127.0.0.1:5080/observability/healthz"]`, and make `observability-init` depend on `service_healthy`. Otherwise keep `service_started`; `waitForO2` already polls.

Under `networks:`, add:

```yaml
  # D50 (spec §4.2): one internal network per hop of the telemetry stack.
  telemetry:
    internal: true
  observe:
    internal: true
  observe-store:
    internal: true
  # Traefik ↔ OpenObserve only; compose.prod.yml makes it the external mastertutor-obs.
  observe-edge:
    internal: true
  # Only so the collector can publish its loopback fluent-forward port (spec §4.2).
  obs-ingest: {}
```

Under `volumes:`, add `openobserve-data: {}`.

- [ ] **Step 5: `compose.prod.yml`**

Add the anchor after `x-logging`:

```yaml
# D50: workers and slots log to the collector (spec §9). Async and non-blocking, so a down
# collector never stops or slows a container; Docker's dual-logging cache keeps `docker logs`.
x-container-logs: &container-logs
  logging:
    driver: fluentd
    options:
      fluentd-address: "127.0.0.1:24224"
      fluentd-async: "true"
      mode: non-blocking
      max-buffer-size: 4m
      tag: "mt.{{.Name}}"
      cache-disabled: "false"
      cache-max-size: 10m
      cache-max-file: "3"
```

Then make these changes:

- In `x-slot-prod`, change `<<: *logging` to `<<: *container-logs`.
- `pdf-worker`: `<<: [*container-logs, *node-runtime-prod]`.
- `audio-capture`: change `<<: *logging` to `<<: *container-logs`.
- `docling`: change `<<: *logging` to `<<: *container-logs`.

In `web.environment`, add:

```yaml
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:?set VAPID_PUBLIC_KEY}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:?set VAPID_PRIVATE_KEY}
      ALERT_WEBHOOK_SECRET: ${ALERT_WEBHOOK_SECRET:?set ALERT_WEBHOOK_SECRET}
      OBSERVE_VIEWER_PASSWORD: ${OBSERVE_VIEWER_PASSWORD:?set OBSERVE_VIEWER_PASSWORD}
```

In `agent.environment`, add `OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318`.

In `garage-init`, add:

```yaml
    environment:
      S3_OBSERVE_ACCESS_KEY_ID: ${S3_OBSERVE_ACCESS_KEY_ID:?set S3_OBSERVE_ACCESS_KEY_ID}
      S3_OBSERVE_SECRET_ACCESS_KEY: ${S3_OBSERVE_SECRET_ACCESS_KEY:?set S3_OBSERVE_SECRET_ACCESS_KEY}
```

Add these services:

```yaml
  otel-collector:
    <<: *logging
    environment:
      OBSERVE_INGEST_PASSWORD: ${OBSERVE_INGEST_PASSWORD:?set OBSERVE_INGEST_PASSWORD}

  observability-init:
    <<: *node-runtime-prod
    mem_limit: 256m
    cpus: 0.25
    pids_limit: 64
    environment:
      OBSERVE_ROOT_PASSWORD: ${OBSERVE_ROOT_PASSWORD:?set OBSERVE_ROOT_PASSWORD}
      OBSERVE_INGEST_PASSWORD: ${OBSERVE_INGEST_PASSWORD:?set OBSERVE_INGEST_PASSWORD}
      OBSERVE_VIEWER_PASSWORD: ${OBSERVE_VIEWER_PASSWORD:?set OBSERVE_VIEWER_PASSWORD}
      ALERT_WEBHOOK_SECRET: ${ALERT_WEBHOOK_SECRET:?set ALERT_WEBHOOK_SECRET}

  # /observability: owner-only through ForwardAuth to web's static cdp address (spec §12).
  # Traefik reaches OpenObserve over mastertutor-obs (infra/host/create-obs-network.sh).
  openobserve:
    <<: *logging
    environment:
      ZO_ROOT_USER_PASSWORD: ${OBSERVE_ROOT_PASSWORD:?set OBSERVE_ROOT_PASSWORD}
      ZO_S3_ACCESS_KEY: ${S3_OBSERVE_ACCESS_KEY_ID:?set S3_OBSERVE_ACCESS_KEY_ID}
      ZO_S3_SECRET_KEY: ${S3_OBSERVE_SECRET_ACCESS_KEY:?set S3_OBSERVE_SECRET_ACCESS_KEY}
    labels:
      traefik.enable: "true"
      traefik.docker.network: mastertutor-obs
      traefik.http.routers.mastertutor-observability.rule: "Host(`${DOMAIN:?set DOMAIN}`) && PathRegexp(`^/observability(/|$$)`)"
      traefik.http.routers.mastertutor-observability.priority: "900"
      traefik.http.routers.mastertutor-observability.entrypoints: ${TRAEFIK_ENTRYPOINT:-websecure}
      traefik.http.routers.mastertutor-observability.tls: ${TRAEFIK_TLS:-true}
      traefik.http.routers.mastertutor-observability.middlewares: mastertutor-observability-slash,mastertutor-observability-auth,mastertutor-live-headers
      traefik.http.routers.mastertutor-observability.service: mastertutor-observability
      traefik.http.services.mastertutor-observability.loadbalancer.server.port: "5080"
      traefik.http.middlewares.mastertutor-observability-auth.forwardauth.address: "http://${CDP_SUBNET_PREFIX:-172.30.231}.11:3000/api/observability/auth"
      traefik.http.middlewares.mastertutor-observability-auth.forwardauth.authResponseHeaders: Authorization,Cookie
      traefik.http.middlewares.mastertutor-observability-auth.forwardauth.trustForwardHeader: "false"
      traefik.http.middlewares.mastertutor-observability-slash.redirectregex.regex: "^(https?://[^/]+/observability)$$"
      traefik.http.middlewares.mastertutor-observability-slash.redirectregex.replacement: "$${1}/"
```

Under `networks:`, add:

```yaml
  observe-edge:
    name: mastertutor-obs
    external: true
    internal: !reset null
```

- [ ] **Step 6: Production rules (`tests/compose/prod-mode.ts`)**

Append and call it at the end of `prodModeProblems` (`problems.push(...observabilityProblems(config));`):

```ts
const DIGEST = /@sha256:[0-9a-f]{64}$/;

/** D50: applied when the observability profile runs (check-env requires it in production). */
function observabilityProblems(config: ComposeConfig): string[] {
  const o2 = config.services.openobserve;
  if (!o2) return [];
  const problems: string[] = [];
  if ((o2.ports ?? []).length > 0) problems.push("openobserve.ports: must publish nothing (D50)");
  if (!DIGEST.test(o2.image ?? "")) problems.push("openobserve.image: must be pinned by digest (D50)");
  if (o2.environment?.ZO_TELEMETRY !== "false") problems.push("openobserve.ZO_TELEMETRY: must be false (D50)");
  const middlewares = o2.labels?.["traefik.http.routers.mastertutor-observability.middlewares"] ?? "";
  if (!middlewares.split(",").includes("mastertutor-observability-auth"))
    problems.push("openobserve: its router must run mastertutor-observability-auth (D50)");
  const collector = config.services["otel-collector"];
  const ports = collector?.ports ?? [];
  if (ports.some((p) => p.host_ip !== "127.0.0.1" || p.target !== 24224))
    problems.push("otel-collector.ports: only 127.0.0.1:24224 (D45, D50)");
  for (const network of ["telemetry", "observe", "observe-store", "observe-edge"])
    if (config.networks[network] && config.networks[network]!.internal !== true)
      problems.push(`networks.${network}: must be internal (D50)`);
  return problems;
}
```

Production resolves `observe-edge` as the external `mastertutor-obs`, which compose reports without `internal`. In the network loop, skip `observe-edge` when `config.networks["observe-edge"]?.external === true`; the host script creates it with `--internal`.

In `tests/deploy/check-env.int.test.ts`, switch the "reports a missing observability secret by key" test from `it.todo` back to `it`.

- [ ] **Step 7: Host scripts**

`infra/host/create-obs-network.sh`:

```bash
#!/usr/bin/env bash
# Creates mastertutor-obs: an internal network that only Traefik and OpenObserve join (D50, spec
# §12), so Traefik can reach OpenObserve without joining any other MasterTutor network.
# OPERATOR STEP, only after the user approves this host change (D41, D42). Idempotent.
# Without --yes it prints the command and changes nothing.
# Usage: bash infra/host/create-obs-network.sh [--yes]
set -euo pipefail
NETWORK=mastertutor-obs
APPLY=0
case "$*" in
  "") ;;
  --yes) APPLY=1 ;;
  *)
    echo "usage: create-obs-network.sh [--yes]" >&2
    exit 2
    ;;
esac
if docker network inspect "$NETWORK" >/dev/null 2>&1; then
  internal="$(docker network inspect -f '{{.Internal}}' "$NETWORK")"
  if [[ "$internal" != "true" ]]; then
    echo "$NETWORK exists but is not internal; remove it first (operator decision)" >&2
    exit 1
  fi
  echo "$NETWORK already exists (internal)"
  exit 0
fi
cmd=(docker network create --internal "$NETWORK")
if [[ "$APPLY" != "1" ]]; then
  echo "would run: ${cmd[*]}"
  echo "re-run with --yes once the user has approved this host change"
  exit 0
fi
"${cmd[@]}"
echo "created $NETWORK"
```

In `infra/host/attach-traefik.sh`, add a `--network obs` option. With it, the script attaches `$TRAEFIK_CONTAINER` to `mastertutor-obs` with no fixed IP, because nothing filters on Traefik's address there. Without it, the script behaves exactly as today. Replace the argument `case` with:

```bash
TARGET=cdp
APPLY=0
for arg in "$@"; do
  case "$arg" in
    --yes) APPLY=1 ;;
    --network) ;;
    obs) TARGET=obs ;;
    *)
      echo "usage: attach-traefik.sh [--network obs] [--yes]" >&2
      exit 2
      ;;
  esac
done
if [[ "$TARGET" == obs ]]; then
  NETWORK=mastertutor-obs
  if docker inspect -f "{{with index .NetworkSettings.Networks \"$NETWORK\"}}yes{{end}}" "$TRAEFIK_CONTAINER" | grep -q yes; then
    echo "$TRAEFIK_CONTAINER already attached to $NETWORK"
    exit 0
  fi
  cmd=(docker network connect "$NETWORK" "$TRAEFIK_CONTAINER")
  if [[ "$APPLY" != "1" ]]; then
    echo "would run: ${cmd[*]}"
    echo "re-run with --yes once the user has approved this host change"
    exit 0
  fi
  "${cmd[@]}"
  echo "attached $TRAEFIK_CONTAINER to $NETWORK"
  exit 0
fi
```

Keep the existing cdp logic after this block unchanged. Keep the prefix validation above it as it is.

In `infra/deploy-runbook.md`, add a section "Observability (D50)" with these steps, in order:

1. User approval for the two host changes.
2. `bash infra/host/create-obs-network.sh --yes`.
3. `bash infra/host/attach-traefik.sh --network obs --yes`. Re-run it whenever Dokploy recreates Traefik, like the cdp attach.
4. Set `COMPOSE_PROFILES=pdf,observability`.
5. `pnpm env:init --out <file>` generates the new secrets; run `pnpm deploy:check-env <file>`.
6. After the deploy, sign in as the owner, open `/observability/`, and check that the six dashboards exist.
7. Turn on phone alerts on the iPhone Home Screen app (Settings → Notifications).

Also note that `/observability` dashboards edited in the UI are overwritten on the next deploy.

- [ ] **Step 8: Bench stack (`tests/bench/compose.local.yml`, `scripts/bench-local.sh`)**

In `compose.local.yml`:

- add `observe-edge: {}` to `traefik.networks`;
- add `MT_DEPLOYMENT: bench` to `web` and `agent` (`environment:` maps);
- for `pdf-worker`, `audio-capture`, `docling` and each `browser-N`, reset the log driver:

```yaml
    logging: !override
      driver: json-file
      options: { max-size: 10m, max-file: "3" }
```

  On the Mac, Docker Desktop's daemon runs in a VM where `127.0.0.1:24224` is not the collector (spec §16).

- under `networks`, add:

```yaml
  observe-edge: !override
    name: mastertutor-obs
    internal: true
```

In `scripts/bench-local.sh`, change `--profile pdf` to `--profile pdf --profile observability`.

- [ ] **Step 9: Run the tests**

Run: `scripts/remote-test.sh unit tests/compose scripts`, then `scripts/remote-test.sh integration tests/compose tests/deploy`, then `scripts/remote-test.sh agent-image`.
Expected: PASS. Then run `docker compose --env-file .env.test -f compose.yml -f compose.test.yml config --quiet` through the remote runner's `integration` suite; `tests/compose/compose-config.int.test.ts` covers it. Expected: valid. The test stack does not enable the profile.

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(compose): telemetry stack, owner-only /observability router, worker logs to the collector, production rules (D50)" -- compose.yml compose.prod.yml tests/bench/compose.local.yml scripts/bench-local.sh Dockerfile packages/observability/src/bin infra/host/create-obs-network.sh infra/host/attach-traefik.sh infra/deploy-runbook.md tests/compose/prod-mode.ts tests/compose/prod-mode.test.ts tests/compose/prod-overlay.int.test.ts tests/deploy/host-scripts.int.test.ts tests/deploy/check-env.int.test.ts
```

---
## Track C: Access, alerts and Web Push

### Task C1: Alerts and push subscription tables, queries and grants

**Files:**
- Create: `packages/db/src/schema/alerts.ts`, `packages/db/src/queries/alerts.ts`, `packages/db/src/queries/alerts.int.test.ts`, `packages/db/migrations/0013_alerts.sql` (generated) with its snapshot and journal entry
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`, `packages/db/src/queries/workspace.ts`, `packages/db/sql/grants.sql`

**Interfaces:**
- Consumes: Task 0 (`ALERT_RULES`, `AlertRule`, `ALERT_LABELS`, `AlertView`), `keyset.ts` (`parseKeysetCursor`, `keysetBefore`, `keysetCursor`, `msOf`), `Membership` (`workspace.ts`).
- Produces (`@mastertutor/db`):
  - tables `alerts` and `pushSubscriptions`;
  - `memberRoleOf(db, userId): Promise<Membership | null>`, `onlyWorkspaceId(db): Promise<string | null>`;
  - `recordAlert(db, { workspaceId, rule, dedupeMinutes }): Promise<{ id: string; created: boolean }>`;
  - `listAlerts(db, workspaceId, { limit, cursor }): Promise<{ items: AlertView[]; nextCursor: string | null }>`, `activeAlerts(db, workspaceId, limit?): Promise<AlertView[]>`;
  - `acknowledgeAlert(db, { workspaceId, alertId, userId }): Promise<boolean>`;
  - `savePushSubscription(db, { userId, endpoint, p256dh, auth })`, `deletePushSubscription(db, { userId, endpoint })`, `deletePushSubscriptionByEndpoint(db, endpoint)`;
  - `ownerPushTargets(db, workspaceId): Promise<PushTarget[]>`, `PushTarget = { endpoint; p256dh; auth }`.

- [ ] **Step 1: Write the failing test** (`packages/db/src/queries/alerts.int.test.ts`)

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { seedMember, startTestDatabase, type TestDatabase } from "../testing.ts";
import {
  acknowledgeAlert,
  activeAlerts,
  deletePushSubscription,
  listAlerts,
  onlyWorkspaceId,
  ownerPushTargets,
  recordAlert,
  savePushSubscription,
} from "./alerts.ts";
import { memberRoleOf } from "./workspace.ts";

let database: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let agent: DbHandle;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  web = createDb(database.webUrl, { max: 2 });
  agent = createDb(database.agentUrl, { max: 2 });
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close(), agent?.close()]);
  await database?.stop();
});

const target = (n: number) => ({
  endpoint: `https://web.push.apple.com/sub-${n}`,
  p256dh: `B${"A".repeat(86)}`,
  auth: "A".repeat(22),
});

describe("alerts (spec §13.3)", () => {
  it("dedupes a rule within the window and keeps rules apart", async () => {
    const { workspaceId } = await seedMember(owner.db);
    const first = await recordAlert(web.db, { workspaceId, rule: "run_failed", dedupeMinutes: 10 });
    const again = await recordAlert(web.db, { workspaceId, rule: "run_failed", dedupeMinutes: 10 });
    const other = await recordAlert(web.db, { workspaceId, rule: "spend_jump", dedupeMinutes: 10 });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect(other.created).toBe(true);
  });

  it("lists newest first with labels, pages, and acknowledges once, per workspace", async () => {
    const { workspaceId, userId } = await seedMember(owner.db);
    const a = await recordAlert(web.db, { workspaceId, rule: "error_spike", dedupeMinutes: 10 });
    const b = await recordAlert(web.db, { workspaceId, rule: "slot_crash_loop", dedupeMinutes: 10 });
    const page1 = await listAlerts(web.db, workspaceId, { limit: 1, cursor: null });
    expect(page1.items.map((i) => [i.id, i.label])).toEqual([[b.id, "A browser slot keeps crashing"]]);
    const page2 = await listAlerts(web.db, workspaceId, { limit: 1, cursor: page1.nextCursor });
    expect(page2.items.map((i) => i.id)).toEqual([a.id]);
    expect(await acknowledgeAlert(web.db, { workspaceId, alertId: a.id, userId })).toBe(true);
    expect(await acknowledgeAlert(web.db, { workspaceId, alertId: a.id, userId })).toBe(true);
    expect((await activeAlerts(web.db, workspaceId)).map((i) => i.id)).toEqual([b.id]);
    const elsewhere = await seedMember(owner.db);
    expect(await acknowledgeAlert(web.db, { workspaceId: elsewhere.workspaceId, alertId: b.id, userId })).toBe(false);
  });

  it("sends pushes to the owner's subscriptions only", async () => {
    const own = await seedMember(owner.db, { role: "owner" });
    const member = await seedMember(owner.db, { workspaceId: own.workspaceId, role: "member" });
    await savePushSubscription(web.db, { userId: own.userId, ...target(1) });
    await savePushSubscription(web.db, { userId: own.userId, ...target(1) });
    await savePushSubscription(web.db, { userId: member.userId, ...target(2) });
    expect((await ownerPushTargets(web.db, own.workspaceId)).map((t) => t.endpoint)).toEqual([target(1).endpoint]);
    await deletePushSubscription(web.db, { userId: own.userId, endpoint: target(1).endpoint });
    expect(await ownerPushTargets(web.db, own.workspaceId)).toEqual([]);
  });

  it("knows the member's role and the single workspace", async () => {
    const { userId, workspaceId } = await seedMember(owner.db, { role: "member" });
    expect(await memberRoleOf(web.db, userId)).toEqual({ workspaceId, role: "member" });
    expect(await memberRoleOf(web.db, "nobody")).toBeNull();
    expect(await onlyWorkspaceId(web.db)).toEqual(expect.any(String));
  });

  it("the agent role cannot read alerts or subscriptions (least privilege)", async () => {
    await expect(agent.sql`select 1 from alerts limit 1`).rejects.toThrow(/permission denied/);
    await expect(agent.sql`select 1 from push_subscriptions limit 1`).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `scripts/remote-test.sh integration packages/db/src/queries/alerts.int.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the schema (`packages/db/src/schema/alerts.ts`)**

```ts
import { ALERT_RULES, type AlertRule } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, tstz } from "./columns.ts";
import { workspaces } from "./workspace.ts";

/** Alerts from OpenObserve (spec §13.3): the rule and when, never alert content. */
export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rule: text("rule").$type<AlertRule>().notNull(),
    firedAt: tstz("fired_at").notNull().defaultNow(),
    acknowledgedAt: tstz("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("alerts_workspace_fired_idx").on(t.workspaceId, t.firedAt),
    check("alerts_rule_ck", sql.raw(`rule in (${ALERT_RULES.map((r) => `'${r}'`).join(", ")})`)),
  ],
);

/** Web Push subscriptions (spec §13.4): the browser's endpoint and keys, per user. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique("push_subscriptions_endpoint_uq"),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);
```

Add `export * from "./alerts.ts";` to `packages/db/src/schema/index.ts`. Then generate the migration:

Run: `pnpm --filter @mastertutor/db generate --name alerts`
Expected: a new `packages/db/migrations/0013_alerts.sql`, a snapshot, and a journal entry with `idx: 13`. Read the SQL. It must create the two tables, the check, the unique constraint and both indexes, and nothing else.

- [ ] **Step 4: Grants (`packages/db/sql/grants.sql`)**

In the `agent_role` branch of the grant loop, change the exclusion list to:

```sql
    -- agent: everything except Better Auth's tables, the audit log, and web-only alert state (D50).
    IF t NOT IN ('user', 'session', 'account', 'verification', 'vault_audit', 'alerts', 'push_subscriptions') THEN
```

- [ ] **Step 5: Queries (`packages/db/src/queries/alerts.ts`)**

```ts
import { ALERT_LABELS, type AlertRule, type AlertView } from "@mastertutor/contracts";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { alerts, pushSubscriptions, workspaceMembers, workspaces } from "../schema/index.ts";
import { keysetBefore, keysetCursor, msOf, parseKeysetCursor } from "./keyset.ts";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

type AlertRow = typeof alerts.$inferSelect;
const view = (row: AlertRow): AlertView => ({
  id: row.id,
  rule: row.rule,
  label: ALERT_LABELS[row.rule],
  firedAt: row.firedAt.toISOString(),
  acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
});

/** v1 has one workspace (D4): where an alert from OpenObserve belongs. */
export async function onlyWorkspaceId(db: Database): Promise<string | null> {
  const [row] = await db.select({ id: workspaces.id }).from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1);
  return row?.id ?? null;
}

/** One row per rule per window (spec §13.2): racing deliveries agree under an advisory lock. */
export async function recordAlert(
  db: Database,
  input: { workspaceId: string; rule: AlertRule; dedupeMinutes: number },
): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`mt.alert:${input.workspaceId}:${input.rule}`}))`,
    );
    const [recent] = await tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.workspaceId, input.workspaceId),
          eq(alerts.rule, input.rule),
          gt(alerts.firedAt, sql`now() - make_interval(mins => ${input.dedupeMinutes})`),
        ),
      )
      .orderBy(desc(alerts.firedAt))
      .limit(1);
    if (recent) return { id: recent.id, created: false };
    const [created] = await tx
      .insert(alerts)
      .values({ workspaceId: input.workspaceId, rule: input.rule })
      .returning({ id: alerts.id });
    if (!created) throw new Error("alerts insert returned no row");
    return { id: created.id, created: true };
  });
}

export async function listAlerts(
  db: Database,
  workspaceId: string,
  page: { limit: number; cursor: string | null },
): Promise<{ items: AlertView[]; nextCursor: string | null }> {
  const position = parseKeysetCursor(page.cursor);
  const rows = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.workspaceId, workspaceId), keysetBefore(alerts.firedAt, alerts.id, position)))
    .orderBy(desc(msOf(alerts.firedAt)), desc(alerts.id))
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items: items.map(view),
    nextCursor: rows.length > page.limit && last ? keysetCursor(last.firedAt, last.id) : null,
  };
}

export async function activeAlerts(db: Database, workspaceId: string, limit = 5): Promise<AlertView[]> {
  const rows = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.workspaceId, workspaceId), isNull(alerts.acknowledgedAt)))
    .orderBy(desc(alerts.firedAt))
    .limit(limit);
  return rows.map(view);
}

/** Idempotent: an acknowledged alert keeps its first acknowledgement. False when not found. */
export async function acknowledgeAlert(
  db: Database,
  input: { workspaceId: string; alertId: string; userId: string },
): Promise<boolean> {
  const rows = await db
    .update(alerts)
    .set({
      acknowledgedAt: sql`coalesce(${alerts.acknowledgedAt}, now())`,
      acknowledgedBy: sql`coalesce(${alerts.acknowledgedBy}, ${input.userId})`,
    })
    .where(and(eq(alerts.id, input.alertId), eq(alerts.workspaceId, input.workspaceId)))
    .returning({ id: alerts.id });
  return rows.length > 0;
}

/** A re-subscribed browser keeps one row per endpoint (the newest user and keys win). */
export async function savePushSubscription(
  db: Database,
  input: { userId: string } & PushTarget,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values(input)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: input.userId, p256dh: input.p256dh, auth: input.auth },
    });
}

export async function deletePushSubscription(
  db: Database,
  input: { userId: string; endpoint: string },
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, input.userId), eq(pushSubscriptions.endpoint, input.endpoint)));
}

/** A push service answered 404/410: the subscription is gone for good. */
export async function deletePushSubscriptionByEndpoint(db: Database, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function ownerPushTargets(db: Database, workspaceId: string): Promise<PushTarget[]> {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, pushSubscriptions.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner")));
}
```

In `packages/db/src/queries/workspace.ts`, append:

```ts
/** The user's workspace and role, or null (D4: one workspace in v1). The owner check uses it. */
export async function memberRoleOf(db: Database, userId: string): Promise<Membership | null> {
  const [row] = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  return row ?? null;
}
```

In `packages/db/src/index.ts`, append `export * from "./queries/alerts.ts";`.

- [ ] **Step 6: Run the tests**

Run: `scripts/remote-test.sh integration packages/db`
Expected: PASS, including `migrate.int.test.ts` and `security.int.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/alerts.ts packages/db/src/queries/alerts.ts packages/db/src/queries/alerts.int.test.ts packages/db/migrations
git commit -m "feat(db): alerts and push subscriptions, owner role lookup, agent excluded (D50)" -- packages/db/src/schema/alerts.ts packages/db/src/schema/index.ts packages/db/src/queries/alerts.ts packages/db/src/queries/alerts.int.test.ts packages/db/src/queries/workspace.ts packages/db/src/index.ts packages/db/sql/grants.sql packages/db/migrations
```

---

### Task C2: Owner-only access: RPC middleware and the `/observability` ForwardAuth and entry routes

**Files:**
- Create: `apps/web/lib/server/rpc/owner-scope.ts`, `apps/web/lib/server/observability/authorize.ts`, `apps/web/lib/server/observability/authorize.test.ts`, `apps/web/lib/server/observability/enter-page.ts`, `apps/web/lib/server/observability/enter-page.test.ts`, `apps/web/app/api/observability/auth/route.ts`, `apps/web/app/api/observability/enter/route.ts`

**Interfaces:**
- Consumes: C1 (`memberRoleOf`), Task 0 (`OBSERVE_USERS`, `OBSERVE_UI_SESSION`, `OBSERVABILITY_PATH`, `OBSERVABILITY_ENTER_PATH`), web helpers (`getViewer` in `apps/web/lib/server/viewer.ts`, `getDb`, `getWebEnv`, `liveOs` in `apps/web/lib/server/rpc/live-os.ts`, `signInPathFor` in `apps/web/lib/auth/next-path.ts`).
- Produces:
  - `ownerScoped(db: () => DbHandle)`: an oRPC middleware builder whose context carries `{ db, workspaceId, actor }`, or which throws FORBIDDEN;
  - `decideObservability(input): ObservabilityDecision`;
  - `enterPage(): string`;
  - routes `GET /api/observability/auth` and `GET /api/observability/enter`.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/server/observability/authorize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideObservability } from "./authorize.ts";

const PASSWORD = "v".repeat(40);

describe("/observability ForwardAuth decision (spec §12, Review Focus 4)", () => {
  it("sends a signed-out visitor to sign in, then to the entry route", () => {
    expect(decideObservability({ signedIn: false, role: null, viewerPassword: PASSWORD })).toEqual({
      kind: "sign_in",
      location: "/sign-in?next=%2Fapi%2Fobservability%2Fenter",
    });
  });

  it("refuses a member who is not the owner", () => {
    expect(decideObservability({ signedIn: true, role: "member", viewerPassword: PASSWORD })).toEqual({ kind: "forbidden" });
    expect(decideObservability({ signedIn: true, role: null, viewerPassword: PASSWORD })).toEqual({ kind: "forbidden" });
  });

  it("is unavailable without a viewer password, and otherwise injects the viewer's credentials", () => {
    expect(decideObservability({ signedIn: true, role: "owner", viewerPassword: undefined })).toEqual({ kind: "unavailable" });
    expect(decideObservability({ signedIn: true, role: "owner", viewerPassword: PASSWORD })).toEqual({
      kind: "allow",
      authorization: `Basic ${Buffer.from(`viewer@mastertutor.internal:${PASSWORD}`).toString("base64")}`,
    });
  });
});
```

`apps/web/lib/server/observability/enter-page.test.ts`:

```ts
import { OBSERVE_UI_SESSION } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { enterPage } from "./enter-page.ts";

describe("enterPage (spec §12)", () => {
  it("seeds OpenObserve's identity record (no secret) and goes to the UI", () => {
    const html = enterPage();
    const record = Buffer.from(JSON.stringify(OBSERVE_UI_SESSION.identity)).toString("base64");
    expect(html).toContain(JSON.stringify(OBSERVE_UI_SESSION.key));
    expect(html).toContain(JSON.stringify(record));
    expect(html).toContain('location.replace("/observability/web/")');
    expect(html).not.toMatch(/password|Basic /i);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit apps/web/lib/server/observability`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

`apps/web/lib/server/observability/authorize.ts`:

```ts
import { OBSERVABILITY_ENTER_PATH, OBSERVE_USERS, type MemberRole } from "@mastertutor/contracts";
import { signInPathFor } from "../../auth/next-path.ts";

export type ObservabilityDecision =
  | { kind: "allow"; authorization: string }
  | { kind: "sign_in"; location: string }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

/**
 * Spec §12: only the workspace owner reaches OpenObserve. The viewer's credentials are added to the
 * upstream request by Traefik (authResponseHeaders) and never reach the browser.
 */
export function decideObservability(input: {
  signedIn: boolean;
  role: MemberRole | null;
  viewerPassword: string | undefined;
}): ObservabilityDecision {
  if (!input.signedIn) return { kind: "sign_in", location: signInPathFor(OBSERVABILITY_ENTER_PATH, "") };
  if (input.role !== "owner") return { kind: "forbidden" };
  if (!input.viewerPassword) return { kind: "unavailable" };
  return {
    kind: "allow",
    authorization: `Basic ${Buffer.from(`${OBSERVE_USERS.viewer}:${input.viewerPassword}`).toString("base64")}`,
  };
}
```

`apps/web/lib/server/observability/enter-page.ts`:

```ts
import { OBSERVABILITY_PATH, OBSERVE_UI_SESSION } from "@mastertutor/contracts";

/**
 * OpenObserve's UI shows its own login unless its client-side identity record exists (spec §12).
 * This page writes that record (an identity, no secret), then opens the UI. Every request the UI
 * makes is authenticated by the ForwardAuth header, never by this record.
 */
export function enterPage(): string {
  const record = Buffer.from(JSON.stringify(OBSERVE_UI_SESSION.identity)).toString("base64");
  const script = `try{${OBSERVE_UI_SESSION.storage}.setItem(${JSON.stringify(OBSERVE_UI_SESSION.key)},${JSON.stringify(record)})}catch(e){}location.replace(${JSON.stringify(`${OBSERVABILITY_PATH}web/`)})`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Opening Observability…</title></head><body><script>${script.replaceAll("<", "\\u003c")}</script></body></html>`;
}
```

`apps/web/lib/server/rpc/owner-scope.ts`:

```ts
import { memberRoleOf, type DbHandle } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { liveOs } from "./live-os.ts";

/**
 * Owner-only procedures (D50: alerts and push). Like workspaceScoped, but the viewer must hold the
 * owner role; anyone else is FORBIDDEN and learns nothing.
 */
export const ownerScoped = (db: () => DbHandle) =>
  liveOs.use(async ({ context, next }) => {
    const handle = db();
    const membership = await memberRoleOf(handle.db, context.viewer.id);
    if (!membership || membership.role !== "owner") throw new ORPCError("FORBIDDEN");
    return next({
      context: { db: handle, workspaceId: membership.workspaceId, actor: context.viewer.id },
    });
  });
```

`apps/web/app/api/observability/auth/route.ts`:

```ts
import { memberRoleOf } from "@mastertutor/db";
import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { decideObservability } from "@/lib/server/observability/authorize.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

/** Traefik ForwardAuth for /observability (spec §12). Fails closed. */
export async function GET(): Promise<Response> {
  const headers = new Headers({ "cache-control": "no-store" });
  // A fixture build signs in a fake viewer; it must never open real telemetry.
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return new Response(null, { status: 403, headers });
  const viewer = await getViewer().catch(() => null);
  const membership = viewer ? await memberRoleOf(getDb().db, viewer.id).catch(() => null) : null;
  const decision = decideObservability({
    signedIn: viewer !== null,
    role: membership?.role ?? null,
    viewerPassword: getWebEnv().OBSERVE_VIEWER_PASSWORD,
  });
  switch (decision.kind) {
    case "sign_in":
      headers.set("location", decision.location);
      return new Response(null, { status: 302, headers });
    case "forbidden":
      return new Response(null, { status: 403, headers });
    case "unavailable":
      return new Response(null, { status: 503, headers });
    case "allow":
      // Traefik copies both onto the upstream request: OpenObserve never sees our session cookie.
      headers.set("authorization", decision.authorization);
      headers.set("cookie", "mt_obs=1");
      return new Response(null, { status: 200, headers });
  }
}
```

`apps/web/app/api/observability/enter/route.ts`:

```ts
import { memberRoleOf } from "@mastertutor/db";
import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { decideObservability } from "@/lib/server/observability/authorize.ts";
import { enterPage } from "@/lib/server/observability/enter-page.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

/** The owner's way into /observability (spec §12): seeds OpenObserve's UI identity, then opens it. */
export async function GET(): Promise<Response> {
  const headers = new Headers({ "cache-control": "no-store" });
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) return new Response(null, { status: 404, headers });
  const viewer = await getViewer().catch(() => null);
  const membership = viewer ? await memberRoleOf(getDb().db, viewer.id).catch(() => null) : null;
  const decision = decideObservability({
    signedIn: viewer !== null,
    role: membership?.role ?? null,
    viewerPassword: getWebEnv().OBSERVE_VIEWER_PASSWORD,
  });
  if (decision.kind === "sign_in") {
    headers.set("location", decision.location);
    return new Response(null, { status: 302, headers });
  }
  if (decision.kind !== "allow") return new Response(null, { status: decision.kind === "forbidden" ? 403 : 503, headers });
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(enterPage(), { status: 200, headers });
}
```

- [ ] **Step 4: Run the tests**

Run: `scripts/remote-test.sh unit apps/web/lib/server/observability`, then `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/observability apps/web/lib/server/rpc/owner-scope.ts apps/web/app/api/observability
git commit -m "feat(web): owner-only /observability ForwardAuth and entry, ownerScoped RPC middleware (D50)" -- apps/web/lib/server/observability apps/web/lib/server/rpc/owner-scope.ts apps/web/app/api/observability
```

---

### Task C3: Web Push crypto (RFC 8291 and RFC 8292 on `node:crypto`)

**Files:**
- Create: `apps/web/lib/server/push/vapid.ts`, `apps/web/lib/server/push/encrypt.ts`, `apps/web/lib/server/push/config.ts`, with tests `vapid.test.ts`, `encrypt.test.ts` and `config.test.ts` beside them

**Interfaces:**
- Consumes: Task 0 (`WebEnv`, `PushConfig`).
- Produces:
  - `VapidKeys { publicKey: string; privateKey: string; subject: string }`;
  - `vapidAuthorization(endpoint: string, keys: VapidKeys, nowSeconds?: number): string`;
  - `encryptPayload(input: { plaintext: Uint8Array; uaPublic: Buffer; authSecret: Buffer; asPrivate?: Buffer; salt?: Buffer }): Buffer`;
  - `vapidKeysOf(env: WebEnv): VapidKeys | null` (null without both keys or without HTTPS);
  - `pushConfigOf(env: WebEnv): PushConfig`.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/server/push/encrypt.test.ts`:

```ts
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptPayload } from "./encrypt.ts";

const b = (value: string) => Buffer.from(value, "base64url");

// RFC 8291 Appendix A. If this fails, compare every value with the RFC text before touching code.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20]!;
  const asPublic = body.subarray(21, 21 + idLength);
  const data = body.subarray(21 + idLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const key = (ikm: Buffer, salt2: Buffer, info: Buffer, n: number) => Buffer.from(hkdfSync("sha256", ikm, salt2, info, n));
  const ikm = key(shared, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = key(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = key(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const padded = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  return padded.subarray(0, padded.lastIndexOf(2)).toString("utf8");
}

describe("encryptPayload (RFC 8291, aes128gcm)", () => {
  it("matches the RFC 8291 Appendix A test vector", () => {
    const body = encryptPayload({
      plaintext: Buffer.from(RFC.plaintext),
      uaPublic: b(RFC.uaPublic),
      authSecret: b(RFC.authSecret),
      asPrivate: b(RFC.asPrivate),
      salt: b(RFC.salt),
    });
    expect(body.toString("base64url")).toBe(RFC.message);
  });

  it("round-trips with fresh keys and salt", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const body = encryptPayload({ plaintext: Buffer.from('{"title":"MasterTutor"}'), uaPublic: ua.getPublicKey(), authSecret: auth });
    expect(decrypt(body, ua.getPrivateKey(), ua.getPublicKey(), auth)).toBe('{"title":"MasterTutor"}');
  });
});
```

`apps/web/lib/server/push/vapid.test.ts`:

```ts
import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { vapidKeyPair } from "../../../../../scripts/lib/vapid.ts";
import { vapidAuthorization } from "./vapid.ts";

describe("vapidAuthorization (RFC 8292)", () => {
  it("signs an ES256 JWT for the push service's origin that its public key verifies", () => {
    const pair = vapidKeyPair();
    const header = vapidAuthorization(
      "https://web.push.apple.com/QGuR?x=1",
      { ...pair, subject: "https://notes.example.org" },
      1_800_000_000,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(match[4]).toBe(pair.publicKey);
    expect(JSON.parse(Buffer.from(match[1]!, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(Buffer.from(match[2]!, "base64url").toString())).toEqual({
      aud: "https://web.push.apple.com",
      exp: 1_800_000_000 + 12 * 3600,
      sub: "https://notes.example.org",
    });
    const raw = Buffer.from(pair.publicKey, "base64url");
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") },
      format: "jwk",
    });
    expect(
      verify("sha256", Buffer.from(`${match[1]}.${match[2]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(match[3]!, "base64url")),
    ).toBe(true);
  });
});
```

`apps/web/lib/server/push/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pushConfigOf, vapidKeysOf } from "./config.ts";

const keys = { VAPID_PUBLIC_KEY: `B${"x".repeat(86)}`, VAPID_PRIVATE_KEY: "y".repeat(43) };

describe("push availability (spec §13.4 degradation)", () => {
  it("needs both keys and an https origin", () => {
    expect(pushConfigOf({ BETTER_AUTH_URL: "http://localhost:18080", ...keys } as never)).toEqual({ available: false, publicKey: null });
    expect(pushConfigOf({ BETTER_AUTH_URL: "https://notes.example.org" } as never)).toEqual({ available: false, publicKey: null });
    expect(pushConfigOf({ BETTER_AUTH_URL: "https://notes.example.org", ...keys } as never)).toEqual({
      available: true,
      publicKey: keys.VAPID_PUBLIC_KEY,
    });
    expect(vapidKeysOf({ BETTER_AUTH_URL: "https://notes.example.org", ...keys } as never)?.subject).toBe("https://notes.example.org");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit apps/web/lib/server/push`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

`apps/web/lib/server/push/encrypt.ts`:

```ts
import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

const RECORD_SIZE = 4_096;
const key = (ikm: Buffer, salt: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync("sha256", ikm, salt, info, length));

/**
 * RFC 8291 message encryption, content coding aes128gcm (RFC 8188), one record. `asPrivate` and
 * `salt` are test seams for the RFC's vector; production draws both fresh for every message.
 */
export function encryptPayload(input: {
  plaintext: Uint8Array;
  uaPublic: Buffer;
  authSecret: Buffer;
  asPrivate?: Buffer;
  salt?: Buffer;
}): Buffer {
  const ecdh = createECDH("prime256v1");
  if (input.asPrivate) ecdh.setPrivateKey(input.asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(input.uaPublic);
  const salt = input.salt ?? randomBytes(16);
  const ikm = key(shared, input.authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), input.uaPublic, asPublic]), 32);
  const cek = key(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = key(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // The last (only) record ends with the 0x02 delimiter and no padding.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(input.plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}
```

`apps/web/lib/server/push/vapid.ts`:

```ts
import { createPrivateKey, sign } from "node:crypto";

export interface VapidKeys {
  /** base64url uncompressed P-256 point (65 bytes). */
  publicKey: string;
  /** base64url 32-byte private scalar. */
  privateKey: string;
  /** Contact for the push service: our https origin (Apple requires https: or mailto:). */
  subject: string;
}

const LIFETIME_SECONDS = 12 * 3_600;
const b64 = (value: string) => Buffer.from(value).toString("base64url");

/** RFC 8292 `Authorization: vapid t=<ES256 JWT>, k=<public key>` for one push service origin. */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  nowSeconds = Math.floor(Date.now() / 1_000),
): string {
  const point = Buffer.from(keys.publicKey, "base64url");
  const privateKey = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
      d: keys.privateKey,
    },
    format: "jwk",
  });
  const input = `${b64(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${b64(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + LIFETIME_SECONDS, sub: keys.subject }),
  )}`;
  const signature = sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${input}.${signature.toString("base64url")}, k=${keys.publicKey}`;
}
```

`apps/web/lib/server/push/config.ts`:

```ts
import type { PushConfig, WebEnv } from "@mastertutor/contracts";
import type { VapidKeys } from "./vapid.ts";

/** Web Push needs both VAPID keys and HTTPS (spec §13.4); otherwise alerts stay in-app only. */
export function vapidKeysOf(env: Pick<WebEnv, "BETTER_AUTH_URL" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY">): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  if (new URL(env.BETTER_AUTH_URL).protocol !== "https:") return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: new URL(env.BETTER_AUTH_URL).origin };
}

export function pushConfigOf(env: Pick<WebEnv, "BETTER_AUTH_URL" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY">): PushConfig {
  const keys = vapidKeysOf(env);
  return { available: keys !== null, publicKey: keys?.publicKey ?? null };
}
```

- [ ] **Step 4: Run the tests**

Run: `scripts/remote-test.sh unit apps/web/lib/server/push`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/push
git commit -m "feat(web): Web Push encryption and VAPID on node:crypto, pinned by the RFC 8291 vector (D50)" -- apps/web/lib/server/push
```

---

### Task C4: Alert webhook, push sender and delivery

**Depends on:** C1, C3 and A4 (`instrument`, `recordAlertReceived`, `recordPush`).

**Files:**
- Create: `apps/web/lib/server/push/send.ts`, `send.test.ts`, `apps/web/lib/server/alerts/read-capped.ts`, `apps/web/lib/server/alerts/webhook.ts`, `webhook.test.ts`, `webhook.int.test.ts`, `apps/web/lib/server/alerts/deliver.ts`, `deliver.test.ts`, `apps/web/app/api/alerts/webhook/route.ts`

**Interfaces:**
- Consumes:
  - C1 (`recordAlert`, `onlyWorkspaceId`, `ownerPushTargets`, `deletePushSubscriptionByEndpoint`, `PushTarget`);
  - C3 (`encryptPayload`, `vapidAuthorization`, `vapidKeysOf`, `VapidKeys`);
  - A4 (`instrument`, `recordAlertReceived`, `recordPush`);
  - Task 0 (`AlertWebhookBody`, `MAX_ALERT_WEBHOOK_BYTES`, `ALERT_DEDUPE_MINUTES`, `alertPushPayload`, `isPushServiceEndpoint`, `PushPayload`, `SPAN`, `ATTR`).
- Produces:
  - `sendPush(target, payload, keys, fetchImpl?): Promise<PushOutcome>`, with `SendPush = typeof sendPush`;
  - `readCapped(request, maxBytes): Promise<string | null>`;
  - `handleAlertWebhook(deps: WebhookDeps, request): Promise<Response>`, with `WebhookDeps { secret; record(rule); onRecorded(alert) }`;
  - `deliverAlert(deps: DeliverDeps, alert: { id; rule }): Promise<PushOutcome[]>`, with `DeliverDeps { vapid: VapidKeys | null; targets(): Promise<PushTarget[]>; forget(endpoint): Promise<void>; send?: SendPush }`;
  - route `POST /api/alerts/webhook`.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/server/push/send.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { vapidKeyPair } from "../../../../../scripts/lib/vapid.ts";
import { createECDH } from "node:crypto";
import { sendPush } from "./send.ts";

const ua = createECDH("prime256v1");
ua.generateKeys();
const target = (endpoint = "https://web.push.apple.com/sub") => ({
  endpoint,
  p256dh: ua.getPublicKey().toString("base64url"),
  auth: Buffer.alloc(16, 1).toString("base64url"),
});
const keys = { ...vapidKeyPair(), subject: "https://notes.example.org" };
const payload = { title: "MasterTutor" as const, body: "A run failed", url: "/settings/alerts#alert-11111111-1111-4111-8111-111111111111" };

describe("sendPush (spec §13.4)", () => {
  it("posts an encrypted, VAPID-signed message with TTL and urgency, following no redirect", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const outcome = await sendPush(target(), payload, keys, async (url, init) => {
      seen = { url: String(url), init: init! };
      return new Response(null, { status: 201 });
    });
    expect(outcome).toBe("sent");
    const headers = seen!.init.headers as Record<string, string>;
    expect(seen!.init.redirect).toBe("error");
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.ttl).toBe("3600");
    expect(headers.urgency).toBe("high");
    expect(headers.authorization).toMatch(/^vapid t=/);
    expect(Buffer.from(seen!.init.body as Uint8Array).toString("latin1")).not.toContain("A run failed");
  });

  it("refuses an endpoint outside the push services without any request (SSRF)", async () => {
    let called = false;
    const outcome = await sendPush(target("https://169.254.169.254/latest"), payload, keys, async () => {
      called = true;
      return new Response(null);
    });
    expect([outcome, called]).toEqual(["refused", false]);
  });

  it("maps 404/410 to gone and anything else to failed", async () => {
    expect(await sendPush(target(), payload, keys, async () => new Response(null, { status: 410 }))).toBe("gone");
    expect(await sendPush(target(), payload, keys, async () => new Response(null, { status: 404 }))).toBe("gone");
    expect(await sendPush(target(), payload, keys, async () => new Response(null, { status: 500 }))).toBe("failed");
    expect(await sendPush(target(), payload, keys, async () => { throw new TypeError("network"); })).toBe("failed");
  });
});
```

`apps/web/lib/server/alerts/webhook.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { handleAlertWebhook } from "./webhook.ts";

const SECRET = "s".repeat(40);
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://web:3000/api/alerts/webhook", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json", ...headers },
    body,
  });

function deps(secret: string | undefined = SECRET) {
  const recorded: string[] = [];
  return {
    recorded,
    deps: {
      secret,
      record: async (rule: string) => ({ id: "11111111-1111-4111-8111-111111111111", workspaceId: "w", created: true, rule }),
      onRecorded: (alert: { rule: string }) => void recorded.push(alert.rule),
    },
  };
}

describe("POST /api/alerts/webhook (spec §13.2)", () => {
  it("does not exist without a secret", async () => {
    const { deps: d } = deps(undefined);
    expect((await handleAlertWebhook(d as never, post('{"rule":"run_failed"}'))).status).toBe(404);
  });

  it("does not exist through Traefik: forwarded requests are 404 before auth (Review Focus 4)", async () => {
    const { deps: d, recorded } = deps();
    const response = await handleAlertWebhook(d as never, post('{"rule":"run_failed"}', { "x-forwarded-for": "203.0.113.9" }));
    expect(response.status).toBe(404);
    expect(recorded).toEqual([]);
  });

  it("refuses a wrong bearer, a big body and an unknown rule or extra field", async () => {
    const { deps: d, recorded } = deps();
    expect((await handleAlertWebhook(d as never, post('{"rule":"run_failed"}', { authorization: "Bearer nope" }))).status).toBe(401);
    expect((await handleAlertWebhook(d as never, post(`{"rule":"run_failed","x":"${"a".repeat(5_000)}"}`))).status).toBe(413);
    expect((await handleAlertWebhook(d as never, post('{"rule":"rm -rf"}'))).status).toBe(400);
    expect((await handleAlertWebhook(d as never, post('{"rule":"run_failed","text":"hi"}'))).status).toBe(400);
    expect((await handleAlertWebhook(d as never, post("not json"))).status).toBe(400);
    expect(recorded).toEqual([]);
  });

  it("records a valid alert and answers 202", async () => {
    const { deps: d, recorded } = deps();
    expect((await handleAlertWebhook(d as never, post('{"rule":"run_failed"}'))).status).toBe(202);
    expect(recorded).toEqual(["run_failed"]);
  });
});
```

`apps/web/lib/server/alerts/webhook.int.test.ts` (Review Focus 2):

```ts
import { ALERT_DEDUPE_MINUTES } from "@mastertutor/contracts";
import { alerts, createDb, onlyWorkspaceId, recordAlert, type DbHandle } from "@mastertutor/db";
import { seedMember, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleAlertWebhook } from "./webhook.ts";

let database: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  web = createDb(database.webUrl, { max: 2 });
  await seedMember(owner.db);
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close()]);
  await database?.stop();
});

describe("webhook against the database", () => {
  it("a repeated rule within 10 minutes is one alert and one push (Review Focus 2)", async () => {
    const delivered: string[] = [];
    const deps = {
      secret: "s".repeat(40),
      record: async (rule: "run_failed") => {
        const workspaceId = (await onlyWorkspaceId(web.db))!;
        return { ...(await recordAlert(web.db, { workspaceId, rule, dedupeMinutes: ALERT_DEDUPE_MINUTES })), workspaceId };
      },
      onRecorded: (alert: { id: string }) => void delivered.push(alert.id),
    };
    const post = () =>
      new Request("http://web:3000/api/alerts/webhook", {
        method: "POST",
        headers: { authorization: `Bearer ${"s".repeat(40)}` },
        body: '{"rule":"run_failed"}',
      });
    const statuses = await Promise.all([1, 2, 3].map(() => handleAlertWebhook(deps as never, post()).then((r) => r.status)));
    expect(statuses).toEqual([202, 202, 202]);
    expect(await owner.db.select().from(alerts)).toHaveLength(1);
    expect(delivered).toHaveLength(1);
  });
});
```

`apps/web/lib/server/alerts/deliver.test.ts` (Review Focus 3):

```ts
import { describe, expect, it } from "vitest";
import { deliverAlert } from "./deliver.ts";

const keys = { publicKey: "k", privateKey: "p", subject: "https://notes.example.org" };
const ALERT = { id: "11111111-1111-4111-8111-111111111111", rule: "run_failed" as const };
const t = (n: number) => ({ endpoint: `https://web.push.apple.com/${n}`, p256dh: "x", auth: "y" });

describe("deliverAlert (spec §13.4)", () => {
  it("a 410 deletes that subscription and the others still get it (Review Focus 3)", async () => {
    const sends: string[] = [];
    const forgotten: string[] = [];
    const outcomes = await deliverAlert(
      {
        vapid: keys,
        targets: async () => [t(1), t(2)],
        forget: async (endpoint) => void forgotten.push(endpoint),
        send: async (target, payload) => {
          sends.push(`${target.endpoint} ${JSON.stringify(payload)}`);
          return target.endpoint.endsWith("/1") ? "gone" : "sent";
        },
      },
      ALERT,
    );
    expect(outcomes).toEqual(["gone", "sent"]);
    expect(forgotten).toEqual([t(1).endpoint]);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toContain('{"title":"MasterTutor","body":"A run failed","url":"/settings/alerts#alert-11111111-1111-4111-8111-111111111111"}');
  });

  it("sends nothing without VAPID keys or HTTPS (in-app only)", async () => {
    let asked = false;
    const outcomes = await deliverAlert(
      { vapid: null, targets: async () => ((asked = true), [t(1)]), forget: async () => undefined, send: async () => "sent" },
      ALERT,
    );
    expect([outcomes, asked]).toEqual([[], false]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit apps/web/lib/server/push/send.test.ts apps/web/lib/server/alerts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

`apps/web/lib/server/push/send.ts`:

```ts
import { isPushServiceEndpoint, PushPayload } from "@mastertutor/contracts";
import type { PushOutcome } from "@mastertutor/contracts/telemetry";
import type { PushTarget } from "@mastertutor/db";
import { encryptPayload } from "./encrypt.ts";
import { vapidAuthorization, type VapidKeys } from "./vapid.ts";

const TIMEOUT_MS = 5_000;

/** One Web Push to one subscription (spec §13.4). Never throws; never follows a redirect. */
export async function sendPush(
  target: PushTarget,
  payload: PushPayload,
  keys: VapidKeys,
  fetchImpl: typeof fetch = fetch,
): Promise<PushOutcome> {
  if (!isPushServiceEndpoint(target.endpoint)) return "refused";
  try {
    const body = encryptPayload({
      plaintext: Buffer.from(JSON.stringify(PushPayload.parse(payload))),
      uaPublic: Buffer.from(target.p256dh, "base64url"),
      authSecret: Buffer.from(target.auth, "base64url"),
    });
    const response = await fetchImpl(target.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: vapidAuthorization(target.endpoint, keys),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "3600",
        urgency: "high",
      },
      body,
    });
    if (response.status === 404 || response.status === 410) return "gone";
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export type SendPush = typeof sendPush;
```

`apps/web/lib/server/alerts/read-capped.ts`:

```ts
/** The request body as text, or null when it is larger than maxBytes (read no further than that). */
export async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
```

`apps/web/lib/server/alerts/webhook.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { AlertWebhookBody, MAX_ALERT_WEBHOOK_BYTES, type AlertRule } from "@mastertutor/contracts";
import { recordAlertReceived } from "@mastertutor/telemetry/record";
import { readCapped } from "./read-capped.ts";

export interface WebhookDeps {
  secret: string | undefined;
  /** Stores the alert (deduped); null when there is no workspace yet. */
  record(rule: AlertRule): Promise<{ id: string; workspaceId: string; created: boolean } | null>;
  /** Runs for a new alert only, after the response (Next's after()). */
  onRecorded(alert: { id: string; rule: AlertRule; workspaceId: string }): void;
}

const status = (code: number) => new Response(null, { status: code, headers: { "cache-control": "no-store" } });
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant time, whatever the lengths. */
function bearerMatches(header: string | null, secret: string): boolean {
  const given = header?.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(given), digest(secret));
}

/**
 * OpenObserve → web (spec §13.2). Fail closed, in order: no secret → 404; arrived through Traefik
 * (forwarded headers) → 404, so it does not exist publicly; bearer → 401; size → 413; schema → 400.
 * Only the rule name is kept.
 */
export async function handleAlertWebhook(deps: WebhookDeps, request: Request): Promise<Response> {
  if (!deps.secret) return status(404);
  if (request.headers.has("x-forwarded-for") || request.headers.has("x-forwarded-host")) return status(404);
  if (!bearerMatches(request.headers.get("authorization"), deps.secret)) return status(401);
  const text = await readCapped(request, MAX_ALERT_WEBHOOK_BYTES);
  if (text === null) return status(413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return status(400);
  }
  const body = AlertWebhookBody.safeParse(json);
  if (!body.success) return status(400);
  const alert = await deps.record(body.data.rule);
  if (!alert) return status(409);
  recordAlertReceived(body.data.rule);
  if (alert.created) deps.onRecorded({ id: alert.id, rule: body.data.rule, workspaceId: alert.workspaceId });
  return status(202);
}
```

`apps/web/lib/server/alerts/deliver.ts`:

```ts
import { alertPushPayload, type AlertRule } from "@mastertutor/contracts";
import { ATTR, SPAN, type PushOutcome } from "@mastertutor/contracts/telemetry";
import type { PushTarget } from "@mastertutor/db";
import { instrument } from "@mastertutor/telemetry/instrument";
import { recordPush } from "@mastertutor/telemetry/record";
import { sendPush, type SendPush } from "../push/send.ts";
import type { VapidKeys } from "../push/vapid.ts";

export interface DeliverDeps {
  /** Null without VAPID keys or HTTPS: alerts stay in-app (spec §13.4). */
  vapid: VapidKeys | null;
  targets(): Promise<PushTarget[]>;
  forget(endpoint: string): Promise<void>;
  send?: SendPush;
}

/** Fans one alert out to the owner's phones, in parallel, once each (seam 10). */
export function deliverAlert(deps: DeliverDeps, alert: { id: string; rule: AlertRule }): Promise<PushOutcome[]> {
  return instrument(SPAN.alertDelivery, { [ATTR.alertRule]: alert.rule }, async (span) => {
    const vapid = deps.vapid;
    if (!vapid) return [];
    const payload = alertPushPayload(alert);
    const send = deps.send ?? sendPush;
    const outcomes = await Promise.all(
      (await deps.targets()).map(async (target) => {
        const outcome = await send(target, payload, vapid);
        recordPush(outcome);
        if (outcome === "gone") await deps.forget(target.endpoint).catch(() => undefined);
        return outcome;
      }),
    );
    if (outcomes.length > 0 && !outcomes.includes("sent")) span.fail("push_failed");
    return outcomes;
  });
}
```

`apps/web/app/api/alerts/webhook/route.ts`:

```ts
import { ALERT_DEDUPE_MINUTES } from "@mastertutor/contracts";
import { deletePushSubscriptionByEndpoint, onlyWorkspaceId, ownerPushTargets, recordAlert } from "@mastertutor/db";
import { after } from "next/server";
import { deliverAlert } from "@/lib/server/alerts/deliver.ts";
import { handleAlertWebhook } from "@/lib/server/alerts/webhook.ts";
import { getDb } from "@/lib/server/db.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import { vapidKeysOf } from "@/lib/server/push/config.ts";

export const dynamic = "force-dynamic";

/** OpenObserve's alert destination, over the internal `observe` network (spec §13.2). */
export async function POST(request: Request): Promise<Response> {
  const env = getWebEnv();
  const db = getDb().db;
  return handleAlertWebhook(
    {
      secret: env.ALERT_WEBHOOK_SECRET,
      record: async (rule) => {
        const workspaceId = await onlyWorkspaceId(db);
        if (!workspaceId) return null;
        return { ...(await recordAlert(db, { workspaceId, rule, dedupeMinutes: ALERT_DEDUPE_MINUTES })), workspaceId };
      },
      onRecorded: (alert) =>
        after(() =>
          deliverAlert(
            {
              vapid: vapidKeysOf(env),
              targets: () => ownerPushTargets(db, alert.workspaceId),
              forget: (endpoint) => deletePushSubscriptionByEndpoint(db, endpoint),
            },
            alert,
          ).then(() => undefined),
        ),
    },
    request,
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `scripts/remote-test.sh unit apps/web/lib/server/push apps/web/lib/server/alerts`, then `scripts/remote-test.sh integration apps/web/lib/server/alerts/webhook.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/push/send.ts apps/web/lib/server/push/send.test.ts apps/web/lib/server/alerts apps/web/app/api/alerts
git commit -m "feat(web): alert webhook, deduped storage and Web Push fan-out (D50)" -- apps/web/lib/server/push/send.ts apps/web/lib/server/push/send.test.ts apps/web/lib/server/alerts apps/web/app/api/alerts
```

---

### Task C5: `alerts` RPC namespace (live and fixture)

**Files:**
- Modify: `packages/contracts/src/api/contract.ts`, `apps/web/lib/server/rpc/live-router.ts` (`createLiveRouter`, `liveRouter`), `apps/web/lib/fixtures/types.ts` (`FixtureState`), `apps/web/lib/fixtures/seed.ts` (`createSeed` return), `apps/web/lib/fixtures/router.ts` (`fixtureRouter`)
- Create: `apps/web/lib/server/rpc/alerts.ts`, `apps/web/lib/server/rpc/alerts.int.test.ts`
- Test: `apps/web/lib/fixtures/router.test.ts` (append)

**Interfaces:**
- Consumes: C1 (queries), C2 (`ownerScoped`), C3 (`pushConfigOf`), Task 0 DTOs, `served` and `ServiceError` (`apps/web/lib/server/service-error.ts`).
- Produces: `apiContract.alerts` = `{ list, active, acknowledge, pushConfig, subscribe, unsubscribe }`, and `createAlertProcedures(deps: { db(): DbHandle; push(): PushConfig })`.

- [ ] **Step 1: Add the contract (`packages/contracts/src/api/contract.ts`)**

Import `AlertRef, AlertView, PushConfig, PushEndpointRef, PushSubscriptionInput` from `"../alerts.ts"`. Add this namespace after `benchmarks`:

```ts
  /** Owner only (D50, spec §13.3, §13.4). */
  alerts: {
    list: oc.input(PageInput).output(Page(AlertView)),
    active: oc.input(Empty).output(z.object({ items: z.array(AlertView) })),
    acknowledge: oc.input(AlertRef).output(Ok),
    pushConfig: oc.input(Empty).output(PushConfig),
    subscribe: oc.input(PushSubscriptionInput).output(Ok),
    unsubscribe: oc.input(PushEndpointRef).output(Ok),
  },
```

- [ ] **Step 2: Write the failing tests**

`apps/web/lib/server/rpc/alerts.int.test.ts`:

```ts
import { createDb, recordAlert, type DbHandle } from "@mastertutor/db";
import { seedMember, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAlertProcedures } from "./alerts.ts";
import { liveOs } from "./live-os.ts";

let database: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let ownerId: string;
let memberId: string;
let workspaceId: string;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  web = createDb(database.webUrl, { max: 2 });
  ({ userId: ownerId, workspaceId } = await seedMember(owner.db, { role: "owner" }));
  ({ userId: memberId } = await seedMember(owner.db, { workspaceId, role: "member" }));
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close()]);
  await database?.stop();
});

const router = (available: boolean) =>
  liveOs.router({
    alerts: createAlertProcedures({
      db: () => web,
      push: () => ({ available, publicKey: available ? `B${"A".repeat(86)}` : null }),
    }),
  } as never);
const as = (id: string, available = true) =>
  createRouterClient(router(available) as never, {
    context: { viewer: { id, name: "T", email: "t@example.test" }, resHeaders: new Headers() },
  }) as any;
const subscription = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) } };

describe("alerts.* (spec §13.3, Review Focus 4)", () => {
  it("lets the owner list, acknowledge and subscribe", async () => {
    const alert = await recordAlert(web.db, { workspaceId, rule: "run_failed", dedupeMinutes: 10 });
    const client = as(ownerId);
    expect((await client.alerts.active({})).items.map((a: { id: string }) => a.id)).toContain(alert.id);
    expect(await client.alerts.acknowledge({ id: alert.id })).toEqual({ ok: true });
    expect((await client.alerts.list({ limit: 10, cursor: null })).items[0].acknowledgedAt).not.toBeNull();
    expect(await client.alerts.subscribe(subscription)).toEqual({ ok: true });
    expect(await client.alerts.unsubscribe({ endpoint: subscription.endpoint })).toEqual({ ok: true });
  });

  it("is FORBIDDEN to a member for every procedure", async () => {
    const client = as(memberId);
    for (const call of [
      () => client.alerts.list({ limit: 10, cursor: null }),
      () => client.alerts.active({}),
      () => client.alerts.acknowledge({ id: "11111111-1111-4111-8111-111111111111" }),
      () => client.alerts.pushConfig({}),
      () => client.alerts.subscribe(subscription),
      () => client.alerts.unsubscribe({ endpoint: subscription.endpoint }),
    ])
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses to subscribe when push is unavailable, and a non-push endpoint always", async () => {
    await expect(as(ownerId, false).alerts.subscribe(subscription)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      as(ownerId).alerts.subscribe({ ...subscription, endpoint: "https://169.254.169.254/x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
```

If `liveOs.router({ alerts })` does not typecheck against the full contract, build the router with `createLiveRouter` from `live-router.ts` instead, giving it a `db` getter that returns `web` and a `push` getter. The test only calls `alerts.*`.

Append to `apps/web/lib/fixtures/router.test.ts`:

```ts
describe("fixture alerts", () => {
  it("lists the seeded (acknowledged) alert and reports push unavailable on http", async () => {
    const { api } = client();
    expect((await api.alerts.active({})).items).toEqual([]);
    expect((await api.alerts.list({ limit: 10, cursor: null })).items).toHaveLength(1);
    expect(await api.alerts.pushConfig({})).toEqual({ available: false, publicKey: null });
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit apps/web/lib/fixtures/router.test.ts`, then `scripts/remote-test.sh integration apps/web/lib/server/rpc/alerts.int.test.ts`
Expected: FAIL. `alerts` is not implemented, and `pnpm typecheck` reports that both routers are missing `alerts`.

- [ ] **Step 4: Write `apps/web/lib/server/rpc/alerts.ts`**

```ts
import type { PushConfig } from "@mastertutor/contracts";
import {
  KeysetCursorInvalid,
  acknowledgeAlert,
  activeAlerts,
  deletePushSubscription,
  listAlerts,
  savePushSubscription,
  type DbHandle,
} from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { ServiceError, served } from "../service-error.ts";
import { ownerScoped } from "./owner-scope.ts";

/** alerts.* (spec §13.3, §13.4): the workspace owner only. */
export function createAlertProcedures(deps: { db(): DbHandle; push(): PushConfig }) {
  const owner = ownerScoped(deps.db);
  return {
    list: owner.alerts.list.handler(({ context, input }) =>
      served(async () => {
        try {
          return await listAlerts(context.db.db, context.workspaceId, input);
        } catch (error) {
          if (error instanceof KeysetCursorInvalid) throw new ServiceError("invalid", "Invalid page cursor");
          throw error;
        }
      }),
    ),
    active: owner.alerts.active.handler(async ({ context }) => ({
      items: await activeAlerts(context.db.db, context.workspaceId),
    })),
    acknowledge: owner.alerts.acknowledge.handler(async ({ context, input }) => {
      const found = await acknowledgeAlert(context.db.db, {
        workspaceId: context.workspaceId,
        alertId: input.id,
        userId: context.actor,
      });
      if (!found) throw new ORPCError("NOT_FOUND", { message: "Alert not found" });
      return { ok: true as const };
    }),
    pushConfig: owner.alerts.pushConfig.handler(() => deps.push()),
    subscribe: owner.alerts.subscribe.handler(async ({ context, input }) => {
      if (!deps.push().available)
        throw new ORPCError("PRECONDITION_FAILED", { message: "Phone alerts aren't set up on this server." });
      await savePushSubscription(context.db.db, {
        userId: context.actor,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      });
      return { ok: true as const };
    }),
    unsubscribe: owner.alerts.unsubscribe.handler(async ({ context, input }) => {
      await deletePushSubscription(context.db.db, { userId: context.actor, endpoint: input.endpoint });
      return { ok: true as const };
    }),
  };
}
```

In `apps/web/lib/server/rpc/live-router.ts`:

- import `createAlertProcedures` and `pushConfigOf`, plus `getWebEnv`;
- add `push(): PushConfig;` to `LiveRouterDeps`;
- create `const alerts = createAlertProcedures({ db: deps.db, push: deps.push });`;
- add `alerts,` to `os.router({...})`;
- add `push: () => pushConfigOf(getWebEnv()),` to the `liveRouter` deps.

- [ ] **Step 5: Fixture router**

In `apps/web/lib/fixtures/types.ts`, add `alerts: AlertView[];` and `pushEndpoints: string[];` to `FixtureState`, importing `AlertView`.

In `apps/web/lib/fixtures/seed.ts`, add to `createSeed()`'s returned object:

```ts
    // One past alert for the Alerts list; acknowledged, so no banner shows by default.
    alerts: [
      {
        id: "a1e7a1e7-0000-4000-8000-000000000001",
        rule: "run_failed",
        label: "A run failed",
        firedAt: "2026-09-30T14:05:00.000Z",
        acknowledgedAt: "2026-09-30T14:20:00.000Z",
      },
    ],
    pushEndpoints: [],
```

In `apps/web/lib/fixtures/router.ts`, add this to `fixtureRouter`. Fixture builds run on http, so push is unavailable:

```ts
  alerts: {
    list: os.alerts.list.handler(({ context, input }) => {
      const items = stateFor(context.ns).alerts.slice(0, input.limit);
      return { items, nextCursor: null };
    }),
    active: os.alerts.active.handler(({ context }) => ({
      items: stateFor(context.ns).alerts.filter((alert) => alert.acknowledgedAt === null).slice(0, 5),
    })),
    acknowledge: os.alerts.acknowledge.handler(({ context, input }) => {
      const alert = stateFor(context.ns).alerts.find((a) => a.id === input.id);
      if (!alert) throw notFound("Alert");
      alert.acknowledgedAt ??= now();
      return { ok: true as const };
    }),
    pushConfig: os.alerts.pushConfig.handler(() => ({ available: false, publicKey: null })),
    subscribe: os.alerts.subscribe.handler(() => {
      throw new ORPCError("PRECONDITION_FAILED", { message: "Phone alerts aren't set up on this server." });
    }),
    unsubscribe: os.alerts.unsubscribe.handler(({ context, input }) => {
      const state = stateFor(context.ns);
      state.pushEndpoints = state.pushEndpoints.filter((e) => e !== input.endpoint);
      return { ok: true as const };
    }),
  },
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm typecheck`, `scripts/remote-test.sh unit apps/web/lib/fixtures`, `scripts/remote-test.sh integration apps/web/lib/server/rpc/alerts.int.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(api): owner-only alerts RPC, live and fixture (D50)" -- packages/contracts/src/api/contract.ts apps/web/lib/server/rpc/alerts.ts apps/web/lib/server/rpc/alerts.int.test.ts apps/web/lib/server/rpc/live-router.ts apps/web/lib/fixtures/types.ts apps/web/lib/fixtures/seed.ts apps/web/lib/fixtures/router.ts apps/web/lib/fixtures/router.test.ts
```

---

### Task C6: Home Screen app, service worker, Notifications, banner and Alerts page

**Files:**
- Create:
  - `apps/web/app/manifest.ts`, `apps/web/app/icon.tsx`, `apps/web/app/apple-icon.tsx`;
  - `apps/web/app/sw.js/route.ts`, `apps/web/lib/push/service-worker.ts`, `apps/web/lib/push/service-worker.test.ts`;
  - `apps/web/components/alerts/push-support.ts`, `push-support.test.ts`, `notifications-group.tsx`, `alert-banner.tsx`, `alerts-view.tsx`;
  - `apps/web/app/(app)/settings/alerts/page.tsx`.
- Modify: `apps/web/components/shell/app-shell.tsx` (next to `<KillBanner />`), `apps/web/components/settings/settings-view.tsx` (after the Safety group, and the Activity nav), `apps/web/styles/shell.css` (`.alert-banner` next to `.kill-banner`)

**Interfaces:**
- Consumes: C5 (`orpc.alerts.*`, `api.alerts.*`), Task 0 (`OBSERVABILITY_ENTER_PATH`, `AlertView`, `PushConfig`).
- Produces:
  - `pushSupport(input: { secureContext: boolean; standalone: boolean; iOS: boolean; hasPush: boolean; config: PushConfig | undefined }): PushSupport`, where `PushSupport` is `"insecure" | "ios_install" | "unsupported" | "unavailable" | "ready"`;
  - `SERVICE_WORKER_SOURCE: string`;
  - the components `NotificationsGroup`, `AlertBanner` and `AlertsView`;
  - the route `/sw.js` and the page `/settings/alerts`.

- [ ] **Step 1: Write the failing tests**

`apps/web/components/alerts/push-support.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PUSH_HINTS, pushSupport } from "./push-support.ts";

const ready = { secureContext: true, standalone: true, iOS: true, hasPush: true, config: { available: true, publicKey: "B" } };

describe("pushSupport (spec §13.4)", () => {
  it("explains each state in order", () => {
    expect(pushSupport({ ...ready, secureContext: false })).toBe("insecure");
    expect(pushSupport({ ...ready, standalone: false })).toBe("ios_install");
    expect(pushSupport({ ...ready, iOS: false, standalone: false, hasPush: false })).toBe("unsupported");
    expect(pushSupport({ ...ready, config: { available: false, publicKey: null } })).toBe("unavailable");
    expect(pushSupport(ready)).toBe("ready");
    expect(pushSupport({ ...ready, iOS: false, standalone: false })).toBe("ready");
  });

  it("says what to do, in plain words", () => {
    expect(PUSH_HINTS.insecure).toBe("Phone alerts need the deployed HTTPS site. Alerts still appear here in the app.");
    expect(PUSH_HINTS.ios_install).toBe(
      "On iPhone, add MasterTutor to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on phone alerts.",
    );
  });
});
```

`apps/web/lib/push/service-worker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SERVICE_WORKER_SOURCE } from "./service-worker.ts";

describe("service worker (spec §13.4)", () => {
  it("shows the payload's title, body and link, and opens same-origin links only", () => {
    expect(SERVICE_WORKER_SOURCE).toContain('addEventListener("push"');
    expect(SERVICE_WORKER_SOURCE).toContain('addEventListener("notificationclick"');
    expect(SERVICE_WORKER_SOURCE).toContain("new URL(url, self.location.origin).origin === self.location.origin");
    expect(SERVICE_WORKER_SOURCE).not.toMatch(/fetch\(|importScripts/);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `scripts/remote-test.sh unit apps/web/components/alerts apps/web/lib/push`
Expected: FAIL, modules not found.

- [ ] **Step 3: PWA files**

`apps/web/lib/push/service-worker.ts`:

```ts
/**
 * The service worker (spec §13.4): shows a push and opens its same-origin deep link. It caches
 * nothing and fetches nothing, so it never changes how the app loads.
 */
export const SERVICE_WORKER_SOURCE = `
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = typeof data.title === "string" ? data.title : "MasterTutor";
  const body = typeof data.body === "string" ? data.body : "";
  const url = typeof data.url === "string" ? data.url : "/settings/alerts";
  event.waitUntil(self.registration.showNotification(title, { body, tag: "mt-alert", data: { url } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  const target = typeof url === "string" && new URL(url, self.location.origin).origin === self.location.origin
    ? url
    : "/settings/alerts";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) if ("focus" in client) return client.navigate(target).then((c) => c && c.focus());
      return self.clients.openWindow(target);
    }),
  );
});
`;
```

`apps/web/app/sw.js/route.ts`:

```ts
import { SERVICE_WORKER_SOURCE } from "@/lib/push/service-worker.ts";

export const dynamic = "force-static";

/** Served from the root so its scope is the whole app; never cached stale. */
export function GET(): Response {
  return new Response(SERVICE_WORKER_SOURCE, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "service-worker-allowed": "/",
    },
  });
}
```

`apps/web/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

/** Installable on the iPhone Home Screen (iOS 16.4+), which Web Push needs there (spec §13.4). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MasterTutor",
    short_name: "MasterTutor",
    start_url: "/library",
    scope: "/",
    display: "standalone",
    background_color: "#FAFAFA",
    theme_color: "#FAFAFA",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
```

`apps/web/app/icon.tsx`:

```tsx
import { ImageResponse } from "next/og";

export function generateImageMetadata() {
  return [192, 512].map((size) => ({ id: String(size), size: { width: size, height: size }, contentType: "image/png" }));
}

/** The app mark, drawn by Next (no image files or new dependencies). */
export default async function Icon({ id }: { id: Promise<string> | string }) {
  const size = Number(await id);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#FAFAFA", color: "#1D1D1F", fontSize: size * 0.56, fontWeight: 700, fontFamily: "sans-serif", letterSpacing: -size * 0.02 }}>
        M
      </div>
    ),
    { width: size, height: size },
  );
}
```

`apps/web/app/apple-icon.tsx`:

```tsx
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#FAFAFA", color: "#1D1D1F", fontSize: 100, fontWeight: 700, fontFamily: "sans-serif" }}>
        M
      </div>
    ),
    size,
  );
}
```

The `stylelint` and raw-values tests apply to CSS files, not to these inline styles. `ImageResponse` requires inline styles. If `apps/web/styles/raw-values.test.ts` scans `.tsx` files, add `app/icon.tsx` and `app/apple-icon.tsx` to its exemptions, with the comment "ImageResponse renders without the app's CSS".

- [ ] **Step 4: Push support logic (`apps/web/components/alerts/push-support.ts`)**

```ts
import type { PushConfig } from "@mastertutor/contracts";

export type PushSupport = "insecure" | "ios_install" | "unsupported" | "unavailable" | "ready";

export const PUSH_HINTS: Record<Exclude<PushSupport, "ready">, string> = {
  insecure: "Phone alerts need the deployed HTTPS site. Alerts still appear here in the app.",
  ios_install:
    "On iPhone, add MasterTutor to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on phone alerts.",
  unsupported: "This browser can't receive push notifications. Alerts still appear here in the app.",
  unavailable: "Phone alerts aren't set up on this server.",
};

/** What the Notifications row can offer here (spec §13.4), checked in order. */
export function pushSupport(input: {
  secureContext: boolean;
  standalone: boolean;
  iOS: boolean;
  hasPush: boolean;
  config: PushConfig | undefined;
}): PushSupport {
  if (!input.secureContext) return "insecure";
  if (input.iOS && !input.standalone) return "ios_install";
  if (!input.hasPush) return "unsupported";
  if (!input.config?.available) return "unavailable";
  return "ready";
}

/** Reads the browser once on the client. */
export function browserPushInput(config: PushConfig | undefined) {
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return {
    secureContext: window.isSecureContext,
    standalone: (navigator as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches,
    iOS,
    hasPush: "serviceWorker" in navigator && "PushManager" in window,
    config,
  };
}
```

- [ ] **Step 5: Components**

`apps/web/components/alerts/notifications-group.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { PUSH_HINTS, browserPushInput, pushSupport, type PushSupport } from "./push-support.ts";

/** Settings → Notifications (spec §13.4). Owner only: for anyone else pushConfig is FORBIDDEN and nothing renders. */
export function NotificationsGroup() {
  const toast = useToast();
  const { data: config, isError } = useQuery(orpc.alerts.pushConfig.queryOptions({ input: {} }));
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config) return;
    const state = pushSupport(browserPushInput(config));
    setSupport(state);
    if (state === "ready")
      void navigator.serviceWorker
        .getRegistration("/")
        .then((registration) => registration?.pushManager.getSubscription())
        .then((subscription) => setOn(Boolean(subscription)));
  }, [config]);

  if (isError || !config || !support) return null;

  const toggle = async (next: boolean) => {
    if (busy || !config.publicKey) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      if (next) {
        if ((await Notification.requestPermission()) !== "granted") throw new Error("denied");
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(atob(config.publicKey.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)),
        });
        const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        await api.alerts.subscribe({ endpoint: json.endpoint, keys: json.keys });
      } else {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await api.alerts.unsubscribe({ endpoint: subscription.endpoint });
          await subscription.unsubscribe();
        }
      }
      setOn(next);
      toast({ title: next ? "Phone alerts on" : "Phone alerts off", icon: "ok" });
    } catch {
      toast({ title: "Couldn't change phone alerts.", icon: "needsReview", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="t-title3 group-title">Notifications</h2>
      <div className="group">
        <div className="row">
          <span className="min-w-0">
            Phone alerts
            <small>{support === "ready" ? "Failed runs, rejected requests, crashing slots, spend jumps and error spikes." : PUSH_HINTS[support]}</small>
          </span>
          {support === "ready" ? <Switch label="Phone alerts" checked={on} busy={busy} onCheckedChange={(next) => void toggle(next)} /> : null}
        </div>
      </div>
    </>
  );
}
```

`atob` decodes base64 only. The two `replaceAll` calls turn base64url into base64. Padding is not needed for the 87-character key, because `atob` accepts unpadded input in browsers. If a test environment complains, append `"="`.

`apps/web/components/alerts/alert-banner.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Icon } from "@/components/ui/icon.tsx";
import { orpc } from "@/lib/api/client.ts";

/** Unacknowledged alerts, for the owner only (anyone else gets FORBIDDEN and sees nothing). Fetched on mount and focus, never polled. */
export function AlertBanner() {
  const { data } = useQuery({
    ...orpc.alerts.active.queryOptions({ input: {} }),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const first = data?.items[0];
  if (!first) return null;
  const more = data.items.length - 1;
  return (
    <div className="alert-banner" role="status">
      <Icon name="needsReview" />
      <span>
        <b>{first.label}.</b>
        {more > 0 ? ` And ${more} more.` : ""}
      </span>
      <Link href={`/settings/alerts#alert-${first.id}`}>Alerts</Link>
    </div>
  );
}
```

`apps/web/components/alerts/alerts-view.tsx`:

```tsx
"use client";

import { OBSERVABILITY_ENTER_PATH, type AlertView } from "@mastertutor/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { formatDateTime } from "@/lib/notes/format.ts";

/** /settings/alerts (spec §13.3): newest first, each one acknowledgeable, with a link to the dashboards. */
export function AlertsView() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useInfiniteQuery(
    orpc.alerts.list.infiniteOptions({
      input: (cursor: string | null) => ({ limit: 50, cursor }),
      initialPageParam: null,
      getNextPageParam: (page) => page.nextCursor,
    }),
  );
  const items: AlertView[] = query.data?.pages.flatMap((page) => page.items) ?? [];
  const acknowledge = async (id: string) => {
    try {
      await api.alerts.acknowledge({ id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: orpc.alerts.list.key() }),
        qc.invalidateQueries({ queryKey: orpc.alerts.active.key() }),
      ]);
    } catch {
      toast({ title: "Couldn't acknowledge the alert.", icon: "needsReview", tone: "danger" });
    }
  };
  return (
    <section className="page">
      <PageHead title="Alerts" />
      {/* A plain link: /observability is served by OpenObserve through ForwardAuth (spec §12). */}
      <p>
        <a className="row-link" href={OBSERVABILITY_ENTER_PATH}>Open dashboards</a>
      </p>
      {query.isError ? (
        <LoadError onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading alerts">
          <Skeleton className="h-40 rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        <p className="muted">No alerts yet.</p>
      ) : (
        <ul className="group" aria-label="Alerts">
          {items.map((alert) => (
            <li key={alert.id} id={`alert-${alert.id}`} className="row">
              <span className="min-w-0">
                {alert.label}
                <small>{formatDateTime(alert.firedAt)}</small>
              </span>
              {alert.acknowledgedAt ? (
                <span className="muted">Acknowledged</span>
              ) : (
                <Button onClick={() => void acknowledge(alert.id)}>Acknowledge</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? <Button onClick={() => void query.fetchNextPage()}>Show more</Button> : null}
    </section>
  );
}
```

Match `PageHead`'s, `LoadError`'s and `formatDateTime`'s props to their definitions. `audit-view.tsx` uses all three; copy its usage exactly. Wrap the page in the same outer markup that `AuditView` uses (its `<Toolbar>`/`<Crumbs>` header and section class), so the page matches the Settings sub-pages.

`apps/web/app/(app)/settings/alerts/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AlertsView } from "@/components/alerts/alerts-view.tsx";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return <AlertsView />;
}
```

In `apps/web/components/shell/app-shell.tsx`, import `AlertBanner` and render `<AlertBanner />` right after `<KillBanner />`.

In `apps/web/components/settings/settings-view.tsx`, import `NotificationsGroup` and render `<NotificationsGroup />` right after the Safety group's closing `</div>`. In the Activity `<nav>`, add after Audit log:

```tsx
              <Link className="row row-link" href="/settings/alerts">
                <span>
                  <Icon name="needsReview" /> Alerts
                </span>
                <Icon name="chevronRight" />
              </Link>
```

In `apps/web/styles/shell.css`, give `.alert-banner` the same rules as `.kill-banner`. Do it by changing that selector to `.kill-banner, .alert-banner`; the second banner's colours come from the same tokens. Add nothing else.

The existing `settings.spec.ts` "settings groups are clean" test lists group headings. The fixture viewer is the owner and gets `pushConfig` `{ available: false }`, so the new "Notifications" heading appears. Add `"Notifications"` to that test's list of headings.

- [ ] **Step 6: Run the tests**

Run: `scripts/remote-test.sh unit apps/web`, `pnpm lint`, `pnpm typecheck`, `scripts/remote-test.sh web-build`
Expected: PASS. `check:first-load` stays within its baseline. If it does not, lazy-load `NotificationsGroup` with `next/dynamic` the way other settings-only components are loaded.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/manifest.ts apps/web/app/icon.tsx apps/web/app/apple-icon.tsx apps/web/app/sw.js apps/web/lib/push apps/web/components/alerts "apps/web/app/(app)/settings/alerts"
git commit -m "feat(web): Home Screen app, service worker, phone alerts toggle, alert banner and Alerts page (D50)" -- apps/web/app/manifest.ts apps/web/app/icon.tsx apps/web/app/apple-icon.tsx apps/web/app/sw.js apps/web/lib/push apps/web/components/alerts "apps/web/app/(app)/settings/alerts" apps/web/components/shell/app-shell.tsx apps/web/components/settings/settings-view.tsx apps/web/styles/shell.css apps/web/e2e/settings.spec.ts
```

---

### Task C7: UI tests, including the local degradation

**Files:**
- Create: `apps/web/e2e/alerts.spec.ts`

**Interfaces:**
- Consumes: C6 UI and the fixture router (C5).
- Produces: Playwright coverage for the banner, acknowledgement, the Alerts page, the Notifications hint on http, and the manifest and service worker being served.

- [ ] **Step 1: Write the test**

```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const ACTIVE = {
  id: "a1e7a1e7-0000-4000-8000-000000000002",
  rule: "slot_crash_loop",
  label: "A browser slot keeps crashing",
  firedAt: "2026-10-08T10:00:00.000Z",
  acknowledgedAt: null,
};

test("an active alert shows the banner, which links to the Alerts list", async ({ page }) => {
  await page.route("**/api/rpc/alerts/active", (route) => route.fulfill({ json: { json: { items: [ACTIVE] } } }));
  await page.goto("/library");
  const banner = page.getByRole("status").filter({ hasText: "A browser slot keeps crashing." });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Alerts" })).toHaveAttribute("href", `/settings/alerts#alert-${ACTIVE.id}`);
  await expectCleanScreen(page);
});

test("no banner without active alerts", async ({ page }) => {
  await page.goto("/library");
  await expect(page.locator(".alert-banner")).toHaveCount(0);
});

test("the Alerts page lists past alerts and links to the dashboards", async ({ page }) => {
  await page.goto("/settings/alerts");
  await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Alerts" }).getByText("A run failed")).toBeVisible();
  await expect(page.getByText("Acknowledged")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open dashboards" })).toHaveAttribute("href", "/api/observability/enter");
  await expectCleanScreen(page);
});

test("on a plain-http origin, Notifications says phone alerts need the HTTPS site (degradation)", async ({ page }) => {
  // The fixture server is 127.0.0.1, which browsers treat as secure; the local stack at
  // http://<host> is not. Simulate that origin's isSecureContext.
  await page.addInitScript(() => Object.defineProperty(window, "isSecureContext", { value: false }));
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(
    page.getByText("Phone alerts need the deployed HTTPS site. Alerts still appear here in the app."),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Phone alerts" })).toHaveCount(0);
});

test("on an iPhone browser tab, Notifications asks to add the app to the Home Screen first", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto("/settings");
  await expect(
    page.getByText(
      "On iPhone, add MasterTutor to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on phone alerts.",
    ),
  ).toBeVisible();
  await context.close();
});

test("without VAPID keys, Notifications says phone alerts aren't set up (fixture server)", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Phone alerts aren't set up on this server.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Phone alerts" })).toHaveCount(0);
});

test("the app is installable: manifest, icons and service worker are served", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "MasterTutor", display: "standalone" });
  expect((await request.get("/icon/192")).headers()["content-type"]).toContain("image/png");
  expect((await request.get("/apple-icon")).headers()["content-type"]).toContain("image/png");
  const sw = await request.get("/sw.js");
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).toContain("notificationclick");
});
```

The fixture build signs in its own viewer. If `apps/web/e2e/helpers/test.ts` signs in through a fixture cookie, set that cookie on the new iPhone context the same way the helper does. Copy the helper's `context.addCookies` call; the fixture viewer is the owner.

- [ ] **Step 2: Run the test**

Run: `scripts/remote-test.sh ui apps/web/e2e/alerts.spec.ts apps/web/e2e/settings.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(web): alerts banner, Alerts page, Notifications degradation and installability (D50)" -- apps/web/e2e/alerts.spec.ts
```

---
## Track F: End to end

### Task F1: The `observability` remote suite: pipeline, owner-only access, alerts and resilience

**Depends on:** A7, B7, C7.

**Files:**
- Create: `scripts/observability-stack.sh`, `tests/observability/compose.observability.yml`, `tests/observability/stack.ts`, `tests/observability/1-access.int.test.ts`, `tests/observability/2-pipeline.int.test.ts`, `tests/observability/3-resilience.int.test.ts`
- Modify: `infra/traefik/test-dynamic.yml` (the `/observability` router), `scripts/lib/test-stack.sh` (the `MT_CI_TELEMETRY` opt-in), `scripts/remote-test.sh` (the suite lists), `scripts/remote-test/run-on-host.sh` (the suite's cases), `scripts/remote-test.test.ts`, `scripts/README.md`

**Interfaces:**
- Consumes: the whole stack (Tasks 0, A, B, C); `generateSecrets` (`scripts/env-init.ts`).
- Produces:
  - `scripts/remote-test.sh observability`;
  - `MT_CI_TELEMETRY=1` for the e2e, smoke and bench-mock stacks;
  - `tests/observability/stack.ts` (`stack.compose(args)`, `stack.baseUrl`, `signUp(email)`, `owner()` and `waitFor(probe, timeoutMs)`).

- [ ] **Step 1: Stack wiring**

`tests/observability/compose.observability.yml`:

```yaml
# Telemetry on a test stack (D50, spec §16): `scripts/remote-test.sh observability`, or any stack
# suite with MT_CI_TELEMETRY=1. Never part of a default test stack.
services:
  web:
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      MT_DEPLOYMENT: test
  agent:
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      MT_DEPLOYMENT: test
  traefik:
    networks:
      observe-edge: {}
```

In `infra/traefik/test-dynamic.yml`, add this router under `http.routers`:

```yaml
    observability:
      rule: 'Host(`localhost`) && PathRegexp(`^/observability(/|$)`)'
      priority: 900
      entryPoints: [web]
      middlewares: [observability-auth, live-headers]
      service: observability
```

Add this middleware under `http.middlewares`:

```yaml
    observability-auth:
      forwardAuth:
        address: http://172.30.231.11:3000/api/observability/auth
        trustForwardHeader: false
        authResponseHeaders: [Authorization, Cookie]
```

Add this service under `http.services`:

```yaml
    observability:
      loadBalancer:
        servers:
          - url: http://openobserve:5080
```

Without the profile, `openobserve` does not exist, and only `/observability` requests fail, with 502. The e2e stack never makes one.

`scripts/observability-stack.sh`:

```bash
#!/usr/bin/env bash
# The observability suite (D50, spec §16): the test stack plus the telemetry profile, then
# tests/observability/*.int.test.ts against it. Remote: scripts/remote-test.sh observability.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/test-stack.sh
source scripts/lib/test-stack.sh

take_stack_lock
obs_env="$(mktemp "${TMPDIR:-/tmp}/mt-obs-env.XXXXXX")"
# Fresh observability secrets for this run only (never written into the repo).
node --input-type=module -e '
import { generateSecrets } from "./scripts/env-init.ts";
const s = generateSecrets();
const keys = ["OBSERVE_ROOT_PASSWORD","OBSERVE_INGEST_PASSWORD","OBSERVE_VIEWER_PASSWORD","ALERT_WEBHOOK_SECRET","S3_OBSERVE_ACCESS_KEY_ID","S3_OBSERVE_SECRET_ACCESS_KEY"];
process.stdout.write(keys.map((k) => `${k}=${s[k]}`).join("\n") + "\n");
' >"$obs_env"
DC+=(--env-file "$obs_env" -f tests/observability/compose.observability.yml --profile observability)
trap 'stop_stack; rm -f "$obs_env"' EXIT
# The access test signs up an owner, then a member.
export AUTH_SIGNUP_OPEN=1
"${DC[@]}" up -d --build --wait --wait-timeout 420
"${DC[@]}" run --rm observability-init
MT_OBS_DC="$(printf '%s\n' "${DC[@]}")" RUN_OBSERVABILITY_STACK=1 \
  pnpm exec vitest run --project integration --sequence.shuffle=false tests/observability "$@"
echo "OBSERVABILITY OK"
```

`DC` comes from `test-stack.sh` and already carries `--env-file .env.test`. The second `--env-file` adds only the generated keys.

In `scripts/lib/test-stack.sh`, after the `DC` lines, add the opt-in:

```bash
# MT_CI_TELEMETRY=1: the stack also runs the telemetry profile (D50); tests never require it.
if [[ "${MT_CI_TELEMETRY:-0}" == "1" && -z "${MT_OBS_ENV:-}" ]]; then
  MT_OBS_ENV="$(mktemp "${TMPDIR:-/tmp}/mt-obs-env.XXXXXX")"
  node --input-type=module -e 'import { generateSecrets } from "./scripts/env-init.ts"; const s = generateSecrets(); for (const k of ["OBSERVE_ROOT_PASSWORD","OBSERVE_INGEST_PASSWORD","OBSERVE_VIEWER_PASSWORD","ALERT_WEBHOOK_SECRET","S3_OBSERVE_ACCESS_KEY_ID","S3_OBSERVE_SECRET_ACCESS_KEY"]) console.log(`${k}=${s[k]}`);' >"$MT_OBS_ENV"
  DC+=(--env-file "$MT_OBS_ENV" -f tests/observability/compose.observability.yml --profile observability)
fi
```

- [ ] **Step 2: The suite in the remote runner**

`scripts/remote-test.sh`: append `observability` to both `suites` and `all_suites`, and to the usage comment.

`scripts/remote-test/run-on-host.sh`:

- add `observability` to the AppArmor case (`behaviour | e2e | smoke | qa | bench-mock | observability)`), to the slot case (`behaviour | ui | e2e | smoke | bench-mock | observability)`) and to the Traefik dynamic-config case (`e2e | smoke | qa | bench-mock | observability)`);
- add the command:

```bash
  observability)
    command="$install && exec bash scripts/observability-stack.sh \"\$@\"" ;;
```

`scripts/remote-test.test.ts`:

- add `"observability"` at the end of the expected `suites` list;
- change the slot regex to `/^ {2}behaviour \| ui \| e2e \| smoke \| bench-mock \| observability\)\n {4}acquire_slot /m`.

`scripts/README.md`: add a line for `scripts/remote-test.sh observability`, along these lines: "the telemetry stack end to end: OpenObserve receives a run's spans, logs and metrics; `/observability` is owner-only; alerts reach the app; the product keeps working with the collector stopped. Other stack suites take `MT_CI_TELEMETRY=1` to run with telemetry on." Also add `observability` to the stack-suite list that README gives.

- [ ] **Step 3: Shared helpers (`tests/observability/stack.ts`)**

```ts
import { execFileSync } from "node:child_process";

export const enabled = process.env.RUN_OBSERVABILITY_STACK === "1";
const dc = (process.env.MT_OBS_DC ?? "").split("\n").filter(Boolean);
export const baseUrl = `http://127.0.0.1:${process.env.TEST_HTTP_PORT ?? "18080"}`;

/** docker compose with exactly the suite's files, env files and profile. */
export function compose(args: string[]): string {
  const [command, ...rest] = dc;
  return execFileSync(command!, [...rest, ...args], { encoding: "utf8" });
}

export async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

/** Better Auth email sign-up through Traefik; returns the session cookie header. */
export async function signUp(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:18080" },
    body: JSON.stringify({ email, password: "observability-test-password", name: email.split("@")[0] }),
  });
  if (!response.ok) throw new Error(`sign-up failed: ${response.status}`);
  return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

/** An OpenObserve search through /observability, i.e. through the owner's ForwardAuth. */
export async function search(cookie: string, type: "logs" | "traces", sql: string): Promise<unknown[]> {
  const now = Date.now() * 1_000;
  const response = await fetch(`${baseUrl}/observability/api/default/_search?type=${type}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ query: { sql, start_time: now - 3_600_000_000, end_time: now, size: 10 } }),
  });
  if (!response.ok) return [];
  return ((await response.json()) as { hits?: unknown[] }).hits ?? [];
}
```

The `origin` header matches `BETTER_AUTH_URL` in `.env.test`. If the stack's `BETTER_AUTH_URL` differs, read it from `compose(["config", "--format", "json"])` for `web`. The `_search` path and body are OpenObserve's. If Task B1 pinned a different search API, use the path it recorded.

- [ ] **Step 4: The tests**

The files run in name order, one at a time (the integration project sets `fileParallelism: false`, and the script passes `--sequence.shuffle=false`). The first file signs up the owner and the member, and saves both cookies with `saveCookies`. The later files read them with `cookies()`.

Add these to `tests/observability/stack.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COOKIES = join(tmpdir(), `mt-obs-cookies-${process.env.TEST_HTTP_PORT ?? "18080"}.json`);
export function saveCookies(value: { owner: string; member: string }): void {
  writeFileSync(COOKIES, JSON.stringify(value), { mode: 0o600 });
}
export function cookies(): { owner: string; member: string } {
  return JSON.parse(readFileSync(COOKIES, "utf8")) as { owner: string; member: string };
}
/** `docker compose port` exits non-zero when nothing is published. */
export function publishedPort(service: string, port: number): string {
  try {
    return compose(["port", service, String(port)]).trim();
  } catch {
    return "";
  }
}
```

In `scripts/observability-stack.sh`, change the Vitest line's arguments to `pnpm exec vitest run --project integration --sequence.shuffle=false tests/observability "$@"`.

`tests/observability/1-access.int.test.ts`:

```ts
import { chromium } from "playwright-core";
import { beforeAll, describe, expect, it } from "vitest";
import { baseUrl, cookies, enabled, publishedPort, saveCookies, signUp } from "./stack.ts";

beforeAll(async () => {
  if (!enabled) return;
  // The first account owns the workspace (D4); the second joins as a member (AUTH_SIGNUP_OPEN=1).
  saveCookies({ owner: await signUp("owner@example.test"), member: await signUp("member@example.test") });
});

describe.runIf(enabled)("/observability is owner-only (spec §12, Review Focus 4)", () => {
  it("sends a signed-out visitor to sign in, then to the entry route", async () => {
    const response = await fetch(`${baseUrl}/observability/`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/sign-in?next=%2Fapi%2Fobservability%2Fenter");
  });

  it("refuses a member and admits the owner", async () => {
    const { owner, member } = cookies();
    expect((await fetch(`${baseUrl}/observability/api/default/streams`, { headers: { cookie: member } })).status).toBe(403);
    expect((await fetch(`${baseUrl}/observability/api/default/streams`, { headers: { cookie: owner } })).status).toBe(200);
  });

  it("the alert webhook does not exist through Traefik", async () => {
    const response = await fetch(`${baseUrl}/api/alerts/webhook`, {
      method: "POST",
      headers: { authorization: "Bearer anything" },
      body: '{"rule":"run_failed"}',
    });
    expect(response.status).toBe(404);
  });

  it("the owner lands in OpenObserve's UI without its login form and sees the provisioned dashboards", async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      await context.addCookies(
        cookies().owner.split("; ").map((pair) => {
          const at = pair.indexOf("=");
          return { name: pair.slice(0, at), value: pair.slice(at + 1), url: baseUrl };
        }),
      );
      const page = await context.newPage();
      await page.goto(`${baseUrl}/api/observability/enter`);
      await page.waitForURL(/\/observability\/web\//);
      await page.goto(`${baseUrl}/observability/web/dashboards`);
      await page.getByText("MasterTutor · Runs and agent").waitFor({ timeout: 30_000 });
      expect(page.url()).not.toMatch(/\/login/);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("OpenObserve publishes no port", () => {
    expect(publishedPort("openobserve", 5080)).toBe("");
  });
});
```

`tests/observability/2-pipeline.int.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { baseUrl, compose, cookies, enabled, search, waitFor } from "./stack.ts";

describe.runIf(enabled)("telemetry reaches OpenObserve (spec §6–§11)", () => {
  it("web traces and agent logs arrive, scrubbed", async () => {
    const { owner } = cookies();
    for (let i = 0; i < 5; i++) await fetch(`${baseUrl}/sign-in`);
    const traces = await waitFor(async () => {
      const hits = await search(owner, "traces", `SELECT * FROM "default" WHERE service_name = 'web'`);
      return hits.length > 0 ? hits : null;
    }, 90_000);
    expect(JSON.stringify(traces)).not.toMatch(/url_full|"cookie"|authorization/i);
    const logs = await waitFor(async () => {
      const hits = await search(owner, "logs", `SELECT * FROM "mastertutor" WHERE service = 'agent'`);
      return hits.length > 0 ? hits : null;
    }, 90_000);
    expect(JSON.stringify(logs)).toContain("agent ready");
  }, 200_000);

  it("the provisioner registered the webhook destination", async () => {
    const response = await fetch(`${baseUrl}/observability/api/default/alerts/destinations`, {
      headers: { cookie: cookies().owner },
    });
    expect(JSON.stringify(await response.json())).toContain("mastertutor-web");
  });

  it("an alert posted the way OpenObserve posts it becomes an in-app alert", async () => {
    // Inside the stack: no X-Forwarded-* headers, the real secret, the internal address.
    compose([
      "exec", "-T", "web", "node", "-e",
      "fetch('http://127.0.0.1:3000/api/alerts/webhook',{method:'POST',headers:{authorization:'Bearer '+process.env.ALERT_WEBHOOK_SECRET},body:JSON.stringify({rule:'run_failed'})}).then(r=>process.exit(r.status===202?0:1))",
    ]);
    const response = await fetch(`${baseUrl}/api/rpc/alerts/active`, {
      method: "POST",
      headers: { cookie: cookies().owner, "content-type": "application/json", origin: "http://localhost:18080" },
      body: JSON.stringify({ json: {} }),
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("A run failed");
  });
});
```

`tests/observability/3-resilience.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { baseUrl, compose, enabled, waitFor } from "./stack.ts";

afterAll(() => {
  if (enabled) compose(["start", "otel-collector"]);
});

describe.runIf(enabled)("the product keeps working with the collector down (spec §7.1)", () => {
  it("web stays healthy and fast, agent stays healthy, and drops are counted", async () => {
    compose(["stop", "otel-collector"]);
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const response = await fetch(`${baseUrl}/sign-in`);
      expect(response.status).toBe(200);
      expect(performance.now() - started).toBeLessThan(2_000);
    }
    const ps = compose(["ps", "--format", "json", "agent", "web"])
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { Service: string; Health: string });
    for (const service of ps) expect(service.Health, service.Service).toBe("healthy");
    await waitFor(
      async () => (compose(["logs", "--since", "5m", "web"]).includes('"errorCode":"telemetry_dropped"') ? true : null),
      90_000,
    );
  }, 150_000);
});
```

The `origin` header and the RPC body follow the oRPC fetch handler's wire format (`{ json: input }`), the same format `apps/web/e2e` stack tests use when they call `/api/rpc` directly. If those tests use a different encoding, copy theirs.

- [ ] **Step 5: Run the suite**

Run: `scripts/remote-test.sh observability`
Expected: `OBSERVABILITY OK`. Then run `scripts/remote-test.sh unit scripts/remote-test.test.ts` and `scripts/remote-test.sh e2e`. Expected: PASS. The e2e stack is unchanged without `MT_CI_TELEMETRY`.

- [ ] **Step 6: Commit**

```bash
git add scripts/observability-stack.sh tests/observability
git commit -m "test(observability): remote suite for pipeline, owner-only access, alerts and collector-down resilience (D50)" -- scripts/observability-stack.sh tests/observability infra/traefik/test-dynamic.yml scripts/lib/test-stack.sh scripts/remote-test.sh scripts/remote-test/run-on-host.sh scripts/remote-test.test.ts scripts/README.md
```

---

## Self-review

**1. Spec coverage**

| Spec | Task |
|---|---|
| §4.3 dependency map; names in contracts | 0 (names); A7 (`boundaries.test.ts`, ESLint) |
| §5 spans, attributes, metrics, allowlist | 0; A2 (allowlist exporter); A4 (recorders) |
| §6 package, versions, no sdk-node, no pg or aws-sdk instrumentation | A2, A3 |
| §6.3 startup, preload, web `instrumentation.ts`, externals | A3, A6 (main), A7 (web), B7 (`--import`) |
| §7.1 bounded queues, drop counting, crash handlers, shutdown flush, collector down | A2, A3, A6, F1 (resilience) |
| §7.2 traces per step | A5 (`mt.step` as root) |
| §7.3 the ten seams | A5 (1–4), A6 (5–8), A7 (9), C4 (10) |
| §7.4 no propagation | A3 (`start.test.ts`) |
| §7.5 tool-declared attributes | A5 |
| §8 six dashboards | B5 |
| §9 log bridge and container logs (fluentd, no socket) | A1, B3 (`logs/containers`), B7 (driver) |
| §10 collector | B3 |
| §11 OpenObserve: Garage, retention, users, provisioning, API pinned | B1, B2, B4, B7 |
| §12 `/observability` owner-only, entry route, host network | C2, B7, F1 |
| §13.1 alert rules | B6 |
| §13.2 webhook | C4 |
| §13.3 in-app banner and list, RPC | C1, C5, C6 |
| §13.4 Web Push (RFC 8291/8292), subscriptions, iOS Home Screen, payload, degradation | C3, C4, C5, C6, C7 |
| §14 security tests | A7 (canary), A2, C2, C4, B7, C1 |
| §15 performance budget | A4 (`overhead.int.test.ts`, micro-benchmark), A7 (loop telemetry) |
| §16 local, CI, bench | B7 (bench), F1 (suite, `MT_CI_TELEMETRY`) |
| §17 changed files | covered by each task's Files block |

**2. Placeholder scan.** No step says TBD, "add error handling" or "similar to". Five places tell the implementer to adapt to the pinned API or the real file, and each names the one file to change and the test that pins it:

- the shape of OpenObserve payloads (B1, B4, B5, B6);
- the `SdkLogRecord` type name (A2);
- the `APIError` constructor (A5);
- the `fakeStore()` return shape (A6);
- the `AuditView` header markup (C6).

These are lookups in files that exist, not open design questions.

**3. Type consistency.** These names are spelled the same in every task that uses them:

- `instrument`, `ProductSpan.set` and `ProductSpan.fail`;
- `recordRunEvent`, `recordSpend`, `recordRunFailure`, `recordModelTokens`, `recordSseConnection`, `recordAlertReceived` and `recordPush`;
- `installTestTelemetry().metric(name)`;
- `ownerScoped`, `decideObservability`, `vapidKeysOf` and `pushConfigOf`;
- `deliverAlert(deps, alert)` and `handleAlertWebhook(deps, request)`;
- `garageBuckets`, `o2Paths`, `upsertDashboards` and `upsertAlerts`.

`ToolAttributes` includes `mt.error.code` in both Task 0 and A5. `STEP_OUTCOMES` matches `StepOutcome.kind`. Interruptions use `mt.interruption`, in both the spec and the plan.

**4. Review Focus.** Each of the five lines has a test in the task named: A3, C4 (two), C2, C5, C4 and A4.

## Execution handoff

Per D30, D35 and D40, execution is subagent-driven on Opus 5.5. First, one implementer runs Task 0. Then three implementers run Track A, Track B and Track C in parallel, each in its own worktree, with a fresh reviewer after each task. Task F1 runs last, after A7, B7 and C7 have merged, followed by a whole-branch review.

Two host steps need the user's approval before the real deploy (D41, D42): `create-obs-network.sh --yes` and `attach-traefik.sh --network obs --yes`. Neither is needed for any test suite.
