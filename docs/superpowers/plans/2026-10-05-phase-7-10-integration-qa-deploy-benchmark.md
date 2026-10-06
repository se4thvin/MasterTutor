# Phases 7–10: Integration, QA, Deploy Readiness and Benchmark Suite Implementation Plan

> **D36 (supersedes this plan):** OPENAI_EMBEDDINGS_KEY is removed; web uses OPENAI_API_KEY for query embeddings.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four outcomes:
- The finished frontend (F1–F5) runs against the finished backend (B1–B6) end to end, with a green `compose.test.yml` E2E and security suite (Phase 7).
- The UI passes the D22 validation swarm and the D28 animation pass with zero open findings (Phase 8).
- The stack is ready for Dokploy without being deployed (Phase 9).
- A benchmark harness measures pure computer use against browser use and loops on failures until the zyBooks acceptance benchmark fully completes (Phase 10, D32–D34).

**Architecture:**
- **Phase 7** adds no new product layers. It:
  - pins the web↔API seams with an HTTP-level oRPC conformance spec;
  - replaces F's recorded-event and iframe stubs with two small client modules (`run-events.ts`, `live-view.ts`);
  - runs Playwright inside an `e2e` container that shares Traefik's network namespace, so `http://localhost:18080` and the WebRTC TCP mux behave exactly as they do for a real user.
- **Phase 8** backs the human-style swarm with three deterministic checks: a DOM layout auditor, Playwright visual baselines plus axe, and a CDP trace analyser. All findings go into one ledger with a gate.
- **Phase 9** is overlays, host scripts and checks only:
  - `compose.prod.yml` holds the Dokploy wiring;
  - `compose.local.yml` is a production-like local stack;
  - a secrets checker reuses the env contracts;
  - a restore drill tests backups.
- **Phase 10** has three parts:
  - a one-enum contract addition (`toolProfile`) plus two small model-facing refinements (a `"focused"` credential target and `read_page` element boxes);
  - a `benchmarks` service in `web`;
  - a test-only harness in `tests/bench` that drives everything through oRPC and SSE, grades from `read_page` evidence, files failure tickets, and writes Markdown reports.

**Tech Stack:**
- Inherited: everything pinned in Phase 0.
- New, test-only:
  - `@playwright/test`, pinned to exactly the `playwright-core` version that B1 pinned in `apps/agent`;
  - `@axe-core/playwright` (exact pin via `-E`);
  - `tesseract-ocr` (apt, inside the e2e image only);
  - `greenmail/standalone` (if B3 did not already add it);
  - `@orpc/client` 1.15.4 for the harness.
- New in product code: nothing.

**Spec:** `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` (§12 Testing & QA, §13 Deployment, §16 phases 7–9). `orchestration/STATE.md` D22, D28 and D32–D35 override the spec. `CLAUDE.md` is mandatory. `docs/superpowers/plans/2026-10-05-phase-0-foundations.md` is the source of truth for names, contracts, tables, env keys and paths. Executors read all four.

---

## Global Constraints

Every task implicitly includes all of these.

**Inherited from Phase 0 (verbatim values)**
- Node ≥ 24.4. pnpm 10.34.6. ESM everywhere. Relative imports carry `.ts`. No TS `enum`, `namespace` or parameter properties. `import type` for type-only imports.
- Exact dependency versions only, with no `^`. Add a dependency only when a step names it.
- Every domain or API type is `z.infer` of a schema in `@mastertutor/contracts`. DB row types come from `@mastertutor/db`. Model-facing schemas use `.nullable()`, never `.optional()`.
- Models: `gpt-6-astra` (agent), `gpt-6.1-sol` (fallback). Viewport 1280×800 at DPR 1. Slots `browser-1..6`. Media ports `5900N` (59001–59006) UDP+TCP. CDP 9223, n.eko 8080, PulseAudio 4713.
- Static `cdp` IPs: agent `.10`, web `.11`, Traefik `.12`, on subnet `${CDP_SUBNET_PREFIX:-172.30.231}.0/24`.
- Test stack command: `pnpm compose:test <args>`, which is `docker compose --env-file .env.test -f compose.yml -f compose.test.yml`.
- **Secrets:**
  - Never `cat`, `echo` or print the root `.env`.
  - `OPENAI_API_KEY` is read only by Compose, or by `grep … | cut` straight into an environment variable that is never echoed.
  - zyBooks credentials are never written to any file, command line, env var, commit, log or plan (D34). They enter **only** through the Vault UI.
- **Disk:** about 20 GB free.
  - After Docker builds, run `docker builder prune -f && docker image prune -f`.
  - Never `docker system prune -a`.
- Commit at the end of each task. Never push. End commit messages with the attribution lines from the session's system reminder.

**New for Phases 7–10**
- **Test files.** Playwright files end in `.spec.ts`, or `.setup.ts`, so Vitest (`*.test.ts`) never collects them. Vitest integration files end in `.int.test.ts`.
- **Security tests.** Any test that is part of the §12 security suite has a top-level `describe` whose name starts with `security: `. `pnpm test:security` selects on that prefix.
- **No site-specific code in product code.** No string matching `/zybook/i` may appear under `apps/` or `packages/` (Task 23 enforces this). Benchmark-specific logic lives only in `tests/bench/`.
- **Real-model spend:**
  - Only Tasks 15, 22 (real-model step) and 25 call the real OpenAI API.
  - Each invocation is capped by the harness's `--max-total-usd`.
  - Default caps: Task 15 smoke $1; fixture real runs $10; zyBooks per invocation $120.
  - Any spend above these caps needs the user's explicit OK.
- **No deployment.** Phase 9 never calls a Dokploy MCP tool that creates, updates or deploys anything, and never touches DNS. Read-only Dokploy calls are also unnecessary.
- **QA widths and themes.** Widths are exactly `1440, 1180, 1024, 820, 390`; themes are `light, dark` (spec §11.5, D22).
- **Takeover counts as a failure in benchmarks.** A benchmark run with `takeovers > 0` can never be graded `passed`.

## Seams this plan consumes from B1–B6 and F1–F5

Only the Phase 0 plan exists while this plan is written. The names below are what this plan assumes the B/F phase plans produced.

**Step 0 of every task:** run the `grep` in the task's Interfaces block.
- If a seam has a different real name, use the real name.
- Record the mapping in the task's commit message body as `seam: <assumed> -> <actual>`.
- Never rename another phase's code to match this plan.
- If a seam is **missing**, implement it in the task where this plan says "create if absent".

| # | Seam (assumed) | Owner | Used by |
|---|---|---|---|
| S1 | oRPC HTTP handler at `apps/web/app/api/rpc/[[...rest]]/route.ts`, prefix `/api/rpc`, RPC protocol (`POST /api/rpc/<router>/<proc>`, body `{"json": input}`) | B/F | T2, T4, T19 |
| S2 | Router built with `implement(apiContract)` in `apps/web/lib/server/rpc/router.ts` (`os` = the implementer); handler context has `db: Database`, `workspaceId: string`, `userId: string` | B/F | T18 |
| S3 | `createRun(context, input: CreateRunInput): Promise<RunSummary>` in `apps/web/lib/server/runs.ts`. It inserts the run and sends `NOTIFY run_queued` | B/F | T16, T18 |
| S4 | SSE route `apps/web/app/api/runs/[id]/events/route.ts`. It sends `id: <eventId>` and `data: <RunEventRecord JSON>`, and resumes from the `Last-Event-ID` header **or** the `?after=<id>` query | B/F | T3, T4, T19 |
| S5 | Browser oRPC client `api` exported from `apps/web/lib/api/client.ts` | F | T3 |
| S6 | App routes `/` (New task), `/runs/[runId]`, `/notes/[noteId]`, `/library`, `/vault`, `/settings`, `/sign-in` | F | T4, T5, T8 |
| S7 | Theme follows `prefers-color-scheme` | F1 | T8 |
| S8 | `tests/llm-mock` (B1): the scenario is selected per run by a convention defined in one helper, `tests/llm-mock/select.ts` → `scenarioGoal(name, text)` (created in T1 if B1 has no helper). It records requests at `GET <mock origin>/__requests` | B1 | T4–T6, T22 |
| S9 | `fixtures` Compose service on a pinned-subnet network named `fixtures`, which `SLOT_EGRESS_ALLOW_CIDRS` allows. The agent's `AGENT_TEST_MODE` private-range exception covers that whole subnet | B1 | T1, T22 |
| S10 | B3's login fixture (`tests/fixtures/site/login/…`) checks credentials imported from `tests/security/canaries.ts` (T6 makes this the single source) | B3 | T4, T6 |
| S11 | Agent tool wiring: the model tool list is built in `apps/agent/src/tools/registry.ts`, tool dispatch is in `apps/agent/src/tools/execute.ts`, observe is in `apps/agent/src/loop/observe.ts`, `read_page` is in `apps/agent/src/tools/read-page.ts`, and the credential fill is in `apps/agent/src/vault/fill.ts` | B1/B3 | T17 |
| S12 | `run_steps.action` holds a `StepAction`-compatible object with `tool`. `run_steps.result` holds the tool's parsed result (for `read_page`, a `ReadPageResult`) | B1 | T20 |
| S13 | Per-slot `/live` Traefik routers: file provider in the test overlay, labels in production | B6 | T1, T12 |

## Review Focus

1. **Unknown, foreign or missing IDs on any oRPC procedure.**
   - Expected: `NOT_FOUND`, never a 500 and never another workspace's data. Without a session every procedure returns 401.
   - *Test:* Task 2, `api-conformance.spec.ts` (every procedure, unauthenticated and with unknown IDs).
2. **An SSE drop during a long run.**
   - Expected: on reconnect the UI and harness neither lose nor duplicate events.
   - A stale `openLive` response that arrives after a newer `slot` event must not win.
   - *Tests:* Task 3, `run-events.test.ts` (dedupe and resume) and `live-view.test.ts` (out-of-order responses); Task 4, `sse.spec.ts` (`?after=` resume).
3. **Grading a benchmark run that has not finished.**
   - Expected: grading is refused, so metrics are never frozen mid-run.
   - Re-grading a finished run must not change its snapshot metrics.
   - *Test:* Task 18, `benchmarks.int.test.ts`.
4. **A run that needed a takeover, or a page that was already complete before the run.**
   - Expected: neither counts as a benchmark pass. Takeovers cap the outcome at `partial`.
   - zyBooks runs require the baseline to show the readings already complete (D32). If it doesn't, the harness stops before acting, unless the user explicitly allows it.
   - *Tests:* Task 20, `criteria.test.ts`; Task 21, `run-suite.test.ts`.
5. **Site credentials appearing anywhere outside the vault.**
   - Expected:
     - the harness refuses any `ZYBOOKS*` env var;
     - it never accepts credentials as arguments;
     - product code contains no site hacks;
     - the post-E2E canary scan finds no secret in the DB, logs, objects, model requests or OCR of screenshots.
   - *Tests:* Task 6, `scan.test.ts` and `stack-canary.ts`; Task 19, `config.test.ts`; Task 23, `no-site-hacks.test.ts`.

---

## File Structure

```
compose.test.yml                       (modified T1, T22) e2e service, browser-2, static slot IPs, greenmail, bench-fixtures
compose.prod.yml                       (T12) Dokploy overlay: dokploy-network, named cdp network, pgbackups, slot labels
compose.local.yml                      (T15) production-like local overlay (Traefik docker provider, e2e runner)
compose.bench-real.yml                 (T22) test stack with the real OpenAI key (agent only)
.env.test                              (modified T1, T22) BROWSER_SLOTS=browser-1,browser-2; bench fixture dummies
.gitignore / .dockerignore             (modified T1, T19) .out dirs, .env.bench, orchestration/benchmarks/.raw
eslint.config.js                       (modified T2) ban stub/recorded-event imports in app code
package.json                           (modified) scripts e2e, test:security, qa:*, bench, prod:smoke
pnpm-workspace.yaml                    (modified T1) + tests/e2e, tests/bench
.github/workflows/ci.yml               (modified T6, T8, T22) e2e, security, visual, bench-mock jobs

scripts/e2e.sh                         (T1, T6) E2E + canary scan runner
scripts/qa-stack.sh                    (T8) boots the QA stack with seeded states
scripts/prod-smoke.sh                  (T15) local production-like smoke (real model)
scripts/deploy/check-env.ts (+.int.test.ts)   (T14) validates a production env file via the env contracts
scripts/deploy/restore-drill.sh        (T14) pg_dump → wipe → restore → verify
scripts/qa/findings.ts                 (T9) findings ledger CLI

infra/host/99-mastertutor.conf         (T13) sysctl
infra/host/firewall.sh                 (T13) ufw rules from slot count
infra/host/attach-traefik.sh           (T13) joins Dokploy's Traefik to the cdp network at .12
infra/host/host.test.ts                (T13) ports/sysctl match contracts
infra/deploy-runbook.md                (T14) first-deploy, secrets, backups, restore

apps/web/lib/client/run-events.ts (+.test.ts)  (T3) EventSource subscription with resume + dedupe
apps/web/lib/client/live-view.ts (+.test.ts)   (T3) openLive controller, slot-event re-open
apps/web/lib/client/hooks.ts                    (T3) useRunEvents, useLiveView
apps/web/lib/server/benchmarks.ts (+.int.test.ts) (T18) benchmarks service
apps/web/lib/server/rpc/benchmarks-errors.ts    (T18) service errors → ORPCError

packages/contracts/src/{enums,tools}.ts, src/api/dto.ts   (modified T16) toolProfile, focused target, element box, takeovers
packages/db/src/schema/{enums,runs,benchmarks}.ts         (modified T16) tool_profile, takeovers
packages/db/migrations/0003_tool_profiles.sql             (T16, generated)

apps/agent/src/tools/profile.ts (+.test.ts)        (T17)
apps/agent/src/tools/read-page-box.ts (+.test.ts)  (T17)
apps/agent/src/vault/focused-target.ts (+.int.test.ts) (T17)

tests/llm-mock/select.ts               (T1, only if B1 has no selector helper)
tests/llm-mock/scenarios/…             (T4, T5, T22) scenarios in B1's format
tests/fixtures/site/takeover.html      (T5)
tests/fixtures/bench-activities/server.ts (T22) dynamic benchmark fixture
tests/compose/compose-json.ts          (T1) `docker compose config` helper
tests/compose/e2e-stack.int.test.ts    (T1)
tests/compose/key-placement.int.test.ts (T6)
tests/compose/prod-overlay.int.test.ts (T12)

tests/e2e/                             @mastertutor/e2e
  package.json, tsconfig.json, playwright.config.ts, Dockerfile, pins.test.ts
  auth.setup.ts
  support/{env,rpc,ui,runs}.ts
  specs/{api-conformance,sse,run-to-note,approvals,vault-otp,kill-switch,library-folders,live-playback,takeover}.spec.ts
  qa/{layout-audit.ts,layout-audit.spec.ts,screens.ts,seed.ts,stub-live.ts,matrix.spec.ts,shoot.ts,findings.ts,findings.test.ts}
  qa/__screenshots__/                  committed baselines (generated in the container)
  motion/{trace.ts,trace.test.ts,catalog.ts,catalog.test.ts,motion.spec.ts}
  smoke/prod-smoke.spec.ts             (T15)

tests/security/
  canaries.ts, scan.ts (+scan.test.ts), dump-objects.ts, stack-canary.ts

tests/bench/                           @mastertutor/bench
  package.json, tsconfig.json
  src/{types,config,app-client,sse,watch,evidence,criteria,classify,report,mock,vault-check,run-suite,cli}.ts
  src/{config,sse,watch,criteria,classify,report,run-suite}.test.ts, src/no-site-hacks.test.ts
  src/suites/{fixtures,zybooks}.ts

orchestration/briefs/{qa-swarm,qa-animation,bench-fix}.md   (T9, T10, T24)
orchestration/qa/findings.json, findings.md                  (T9 ledger output)
orchestration/benchmarks/README.md                           (T24) protocols
orchestration/benchmarks/zybooks/sections.json               (T23, committed after calibration)
orchestration/benchmarks/<date>-<suite>-<n>/report.md        (harness output)
orchestration/benchmarks/tickets/BT-####.md                  (harness output)
```

---

# Phase 7: Integration

### Task 1: E2E package, `compose.test.yml` E2E stack and runner

**Files:**
- Create: `tests/e2e/{package.json,tsconfig.json,playwright.config.ts,Dockerfile,pins.test.ts,auth.setup.ts}`, `tests/e2e/support/{env,rpc}.ts`
- Create: `tests/compose/compose-json.ts`, `tests/compose/e2e-stack.int.test.ts`, `scripts/e2e.sh`
- Create if absent: `tests/llm-mock/select.ts`
- Modify: `compose.test.yml`, `.env.test`, `pnpm-workspace.yaml`, `.gitignore`, `.dockerignore`, `package.json`, `scripts/compose-smoke.sh` (slot count)

**Interfaces:**
- Consumes:
  - Phase 0 `compose.yml`/`compose.test.yml`, `.env.test` and `pnpm compose:test`;
  - S8, S9 and S13.
  - Seam check: `grep -n "llm-mock\|fixtures\|greenmail" compose.test.yml; ls tests/llm-mock tests/fixtures; grep -n "playwright" apps/agent/package.json`.
- Produces:
  - **Image** `mastertutor/e2e:local`.
  - **Service** `e2e`: profile `e2e`, `network_mode: service:traefik`, `E2E_BASE_URL=http://localhost:18080`.
  - **Test Traefik** listens on **18080 inside the container**.
  - **Slots:** `browser-1` at `.21` and `browser-2` at `.22` on `cdp`, each with `NEKO_WEBRTC_NAT1TO1` equal to its own IP.
  - **`scripts/e2e.sh [playwright args]`** (root script `pnpm e2e`).
  - **`tests/e2e/support/env.ts`:** `BASE_URL`, `AUTH_STATE`, `OWNER`.
  - **`tests/e2e/support/rpc.ts`:**
    - `rpcCall(request: APIRequestContext, path: string, input: unknown): Promise<RpcResponse>`, where `RpcResponse = {status: number; json: unknown; code: string | null}`;
    - `rpcOk<T>(request, path, input): Promise<T>`.
  - **`tests/compose/compose-json.ts`:** `composeConfig(envFile, files, options?: {profiles?: string[]; env?: Record<string,string>}): ComposeConfig`.
  - **`tests/llm-mock/select.ts`:** `scenarioGoal(name: string, text: string): string`.

- [ ] **Step 1: Write the failing compose test.**

`tests/compose/compose-json.ts`:
```ts
import { execFileSync } from "node:child_process";

export interface ComposePort {
  target: number;
  published?: string;
  protocol?: string;
  host_ip?: string;
}
export interface ComposeService {
  environment?: Record<string, string | null>;
  networks?: Record<string, { ipv4_address?: string } | null>;
  network_mode?: string;
  ports?: ComposePort[];
  labels?: Record<string, string>;
  profiles?: string[];
  volumes?: { source?: string; target?: string }[];
  command?: string[] | null;
}
export interface ComposeConfig {
  services: Record<string, ComposeService>;
  networks: Record<string, { name?: string; external?: boolean }>;
  volumes?: Record<string, unknown>;
}

/** Fully resolved `docker compose config`; needs only the docker CLI, no running containers. */
export function composeConfig(
  envFile: string,
  files: readonly string[],
  options: { profiles?: readonly string[]; env?: Record<string, string> } = {},
): ComposeConfig {
  const args = [
    "compose",
    "--env-file",
    envFile,
    ...files.flatMap((file) => ["-f", file]),
    ...(options.profiles ?? []).flatMap((profile) => ["--profile", profile]),
    "config",
    "--format",
    "json",
  ];
  const text = execFileSync("docker", args, {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(text) as ComposeConfig;
}
```

`tests/compose/e2e-stack.int.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { composeConfig } from "./compose-json.ts";

const config = composeConfig(".env.test", ["compose.yml", "compose.test.yml"], { profiles: ["e2e"] });
const prefix = "172.30.231";

describe("compose.test.yml E2E stack", () => {
  it("runs two slots with static cdp IPs advertised as their WebRTC address", () => {
    for (const [slot, ip] of [
      ["browser-1", `${prefix}.21`],
      ["browser-2", `${prefix}.22`],
    ] as const) {
      const service = config.services[slot];
      expect(service, slot).toBeDefined();
      expect(service?.networks?.cdp?.ipv4_address).toBe(ip);
      expect(service?.environment?.NEKO_WEBRTC_NAT1TO1).toBe(ip);
    }
    expect(config.services["browser-3"]).toBeUndefined();
  });

  it("runs Playwright inside Traefik's network namespace on the public port", () => {
    expect(config.services.e2e?.network_mode).toBe("service:traefik");
    expect(config.services.e2e?.environment?.E2E_BASE_URL).toBe("http://localhost:18080");
    const ports = config.services.traefik?.ports ?? [];
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({ target: 18080, published: "18080", host_ip: "127.0.0.1" });
    expect(config.services.traefik?.command).toContain("--entrypoints.web.address=:18080");
  });

  it("lists exactly the active slots in BROWSER_SLOTS", () => {
    expect(config.services.agent?.environment?.BROWSER_SLOTS).toBe("browser-1,browser-2");
  });
});
```

`tests/e2e/pins.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function manifest(relative: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

describe("e2e pins", () => {
  it("uses exactly the agent's Playwright version", () => {
    const agent = manifest("../../apps/agent/package.json");
    const e2e = manifest("./package.json");
    const agentPin = agent.dependencies?.["playwright-core"] ?? agent.dependencies?.playwright;
    expect(agentPin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(e2e.devDependencies?.["@playwright/test"]).toBe(agentPin);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test:int -- tests/compose/e2e-stack && pnpm test -- tests/e2e/pins`
Expected: FAIL (no `e2e` service, one slot, no `tests/e2e/package.json`).

- [ ] **Step 3: Create the package.**

Add `tests/e2e` and `tests/bench` to `pnpm-workspace.yaml` under `packages:`. If B1 already added `tests/*`, leave it as is.

`tests/e2e/package.json`. Set `<V>` to the exact `playwright-core` version from `apps/agent/package.json`. Then run `pnpm --filter @mastertutor/e2e add -D -E @axe-core/playwright@4`, which writes the exact resolved 4.x version:
```json
{
  "name": "@mastertutor/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "devDependencies": {
    "@mastertutor/contracts": "workspace:*",
    "@playwright/test": "<V>"
  }
}
```

`tests/e2e/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2024", "DOM", "DOM.Iterable"], "noEmit": true },
  "include": ["**/*.ts"],
  "exclude": [".out", "node_modules"]
}
```

`tests/e2e/support/env.ts`:
```ts
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:18080";
export const AUTH_STATE = ".out/auth/owner.json";
/** The E2E owner of the throwaway test stack. Not a secret: the stack is destroyed after each run. */
export const OWNER = { email: "owner@e2e.test", password: "e2e-owner-password-0123" } as const;
export const FIXTURES_ORIGIN = "http://fixtures";
```

`tests/e2e/support/rpc.ts`:
```ts
import type { APIRequestContext } from "@playwright/test";
import { BASE_URL } from "./env.ts";

export interface RpcResponse {
  status: number;
  json: unknown;
  code: string | null;
}

/** oRPC RPC protocol (S1): POST /api/rpc/<router>/<procedure> with {"json": input}. */
export async function rpcCall(request: APIRequestContext, path: string, input: unknown): Promise<RpcResponse> {
  const response = await request.post(`${BASE_URL}/api/rpc/${path}`, {
    headers: { "content-type": "application/json", origin: BASE_URL },
    data: { json: input },
    failOnStatusCode: false,
  });
  const type = response.headers()["content-type"] ?? "";
  if (!type.includes("application/json")) {
    return { status: response.status(), json: null, code: null };
  }
  const body = (await response.json()) as { json?: unknown };
  const json = body.json ?? null;
  const code =
    response.status() >= 400 && json !== null && typeof json === "object" && "code" in json
      ? String((json as { code: unknown }).code)
      : null;
  return { status: response.status(), json, code };
}

export async function rpcOk<T>(request: APIRequestContext, path: string, input: unknown): Promise<T> {
  const result = await rpcCall(request, path, input);
  if (result.status !== 200) throw new Error(`${path} failed: HTTP ${result.status} ${result.code ?? ""}`);
  return result.json as T;
}
```

`tests/e2e/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";
import { AUTH_STATE, BASE_URL } from "./support/env.ts";

export default defineConfig({
  testDir: ".",
  outputDir: ".out/results",
  snapshotPathTemplate: "{testDir}/qa/__screenshots__/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: ".out/report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        // Disables non-proxied UDP, so WebRTC must use n.eko's TCP mux (spec §10.2, §12).
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    { name: "e2e", testMatch: /specs\/.*\.spec\.ts$/, dependencies: ["setup"], use: { storageState: AUTH_STATE } },
    { name: "layout-unit", testMatch: /qa\/layout-audit\.spec\.ts$/ },
    { name: "qa", testMatch: /qa\/matrix\.spec\.ts$/, dependencies: ["setup"], use: { storageState: AUTH_STATE } },
    { name: "motion", testMatch: /motion\/motion\.spec\.ts$/, dependencies: ["setup"], use: { storageState: AUTH_STATE } },
    { name: "prod-smoke", testMatch: /smoke\/.*\.spec\.ts$/ },
  ],
});
```

`tests/e2e/auth.setup.ts`:
```ts
import { expect, test as setup } from "@playwright/test";
import { AUTH_STATE, BASE_URL, OWNER } from "./support/env.ts";

setup("owner session", async ({ request }) => {
  const headers = { origin: BASE_URL };
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers,
    data: { ...OWNER, name: "E2E Owner" },
    failOnStatusCode: false,
  });
  if (signUp.status() !== 200) {
    // Sign-up closes after the first user (Phase 0), so a re-run signs in instead.
    expect(signUp.status()).toBe(403);
    const signIn = await request.post("/api/auth/sign-in/email", { headers, data: OWNER });
    expect(signIn.ok()).toBe(true);
  }
  await request.storageState({ path: AUTH_STATE });
});
```

`tests/llm-mock/select.ts`. Create this **only if** B1 has no equivalent helper; otherwise re-export B1's helper from this path:
```ts
/**
 * Selects an llm-mock scenario for one run (S8). This is the only place that knows the
 * convention, so E2E specs and the benchmark harness never hard-code it.
 */
export function scenarioGoal(name: string, text: string): string {
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new TypeError(`Invalid scenario name: ${name}`);
  return `[scenario:${name}] ${text}`;
}
```
If B1's convention differs (for example a header or a different prefix), change only the body of `scenarioGoal`.

- [ ] **Step 4: Write the e2e image.**

`tests/e2e/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.7
# Test-only Playwright runner for compose.test.yml and compose.local.yml (spec §12).
# tesseract-ocr is used only by the post-E2E secret canary scan (OCR of screenshots).
FROM node:24-slim
ENV CI=true PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.34.6 && npm cache clean --force
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@mastertutor/e2e..."
RUN pnpm --filter @mastertutor/e2e exec playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo/tests/e2e
CMD ["pnpm", "exec", "playwright", "test"]
```

Append to `.dockerignore`:
```
tests/e2e/.out
tests/security/.out
```
Append to `.gitignore`:
```
tests/e2e/.out/
tests/security/.out/
```

- [ ] **Step 5: Extend the test overlay.**

In `compose.test.yml`:
1. **Traefik command.** Replace the `traefik` service's `command:` (the overlay replaces the list) and override its `ports`:
   ```yaml
   traefik:
     command:
       - --entrypoints.web.address=:18080
       - --providers.file.filename=/etc/traefik/dynamic.yml
       - --ping=true
       - --log.level=WARN
     ports: !override
       - "127.0.0.1:${TEST_HTTP_PORT:-18080}:18080"
   ```
   If B6 changed `test-dynamic.yml` entrypoint names, keep them. Only the listen address moves to `:18080`, so the container-internal and public ports are equal. That is what lets `e2e` use `localhost:18080` from inside Traefik's namespace.
2. **Re-enable `browser-2` and give both slots static IPs.** Delete the `browser-2: profiles: !override ["extra-slots"]` entry, then add:
   ```yaml
   browser-1:
     environment:
       NEKO_WEBRTC_NAT1TO1: ${CDP_SUBNET_PREFIX:-172.30.231}.21
     networks:
       cdp:
         ipv4_address: ${CDP_SUBNET_PREFIX:-172.30.231}.21
   browser-2:
     environment:
       NEKO_WEBRTC_NAT1TO1: ${CDP_SUBNET_PREFIX:-172.30.231}.22
     networks:
       cdp:
         ipv4_address: ${CDP_SUBNET_PREFIX:-172.30.231}.22
   ```
3. **Add the runner:**
   ```yaml
   e2e:
     profiles: ["e2e"]
     image: mastertutor/e2e:local
     build:
       context: .
       dockerfile: tests/e2e/Dockerfile
     # Shares Traefik's network namespace: localhost:18080 is the public entry point, and the
     # slots' cdp IPs (their WebRTC NAT1TO1 addresses) are reachable, as for a real browser.
     network_mode: "service:traefik"
     environment:
       CI: ${CI:-}
       E2E_BASE_URL: http://localhost:18080
     volumes:
       - ./tests/e2e/specs:/repo/tests/e2e/specs:ro
       - ./tests/e2e/motion:/repo/tests/e2e/motion:ro
       - ./tests/e2e/qa:/repo/tests/e2e/qa
       - ./tests/e2e/.out:/repo/tests/e2e/.out
       - ./tests/security/.out:/repo/tests/security/.out
     depends_on:
       traefik:
         condition: service_healthy
   ```

In `.env.test`, set `BROWSER_SLOTS=browser-1,browser-2`.

In `scripts/compose-smoke.sh`:
- replace the `"1"` slot-count check with a count of the `BROWSER_SLOTS` entries:
  ```bash
  expected_slots="$(grep -E '^BROWSER_SLOTS=' .env.test | cut -d= -f2 | tr ',' '\n' | grep -c .)"
  [[ "$(psql_value "select count(*) from browser_slots")" == "$expected_slots" ]] || fail "browser_slots not synced to BROWSER_SLOTS"
  ```
- replace the curl base so it still uses the host port, which stays 18080. No other change.

- [ ] **Step 6: Write the runner script.**

`scripts/e2e.sh`:
```bash
#!/usr/bin/env bash
# Full E2E (spec §12). It:
#   - boots compose.test.yml;
#   - runs Playwright in the e2e container;
#   - scans the stack for secret canaries (added in Task 6).
# Usage: bash scripts/e2e.sh [playwright args]   (KEEP_STACK=1 leaves the stack running)
set -euo pipefail
cd "$(dirname "$0")/.."

DC=(docker compose --env-file .env.test -f compose.yml -f compose.test.yml)
cleanup() { if [[ "${KEEP_STACK:-0}" != "1" ]]; then "${DC[@]}" --profile e2e down -v --remove-orphans >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT

mkdir -p tests/e2e/.out tests/security/.out
chmod 777 tests/e2e/.out tests/security/.out

"${DC[@]}" up -d --build --wait --wait-timeout 420
"${DC[@]}" --profile e2e build e2e
"${DC[@]}" --profile e2e run --rm e2e pnpm exec playwright test --project=setup --project=e2e "$@"
echo "E2E OK"
```

Add these root scripts to `package.json`:
- `"e2e": "bash scripts/e2e.sh"`;
- `"compose:e2e": "docker compose --env-file .env.test -f compose.yml -f compose.test.yml --profile e2e"`.

- [ ] **Step 7: Run the tests to verify they pass.**

Run: `pnpm install && pnpm test -- tests/e2e/pins && pnpm test:int -- tests/compose && pnpm typecheck && pnpm lint`
Expected: PASS.

Run: `pnpm smoke` (Phase 0 smoke, now with 2 slots)
Expected: `SMOKE OK`.

Run: `pnpm compose:e2e build e2e && docker builder prune -f && df -h / | tail -1`
Expected: the image builds and at least about 12 GB stays free.

- [ ] **Step 8: Commit.**

```bash
git add tests/e2e tests/compose tests/llm-mock/select.ts scripts/e2e.sh scripts/compose-smoke.sh compose.test.yml .env.test pnpm-workspace.yaml pnpm-lock.yaml package.json .gitignore .dockerignore
git commit -m "test(e2e): Playwright runner in Traefik's namespace, two-slot E2E stack with static WebRTC addresses"
```

---

### Task 2: oRPC conformance spec and no stubs in app code

**Files:**
- Create: `tests/e2e/specs/api-conformance.spec.ts`
- Modify: `eslint.config.js`, plus any F file still importing recorded or fixture data at runtime

**Interfaces:**
- Consumes:
  - `apiContract`;
  - `rpcCall` and `rpcOk` (T1);
  - S1.
  - Seam check: `ls apps/web/app/api/rpc; grep -rln "recorded\|fixtures\|mock-events\|seed" apps/web --include=*.ts --include=*.tsx | grep -v "\.test\.\|\.stories\."`.
- Produces:
  - the guarantee that every contract procedure is served over HTTP, returns JSON, never 500s on unknown IDs, and returns 401 without a session;
  - an ESLint rule `no-restricted-imports` that bans the stub modules found in Step 1 from `apps/web/{app,components,lib}`.

- [ ] **Step 1: Find the stubs.**

Run the seam-check grep above. Note each runtime module F used in place of the API, for example a recorded `RunEvent` stream, seeded JSON or a fake iframe source. Keep the list for Step 5.

- [ ] **Step 2: Write the failing conformance spec.**

`tests/e2e/specs/api-conformance.spec.ts`:
```ts
import { apiContract } from "@mastertutor/contracts";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { BASE_URL, FIXTURES_ORIGIN } from "../support/env.ts";
import { rpcCall, rpcOk } from "../support/rpc.ts";

const MISSING = "00000000-0000-4000-8000-00000000dead";
type Expectation = "ok" | "not_found";

/** One probe per procedure that has no side effects, or whose side effect needs an unknown id. */
const PROBES: ReadonlyArray<readonly [string, unknown, Expectation]> = [
  ["runs/list", { limit: 1 }, "ok"],
  ["runs/get", { runId: MISSING }, "not_found"],
  ["runs/steps", { runId: MISSING }, "not_found"],
  ["runs/cancel", { runId: MISSING }, "not_found"],
  ["runs/resume", { runId: MISSING }, "not_found"],
  ["runs/sendMessage", { runId: MISSING, text: "probe" }, "not_found"],
  ["runs/decideApproval", { approvalId: MISSING, decision: "denied" }, "not_found"],
  ["runs/submitOtp", { runId: MISSING, code: "123456" }, "not_found"],
  ["runs/takeControl", { runId: MISSING }, "not_found"],
  ["runs/handBack", { runId: MISSING }, "not_found"],
  ["runs/openLive", { runId: MISSING }, "not_found"],
  ["notes/list", {}, "ok"],
  ["notes/get", { noteId: MISSING }, "not_found"],
  ["notes/updateBlock", { blockId: MISSING, markdown: "probe" }, "not_found"],
  ["notes/markVerified", { blockId: MISSING }, "not_found"],
  ["notes/move", { noteId: MISSING, folderId: null }, "not_found"],
  ["notes/delete", { noteId: MISSING }, "not_found"],
  ["notes/export", { noteId: MISSING }, "not_found"],
  ["notes/search", { q: "probe" }, "ok"],
  ["folders/tree", {}, "ok"],
  ["folders/rename", { folderId: MISSING, name: "probe" }, "not_found"],
  ["folders/move", { folderId: MISSING, parentId: null }, "not_found"],
  ["folders/delete", { folderId: MISSING }, "not_found"],
  ["vault/list", {}, "ok"],
  ["vault/setSecret", { itemId: MISSING, field: "password", value: "probe" }, "not_found"],
  ["vault/removeSecret", { itemId: MISSING, field: "password" }, "not_found"],
  ["vault/delete", { itemId: MISSING }, "not_found"],
  ["vault/forgetSession", { alias: "no-such-alias", origin: "https://probe.example" }, "not_found"],
  ["vault/audit", { limit: 1 }, "ok"],
  ["settings/get", {}, "ok"],
  ["settings/update", {}, "ok"],
  ["settings/setKillSwitch", { on: false }, "ok"],
  ["settings/usage", { from: "2026-10-01", to: "2026-10-05" }, "ok"],
  ["assets/url", { assetId: MISSING }, "not_found"],
  ["benchmarks/list", {}, "ok"],
  ["benchmarks/start", { benchmarkId: MISSING }, "not_found"],
  ["benchmarks/runs", {}, "ok"],
  ["benchmarks/grade", { benchmarkRunId: MISSING, outcome: "failed" }, "not_found"],
];
/** Procedures probed by the create-then-clean-up test below. */
const CREATES = ["runs/create", "folders/create", "vault/create", "benchmarks/create"];

test("every contract procedure has a probe", () => {
  const all = Object.entries(apiContract).flatMap(([router, procedures]) =>
    Object.keys(procedures).map((name) => `${router}/${name}`),
  );
  expect([...PROBES.map(([path]) => path), ...CREATES].sort()).toEqual(all.sort());
});

test.describe("security: oRPC conformance", () => {
  for (const [path, input, expectation] of PROBES) {
    test(`${path} answers with JSON and the expected outcome`, async ({ request }) => {
      const result = await rpcCall(request, path, input);
      expect(result.json, `${path} returned a non-JSON body: is it routed?`).not.toBeNull();
      expect(result.status).not.toBe(500);
      if (expectation === "ok") expect(result.status).toBe(200);
      else expect(result.code).toBe("NOT_FOUND");
    });
  }

  test("every procedure rejects requests without a session", async () => {
    const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL });
    for (const path of [...PROBES.map(([p]) => p), ...CREATES]) {
      const input = PROBES.find(([p]) => p === path)?.[1] ?? {};
      const result = await rpcCall(anonymous, path, input);
      expect(result.status, path).toBe(401);
    }
    await anonymous.dispose();
  });

  test("create procedures work and their results can be cleaned up", async ({ request }) => {
    const folder = await rpcOk<{ id: string }>(request, "folders/create", { name: `Probe ${Date.now()}` });
    await rpcOk(request, "folders/delete", { folderId: folder.id });

    const item = await rpcOk<{ id: string }>(request, "vault/create", {
      alias: `probe-${Date.now()}`,
      origin: "https://probe.example",
      label: "Probe",
      secrets: {},
      imap: null,
    });
    await rpcOk(request, "vault/delete", { itemId: item.id });

    const run = await rpcOk<{ id: string }>(request, "runs/create", {
      goal: "probe: cancel immediately",
      allowedOrigins: [FIXTURES_ORIGIN],
      approvalMode: "ask",
    });
    await rpcOk(request, "runs/cancel", { runId: run.id });

    const benchmark = await rpcOk<{ id: string }>(request, "benchmarks/create", {
      name: `probe-${Date.now()}`,
      task: "probe",
      allowedOrigins: [FIXTURES_ORIGIN],
      successCriteria: "probe",
    });
    expect(benchmark.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 3: Run the spec to verify which procedures fail.**

Run: `pnpm e2e -- specs/api-conformance.spec.ts`
Expected: before integration, FAIL on every procedure that is unrouted, stubbed, 500s on unknown IDs, or lets an anonymous request through. `benchmarks/*` will fail until Task 18; mark them `test.fixme` **only** for `benchmarks/*` and remove the `fixme` in Task 18.

- [ ] **Step 4: Fix each failing procedure in the router.** For each failure:
  - **Not routed:** add the handler to S2.
  - **500 on an unknown id:** the handler must `throw new ORPCError("NOT_FOUND")` when the workspace-scoped lookup returns no row. Scope every lookup by `context.workspaceId`.
  - **Anonymous 200:** the auth middleware must cover the whole router.

  Every fix ships with a failing probe first (this spec). Commit fixes per router.

- [ ] **Step 5: Ban stubs in app code.**

For each stub module found in Step 1:
- point its runtime callers at the real API. `api.*` replaces seeded data; Task 3 replaces recorded events and the iframe stub.
- leave the module only if a test or story still imports it.

Then add to `eslint.config.js`, using the exact module paths from Step 1. The paths below are an example to replace:
```js
{
  files: ["apps/web/app/**/*.{ts,tsx}", "apps/web/components/**/*.{ts,tsx}", "apps/web/lib/**/*.{ts,tsx}"],
  ignores: ["**/*.test.*", "**/*.stories.*"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        { group: ["**/fixtures/**", "**/recorded-*", "**/*-stub", "**/seed-data*"],
          message: "Runtime UI code talks to the real API (Phase 7). Stubs are for tests and stories only." },
      ],
    }],
  },
},
```
If the F phases already declared `no-restricted-imports` for the same files (for example the motion bans), **merge** these patterns into that rule's `patterns`. A later flat-config entry would otherwise replace it.

- [ ] **Step 6: Run everything to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm e2e -- specs/api-conformance.spec.ts`
Expected: PASS, with `benchmarks/*` still `fixme`.

- [ ] **Step 7: Commit.**

```bash
git add tests/e2e/specs/api-conformance.spec.ts eslint.config.js apps/web
git commit -m "test(e2e): oRPC conformance (routing, NOT_FOUND, 401) and no stub imports in app code"
```

---

### Task 3: Client wiring for run events and the live iframe

**Files:**
- Create: `apps/web/lib/client/run-events.ts`, `apps/web/lib/client/run-events.test.ts`, `apps/web/lib/client/live-view.ts`, `apps/web/lib/client/live-view.test.ts`, `apps/web/lib/client/hooks.ts`
- Modify:
  - F3's run view: replace the recorded stream and the iframe stub;
  - the S4 SSE route: add `?after=` if absent;
  - F components: add the `data-testid` and `data-qa-*` attributes listed in Step 6.

**Interfaces:**
- Consumes:
  - `RunEventRecord`, `RunEvent` and `OpenLiveResult`;
  - S4 and S5.
  - Seam check: `grep -n "Last-Event-ID\|after" apps/web/app/api/runs/*/events/route.ts; grep -rn "iframe" apps/web/components | head`.
- Produces:
  - `subscribeRunEvents(runId: string, options: {afterId: string | null; onEvent(record: RunEventRecord): void; onError?(error: unknown): void; factory?: EventSourceFactory}): {close(): void}`;
  - `type EventSourceLike`, `type EventSourceFactory`;
  - `createLiveViewController(runId: string, openLive: (runId: string) => Promise<OpenLiveResult>, onChange: (state: LiveViewState) => void): LiveViewController`, where `LiveViewController = {start(): Promise<void>; onRunEvent(event: RunEvent): void; retry(): Promise<void>; dispose(): void}`;
  - `type LiveViewState = {kind:"connecting"} | {kind:"live"; slotName; embedPath; iceServers} | {kind:"sleeping"} | {kind:"error"}`;
  - `useRunEvents(runId, afterId, onEvent)` and `useLiveView(runId): {state: LiveViewState; onRunEvent(e: RunEvent): void; retry(): void}`;
  - the DOM hooks used by E2E and QA (Step 6).

- [ ] **Step 1: Write the failing unit tests.**

`apps/web/lib/client/run-events.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { RunEventRecord } from "@mastertutor/contracts";
import { subscribeRunEvents, type EventSourceLike } from "./run-events.ts";

const RUN = "11111111-1111-4111-8111-111111111111";

class FakeSource implements EventSourceLike {
  onmessage: EventSourceLike["onmessage"] = null;
  onerror: EventSourceLike["onerror"] = null;
  readyState = 1;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  emit(id: string, data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data), lastEventId: id });
  }
  close(): void {
    this.closed = true;
  }
}

function record(id: string): RunEventRecord {
  return { id, runId: RUN, at: "2026-10-05T12:00:00.000Z", event: { type: "control", holder: "agent" } };
}

describe("subscribeRunEvents", () => {
  it("resumes after the snapshot's last event id", () => {
    let source: FakeSource | undefined;
    subscribeRunEvents(RUN, {
      afterId: "41",
      onEvent: () => undefined,
      factory: (url) => (source = new FakeSource(url)),
    });
    expect(source?.url).toBe(`/api/runs/${RUN}/events?after=41`);
  });

  it("drops events at or below the highest id already delivered (reconnect replay)", () => {
    const seen: string[] = [];
    let source: FakeSource | undefined;
    subscribeRunEvents(RUN, {
      afterId: null,
      onEvent: (r) => seen.push(r.id),
      factory: (url) => (source = new FakeSource(url)),
    });
    source?.emit("7", record("7"));
    source?.emit("8", record("8"));
    source?.emit("8", record("8"));
    source?.emit("6", record("6"));
    source?.emit("10", record("10"));
    expect(seen).toEqual(["7", "8", "10"]);
  });

  it("compares ids numerically, not as strings", () => {
    const seen: string[] = [];
    let source: FakeSource | undefined;
    subscribeRunEvents(RUN, {
      afterId: "9",
      onEvent: (r) => seen.push(r.id),
      factory: (url) => (source = new FakeSource(url)),
    });
    source?.emit("10", record("10"));
    expect(seen).toEqual(["10"]);
  });

  it("reports malformed payloads instead of throwing", () => {
    const errors: unknown[] = [];
    let source: FakeSource | undefined;
    subscribeRunEvents(RUN, {
      afterId: null,
      onEvent: () => undefined,
      onError: (e) => errors.push(e),
      factory: (url) => (source = new FakeSource(url)),
    });
    source?.onmessage?.({ data: "{not json", lastEventId: "1" });
    source?.emit("2", { id: "2", nope: true });
    expect(errors).toHaveLength(2);
  });

  it("closes the source", () => {
    let source: FakeSource | undefined;
    const sub = subscribeRunEvents(RUN, {
      afterId: null,
      onEvent: () => undefined,
      factory: (url) => (source = new FakeSource(url)),
    });
    sub.close();
    expect(source?.closed).toBe(true);
  });
});
```

`apps/web/lib/client/live-view.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { OpenLiveResult } from "@mastertutor/contracts";
import { createLiveViewController, type LiveViewState } from "./live-view.ts";

const RUN = "22222222-2222-4222-8222-222222222222";
const live = (slotName: string): OpenLiveResult => ({
  sleeping: false,
  slotName,
  embedPath: `/live/${RUN}/?embed=1`,
  iceServers: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createLiveViewController", () => {
  it("goes live, then re-opens when the run moves to another slot", async () => {
    const states: LiveViewState[] = [];
    const calls: string[] = [];
    const answers = [live("browser-1"), live("browser-2")];
    const controller = createLiveViewController(
      RUN,
      async (id) => (calls.push(id), answers.shift()!),
      (s) => states.push(s),
    );
    await controller.start();
    controller.onRunEvent({ type: "slot", slotName: "browser-2" });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(states.at(-1)).toMatchObject({ kind: "live", slotName: "browser-2" });
  });

  it("does not re-open for a slot event naming the current slot", async () => {
    let calls = 0;
    const controller = createLiveViewController(RUN, async () => (calls++, live("browser-1")), () => undefined);
    await controller.start();
    controller.onRunEvent({ type: "slot", slotName: "browser-1" });
    expect(calls).toBe(1);
  });

  it("shows sleeping when the slot is released", async () => {
    const states: LiveViewState[] = [];
    const controller = createLiveViewController(RUN, async () => live("browser-1"), (s) => states.push(s));
    await controller.start();
    controller.onRunEvent({ type: "slot", slotName: null });
    expect(states.at(-1)).toEqual({ kind: "sleeping" });
  });

  it("ignores a stale openLive answer that resolves after a newer one", async () => {
    const first = deferred<OpenLiveResult>();
    const second = deferred<OpenLiveResult>();
    const queue = [first.promise, second.promise];
    const states: LiveViewState[] = [];
    const controller = createLiveViewController(RUN, () => queue.shift()!, (s) => states.push(s));
    const a = controller.start();
    const b = controller.retry();
    second.resolve(live("browser-2"));
    await b;
    first.resolve(live("browser-1"));
    await a;
    expect(states.at(-1)).toMatchObject({ kind: "live", slotName: "browser-2" });
  });

  it("reports errors and recovers on retry", async () => {
    let fail = true;
    const states: LiveViewState[] = [];
    const controller = createLiveViewController(
      RUN,
      async () => {
        if (fail) throw new Error("boom");
        return live("browser-1");
      },
      (s) => states.push(s),
    );
    await controller.start();
    expect(states.at(-1)).toEqual({ kind: "error" });
    fail = false;
    await controller.retry();
    expect(states.at(-1)).toMatchObject({ kind: "live" });
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test -- apps/web/lib/client`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement.**

`apps/web/lib/client/run-events.ts`:
```ts
import { RunEventRecord } from "@mastertutor/contracts";

export interface EventSourceLike {
  onmessage: ((message: { data: string; lastEventId: string }) => void) | null;
  onerror: (() => void) | null;
  readonly readyState: number;
  close(): void;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

export interface RunEventsOptions {
  /** The run snapshot's lastEventId; only newer events are delivered. */
  afterId: string | null;
  onEvent(record: RunEventRecord): void;
  onError?(error: unknown): void;
  factory?: EventSourceFactory;
}

const browserFactory: EventSourceFactory = (url) => new EventSource(url, { withCredentials: true });

/**
 * Streams a run's events (spec §6). EventSource re-sends Last-Event-ID itself on reconnect;
 * anything at or below the highest delivered id is dropped, so replays never duplicate.
 */
export function subscribeRunEvents(runId: string, options: RunEventsOptions): { close(): void } {
  let highest = options.afterId === null ? -1n : BigInt(options.afterId);
  const query = options.afterId === null ? "" : `?after=${encodeURIComponent(options.afterId)}`;
  const source = (options.factory ?? browserFactory)(`/api/runs/${encodeURIComponent(runId)}/events${query}`);

  source.onmessage = (message) => {
    let parsed: ReturnType<typeof RunEventRecord.safeParse>;
    try {
      parsed = RunEventRecord.safeParse(JSON.parse(message.data));
    } catch (error) {
      options.onError?.(error);
      return;
    }
    if (!parsed.success) {
      options.onError?.(parsed.error);
      return;
    }
    const id = BigInt(parsed.data.id);
    if (id <= highest) return;
    highest = id;
    options.onEvent(parsed.data);
  };
  source.onerror = () => options.onError?.(new Error("run event stream interrupted; reconnecting"));
  return { close: () => source.close() };
}
```

`apps/web/lib/client/live-view.ts`:
```ts
import type { IceServer, OpenLiveResult, RunEvent } from "@mastertutor/contracts";

export type LiveViewState =
  | { kind: "connecting" }
  | { kind: "live"; slotName: string; embedPath: string; iceServers: IceServer[] }
  | { kind: "sleeping" }
  | { kind: "error" };

export interface LiveViewController {
  start(): Promise<void>;
  onRunEvent(event: RunEvent): void;
  retry(): Promise<void>;
  dispose(): void;
}

/**
 * Owns runs.openLive for one run view (spec §10.2 step 3): it re-opens on every slot change,
 * and a newer request always wins over an older answer that arrives late.
 */
export function createLiveViewController(
  runId: string,
  openLive: (runId: string) => Promise<OpenLiveResult>,
  onChange: (state: LiveViewState) => void,
): LiveViewController {
  let generation = 0;
  let current: LiveViewState = { kind: "connecting" };
  const set = (state: LiveViewState) => {
    current = state;
    onChange(state);
  };

  async function open(): Promise<void> {
    const mine = ++generation;
    set({ kind: "connecting" });
    try {
      const result = await openLive(runId);
      if (mine !== generation) return;
      set(
        result.sleeping
          ? { kind: "sleeping" }
          : { kind: "live", slotName: result.slotName, embedPath: result.embedPath, iceServers: result.iceServers },
      );
    } catch {
      if (mine === generation) set({ kind: "error" });
    }
  }

  return {
    start: open,
    retry: open,
    onRunEvent(event) {
      if (event.type !== "slot") return;
      if (event.slotName === null) {
        generation++;
        set({ kind: "sleeping" });
        return;
      }
      if (current.kind === "live" && current.slotName === event.slotName) return;
      void open();
    },
    dispose() {
      generation++;
    },
  };
}
```

`apps/web/lib/client/hooks.ts`:
```ts
"use client";
import type { RunEvent, RunEventRecord } from "@mastertutor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.ts";
import { createLiveViewController, type LiveViewController, type LiveViewState } from "./live-view.ts";
import { subscribeRunEvents } from "./run-events.ts";

export function useRunEvents(runId: string, afterId: string | null, onEvent: (record: RunEventRecord) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const subscription = subscribeRunEvents(runId, { afterId, onEvent: (record) => handler.current(record) });
    return () => subscription.close();
  }, [runId, afterId]);
}

export function useLiveView(runId: string): { state: LiveViewState; onRunEvent(event: RunEvent): void; retry(): void } {
  const [state, setState] = useState<LiveViewState>({ kind: "connecting" });
  const controller = useRef<LiveViewController | null>(null);
  useEffect(() => {
    const instance = createLiveViewController(runId, (id) => api.runs.openLive({ runId: id }), setState);
    controller.current = instance;
    void instance.start();
    return () => instance.dispose();
  }, [runId]);
  const onRunEvent = useCallback((event: RunEvent) => controller.current?.onRunEvent(event), []);
  const retry = useCallback(() => void controller.current?.retry(), []);
  return { state, onRunEvent, retry };
}
```
Adjust the `api` import path to S5 if it differs.

- [ ] **Step 4: Run the unit tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/client && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Wire the run view and the SSE route.**
  1. In F3's run view, replace the recorded event source with `useRunEvents(runId, detail.lastEventId, …)`, where `detail` comes from `api.runs.get`. Pass each `record.event` both to the run-view state reducer and to `useLiveView().onRunEvent`.
  2. Replace the iframe stub's `src` with `state.embedPath` when `state.kind === "live"`. Render the §10.4 Paused/sleeping treatment for `sleeping`, and Reconnecting (with a `retry` button) for `error`.
  3. **SSE route (S4).** If it does not read `?after=`, add it: `const after = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");` then validate it with `/^[0-9]+$/`. Ignore an invalid value and start from the beginning.

- [ ] **Step 6: Add the E2E and QA DOM hooks.** Add these attributes to F components. They are test hooks only, with no styling meaning:

  | Attribute | Element |
  |---|---|
  | `data-testid="run-status"` + `data-status` + `data-wait-reason` | the run status mark |
  | `data-testid="live-preview"` | the overlay above the iframe that takes the takeover press |
  | `data-testid="control-banner"` | the "You're in control" glass banner |
  | `data-testid="step-row"` | each timeline step row |
  | `data-testid="approval-sheet"` | the approval spotlight sheet |
  | `data-testid="note-block"` + `data-origin` | each rendered note block |
  | `data-testid="library-note"` | each library card or row |
  | `data-testid="folder-tree"` | the folder tree root |
  | `data-testid="vault-item"` | each vault alias row |
  | `data-qa-region="timeline"` | the run timeline container |
  | `data-qa-layer="leader"` | each callout leader line SVG |

- [ ] **Step 7: Run the checks and commit.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): live run events (resume + dedupe) and live iframe controller wired into the run view"
```

---

### Task 4: Core-flow E2E specs

**Files:**
- Create: `tests/e2e/support/{ui,runs}.ts`
- Create: `tests/e2e/specs/{sse,run-to-note,approvals,vault-otp,kill-switch,library-folders}.spec.ts`
- Create, only if absent and in B1's scenario format: `tests/llm-mock/scenarios/{capture-article,risky-click,login-otp-ui,login-otp-imap,long-wait}`
- Modify: `compose.test.yml` (add `greenmail` if absent)

**Interfaces:**
- Consumes:
  - T1 (`rpcCall`, `rpcOk`, `OWNER`, `FIXTURES_ORIGIN`, `scenarioGoal`) and the T3 DOM hooks;
  - S6, S8, S9 and S10;
  - `CANARIES` from `tests/security/canaries.ts` (created in T6; create that file now if T6 hasn't run, with the content given in T6 Step 3).
  - Seam check: `ls tests/llm-mock/scenarios tests/fixtures/site; grep -n greenmail compose.test.yml`.
- Produces:
  - `createRun(request, {goal, approvalMode?, allowedOrigins?}): Promise<string>`;
  - `waitForStatus(request, runId, statuses: RunStatus[], timeoutMs?): Promise<RunDetail>`;
  - `runSteps(request, runId): Promise<RunStepView[]>`;
  - `ui.*` locators.

- [ ] **Step 1: Write the helpers.**

`tests/e2e/support/runs.ts`:
```ts
import type { RunDetail, RunStatus, RunStepView } from "@mastertutor/contracts";
import type { APIRequestContext } from "@playwright/test";
import { FIXTURES_ORIGIN } from "./env.ts";
import { rpcOk } from "./rpc.ts";

export async function createRun(
  request: APIRequestContext,
  input: { goal: string; approvalMode?: "ask" | "auto_within_allowlist"; allowedOrigins?: string[] },
): Promise<string> {
  const run = await rpcOk<{ id: string }>(request, "runs/create", {
    goal: input.goal,
    allowedOrigins: input.allowedOrigins ?? [FIXTURES_ORIGIN],
    approvalMode: input.approvalMode ?? "ask",
  });
  return run.id;
}

export async function waitForStatus(
  request: APIRequestContext,
  runId: string,
  statuses: readonly RunStatus[],
  timeoutMs = 90_000,
): Promise<RunDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await rpcOk<RunDetail>(request, "runs/get", { runId });
    if (statuses.includes(detail.status)) return detail;
    if (Date.now() > deadline) throw new Error(`run ${runId} stayed ${detail.status}; wanted ${statuses.join("|")}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function runSteps(request: APIRequestContext, runId: string): Promise<RunStepView[]> {
  return (await rpcOk<{ items: RunStepView[] }>(request, "runs/steps", { runId })).items;
}
```
(`waitForStatus` polls the API in test code only. The product itself streams.)

`tests/e2e/support/ui.ts`. These are the only place that knows F's accessible names; adjust here, not in specs:
```ts
import type { Page } from "@playwright/test";

export const ui = {
  composer: (page: Page) => page.getByRole("textbox", { name: /task|what should/i }),
  startTask: (page: Page) => page.getByRole("button", { name: /^start/i }),
  runStatus: (page: Page) => page.getByTestId("run-status"),
  livePreview: (page: Page) => page.getByTestId("live-preview"),
  liveFrame: (page: Page) => page.frameLocator('iframe[src*="/live/"]'),
  controlBanner: (page: Page) => page.getByTestId("control-banner"),
  handBack: (page: Page) => page.getByRole("button", { name: /hand back/i }),
  approvalSheet: (page: Page) => page.getByTestId("approval-sheet"),
  approve: (page: Page) => page.getByTestId("approval-sheet").getByRole("button", { name: /^approve$/i }),
  deny: (page: Page) => page.getByTestId("approval-sheet").getByRole("button", { name: /^deny$/i }),
  codeSlots: (page: Page) => page.getByRole("textbox", { name: /code|digit/i }),
  noteBlocks: (page: Page) => page.getByTestId("note-block"),
  libraryNotes: (page: Page) => page.getByTestId("library-note"),
  folderTree: (page: Page) => page.getByTestId("folder-tree"),
  vaultItems: (page: Page) => page.getByTestId("vault-item"),
  killSwitch: (page: Page) => page.getByRole("switch", { name: /kill switch/i }),
};

/** Clicks a confirm button if a confirmation dialog appears, and does nothing otherwise. */
export async function confirmIfAsked(page: Page): Promise<void> {
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /confirm|turn on|stop|continue/i }).click();
  }
}
```

- [ ] **Step 2: Ensure the mock scenarios and greenmail exist.**

**Scenarios.** For each scenario below that B1 did not ship, write it in B1's format under `tests/llm-mock/scenarios/`:

| Scenario | Turns (each step is one model response) |
|---|---|
| `capture-article` | `read_page {mode:"interactive"}` → `capture {scope:"page", selector:null, kind:"web"}` → `AgentTurn {status:"done"}` |
| `risky-click` | `computer click` on the fixture page's "Delete account" button → after approval, `read_page text` → done. On a denial, `AgentTurn {status:"done", reason:"denied"}` |
| `login-otp-ui` | `fill_credential username` → `fill_credential password` → `computer click` "Sign in" → `fill_credential {field:"otp"}`. With no IMAP config this waits `otp`; after submit it repeats the fill → done |
| `login-otp-imap` | same as `login-otp-ui`, with the vault item's IMAP config pointing at greenmail |
| `long-wait` | `computer {type:"wait"}` repeated 200 times, then done |

Element refs and coordinates come from B1's fixture pages, as B1's own scenarios already do.

**Greenmail.** If `compose.test.yml` has no `greenmail`, add it on `backend` and on the `fixtures` network (so the login fixture can send mail):
```yaml
greenmail:
  image: greenmail/standalone:2.1.2
  environment:
    GREENMAIL_OPTS: "-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled"
  networks:
    backend: {}
    fixtures: {}
```
Verify the tag with `docker manifest inspect greenmail/standalone:2.1.2`. If it is missing, use the newest `2.1.x`.

- [ ] **Step 3: Write the specs.**

`tests/e2e/specs/sse.spec.ts`:
```ts
import type { RunEventRecord } from "@mastertutor/contracts";
import { expect, test } from "@playwright/test";
import { scenarioGoal } from "../../llm-mock/select.ts";
import { createRun, waitForStatus } from "../support/runs.ts";

async function readEvents(page: import("@playwright/test").Page, url: string, count: number): Promise<RunEventRecord[]> {
  return page.evaluate(
    ({ url, count }) =>
      new Promise<RunEventRecord[]>((resolve, reject) => {
        const got: RunEventRecord[] = [];
        const source = new EventSource(url);
        const timer = setTimeout(() => (source.close(), reject(new Error(`only ${got.length} events`))), 30_000);
        source.onmessage = (m) => {
          got.push(JSON.parse(m.data));
          if (got.length >= count) {
            clearTimeout(timer);
            source.close();
            resolve(got);
          }
        };
      }),
    { url, count },
  );
}

test.describe("run event stream", () => {
  test("streams RunEventRecords and resumes strictly after ?after=", async ({ page, request }) => {
    await page.goto("/");
    const runId = await createRun(request, { goal: scenarioGoal("capture-article", "Capture the article") });
    await waitForStatus(request, runId, ["completed"]);
    const first = await readEvents(page, `/api/runs/${runId}/events`, 3);
    expect(first.map((r) => r.runId)).toEqual([runId, runId, runId]);
    const resumed = await readEvents(page, `/api/runs/${runId}/events?after=${first[1]!.id}`, 1);
    expect(BigInt(resumed[0]!.id)).toBeGreaterThan(BigInt(first[1]!.id));
  });

  test("security: the event stream refuses anonymous readers", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    const response = await anonymous.get("/api/runs/00000000-0000-4000-8000-00000000dead/events");
    expect([401, 404]).toContain(response.status());
    await anonymous.dispose();
  });
});
```

`tests/e2e/specs/run-to-note.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { scenarioGoal } from "../../llm-mock/select.ts";
import { FIXTURES_ORIGIN } from "../support/env.ts";
import { ui } from "../support/ui.ts";

test("a task started in the UI runs to a filed, readable note", async ({ page }) => {
  await page.goto("/");
  await ui.composer(page).fill(scenarioGoal("capture-article", `Capture ${FIXTURES_ORIGIN}/article.html`));
  await ui.startTask(page).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(ui.runStatus(page)).toHaveAttribute("data-status", "completed", { timeout: 90_000 });
  await expect(page.getByTestId("step-row").first()).toBeVisible();

  await page.goto("/library");
  await ui.libraryNotes(page).first().click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(ui.noteBlocks(page).first()).toBeVisible();
  await expect(page.locator('[data-testid="note-block"][data-origin="dom"]').first()).toBeVisible();
});
```

`tests/e2e/specs/approvals.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { scenarioGoal } from "../../llm-mock/select.ts";
import { createRun, waitForStatus } from "../support/runs.ts";
import { ui } from "../support/ui.ts";

test.describe("approvals", () => {
  test("a risky click waits for approval and proceeds when approved", async ({ page, request }) => {
    const runId = await createRun(request, { goal: scenarioGoal("risky-click", "Delete the account") });
    await waitForStatus(request, runId, ["waiting"]);
    await page.goto(`/runs/${runId}`);
    await expect(ui.approvalSheet(page)).toBeVisible();
    await expect(ui.approvalSheet(page)).toContainText(/delete account/i);
    await ui.approve(page).click();
    await expect(ui.approvalSheet(page)).toBeHidden({ timeout: 2_000 });
    await expect(ui.runStatus(page)).toHaveAttribute("data-status", "completed", { timeout: 60_000 });
  });

  test("a denied risky click is not performed", async ({ page, request }) => {
    const runId = await createRun(request, { goal: scenarioGoal("risky-click", "Delete the account") });
    await waitForStatus(request, runId, ["waiting"]);
    await page.goto(`/runs/${runId}`);
    await ui.deny(page).click();
    await expect(ui.runStatus(page)).toHaveAttribute("data-status", /completed|cancelled/, { timeout: 60_000 });
    await expect(page.getByTestId("step-row").filter({ hasText: /deleted/i })).toHaveCount(0);
  });

  test("auto_within_allowlist approves the same click by policy and records it", async ({ request }) => {
    const runId = await createRun(request, {
      goal: scenarioGoal("risky-click", "Delete the account"),
      approvalMode: "auto_within_allowlist",
    });
    const detail = await waitForStatus(request, runId, ["completed"]);
    expect(detail.approvalMode).toBe("auto_within_allowlist");
  });
});
```

`tests/e2e/specs/vault-otp.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { scenarioGoal } from "../../llm-mock/select.ts";
import { CANARIES, FIXTURE_LOGIN_USER } from "../../security/canaries.ts";
import { FIXTURES_ORIGIN } from "../support/env.ts";
import { rpcOk } from "../support/rpc.ts";
import { createRun, waitForStatus } from "../support/runs.ts";
import { ui } from "../support/ui.ts";

test.describe("vault and OTP", () => {
  test("a vault item created in the UI never renders its secrets back", async ({ page }) => {
    await page.goto("/vault");
    await page.getByRole("button", { name: /add|new/i }).first().click();
    await page.getByRole("textbox", { name: /alias/i }).fill("fixture-login");
    await page.getByRole("textbox", { name: /origin|site/i }).fill(FIXTURES_ORIGIN);
    await page.getByRole("textbox", { name: /label|name/i }).fill("Fixture login");
    await page.getByRole("textbox", { name: /username|email/i }).fill(FIXTURE_LOGIN_USER);
    await page.getByLabel(/password/i).fill(CANARIES.password);
    await page.getByLabel(/totp|authenticator/i).fill(CANARIES.totpSeed);
    await page.getByLabel(/pin/i).fill(CANARIES.pin);
    await page.getByRole("button", { name: /save/i }).click();
    await expect(ui.vaultItems(page).filter({ hasText: "fixture-login" })).toBeVisible();
    await page.reload();
    const html = await page.content();
    for (const value of Object.values(CANARIES)) expect(html).not.toContain(value);
    await expect(page.getByText(/secrets are never shown/i)).toBeVisible();
  });

  test("an OTP typed into CodeSlots unblocks the login", async ({ page, request }) => {
    const runId = await createRun(request, { goal: scenarioGoal("login-otp-ui", "Sign in to the fixture") });
    await waitForStatus(request, runId, ["waiting"]);
    await page.goto(`/runs/${runId}`);
    await expect(ui.runStatus(page)).toHaveAttribute("data-wait-reason", "otp");
    await ui.codeSlots(page).first().pressSequentially(CANARIES.otp);
    await expect(ui.runStatus(page)).toHaveAttribute("data-status", "completed", { timeout: 60_000 });
  });

  test("an emailed OTP is read from IMAP without the user", async ({ request }) => {
    const runId = await createRun(request, { goal: scenarioGoal("login-otp-imap", "Sign in with email code") });
    const detail = await waitForStatus(request, runId, ["completed", "failed"]);
    expect(detail.status).toBe("completed");
    const audit = await rpcOk<{ items: { action: string }[] }>(request, "vault/audit", { limit: 50 });
    expect(audit.items.some((row) => row.action === "otp_received")).toBe(true);
  });
});
```

`tests/e2e/specs/kill-switch.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { scenarioGoal } from "../../llm-mock/select.ts";
import { rpcOk } from "../support/rpc.ts";
import { createRun, waitForStatus } from "../support/runs.ts";
import { confirmIfAsked, ui } from "../support/ui.ts";

test("the kill switch cancels running work within seconds and blocks new runs until cleared", async ({ page, request }) => {
  const runId = await createRun(request, { goal: scenarioGoal("long-wait", "Wait") });
  await waitForStatus(request, runId, ["running"]);
  await page.goto("/settings");
  await ui.killSwitch(page).click();
  await confirmIfAsked(page);
  const cancelled = await waitForStatus(request, runId, ["cancelled"], 3_000);
  expect(cancelled.status).toBe("cancelled");

  const blocked = await createRun(request, { goal: scenarioGoal("long-wait", "Wait") });
  await page.waitForTimeout(2_000);
  expect((await rpcOk<{ status: string }>(request, "runs/get", { runId: blocked })).status).toBe("queued");

  await ui.killSwitch(page).click();
  await waitForStatus(request, blocked, ["running"], 30_000);
  await rpcOk(request, "runs/cancel", { runId: blocked });
});
```

`tests/e2e/specs/library-folders.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { rpcOk } from "../support/rpc.ts";
import { ui } from "../support/ui.ts";

test("nested folders persist and a note can be moved with Move to…", async ({ page, request }) => {
  const parent = await rpcOk<{ id: string }>(request, "folders/create", { name: `Parent ${Date.now()}` });
  const child = await rpcOk<{ id: string }>(request, "folders/create", { name: "Child", parentId: parent.id });
  await page.goto("/library");
  await expect(ui.folderTree(page).getByText("Child")).toBeVisible();

  const notes = await rpcOk<{ items: { id: string; title: string }[] }>(request, "notes/list", { limit: 1 });
  test.skip(notes.items.length === 0, "run-to-note.spec.ts creates the first note");
  const note = notes.items[0]!;
  await page.goto(`/notes/${note.id}`);
  await page.getByRole("button", { name: /move to/i }).click();
  await page.getByRole("dialog").getByText("Child").click();
  await page.getByRole("dialog").getByRole("button", { name: /move/i }).click();
  await page.goto("/library");
  await ui.folderTree(page).getByText("Child").click();
  await expect(ui.libraryNotes(page).filter({ hasText: note.title })).toBeVisible();
  expect(child.id).toMatch(/^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 4: Run them to verify they pass, fixing integration bugs test-first.**

Run: `pnpm e2e`
Expected: every spec in `specs/` PASSES, except `live-playback` and `takeover`, which don't exist yet.

When a spec fails because of a product bug:
- write a failing unit or integration test for the bug in the owning package;
- fix it there;
- re-run.

Never loosen the E2E assertion to make it pass.

- [ ] **Step 5: Commit.**

```bash
git add tests/e2e tests/llm-mock compose.test.yml
git commit -m "test(e2e): core flows (task to note, approvals, vault + OTP, kill switch, folders, SSE resume)"
```

---

### Task 5: Live view (WebRTC over the TCP mux) and takeover E2E

**Files:**
- Create: `tests/fixtures/site/takeover.html`, `tests/e2e/specs/{live-playback,takeover}.spec.ts`
- Create if absent: `tests/llm-mock/scenarios/takeover-target` (B1 format)

**Interfaces:**
- Consumes: T1–T4 helpers, B6's live routing (S13), and the T3 hooks (`live-preview`, `control-banner`).
- Produces: E2E proof that:
  - the n.eko stream decodes in a real browser with UDP disabled;
  - takeover moves control and pauses the agent;
  - user input reaches the page through n.eko;
  - hand back resumes the agent.

- [ ] **Step 1: Write the fixture and the scenario.**

`tests/fixtures/site/takeover.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Takeover fixture</title>
  <style>
    html, body { margin: 0; height: 100%; background: #ffffff; font: 20px system-ui, sans-serif; }
    /* A large centred block, so the middle of the live video is always inside it. */
    #block { position: fixed; inset: 15% 20%; background: rgb(220, 20, 20); display: grid; place-items: center; color: #fff; }
    #block[data-on="1"] { background: rgb(20, 180, 60); }
  </style>
</head>
<body>
  <button id="block" type="button" aria-label="Toggle colour">Toggle</button>
  <script>
    const block = document.getElementById("block");
    block.addEventListener("click", () => { block.dataset.on = block.dataset.on === "1" ? "0" : "1"; });
  </script>
</body>
</html>
```

The `takeover-target` scenario is: navigate to `http://fixtures/takeover.html` (B1's way of opening a URL, for example a `keypress` sequence or B1's navigation step), then `computer {type:"wait"}` repeated 300 times, then done.

- [ ] **Step 2: Write the specs.**

`tests/e2e/specs/live-playback.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { scenarioGoal } from "../../llm-mock/select.ts";
import { rpcOk } from "../support/rpc.ts";
import { createRun, waitForStatus } from "../support/runs.ts";
import { ui } from "../support/ui.ts";

test("the live view decodes the slot's video with UDP disabled (TCP mux)", async ({ page, request }) => {
  const runId = await createRun(request, { goal: scenarioGoal("takeover-target", "Open the takeover page") });
  await waitForStatus(request, runId, ["running"]);
  await page.goto(`/runs/${runId}`);
  const video = ui.liveFrame(page).locator("video");
  await expect(video).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBe(1280);
  const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(1_500);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(before);
  await rpcOk(request, "runs/cancel", { runId });
});
```

`tests/e2e/specs/takeover.spec.ts`:
```ts
import { expect, test, type Locator } from "@playwright/test";
import { scenarioGoal } from "../../llm-mock/select.ts";
import { rpcOk } from "../support/rpc.ts";
import { createRun, runSteps, waitForStatus } from "../support/runs.ts";
import { ui } from "../support/ui.ts";

async function centrePixel(video: Locator): Promise<[number, number, number]> {
  return video.evaluate((v: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(v, 0, 0);
    const d = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  });
}
const isRed = ([r, g]: [number, number, number]) => r > 150 && g < 90;
const isGreen = ([r, g]: [number, number, number]) => g > 120 && r < 90;

test("click-to-take-over pauses the agent, user input reaches the page, and hand back resumes", async ({ page, request }) => {
  const runId = await createRun(request, { goal: scenarioGoal("takeover-target", "Open the takeover page") });
  await waitForStatus(request, runId, ["running"]);
  await page.goto(`/runs/${runId}`);
  const video = ui.liveFrame(page).locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBe(1280);
  await expect.poll(async () => isRed(await centrePixel(video)), { timeout: 20_000 }).toBe(true);

  // 1. Press into the preview: an optimistic transition, then the control event within 2 s (spec §10.3).
  const box = (await ui.livePreview(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(ui.controlBanner(page)).toBeVisible({ timeout: 2_000 });
  await expect(ui.controlBanner(page)).toContainText(/you.re in control/i);
  await waitForStatus(request, runId, ["waiting"], 5_000);

  // 2. The agent is paused: no new steps while the user holds control.
  const stepsAtTakeover = (await runSteps(request, runId)).length;
  await page.waitForTimeout(3_000);
  expect((await runSteps(request, runId)).length).toBe(stepsAtTakeover);

  // 3. The user's click goes through n.eko to the real page.
  const frameBox = (await page.locator('iframe[src*="/live/"]').boundingBox())!;
  await page.mouse.click(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  await expect.poll(async () => isGreen(await centrePixel(video)), { timeout: 10_000 }).toBe(true);

  // 4. Hand back: the banner leaves and the agent acts again.
  await ui.handBack(page).click();
  await expect(ui.controlBanner(page)).toBeHidden({ timeout: 2_000 });
  await expect.poll(async () => (await runSteps(request, runId)).length, { timeout: 15_000 }).toBeGreaterThan(stepsAtTakeover);
  await rpcOk(request, "runs/cancel", { runId });
});
```

- [ ] **Step 3: Run them to verify they pass.**

Run: `pnpm e2e -- specs/live-playback.spec.ts specs/takeover.spec.ts`
Expected: PASS.

If the video never gets dimensions:
1. Check `docker compose … logs browser-1` for ICE/mux errors.
2. Check that `NEKO_WEBRTC_NAT1TO1` equals the slot's `cdp` IP (T1 test).
3. If B6's slot ingress filter drops the mux port from Traefik's IP `.12`, extend the filter. Do not weaken the test.

- [ ] **Step 4: Commit.**

```bash
git add tests/fixtures/site/takeover.html tests/e2e/specs tests/llm-mock
git commit -m "test(e2e): WebRTC playback over the TCP mux and click-to-take-over with real input and hand back"
```

---

### Task 6: Security suite (stack canary scan, key placement) and CI jobs

**Files:**
- Create: `tests/security/{canaries.ts,scan.ts,scan.test.ts,dump-objects.ts,stack-canary.ts}`, `tests/compose/key-placement.int.test.ts`
- Modify:
  - `scripts/e2e.sh`, `package.json` (script `test:security`), `.github/workflows/ci.yml`;
  - B3's login fixture: import credentials from `canaries.ts`;
  - existing security tests: add the `security: ` describe prefix.

**Interfaces:**
- Consumes:
  - the E2E stack (T1–T5) and S8 (`/__requests`);
  - Garage env names (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
  - Seam check: `grep -rln "describe(\"security\|canary" apps packages tests | head -30`.
- Produces:
  - `CANARIES: {password; totpSeed; pin; otp; imapPassword}` and `FIXTURE_LOGIN_USER`;
  - `scanBuffer(buffer: Buffer, where: string, canaries: Canaries): Hit[]`;
  - `scanOcrText(text: string, where: string, canaries: Canaries): Hit[]`;
  - `base64Needles(value: string): string[]`;
  - `node tests/security/stack-canary.ts`, which exits 1 on any hit and writes `tests/security/.out/report.json`;
  - `pnpm test:security`;
  - CI jobs `e2e` and `security`.

- [ ] **Step 1: Write the failing scanner test.**

`tests/security/scan.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { base64Needles, scanBuffer, scanOcrText } from "./scan.ts";

const canaries = { password: "QZ7CANARYPASSWORD4K9" };

describe("security: canary scanner", () => {
  it("finds a canary as UTF-8, UTF-16 and base64 at every byte alignment", () => {
    const plain = Buffer.from(`x ${canaries.password} y`);
    const utf16 = Buffer.from(`x ${canaries.password} y`, "utf16le");
    expect(scanBuffer(plain, "a", canaries).map((h) => h.form)).toContain("plain");
    expect(scanBuffer(utf16, "b", canaries).map((h) => h.form)).toContain("utf16");
    for (const prefix of ["", "a", "ab"]) {
      const b64 = Buffer.from(Buffer.from(`${prefix}${canaries.password}tail`).toString("base64"));
      expect(scanBuffer(b64, "c", canaries).map((h) => h.form), `prefix ${prefix.length}`).toContain("base64");
    }
  });

  it("does not report clean data", () => {
    expect(scanBuffer(Buffer.from("nothing secret here"), "d", canaries)).toEqual([]);
  });

  it("matches OCR text after removing spaces and punctuation", () => {
    expect(scanOcrText("QZ7 CANARY-PASSWORD 4K9", "e", canaries)).toHaveLength(1);
    expect(scanOcrText("QZ7 CANARY", "e", canaries)).toEqual([]);
  });

  it("produces stable base64 needles of useful length", () => {
    const needles = base64Needles(canaries.password);
    expect(needles).toHaveLength(3);
    for (const needle of needles) expect(needle.length).toBeGreaterThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test -- tests/security`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the canaries and the scanner.**

`tests/security/canaries.ts`:
```ts
/**
 * Test-only secret canaries (spec §12 security test 1). They are dummy values: E2E types them
 * into the vault and the login fixture accepts them; the post-E2E scan proves they never escape.
 * They are the single source for B3's login fixture credentials (S10).
 */
export const FIXTURE_LOGIN_USER = "canary-user@fixtures.test";
export const CANARIES = {
  password: "QZ7CANARYPASSWORD4K9",
  totpSeed: "CANARYSEEDQQ2345",
  pin: "739146",
  otp: "582039",
  imapPassword: "QZ7CANARYIMAP9K4W",
} as const;
```
Point B3's login fixture (S10) at these values: the expected password, PIN, OTP and TOTP seed all import from here. If the fixture is static HTML, generate its expected values from this module at fixture build time, or have the fixture server import it.

`tests/security/scan.ts`:
```ts
export type Canaries = Readonly<Record<string, string>>;
export interface Hit {
  canary: string;
  where: string;
  form: "plain" | "utf16" | "base64" | "ocr";
}

/**
 * Base64 substrings that appear whenever `value` is base64-encoded, at each of the 3 byte
 * alignments. The 4-character groups that may mix in neighbouring bytes are dropped.
 */
export function base64Needles(value: string): string[] {
  const bytes = Buffer.from(value, "utf8");
  return [0, 1, 2].map((offset) => {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64");
    return encoded.slice(offset === 0 ? 0 : 4, encoded.length - 4);
  });
}

export function scanBuffer(buffer: Buffer, where: string, canaries: Canaries): Hit[] {
  const hits: Hit[] = [];
  for (const [canary, value] of Object.entries(canaries)) {
    if (buffer.includes(Buffer.from(value, "utf8"))) hits.push({ canary, where, form: "plain" });
    else if (buffer.includes(Buffer.from(value, "utf16le"))) hits.push({ canary, where, form: "utf16" });
    else if (base64Needles(value).some((needle) => buffer.includes(Buffer.from(needle, "latin1")))) {
      hits.push({ canary, where, form: "base64" });
    }
  }
  return hits;
}

const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function scanOcrText(text: string, where: string, canaries: Canaries): Hit[] {
  const haystack = normalize(text);
  return Object.entries(canaries)
    .filter(([, value]) => haystack.includes(normalize(value)))
    .map(([canary]) => ({ canary, where, form: "ocr" as const }));
}
```

`tests/security/dump-objects.ts`. This runs **inside the agent container**, mounted into `packages/storage/` so that `@aws-sdk/client-s3` resolves:
```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const env = process.env;
const outDir = process.argv[2] ?? "/out/objects";
mkdirSync(outDir, { recursive: true });
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION ?? "garage",
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "" },
});
const bucket = env.S3_BUCKET ?? "mastertutor";
let token: string | undefined;
let count = 0;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
  for (const item of page.Contents ?? []) {
    if (!item.Key) continue;
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: item.Key }));
    const bytes = await object.Body!.transformToByteArray();
    writeFileSync(join(outDir, item.Key.replaceAll("/", "__")), bytes);
    count++;
  }
  token = page.NextContinuationToken;
} while (token);
console.log(JSON.stringify({ objects: count }));
```

`tests/security/stack-canary.ts`:
```ts
// Post-E2E secret canary scan (spec §12 security test 1). It reads the running compose.test.yml stack:
//   - a Postgres data dump;
//   - every service's logs;
//   - every Garage object;
//   - the llm-mock request recording;
//   - OCR of every stored image.
// It prints canary names and locations only, never values. Exits 1 on any hit.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CANARIES } from "./canaries.ts";
import { scanBuffer, scanOcrText, type Hit } from "./scan.ts";

const DC = ["compose", "--env-file", ".env.test", "-f", "compose.yml", "-f", "compose.test.yml"];
const OUT = resolve("tests/security/.out");
const OBJECTS = join(OUT, "objects");
const docker = (args: string[]) => execFileSync("docker", args, { maxBuffer: 1 << 30 });

const hits: Hit[] = [];
rmSync(OBJECTS, { recursive: true, force: true });
mkdirSync(OBJECTS, { recursive: true, mode: 0o777 });

hits.push(...scanBuffer(docker([...DC, "exec", "-T", "postgres", "pg_dump", "-U", "owner", "-d", "mastertutor", "--data-only"]), "postgres", CANARIES));
hits.push(...scanBuffer(docker([...DC, "logs", "--no-color"]), "logs", CANARIES));

docker([
  ...DC, "run", "--rm", "--no-deps",
  "-v", `${resolve("tests/security/dump-objects.ts")}:/app/packages/storage/dump-objects.ts:ro`,
  "-v", `${OUT}:/out`,
  "agent", "node", "packages/storage/dump-objects.ts", "/out/objects",
]);
for (const name of readdirSync(OBJECTS)) {
  hits.push(...scanBuffer(readFileSync(join(OBJECTS, name)), `object ${name}`, CANARIES));
}

const requests = docker([
  ...DC, "exec", "-T", "agent", "node", "-e",
  "fetch(new URL('/__requests', process.env.OPENAI_BASE_URL)).then((r) => r.text()).then((t) => process.stdout.write(t))",
]);
hits.push(...scanBuffer(requests, "llm-mock requests", CANARIES));

docker([
  ...DC, "--profile", "e2e", "run", "--rm", "--no-deps", "--entrypoint", "bash", "e2e", "-c",
  "shopt -s nullglob; for f in /repo/tests/security/.out/objects/*.{png,jpg,jpeg,webp}; do tesseract \"$f\" \"$f\" >/dev/null 2>&1 || true; done",
]);
for (const name of readdirSync(OBJECTS).filter((n) => n.endsWith(".txt"))) {
  hits.push(...scanOcrText(readFileSync(join(OBJECTS, name), "utf8"), `ocr ${name}`, CANARIES));
}

writeFileSync(join(OUT, "report.json"), JSON.stringify({ hits }, null, 2));
if (hits.length > 0) {
  for (const hit of hits) console.error(`CANARY LEAK: ${hit.canary} in ${hit.where} (${hit.form})`);
  process.exit(1);
}
console.log("canary scan clean");
```
If B1's `/__requests` path differs (S8), change only the `new URL(...)` path.

- [ ] **Step 4: Write the key-placement test.**

`tests/compose/key-placement.int.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { composeConfig } from "./compose-json.ts";

const config = composeConfig(".env.test", ["compose.yml"]);
const env = (service: string) => Object.keys(config.services[service]?.environment ?? {});
const slots = Object.keys(config.services).filter((name) => /^browser-\d+$/.test(name));

describe("security: key placement (spec §12 test 8, §13 least privilege)", () => {
  it("web holds no decryption key, no n.eko admin secret and no agent OpenAI key", () => {
    for (const key of ["VAULT_PRIVATE_KEY", "NEKO_ADMIN_SECRET", "OPENAI_API_KEY"]) expect(env("web")).not.toContain(key);
  });
  it("agent holds no n.eko member secret and no web-only secrets", () => {
    for (const key of ["NEKO_MEMBER_SECRET", "BETTER_AUTH_SECRET", "LIVE_COOKIE_SECRET", "TURN_SECRET"]) {
      expect(env("agent")).not.toContain(key);
    }
  });
  it("slots hold no vault, OpenAI, database or storage keys", () => {
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      for (const key of env(slot)) expect(key, `${slot}:${key}`).not.toMatch(/^(VAULT_|OPENAI_|DATABASE_URL|S3_)/);
    }
  });
  it("coturn, when present, holds only the TURN secret", () => {
    const coturn = config.services.coturn;
    if (!coturn) return;
    expect(env("coturn").filter((key) => /SECRET|KEY|PASSWORD/.test(key))).toEqual(["TURN_SECRET"]);
  });
});
```

- [ ] **Step 5: Wire the security suite and CI.**
  1. **Prefixes.** For each security test from B1–B6 found by the seam grep, rename its top-level `describe` to start with `security: `. Do not change the tests themselves. The §12 security list is:
     - secret canary;
     - origin pinning;
     - field type;
     - injection;
     - SSRF;
     - slot reset;
     - downloads;
     - key placement;
     - tool list;
     - live-view auth;
     - takeover lock;
     - masking.
  2. **Script.** Root `package.json`: `"test:security": "vitest run --project integration --testNamePattern \"^security: \""`.
  3. **E2E script.** Append to `scripts/e2e.sh`, before `echo "E2E OK"`:
     ```bash
     node tests/security/stack-canary.ts
     ```
  4. **CI.** Append these jobs to `.github/workflows/ci.yml`:
     ```yaml
       security:
         name: Security suite (integration, prefix "security:")
         runs-on: ubuntu-24.04
         timeout-minutes: 30
         steps:
           - uses: actions/checkout@v4
           - uses: pnpm/action-setup@v4
           - uses: actions/setup-node@v4
             with:
               node-version: 24
               cache: pnpm
           - run: pnpm install --frozen-lockfile
           - name: Allow unprivileged user namespaces (slot sandbox)
             run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
           - run: pnpm test:security

       e2e:
         name: End-to-end + stack canary scan (compose.test.yml)
         runs-on: ubuntu-24.04
         timeout-minutes: 75
         steps:
           - uses: actions/checkout@v4
           - uses: pnpm/action-setup@v4
           - uses: actions/setup-node@v4
             with:
               node-version: 24
               cache: pnpm
           - run: pnpm install --frozen-lockfile
           - name: Allow unprivileged user namespaces (slot sandbox)
             run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
           - run: bash scripts/e2e.sh
           - if: failure()
             uses: actions/upload-artifact@v4
             with:
               name: e2e-report
               path: |
                 tests/e2e/.out/report
                 tests/security/.out/report.json
     ```

- [ ] **Step 6: Run everything to verify it passes.**

Run: `pnpm test -- tests/security && pnpm test:int -- tests/compose/key-placement && pnpm test:security && pnpm e2e`
Expected: PASS, ending with `canary scan clean` and `E2E OK`.

**Sanity check:** temporarily add `console.log(CANARIES.password)` to a test-only log path, run `node tests/security/stack-canary.ts`, confirm it exits 1, then revert.

- [ ] **Step 7: Commit.**

```bash
git add tests/security tests/compose/key-placement.int.test.ts scripts/e2e.sh package.json .github/workflows/ci.yml apps packages tests/fixtures
git commit -m "test(security): stack-wide canary scan (DB, logs, objects, model requests, OCR), key placement, CI e2e and security jobs"
```

**Phase 7 exit:** CI jobs `checks`, `integration`, `compose-smoke`, `security` and `e2e` are green; `api-conformance` has no `fixme` left after Task 18.

---

# Phase 8: QA

### Task 7: DOM layout auditor (overflow, clipping, wrapping, overlap, targets)

**Files:**
- Create: `tests/e2e/qa/layout-audit.ts`, `tests/e2e/qa/layout-audit.spec.ts`

**Interfaces:**
- Consumes: Playwright `Page`.
- Produces:
  - `auditLayout(page: Page, options?: {minTarget?: number}): Promise<LayoutIssue[]>`, where `LayoutIssue = {kind: "page-overflow"|"clipped"|"escapes-clip"|"wrapped"|"overlap"|"small-target"; selector: string; detail: string}`;
  - **Opt-outs:**
    - `data-qa-ignore` (the subtree);
    - `data-qa-allow-clip` (intentional clipping);
    - `data-qa-nowrap` (the element must stay on one line);
    - `data-qa-layer="leader"` with `data-qa-region="timeline"` (they must not intersect).

- [ ] **Step 1: Write the failing spec.**

`tests/e2e/qa/layout-audit.spec.ts` (Playwright project `layout-unit`, no stack needed):
```ts
import { expect, test } from "@playwright/test";
import { auditLayout } from "./layout-audit.ts";

const page390 = { width: 390, height: 844 };
const kinds = async (page: import("@playwright/test").Page) => (await auditLayout(page)).map((i) => i.kind);

test.use({ viewport: page390 });

test("a clean layout has no issues", async ({ page }) => {
  await page.setContent(`<main style="padding:16px"><h1>Title</h1><button style="min-width:44px;min-height:44px">Go</button></main>`);
  expect(await auditLayout(page)).toEqual([]);
});

test("page-level horizontal overflow", async ({ page }) => {
  await page.setContent(`<div style="width:600px;height:20px"></div>`);
  expect(await kinds(page)).toContain("page-overflow");
});

test("the D22 OTP case: a sixth box clipped by its card", async ({ page }) => {
  await page.setContent(`<section style="width:300px;overflow:hidden;display:flex;gap:8px">
    ${Array.from({ length: 6 }, (_, i) => `<input aria-label="Digit ${i + 1}" style="flex:none;width:48px;height:48px">`).join("")}
  </section>`);
  const issues = await auditLayout(page);
  expect(issues.some((i) => i.kind === "escapes-clip" && i.selector.includes("Digit 6"))).toBe(true);
});

test("the D22 strikethrough case: a nowrap label that wraps", async ({ page }) => {
  await page.setContent(`<p style="width:60px"><del data-qa-nowrap>the model</del></p>`);
  expect(await kinds(page)).toContain("wrapped");
});

test("intentional ellipsis with a title is not a clip", async ({ page }) => {
  await page.setContent(`<div title="A very long file name.pdf" style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">A very long file name.pdf</div>`);
  expect(await auditLayout(page)).toEqual([]);
});

test("the D22 leader case: a callout leader crossing the timeline", async ({ page }) => {
  await page.setContent(`
    <div data-qa-region="timeline" style="position:absolute;left:200px;top:0;width:150px;height:400px"></div>
    <svg data-qa-layer="leader" style="position:absolute;left:100px;top:100px;width:200px;height:2px"></svg>`);
  expect(await kinds(page)).toContain("overlap");
});

test("small touch targets, but not inline links in prose", async ({ page }) => {
  await page.setContent(`<button style="width:30px;height:30px">x</button><p>Read <a href="#">more</a> here.</p>`);
  const issues = await auditLayout(page);
  expect(issues.filter((i) => i.kind === "small-target")).toHaveLength(1);
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm compose:e2e run --rm --no-deps e2e pnpm exec playwright test --project=layout-unit`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement.**

`tests/e2e/qa/layout-audit.ts`:
```ts
import type { Page } from "@playwright/test";

export type LayoutIssueKind = "page-overflow" | "clipped" | "escapes-clip" | "wrapped" | "overlap" | "small-target";
export interface LayoutIssue {
  kind: LayoutIssueKind;
  selector: string;
  detail: string;
}
export interface AuditOptions {
  minTarget: number;
}

/** Runs in the page; self-contained (no closures) because Playwright serializes it. */
function auditInPage(options: AuditOptions): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const describe = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${node.id}`);
        break;
      }
      const testId = node.getAttribute("data-testid");
      const label = node.getAttribute("aria-label");
      if (testId) part += `[data-testid="${testId}"]`;
      else if (label) part += `[aria-label="${label.slice(0, 40)}"]`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const visible = (el: Element): boolean => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const clips = (s: CSSStyleDeclaration) =>
    s.overflowX === "hidden" || s.overflowX === "clip" || s.overflowY === "hidden" || s.overflowY === "clip";
  const hasDirectText = (el: Element) =>
    Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");

  const root = document.scrollingElement ?? document.documentElement;
  if (root.scrollWidth > root.clientWidth + 1) {
    issues.push({ kind: "page-overflow", selector: "html", detail: `scrollWidth ${root.scrollWidth} > ${root.clientWidth}` });
  }

  const elements = Array.from(document.querySelectorAll("body *")).filter(
    (el) => !el.closest("[data-qa-ignore]") && visible(el),
  );

  for (const el of elements) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    if (clips(style) && !el.hasAttribute("data-qa-allow-clip")) {
      const ellipsis = style.textOverflow === "ellipsis" && (el.getAttribute("title") || el.getAttribute("aria-label"));
      const horizontal = el.scrollWidth > el.clientWidth + 1;
      const vertical = hasDirectText(el) && el.scrollHeight > el.clientHeight + 1;
      if (!ellipsis && (horizontal || vertical)) {
        issues.push({ kind: "clipped", selector: describe(el), detail: `content ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}` });
      }
    }

    const leaf = el.children.length === 0 || ["INPUT", "BUTTON", "IMG", "SVG", "SELECT", "TEXTAREA"].includes(el.tagName);
    if (leaf) {
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== document.body) {
        const s = getComputedStyle(ancestor);
        if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll") break;
        if (clips(s)) {
          if (ancestor.hasAttribute("data-qa-allow-clip")) break;
          const a = ancestor.getBoundingClientRect();
          if (rect.right > a.right + 1 || rect.left < a.left - 1 || rect.bottom > a.bottom + 1 || rect.top < a.top - 1) {
            issues.push({ kind: "escapes-clip", selector: describe(el), detail: `outside ${describe(ancestor)}` });
          }
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    const mustNotWrap = el.matches("[data-qa-nowrap], del, s, button, [role=tab], [role=button], [role=menuitem]");
    if (mustNotWrap && (el.textContent ?? "").trim().length > 0 && (el.textContent ?? "").trim().length <= 40) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (tops.size > 1) issues.push({ kind: "wrapped", selector: describe(el), detail: `${tops.size} lines` });
    }

    const interactive = el.matches(
      "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch]",
    );
    const inlineProseLink = el.tagName === "A" && style.display === "inline";
    if (interactive && !inlineProseLink && style.pointerEvents !== "none") {
      if (Math.min(rect.width, rect.height) < options.minTarget - 0.5) {
        issues.push({ kind: "small-target", selector: describe(el), detail: `${Math.round(rect.width)}x${Math.round(rect.height)}` });
      }
    }
  }

  const regions = Array.from(document.querySelectorAll('[data-qa-region="timeline"]')).map((r) => r.getBoundingClientRect());
  for (const leader of Array.from(document.querySelectorAll('[data-qa-layer="leader"]'))) {
    const l = leader.getBoundingClientRect();
    if (regions.some((r) => l.left < r.right && l.right > r.left && l.top < r.bottom && l.bottom > r.top)) {
      issues.push({ kind: "overlap", selector: describe(leader), detail: "callout leader crosses the timeline" });
    }
  }
  return issues;
}

export async function auditLayout(page: Page, options: Partial<AuditOptions> = {}): Promise<LayoutIssue[]> {
  return page.evaluate(auditInPage, { minTarget: options.minTarget ?? 44 });
}
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `pnpm compose:e2e run --rm --no-deps e2e pnpm exec playwright test --project=layout-unit`
Expected: 7 PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/e2e/qa/layout-audit.ts tests/e2e/qa/layout-audit.spec.ts
git commit -m "test(qa): DOM layout auditor for overflow, clipping, wrapping, leader overlap and 44px targets"
```

---

### Task 8: QA seed, screen catalog, visual regression and axe matrix

**Files:**
- Create: `tests/e2e/qa/{seed.ts,stub-live.ts,screens.ts,matrix.spec.ts}`, `scripts/qa-stack.sh`
- Create (generated, committed): `tests/e2e/qa/__screenshots__/*.png`
- Modify: `package.json` (scripts `qa:stack`, `qa:matrix`, `qa:update-baselines`), `.github/workflows/ci.yml` (job `visual`)

**Interfaces:**
- Consumes: `auditLayout` (T7), `AUTH_STATE`, S6, S7 and the Phase 0 table and column names.
- Produces:
  - `SEED`: fixed ids `{folders; notes; runs: {live, approval, takeover, sleeping, completed, failed, queued}; vaultItem}`;
  - `seedSql(): string`, printed by `node tests/e2e/qa/seed.ts`;
  - `stubLiveFrame(page: Page): Promise<void>`;
  - `QA_WIDTHS = [1440, 1180, 1024, 820, 390]`, `THEMES = ["light","dark"]`, `VIEWPORT_HEIGHT: Record<number, number>`;
  - `SCREENS: Screen[]`, where `Screen = {id; group: "G1"|"G2"|"G3"|"G4"|"G5"; path(): string; ready(page): Promise<void>; prepare?(page): Promise<void>}`;
  - `pnpm qa:stack` (boot, sign up, stop the agent, seed), `pnpm qa:matrix` and `pnpm qa:update-baselines`.

- [ ] **Step 1: Write the seed.**

`tests/e2e/qa/seed.ts`:
```ts
// Deterministic QA data: every run-view state, a nested library, notes with every block origin,
// and vault rows. Prints SQL; scripts/qa-stack.sh pipes it into psql as owner. Needs one signed-up owner.
const id = (n: number) => `0a000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const SEED = {
  folders: { research: id(1), papers: id(2), video: id(3) },
  sources: { article: id(10) },
  notes: { verified: id(20), review: id(21) },
  runs: {
    live: id(30),
    approval: id(31),
    takeover: id(32),
    sleeping: id(33),
    completed: id(34),
    failed: id(35),
    queued: id(36),
  },
  approval: id(40),
  vaultItem: id(50),
} as const;

const WS = "(select workspace_id from workspace_members where role = 'owner' order by created_at limit 1)";
const usage = (steps: number, usd: number) =>
  `'{"steps":${steps},"inputTokens":${steps * 3100},"cachedInputTokens":${steps * 2400},"outputTokens":${steps * 120},"usd":${usd},"activeMs":${steps * 4100}}'::jsonb`;
const plan = `'{"items":[{"text":"Open the article","done":true},{"text":"Capture the page","done":true},{"text":"File the note","done":false}]}'::jsonb`;
const T = "timestamptz '2026-10-05 14:30:00+00'";

function run(key: keyof typeof SEED.runs, status: string, wait: string | null, extra: Record<string, string> = {}): string {
  const columns: Record<string, string> = {
    id: `'${SEED.runs[key]}'`,
    workspace_id: WS,
    goal: `'QA ${key}: capture the Ada Lovelace article with figures and the analytical engine diagram'`,
    status: `'${status}'`,
    wait_reason: wait === null ? "null" : `'${wait}'`,
    approval_mode: "'ask'",
    plan,
    usage: usage(42, 0.84),
    allowed_origins: "array['https://en.wikipedia.org']",
    current_url: "'https://en.wikipedia.org/wiki/Ada_Lovelace'",
    created_at: T,
    ...extra,
  };
  return `insert into runs (${Object.keys(columns).join(", ")}) values (${Object.values(columns).join(", ")});`;
}

export function seedSql(): string {
  const steps = (runId: string) =>
    [
      [1, "observe", "Looked at the page"],
      [2, "decide", "Decided to capture the article body"],
      [3, "act", "Clicked “Read more” to expand the biography section"],
      [4, "observe", "Checked that the expanded section loaded"],
      [5, "act", "Captured 38 blocks, 4 figures (coverage 99.2%)"],
    ]
      .map(
        ([seq, phase, caption]) =>
          `insert into run_steps (run_id, seq, phase, state, caption, url, action) values ('${runId}', ${seq}, '${phase}', 'done', '${caption}', 'https://en.wikipedia.org/wiki/Ada_Lovelace', ${phase === "act" ? `'{"tool":"computer","summary":"${caption}","point":{"x":640,"y":420}}'::jsonb` : "null"});`,
      )
      .join("\n");

  return `begin;
insert into folders (id, workspace_id, parent_id, name, sort) values
  ('${SEED.folders.research}', ${WS}, null, 'Research', 0),
  ('${SEED.folders.papers}', ${WS}, '${SEED.folders.research}', 'Papers with an unusually long folder name for wrapping', 0),
  ('${SEED.folders.video}', ${WS}, null, 'Video lectures', 1);
insert into sources (id, workspace_id, kind, url, canonical_url, origin, title, captured_at) values
  ('${SEED.sources.article}', ${WS}, 'web', 'https://en.wikipedia.org/wiki/Ada_Lovelace', 'https://en.wikipedia.org/wiki/Ada_Lovelace', 'https://en.wikipedia.org', 'Ada Lovelace - Wikipedia', ${T});
insert into notes (id, workspace_id, folder_id, filed_by, title, lede, fidelity, coverage, created_at, updated_at) values
  ('${SEED.notes.verified}', ${WS}, '${SEED.folders.papers}', 'agent', 'Ada Lovelace', 'English mathematician and writer, chiefly known for her work on Charles Babbage''s proposed mechanical general-purpose computer, the Analytical Engine.', 'verified', 0.992, ${T}, ${T}),
  ('${SEED.notes.review}', ${WS}, null, 'user', 'Scanned lecture handout with a deliberately long title that must wrap gracefully at 390px', null, 'needs_review', 0.71, ${T}, ${T});
insert into note_blocks (note_id, position, type, markdown, source_id, origin, anchor, verified) values
  ('${SEED.notes.verified}', 'a0', 'heading', '## Early life', '${SEED.sources.article}', 'dom', '{"selector":"#Early_life","xpath":null,"start":0,"end":10,"textFragment":"Early%20life"}'::jsonb, true),
  ('${SEED.notes.verified}', 'a1', 'paragraph', 'Lovelace was the only legitimate child of poet Lord Byron and reformer Anne Isabella Milbanke.', '${SEED.sources.article}', 'dom', '{"selector":"main p:nth-of-type(1)","xpath":null,"start":0,"end":96,"textFragment":"Lovelace%20was%20the%20only"}'::jsonb, true),
  ('${SEED.notes.verified}', 'a2', 'code', '\`\`\`text\\nv1 = v2 * v3\\n\`\`\`', '${SEED.sources.article}', 'dom', null, true),
  ('${SEED.notes.verified}', 'a3', 'table', '| Year | Event |\\n|---|---|\\n| 1843 | Notes published |', '${SEED.sources.article}', 'dom', null, true),
  ('${SEED.notes.verified}', 'a4', 'math', '$$B_n = -\\\\sum_{k=0}^{n-1} \\\\binom{n}{k} \\\\frac{B_k}{n-k+1}$$', '${SEED.sources.article}', 'dom', null, true),
  ('${SEED.notes.verified}', 'a5', 'commentary', 'Summary: the Notes contain what is often called the first published algorithm.', null, 'model', null, false),
  ('${SEED.notes.review}', 'a0', 'paragraph', 'Diagram text transcribed from an image; please verify.', null, 'ocr_model', null, false);
update browser_slots set state = 'leased', run_id = null where name = 'browser-1';
${run("live", "running", null, { controller: "'agent'", slot_name: "'browser-1'", lease_owner: "'qa-seed'", lease_expires_at: "now() + interval '1 day'", last_activity_at: "now()" })}
update browser_slots set run_id = '${SEED.runs.live}', lease_owner = 'qa-seed', lease_expires_at = now() + interval '1 day' where name = 'browser-1';
${run("approval", "waiting", "approval")}
${run("takeover", "waiting", "takeover", { controller: "'user'" })}
${run("sleeping", "sleeping", null)}
${run("completed", "completed", null, { note_id: `'${SEED.notes.verified}'`, finished_at: T })}
${run("failed", "failed", null, { error: `'{"code":"page_unreachable","message":"The site did not respond after 3 attempts."}'::jsonb`, finished_at: T })}
${run("queued", "queued", null, { usage: usage(0, 0) })}
${Object.values(SEED.runs).map(steps).join("\n")}
insert into approvals (id, run_id, step_seq, kind, request, status) values
  ('${SEED.approval}', '${SEED.runs.approval}', 5, 'risky_click', '{"kind":"risky_click","action":{"type":"click","x":640,"y":420,"button":"left"},"label":"Delete account","url":"https://example.org/settings","screenshotKey":null}'::jsonb, 'pending');
insert into vault_items (id, workspace_id, alias, origin, label, fields) values
  ('${SEED.vaultItem}', ${WS}, 'university-portal', 'https://learn.example.edu', 'University portal (long label to test truncation)', array['username','password','totp']::vault_secret_field[]);
commit;
`;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(seedSql());
```
If the `vault_items.fields` enum type name differs from `vault_secret_field`, use the name from migration `0001`.

`scripts/qa-stack.sh`:
```bash
#!/usr/bin/env bash
# Boots the QA stack:
#   - compose.test.yml;
#   - an owner account (the e2e setup project);
#   - the agent stopped, so seeded runs stay frozen;
#   - deterministic seed data.
# Usage: bash scripts/qa-stack.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DC=(docker compose --env-file .env.test -f compose.yml -f compose.test.yml)
mkdir -p tests/e2e/.out && chmod 777 tests/e2e/.out
"${DC[@]}" up -d --build --wait --wait-timeout 420
"${DC[@]}" stop agent
"${DC[@]}" --profile e2e run --rm e2e pnpm exec playwright test --project=setup
node tests/e2e/qa/seed.ts | "${DC[@]}" exec -T postgres psql -U owner -d mastertutor -v ON_ERROR_STOP=1 -q
echo "QA stack ready on http://localhost:18080"
```

- [ ] **Step 2: Write the live stub and the screen catalog.**

`tests/e2e/qa/stub-live.ts`:
```ts
import type { Page } from "@playwright/test";

/** A fixed, deterministic frame in place of the n.eko stream (spec §12: visual regression stubs the live iframe). */
const FRAME = `<!doctype html><html><body style="margin:0;background:#fff;font:16px system-ui">
<div style="height:56px;background:#f2f2f2;border-bottom:1px solid #ddd"></div>
<div style="padding:32px 96px"><div style="height:28px;width:60%;background:#e5e5e5;margin-bottom:24px"></div>
${Array.from({ length: 9 }, () => `<div style="height:12px;background:#eee;margin:10px 0"></div>`).join("")}
<div style="height:220px;width:340px;background:#e9e9e9;margin-top:24px"></div></div></body></html>`;

export async function stubLiveFrame(page: Page): Promise<void> {
  await page.route(/\/live\/[0-9a-f-]{36}\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: FRAME }),
  );
}
```

`tests/e2e/qa/screens.ts`:
```ts
import { expect, type Page } from "@playwright/test";
import { SEED } from "./seed.ts";

export const QA_WIDTHS = [1440, 1180, 1024, 820, 390] as const;
export const THEMES = ["light", "dark"] as const;
export const VIEWPORT_HEIGHT: Record<(typeof QA_WIDTHS)[number], number> = {
  1440: 900,
  1180: 820,
  1024: 768,
  820: 1180,
  390: 844,
};
export type Group = "G1" | "G2" | "G3" | "G4" | "G5";
export interface Screen {
  id: string;
  group: Group;
  path(): string;
  ready(page: Page): Promise<void>;
  prepare?(page: Page): Promise<void>;
}

const main = async (page: Page) => expect(page.getByRole("main")).toBeVisible();
const run = (id: string, key: keyof typeof SEED.runs, prepare?: Screen["prepare"]): Screen => ({
  id,
  group: "G3",
  path: () => `/runs/${SEED.runs[key]}`,
  ready: async (page) => expect(page.getByTestId("run-status")).toBeVisible(),
  prepare,
});

export const SCREENS: Screen[] = [
  { id: "sign-in", group: "G1", path: () => "/sign-in", ready: main },
  { id: "settings", group: "G1", path: () => "/settings", ready: main },
  { id: "new-task", group: "G2", path: () => "/", ready: main },
  {
    id: "new-task-filled",
    group: "G2",
    path: () => "/",
    ready: main,
    prepare: async (page) => {
      await page.getByRole("textbox", { name: /task|what should/i }).fill("Capture the Ada Lovelace article and its diagrams into Research › Papers");
    },
  },
  run("run-live", "live"),
  run("run-approval", "approval"),
  run("run-takeover", "takeover"),
  run("run-sleeping", "sleeping"),
  run("run-completed", "completed"),
  run("run-failed", "failed"),
  run("run-queued", "queued"),
  run("run-reconnecting", "live", async (page) => {
    await page.unroute(/\/live\//);
    await page.route(/\/live\//, (route) => route.abort());
    await page.reload();
  }),
  { id: "library", group: "G4", path: () => "/library", ready: main },
  { id: "library-folder", group: "G4", path: () => `/library?folder=${SEED.folders.papers}`, ready: main },
  { id: "note-verified", group: "G4", path: () => `/notes/${SEED.notes.verified}`, ready: main },
  { id: "note-review", group: "G4", path: () => `/notes/${SEED.notes.review}`, ready: main },
  { id: "vault", group: "G5", path: () => "/vault", ready: main },
  {
    id: "vault-new",
    group: "G5",
    path: () => "/vault",
    ready: main,
    prepare: async (page) => {
      await page.getByRole("button", { name: /add|new/i }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
];
```
The `?folder=` query is S6. Adjust paths only here.

- [ ] **Step 3: Write the matrix spec.**

`tests/e2e/qa/matrix.spec.ts`:
```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { auditLayout } from "./layout-audit.ts";
import { QA_WIDTHS, SCREENS, THEMES, VIEWPORT_HEIGHT } from "./screens.ts";
import { stubLiveFrame } from "./stub-live.ts";

const only = process.env.QA_GROUP;

for (const screen of SCREENS.filter((s) => !only || s.group === only)) {
  for (const width of QA_WIDTHS) {
    for (const theme of THEMES) {
      test(`${screen.group} ${screen.id} @${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.clock.setFixedTime(new Date("2026-10-05T15:00:00Z"));
        await stubLiveFrame(page);
        await page.goto(screen.path());
        await screen.ready(page);
        if (screen.prepare) await screen.prepare(page);
        await page.evaluate(() => document.fonts.ready);

        expect(await auditLayout(page), "layout audit").toEqual([]);

        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const blocking = axe.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`);
        expect(blocking, "axe serious/critical").toEqual([]);

        await expect(page).toHaveScreenshot(`${screen.id}-${width}-${theme}.png`, {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.002,
        });
      });
    }
  }
}
```
Playwright's `caret: "hide"` here applies to our own app pages in the QA browser, not to the slot. Spec §9's ban covers model screenshots only.

Root scripts:
- `"qa:stack": "bash scripts/qa-stack.sh"`;
- `"qa:matrix": "docker compose --env-file .env.test -f compose.yml -f compose.test.yml --profile e2e run --rm e2e pnpm exec playwright test --project=qa"`;
- `"qa:update-baselines": "docker compose --env-file .env.test -f compose.yml -f compose.test.yml --profile e2e run --rm e2e pnpm exec playwright test --project=qa --update-snapshots"`.

- [ ] **Step 4: Run it to verify it fails meaningfully, then create the baselines.**

Run: `pnpm qa:stack && pnpm qa:matrix`
Expected:
- the first run fails on missing baselines;
- any audit or axe failures are **real findings**. Record them; do not fix them here. They go into the ledger in Task 9 and are fixed in Task 11.

Run: `pnpm qa:update-baselines`
Expected: 180 PNGs under `tests/e2e/qa/__screenshots__/` (18 screens × 5 widths × 2 themes). Baselines are **provisional** until Task 11's gate passes. Every fix that changes pixels re-generates them in the same commit.

- [ ] **Step 5: Add the `visual` CI job.**

Append to `.github/workflows/ci.yml`:
```yaml
  visual:
    name: Visual regression + layout audit + axe (QA matrix)
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Allow unprivileged user namespaces (slot sandbox)
        run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
      - run: pnpm qa:stack
      - run: pnpm qa:matrix
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: visual-report
          path: tests/e2e/.out
```

- [ ] **Step 6: Commit.**

```bash
git add tests/e2e/qa scripts/qa-stack.sh package.json .github/workflows/ci.yml
git commit -m "test(qa): seeded screen matrix with layout audit, axe and visual baselines at 5 widths x 2 themes"
```

---

### Task 9: UI validation swarm protocol, shooter and findings ledger

**Files:**
- Create: `tests/e2e/qa/{shoot.ts,findings.ts,findings.test.ts}`, `scripts/qa/findings.ts`, `orchestration/briefs/qa-swarm.md`
- Create (output): `orchestration/qa/findings.json`, `orchestration/qa/findings.md`
- Modify: `package.json` (scripts `qa:shoot`, `qa:findings`)

**Interfaces:**
- Consumes: `SCREENS`, `QA_WIDTHS`, `THEMES`, `VIEWPORT_HEIGHT`, `stubLiveFrame` and `auditLayout`.
- Produces:
  - **Zod schemas:** `FindingInput`, `SwarmReport` and `LedgerEntry` (`{id: "QA-###"; status: "open"|"fixed"|"verified"; finding; fixCommit|null; verifiedInRun|null; firstSeenInRun}`);
  - **Functions:**
    - `mergeReports(ledger: LedgerEntry[], reports: SwarmReport[], runIds: string[]): LedgerEntry[]`, which dedupes by `findingKey`;
    - `findingKey(f: FindingInput): string`;
    - `renderLedgerMarkdown(ledger): string`;
  - **`pnpm qa:shoot -- --group G3 --run <runDirName>`**: screenshots, audit JSON and axe summaries under `orchestration/runs/<run>/shots/`;
  - **`pnpm qa:findings <merge|fix|verify|gate|md> …`**.

- [ ] **Step 1: Write the failing ledger test.**

`tests/e2e/qa/findings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { findingKey, mergeReports, renderLedgerMarkdown, SwarmReport, type LedgerEntry } from "./findings.ts";

const report = (title: string, selector: string | null = "div#otp") =>
  SwarmReport.parse({
    group: "G3",
    agent: "layout",
    checked: [{ screen: "run-approval", width: 390, theme: "dark" }],
    findings: [
      {
        group: "G3",
        screen: "run-approval",
        width: 390,
        theme: "dark",
        category: "clipping",
        severity: "major",
        title,
        detail: "6th OTP box clipped",
        evidence: ["orchestration/runs/2026-11-01-40-qa-swarm-g3/shots/run-approval/390-dark.png"],
        selector,
        autoDetected: false,
      },
    ],
  });

describe("findings ledger", () => {
  it("assigns sequential ids and dedupes the same finding across runs", () => {
    const first = mergeReports([], [report("OTP box clipped")], ["run-a"]);
    const second = mergeReports(first, [report("OTP  box clipped ")], ["run-b"]);
    expect(first.map((e) => e.id)).toEqual(["QA-001"]);
    expect(second).toHaveLength(1);
  });

  it("re-opens a verified finding that is reported again", () => {
    const ledger: LedgerEntry[] = mergeReports([], [report("OTP box clipped")], ["run-a"]).map((e) => ({
      ...e,
      status: "verified",
      fixCommit: "abc1234",
      verifiedInRun: "run-b",
    }));
    expect(mergeReports(ledger, [report("OTP box clipped")], ["run-c"])[0]?.status).toBe("open");
  });

  it("requires screenshot evidence", () => {
    const bad = { ...report("x").findings[0], evidence: [] };
    expect(SwarmReport.safeParse({ group: "G3", agent: "layout", checked: [], findings: [bad] }).success).toBe(false);
  });

  it("keys ignore case and spacing", () => {
    const a = report("OTP box clipped").findings[0]!;
    const b = { ...a, title: "otp box   CLIPPED" };
    expect(findingKey(a)).toBe(findingKey(b));
  });

  it("renders open findings first", () => {
    const ledger = mergeReports([], [report("A"), report("B", "span.x")], ["run-a"]);
    ledger[0]!.status = "verified";
    const md = renderLedgerMarkdown(ledger);
    expect(md.indexOf("QA-002")).toBeLessThan(md.indexOf("QA-001"));
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test -- tests/e2e/qa/findings`
Expected: FAIL.

- [ ] **Step 3: Implement the ledger, its CLI and the shooter.**

`tests/e2e/qa/findings.ts`:
```ts
import { z } from "zod";

export const QA_GROUPS = ["G1", "G2", "G3", "G4", "G5", "INTERACTIVE", "MOTION"] as const;
export const FINDING_CATEGORIES = [
  "alignment",
  "overflow",
  "clipping",
  "wrapping",
  "contrast",
  "overlap",
  "target-size",
  "motion",
  "other",
] as const;

export const FindingInput = z.object({
  group: z.enum(QA_GROUPS),
  screen: z.string().min(1).max(80),
  width: z.union([z.literal(1440), z.literal(1180), z.literal(1024), z.literal(820), z.literal(390)]).nullable(),
  theme: z.enum(["light", "dark"]).nullable(),
  category: z.enum(FINDING_CATEGORIES),
  severity: z.enum(["blocker", "major", "minor"]),
  title: z.string().min(3).max(160),
  detail: z.string().max(4_000),
  evidence: z.array(z.string().regex(/^orchestration\/runs\/[^/]+\/.+\.(png|json|webm|md)$/)).min(1),
  selector: z.string().max(400).nullable(),
  autoDetected: z.boolean(),
});
export type FindingInput = z.infer<typeof FindingInput>;

export const SwarmReport = z.object({
  group: z.enum(QA_GROUPS),
  agent: z.enum(["layout", "interactive", "animation"]),
  checked: z.array(z.object({ screen: z.string(), width: z.number().nullable(), theme: z.enum(["light", "dark"]).nullable() })),
  findings: z.array(FindingInput),
});
export type SwarmReport = z.infer<typeof SwarmReport>;

export const LedgerEntry = z.object({
  id: z.string().regex(/^QA-\d{3,}$/),
  status: z.enum(["open", "fixed", "verified"]),
  finding: FindingInput,
  firstSeenInRun: z.string(),
  fixCommit: z.string().nullable(),
  verifiedInRun: z.string().nullable(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

const norm = (text: string | null) => (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
export function findingKey(f: FindingInput): string {
  return [f.group, f.screen, f.width ?? "*", f.theme ?? "*", f.category, norm(f.selector), norm(f.title)].join("|");
}

export function mergeReports(ledger: readonly LedgerEntry[], reports: readonly SwarmReport[], runIds: readonly string[]): LedgerEntry[] {
  const next = ledger.map((entry) => ({ ...entry }));
  const byKey = new Map(next.map((entry) => [findingKey(entry.finding), entry]));
  let max = next.reduce((m, e) => Math.max(m, Number(e.id.slice(3))), 0);
  reports.forEach((report, index) => {
    for (const finding of report.findings) {
      const existing = byKey.get(findingKey(finding));
      if (existing) {
        if (existing.status !== "open") Object.assign(existing, { status: "open", fixCommit: null, verifiedInRun: null });
        continue;
      }
      const entry: LedgerEntry = {
        id: `QA-${String(++max).padStart(3, "0")}`,
        status: "open",
        finding,
        firstSeenInRun: runIds[index] ?? runIds[0] ?? "unknown",
        fixCommit: null,
        verifiedInRun: null,
      };
      next.push(entry);
      byKey.set(findingKey(finding), entry);
    }
  });
  return next;
}

export function renderLedgerMarkdown(ledger: readonly LedgerEntry[]): string {
  const order = { open: 0, fixed: 1, verified: 2 } as const;
  const rows = [...ledger]
    .sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id))
    .map((e) => {
      const f = e.finding;
      const where = `${f.screen} ${f.width ?? "all"} ${f.theme ?? "both"}`;
      return `| ${e.id} | ${e.status} | ${f.severity} | ${f.group} | ${where} | ${f.category} | ${f.title.replaceAll("|", "\\|")} | ${f.evidence[0]} | ${e.fixCommit ?? ""} |`;
    });
  const open = ledger.filter((e) => e.status !== "verified").length;
  return [
    "# QA findings ledger",
    "",
    `Open or unverified: **${open}**. Exit requires zero (spec §12, D22, D28).`,
    "",
    "| ID | Status | Severity | Group | Where | Category | Title | Evidence | Fix |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
```

`scripts/qa/findings.ts`:
```ts
// QA findings ledger CLI.
//   merge <report.json>...           add swarm findings (run id = parent directory name)
//   fix <QA-###> --commit <sha>      mark fixed
//   verify <QA-###> --run <run>      mark verified by a re-dispatched agent
//   gate                             exit 1 while any finding is not verified
//   md                               rewrite findings.md
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { LedgerEntry, mergeReports, renderLedgerMarkdown, SwarmReport } from "../../tests/e2e/qa/findings.ts";

const LEDGER = "orchestration/qa/findings.json";
const MD = "orchestration/qa/findings.md";
const load = (): LedgerEntry[] => (existsSync(LEDGER) ? z.array(LedgerEntry).parse(JSON.parse(readFileSync(LEDGER, "utf8"))) : []);
const save = (ledger: LedgerEntry[]) => {
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(MD, renderLedgerMarkdown(ledger));
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { commit: { type: "string" }, run: { type: "string" } },
});
const [command, ...rest] = positionals;
const ledger = load();
const find = (id: string | undefined) => {
  const entry = ledger.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown finding ${id}`);
  return entry;
};

switch (command) {
  case "merge": {
    const reports = rest.map((file) => SwarmReport.parse(JSON.parse(readFileSync(file, "utf8"))));
    save(mergeReports(ledger, reports, rest.map((file) => basename(dirname(file)))));
    break;
  }
  case "fix":
    Object.assign(find(rest[0]), { status: "fixed", fixCommit: z.string().regex(/^[0-9a-f]{7,40}$/).parse(values.commit) });
    save(ledger);
    break;
  case "verify": {
    const entry = find(rest[0]);
    if (entry.status !== "fixed") throw new Error(`${entry.id} must be fixed before it is verified`);
    Object.assign(entry, { status: "verified", verifiedInRun: z.string().min(1).parse(values.run) });
    save(ledger);
    break;
  }
  case "gate": {
    const open = ledger.filter((e) => e.status !== "verified");
    for (const e of open) console.error(`${e.id} ${e.status}: ${e.finding.title}`);
    process.exit(open.length === 0 ? 0 : 1);
  }
  case "md":
    save(ledger);
    break;
  default:
    throw new Error("usage: qa:findings <merge|fix|verify|gate|md> …");
}
```

`tests/e2e/qa/shoot.ts`. This runs inside the e2e container and writes into a mounted `orchestration/runs`:
```ts
// Screenshot shooter for UI swarm agents. For one group it writes, per screen, width and theme:
//   - a full-page PNG;
//   - the layout-audit JSON;
//   - a summary of axe serious/critical violations.
// Usage: node qa/shoot.ts --group G3 --run 2026-11-01-40-qa-swarm-g3 [--motion]
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { AUTH_STATE, BASE_URL } from "../support/env.ts";
import { auditLayout } from "./layout-audit.ts";
import { QA_WIDTHS, SCREENS, THEMES, VIEWPORT_HEIGHT } from "./screens.ts";
import { stubLiveFrame } from "./stub-live.ts";

const { values } = parseArgs({ options: { group: { type: "string" }, run: { type: "string" }, motion: { type: "boolean", default: false } } });
if (!values.group || !values.run || !/^[\w-]+$/.test(values.run)) throw new Error("--group and --run are required");
const root = join("/repo/orchestration/runs", values.run, "shots");
const browser = await chromium.launch();
const summary: unknown[] = [];
for (const screen of SCREENS.filter((s) => s.group === values.group)) {
  for (const width of QA_WIDTHS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        storageState: AUTH_STATE,
        viewport: { width, height: VIEWPORT_HEIGHT[width] },
        colorScheme: theme,
        reducedMotion: values.motion ? "no-preference" : "reduce",
      });
      const page = await context.newPage();
      await stubLiveFrame(page);
      await page.goto(screen.path());
      await screen.ready(page);
      if (screen.prepare) await screen.prepare(page);
      const dir = join(root, screen.id);
      mkdirSync(dir, { recursive: true });
      const base = join(dir, `${width}-${theme}`);
      await page.screenshot({ path: `${base}.png`, fullPage: true });
      const audit = await auditLayout(page);
      const axe = await new AxeBuilder({ page }).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, nodes: v.nodes.length }));
      writeFileSync(`${base}.json`, JSON.stringify({ audit, axe: serious }, null, 2));
      summary.push({ screen: screen.id, width, theme, audit: audit.length, axe: serious.length });
      await context.close();
    }
  }
}
writeFileSync(join(root, "summary.json"), JSON.stringify(summary, null, 2));
await browser.close();
console.log(`shots written to orchestration/runs/${values.run}/shots`);
```
Add `./orchestration/runs:/repo/orchestration/runs` to the `e2e` service volumes in `compose.test.yml`.

Root scripts:
- `"qa:shoot": "docker compose --env-file .env.test -f compose.yml -f compose.test.yml --profile e2e run --rm e2e node qa/shoot.ts"`;
- `"qa:findings": "node scripts/qa/findings.ts"`.

- [ ] **Step 4: Write the swarm brief.**

`orchestration/briefs/qa-swarm.md`:
```markdown
# Brief: UI validation swarm agent (D22)

You own screen group **{{GROUP}}** for QA run **{{RUN_ID}}**. Save everything under
`orchestration/runs/{{RUN_ID}}/` per `orchestration/README.md`. Do not edit product code.

## Inputs
- The QA stack is already up and seeded (`pnpm qa:stack`); do not restart it.
- Screens in your group: `tests/e2e/qa/screens.ts` (filter `group === "{{GROUP}}"`).
- Widths 1440 / 1180 / 1024 / 820 / 390, themes light and dark.

## Procedure
1. Run `pnpm qa:shoot -- --group {{GROUP}} --run {{RUN_ID}}`. It writes, per screen × width × theme, a PNG,
   the layout-audit issues and the axe serious/critical summary.
2. Open every PNG with the Read tool and inspect it at full resolution. For each screen, compare the
   five widths side by side and check:
   - **Alignment:** baselines, gutters and edges; concentric radii; the 4/8pt rhythm.
   - **Overflow and clipping:** nothing cut off. The D22 trio is explicit:
     - the 6th OTP box must be visible;
     - "model" must not wrap onto its own line;
     - callout leaders must never cross the timeline.
   - **Wrapping:** one-word orphans, labels breaking mid-phrase, truncation without a tooltip.
   - **Contrast:** text on glass in both themes, disabled states, focus rings.
   - **Layout rules (spec §11.5):**
     - full sidebar above 1180;
     - icon rail at ≤ 1180;
     - bottom tab bar at ≤ 820;
     - trimmed path at ≤ 420.
   - Every audit or axe item in the JSON files is a finding (`autoDetected: true`).
3. Write `report.json` (schema `SwarmReport` in `tests/e2e/qa/findings.ts`) and a short `report.md`.
   Every finding needs at least one evidence path inside your run directory. If a finding needs a
   crop, write a cropped PNG next to the original.

## Report format
`report.json`: `{ group, agent: "layout", checked: [{screen,width,theme}...], findings: FindingInput[] }`.
- Severity:
  - **blocker:** content unreachable or unreadable;
  - **major:** visibly broken alignment, clipping or wrapping;
  - **minor:** polish.
- Do not report taste-only opinions.
```

The interactive agent uses the same brief with these changes:
- group **INTERACTIVE**, `agent: "interactive"`;
- it uses the claude-in-chrome tools in its own window at each width (`resize_window`), on the QA stack;
- it checks the stateful flows the shooter cannot reach:
  - opening and closing sheets;
  - the approval spotlight;
  - ⌘K search;
  - drag-to-move;
  - the takeover transition on the `run-live` screen (stubbed frame);
  - toasts and Undo;
  - keyboard focus order.
- Append this section to the brief file as "Variant: INTERACTIVE".

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm test -- tests/e2e/qa/findings && pnpm typecheck && pnpm lint`
Expected: PASS.

Run: `pnpm qa:shoot -- --group G1 --run 2026-10-05-qa-shoot-dryrun && ls orchestration/runs/2026-10-05-qa-shoot-dryrun/shots && rm -rf orchestration/runs/2026-10-05-qa-shoot-dryrun`
Expected: per-screen directories with 10 PNG and JSON pairs each.

- [ ] **Step 6: Commit.**

```bash
git add tests/e2e/qa scripts/qa orchestration/briefs/qa-swarm.md package.json compose.test.yml
git commit -m "test(qa): swarm shooter, brief and findings ledger with dedupe, re-open and gate"
```

---

### Task 10: Animation pass — CDP trace harness, motion catalog and brief

**Files:**
- Create: `tests/e2e/motion/{trace.ts,trace.test.ts,catalog.ts,catalog.test.ts,motion.spec.ts}`, `orchestration/briefs/qa-animation.md`
- Modify: `package.json` (script `qa:motion`)

**Interfaces:**
- Consumes:
  - `apps/web/lib/motion-tokens.ts` (F1);
  - `stubLiveFrame` and `SEED`.
  - Seam check: `grep -rln "motion/react" apps/web/components apps/web/app`.
- Produces:
  - `TraceEvent` (the Chrome trace event shape);
  - `analyzeTrace(events: TraceEvent[], window: {startUs: number; endUs: number; warmupUs?: number}): MotionVerdict`, where `MotionVerdict = {frames: number; longFrames: number; worstFrameMs: number; layouts: number; paints: number}`;
  - `traceMotion(page, trigger: (page) => Promise<void>, durationMs): Promise<MotionVerdict>`;
  - `MOTIONS: Motion[]`, where `Motion = {id; files: string[]; screen: string; trigger(page): Promise<void>; durationMs}`;
  - `pnpm qa:motion`.

- [ ] **Step 1: Write the failing tests.**

`tests/e2e/motion/trace.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { analyzeTrace, type TraceEvent } from "./trace.ts";

const frame = (ts: number): TraceEvent => ({ name: "DrawFrame", cat: "disabled-by-default-devtools.timeline.frame", ph: "I", ts, pid: 1, tid: 1 });
const ev = (name: string, ts: number): TraceEvent => ({ name, cat: "devtools.timeline", ph: "X", ts, dur: 100, pid: 1, tid: 1 });

describe("analyzeTrace", () => {
  it("counts long frames over 16.7 ms", () => {
    const events = [0, 16_600, 33_200, 60_000, 76_600].map(frame);
    const verdict = analyzeTrace(events, { startUs: 0, endUs: 100_000 });
    expect(verdict.frames).toBe(5);
    expect(verdict.longFrames).toBe(1);
    expect(verdict.worstFrameMs).toBeCloseTo(26.8, 1);
  });

  it("counts layout and paint only after the warm-up window", () => {
    const events = [ev("Layout", 1_000), ev("Paint", 2_000), ev("Layout", 40_000), ev("Paint", 50_000), ev("UpdateLayoutTree", 50_000)];
    const verdict = analyzeTrace(events, { startUs: 0, endUs: 100_000, warmupUs: 33_400 });
    expect(verdict.layouts).toBe(1);
    expect(verdict.paints).toBe(1);
  });

  it("ignores events outside the window", () => {
    const verdict = analyzeTrace([ev("Layout", 500_000), frame(500_000)], { startUs: 0, endUs: 100_000 });
    expect(verdict).toMatchObject({ frames: 0, layouts: 0 });
  });
});
```

`tests/e2e/motion/catalog.test.ts`:
```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MOTIONS } from "./catalog.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("motion catalog", () => {
  it("covers every UI file that animates with motion (D28)", () => {
    const root = new URL("../../../", import.meta.url).pathname;
    const animated = ["apps/web/components", "apps/web/app"]
      .flatMap((dir) => walk(join(root, dir)))
      .filter((file) => /from "motion\/react"/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file));
    const covered = new Set(MOTIONS.flatMap((m) => m.files));
    expect(animated.filter((file) => !covered.has(file))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test -- tests/e2e/motion`
Expected: FAIL.

- [ ] **Step 3: Implement the trace analyser and harness.**

`tests/e2e/motion/trace.ts`:
```ts
import type { Page } from "@playwright/test";

export interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
}
export interface MotionVerdict {
  frames: number;
  longFrames: number;
  worstFrameMs: number;
  layouts: number;
  paints: number;
}

const FRAME_BUDGET_US = 16_700;

/** Spec §12 D28: no frame over 16.7 ms and no animation-caused layout or paint after warm-up (layer promotion). */
export function analyzeTrace(
  events: readonly TraceEvent[],
  window: { startUs: number; endUs: number; warmupUs?: number },
): MotionVerdict {
  const inWindow = (e: TraceEvent) => e.ts >= window.startUs && e.ts <= window.endUs;
  const afterWarmup = (e: TraceEvent) => e.ts >= window.startUs + (window.warmupUs ?? 0);
  const frames = events.filter((e) => e.name === "DrawFrame" && inWindow(e)).map((e) => e.ts).sort((a, b) => a - b);
  let longFrames = 0;
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i]! - frames[i - 1]!;
    worst = Math.max(worst, gap);
    if (gap > FRAME_BUDGET_US) longFrames++;
  }
  const count = (name: string) => events.filter((e) => e.name === name && inWindow(e) && afterWarmup(e)).length;
  return { frames: frames.length, longFrames, worstFrameMs: worst / 1000, layouts: count("Layout"), paints: count("Paint") };
}

export async function traceMotion(page: Page, trigger: (page: Page) => Promise<void>, durationMs: number): Promise<MotionVerdict> {
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  cdp.on("Tracing.dataCollected", (payload: { value: TraceEvent[] }) => events.push(...payload.value));
  const done = new Promise<void>((resolve) => cdp.once("Tracing.tracingComplete", () => resolve()));
  await cdp.send("Tracing.start", {
    traceConfig: {
      recordMode: "recordAsMuchAsPossible",
      includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline.frame"],
    },
  });
  const startUs = (await page.evaluate(() => performance.timeOrigin + performance.now())) * 1000;
  await trigger(page);
  await page.waitForTimeout(durationMs);
  const endUs = (await page.evaluate(() => performance.timeOrigin + performance.now())) * 1000;
  await cdp.send("Tracing.end");
  await done;
  await cdp.detach();
  // Trace timestamps use the monotonic clock: rebase the window onto the first recorded event.
  const base = Math.min(...events.map((e) => e.ts).filter((ts) => ts > 0));
  return analyzeTrace(events, { startUs: base, endUs: base + (endUs - startUs), warmupUs: 2 * FRAME_BUDGET_US });
}
```

`tests/e2e/motion/catalog.ts`. Use the real F file paths found by the seam grep; the entries below are the required motions:
```ts
import type { Page } from "@playwright/test";
import { SEED } from "../qa/seed.ts";

export interface Motion {
  id: string;
  /** Repo-relative files whose motion this entry exercises. */
  files: string[];
  screen: string;
  trigger(page: Page): Promise<void>;
  durationMs: number;
}

const click = (name: RegExp) => async (page: Page) => page.getByRole("button", { name }).first().click();

export const MOTIONS: Motion[] = [
  { id: "press-feedback", files: ["apps/web/components/ui/button.tsx"], screen: "/", trigger: async (p) => { const b = p.getByRole("button").first(); await b.hover(); await p.mouse.down(); await p.mouse.up(); }, durationMs: 300 },
  { id: "approval-sheet", files: ["apps/web/components/run/approval-sheet.tsx"], screen: `/runs/${SEED.runs.approval}`, trigger: async () => undefined, durationMs: 600 },
  { id: "takeover-transition", files: ["apps/web/components/run/live-frame.tsx"], screen: `/runs/${SEED.runs.live}`, trigger: async (p) => p.getByTestId("live-preview").click(), durationMs: 700 },
  { id: "status-mark", files: ["apps/web/components/bits/status-mark.tsx"], screen: `/runs/${SEED.runs.live}`, trigger: async () => undefined, durationMs: 800 },
  { id: "thought-line", files: ["apps/web/components/bits/thought-line.tsx"], screen: `/runs/${SEED.runs.live}`, trigger: async () => undefined, durationMs: 800 },
  { id: "count-up", files: ["apps/web/components/bits/count-up.tsx"], screen: `/runs/${SEED.runs.completed}`, trigger: async () => undefined, durationMs: 900 },
  { id: "code-slots", files: ["apps/web/components/bits/code-slots.tsx"], screen: `/runs/${SEED.runs.approval}`, trigger: async (p) => p.keyboard.type("123456"), durationMs: 600 },
  { id: "spring-check", files: ["apps/web/components/bits/spring-check.tsx"], screen: `/notes/${SEED.notes.review}`, trigger: click(/mark verified/i), durationMs: 600 },
  { id: "rubber-segment", files: ["apps/web/components/bits/rubber-segment.tsx"], screen: "/library", trigger: click(/^pdf$/i), durationMs: 600 },
  { id: "swipe-toast", files: ["apps/web/components/bits/swipe-toast.tsx"], screen: `/notes/${SEED.notes.review}`, trigger: click(/mark verified/i), durationMs: 900 },
  { id: "route-transition", files: ["apps/web/app/layout.tsx"], screen: "/library", trigger: async (p) => p.getByTestId("library-note").first().click(), durationMs: 700 },
];
```
Every `files` entry must exist; the catalog test fails otherwise. The 3D hero is excluded: it is a canvas, verified by run 16's constraints and the animation agent's manual pass.

`tests/e2e/motion/motion.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { stubLiveFrame } from "../qa/stub-live.ts";
import { MOTIONS } from "./catalog.ts";
import { traceMotion } from "./trace.ts";

// Frame-time is asserted only where frames are real (local headed Chrome with a GPU: MOTION_FRAMES=1).
// Layout and paint counts are deterministic and asserted everywhere.
const assertFrames = process.env.MOTION_FRAMES === "1";

for (const motion of MOTIONS) {
  test(`motion ${motion.id} animates on the compositor`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await stubLiveFrame(page);
    await page.goto(motion.screen);
    await page.waitForLoadState("networkidle");
    const verdict = await traceMotion(page, motion.trigger, motion.durationMs);
    expect(verdict.layouts, "layout during animation").toBe(0);
    expect(verdict.paints, "paint during animation").toBe(0);
    if (assertFrames) expect(verdict.longFrames, `worst ${verdict.worstFrameMs} ms`).toBe(0);
  });

  test(`motion ${motion.id} has a reduced-motion variant`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubLiveFrame(page);
    await page.goto(motion.screen);
    await motion.trigger(page);
    const moving = await page.evaluate(() =>
      document.getAnimations().filter((a) => {
        const effect = a.effect as KeyframeEffect | null;
        return effect?.getKeyframes().some((k) => "transform" in k) ?? false;
      }).length,
    );
    expect(moving).toBe(0);
  });
}
```
Root script: `"qa:motion": "docker compose --env-file .env.test -f compose.yml -f compose.test.yml --profile e2e run --rm e2e pnpm exec playwright test --project=motion"`.

- [ ] **Step 4: Write the animation brief.**

`orchestration/briefs/qa-animation.md`:
```markdown
# Brief: animation-expert pass (D28)

Audit every UI motion for QA run **{{RUN_ID}}**. Save under `orchestration/runs/{{RUN_ID}}/`.
Do not edit product code.

## Inputs
- The QA stack is up and seeded.
- `tests/e2e/motion/catalog.ts` lists every motion.
- `apps/web/lib/motion-tokens.ts` is the token source.
- Spec §11.4 has the rules; run 18 has the React Bits adaptation list.

## Procedure
1. `pnpm qa:motion` and attach its output: layout and paint counts per motion, plus reduced-motion variants.
2. Locally, run headed Chrome with a GPU:
   `MOTION_FRAMES=1 pnpm --filter @mastertutor/e2e exec playwright test --project=motion --headed`,
   with `E2E_BASE_URL=http://localhost:18080`. Record the worst frame per motion.
3. For each catalog motion, record a 60fps clip with Chrome DevTools' screencast, or with
   `pnpm qa:shoot -- --group G3 --run {{RUN_ID}} --motion` plus manual stepping. Check:
   - **Tokens:** only `spring`, `springSoft`, durations micro/base/panel and the out/in/cursor easings are used.
     `grep` each component for literals; the ESLint/Stylelint rules should already fail on them.
   - **Curve feel:**
     - `spring` settles in about 450 ms with no visible second bounce;
     - sheets and the PiP use `springSoft`;
     - press feedback starts within 100 ms (scale 0.96, or 0.92 for icon buttons).
   - **Takeover:** frame 1 → 1.01, ring cross-fade, banner spring, cursor fade, and an exact reversal on hand back.
   - **Cursor:** arc travel 250–450 ms with cursor easing; click ring 24→44 px over 400 ms.
   - **Reduced motion:** transforms are replaced by fades or jumps; nothing slides.
   - **Transform/opacity only:** nothing animates width, height, top, left or filter. ThoughtLine has no blur.
   - **The 3D hero:**
     - poster cross-fade over 700 ms;
     - pauses offscreen and on a hidden tab;
     - `three` is not downloaded under reduced motion.
4. Write `report.json` (`SwarmReport`, `group: "MOTION"`, `agent: "animation"`, `category: "motion"`) and
   `report.md`. Evidence is a clip, a trace JSON or a screenshot inside your run directory.
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm test -- tests/e2e/motion && pnpm qa:stack && pnpm qa:motion`
Expected:
- the unit tests PASS;
- `qa:motion` runs, and each layout or paint failure is a **finding** (Task 11), not a harness bug.

Confirm the harness on one known-good motion by hand: `press-feedback` should report 0 layouts.

- [ ] **Step 6: Commit.**

```bash
git add tests/e2e/motion orchestration/briefs/qa-animation.md package.json
git commit -m "test(qa): CDP trace harness, motion catalog with coverage test, animation-expert brief"
```

---

### Task 11: Run the QA cycle and the fix loop until the gate passes

**Files:**
- Create (outputs): `orchestration/runs/<date>-NN-qa-swarm-<group>/…`, `orchestration/runs/<date>-NN-qa-animation/…`, `orchestration/qa/findings.{json,md}`
- Modify: whatever `apps/web/**` files the fixes need, plus `tests/e2e/qa/__screenshots__/*` where pixels change

**Interfaces:**
- Consumes: Tasks 7–10.
- Produces:
  - `pnpm qa:findings gate` exits 0;
  - the CI `visual` job is green;
  - `pnpm qa:motion` is green.

This task is executed by the **orchestrator**. Fixers are subagents.

- [ ] **Step 1: Prepare.**

Run: `pnpm qa:stack && pnpm qa:matrix || true`
Collect the automated failures. Create `orchestration/runs/<date>-NN-qa-auto/report.json` that converts each matrix failure into a `FindingInput` with `autoDetected: true`. Evidence is the copied diff or actual PNG from `tests/e2e/.out/results`.

- [ ] **Step 2: Dispatch the swarm in parallel.**

In **one message**, dispatch 7 subagents:
- the 5 layout agents (G1–G5) with `orchestration/briefs/qa-swarm.md`;
- 1 INTERACTIVE agent (same brief, variant section);
- 1 animation-expert agent with `orchestration/briefs/qa-animation.md`.

Rules:
- Each brief is filled with `{{GROUP}}` and its own `{{RUN_ID}}` (`<date>-NN-qa-swarm-g1` and so on).
- The INTERACTIVE agent is the only one that uses claude-in-chrome.
- The other agents use `pnpm qa:shoot`, which runs separate headless browsers, so there are no shared-window conflicts.

- [ ] **Step 3: Merge the findings.**

Run: `pnpm qa:findings merge orchestration/runs/*-qa-*/report.json`
Then commit the ledger:
```bash
git add orchestration/runs orchestration/qa && git commit -m "qa: swarm round 1 findings"
```

- [ ] **Step 4: The fix loop.** For each open finding, grouped by component (one fixer subagent per component, in parallel when the components differ):
  1. **Pin it first.** Give the fixer the finding ids and evidence paths. It writes a failing check:
     - a `layout-audit.spec.ts` case that reproduces the pattern, for example a new `setContent` mirroring the clipped structure;
     - or a matrix failure that is already red;
     - or an axe failure;
     - or a motion spec failure.

     Pure taste fixes with no automatable check need the screenshot evidence in the commit message.
  2. **Fix it** in `apps/web`, using tokens and existing components only.
  3. **Re-run the narrow check and the whole matrix for that group:** `QA_GROUP=G3 pnpm qa:matrix`. If the pixels changed intentionally, re-generate that group's baselines (`QA_GROUP=G3 pnpm qa:update-baselines`) and inspect each changed PNG with the Read tool before committing.
  4. **Review:** a fresh reviewer subagent checks the diff against spec §11 and the finding.
  5. **Commit**, then run `pnpm qa:findings fix QA-### --commit <sha>`.

- [ ] **Step 5: Verify by re-dispatch.**

Re-dispatch **only the groups that had fixes**, with new run ids. Add a brief line: "Verify these finding ids: … and report any regression on the same screens." For each finding the agent confirms gone, run `pnpm qa:findings verify QA-### --run <runId>`. New findings are merged as in Step 3 and loop back to Step 4.

- [ ] **Step 6: Gate.**

Run: `pnpm qa:findings gate && pnpm qa:matrix && pnpm qa:motion && pnpm e2e`
Expected: all exit 0.

Commit:
```bash
git add orchestration/qa tests/e2e/qa/__screenshots__ apps/web
git commit -m "qa: zero open findings (D22 swarm + D28 animation pass), baselines final"
```

**Phase 8 exit:** `qa:findings gate` is green with zero open findings, and the CI `visual` job is green.

---

# Phase 9: Deploy readiness (no deployment)

### Task 12: Production overlay with Dokploy wiring and label checks

**Files:**
- Create: `compose.prod.yml`, `tests/compose/prod-overlay.int.test.ts`
- Modify: the slot label set, if B6 wrote different labels (S13)

**Interfaces:**
- Consumes:
  - `compose.yml`, B6's per-slot router design (§10.2) and `mediaPortForSlot`;
  - `composeConfig`.
  - Seam check: `grep -n "traefik\." compose*.yml infra/traefik/*.yml`.
- Produces: `compose.prod.yml`. Dokploy runs `docker compose -f compose.yml -f compose.prod.yml up -d --build`. The overlay provides:
  - **Networks:**
    - `web` joins the external `dokploy-network`;
    - the `cdp` network is named `mastertutor-cdp`.
  - **Slot labels:**
    - routers `mastertutor-live-browser-N`, with the rule ``Host(`${DOMAIN}`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `live_slot=browser-N\.`)``;
    - middlewares `mastertutor-live-strip` and `mastertutor-live-auth`;
    - entrypoint `${TRAEFIK_ENTRYPOINT:-websecure}`, `tls=${TRAEFIK_TLS:-true}`;
    - `traefik.docker.network=mastertutor-cdp`.
  - **Postgres:** the `pgbackups` volume mounted at `/backups` on `postgres`.
  - **Env:** `PUBLIC_URL` must be `https://${DOMAIN}` (checked in Task 14).

- [ ] **Step 1: Write the failing test.**

`tests/compose/prod-overlay.int.test.ts`:
```ts
import { mediaPortForSlot } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { composeConfig } from "./compose-json.ts";

const config = composeConfig(".env.test", ["compose.yml", "compose.prod.yml"], {
  env: { DOMAIN: "notes.example.org" },
});
const slots = Object.keys(config.services).filter((name) => /^browser-\d+$/.test(name));

describe("compose.prod.yml (Dokploy)", () => {
  it("attaches web, and only web, to Dokploy's network", () => {
    expect(config.networks["dokploy-network"]).toMatchObject({ external: true });
    const attached = Object.entries(config.services).filter(([, s]) => s.networks && "dokploy-network" in s.networks).map(([n]) => n);
    expect(attached).toEqual(["web"]);
  });

  it("names the cdp network so Dokploy's Traefik can join it at .12", () => {
    expect(config.networks.cdp?.name).toBe("mastertutor-cdp");
  });

  it("routes /live per slot, scoped to the app's host, through ForwardAuth", () => {
    expect(slots).toHaveLength(6);
    for (const slot of slots) {
      const labels = config.services[slot]?.labels ?? {};
      const router = `traefik.http.routers.mastertutor-live-${slot}`;
      expect(labels["traefik.enable"]).toBe("true");
      expect(labels["traefik.docker.network"]).toBe("mastertutor-cdp");
      expect(labels[`${router}.rule`]).toContain("Host(`notes.example.org`)");
      expect(labels[`${router}.rule`]).toContain(`live_slot=${slot}\\.`);
      expect(labels[`${router}.middlewares`]).toBe("mastertutor-live-strip,mastertutor-live-auth");
      expect(labels[`traefik.http.services.mastertutor-live-${slot}.loadbalancer.server.port`]).toBe("8080");
    }
    const first = config.services[slots[0]!]?.labels ?? {};
    expect(first["traefik.http.middlewares.mastertutor-live-auth.forwardauth.address"]).toBe("http://web:3000/api/live/auth");
  });

  it("publishes only the WebRTC mux ports (no CDP, n.eko, database or storage)", () => {
    const published = Object.entries(config.services).flatMap(([name, s]) =>
      (s.ports ?? []).map((p) => ({ name, port: Number(p.published), protocol: p.protocol ?? "tcp" })),
    );
    for (const p of published.filter((x) => x.name !== "coturn")) {
      expect(p.port, p.name).toBe(mediaPortForSlot(p.name));
    }
  });

  it("keeps Postgres dumps on their own volume for Dokploy volume backups", () => {
    expect(config.services.postgres?.volumes?.some((v) => v.target === "/backups")).toBe(true);
    expect(config.volumes).toHaveProperty("pgbackups");
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test:int -- tests/compose/prod-overlay`
Expected: FAIL (no overlay).

- [ ] **Step 3: Write the overlay.**

`compose.prod.yml`. If B6 already wrote production slot labels, align them to this exact set and delete any duplicates:
```yaml
# Dokploy production overlay (spec §13). Dokploy compose command:
#   docker compose -f compose.yml -f compose.prod.yml up -d --build
# web's domain router (TLS, letsencrypt) is configured in Dokploy's Domains tab: web, port 3000.
# Dokploy's Traefik must also join mastertutor-cdp at .12 (infra/host/attach-traefik.sh).

x-live-labels: &live-labels
  traefik.enable: "true"
  traefik.docker.network: mastertutor-cdp
  traefik.http.middlewares.mastertutor-live-strip.stripprefixregex.regex: "^/live/[0-9a-f-]{36}"
  traefik.http.middlewares.mastertutor-live-auth.forwardauth.address: http://web:3000/api/live/auth
  traefik.http.middlewares.mastertutor-live-auth.forwardauth.trustForwardHeader: "false"

services:
  web:
    networks:
      dokploy-network: {}

  postgres:
    volumes:
      - pgbackups:/backups

  browser-1:
    labels:
      <<: *live-labels
      traefik.http.routers.mastertutor-live-browser-1.rule: "Host(`${DOMAIN:?set DOMAIN}`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `live_slot=browser-1\\.`)"
      traefik.http.routers.mastertutor-live-browser-1.entrypoints: ${TRAEFIK_ENTRYPOINT:-websecure}
      traefik.http.routers.mastertutor-live-browser-1.tls: ${TRAEFIK_TLS:-true}
      traefik.http.routers.mastertutor-live-browser-1.middlewares: mastertutor-live-strip,mastertutor-live-auth
      traefik.http.routers.mastertutor-live-browser-1.service: mastertutor-live-browser-1
      traefik.http.services.mastertutor-live-browser-1.loadbalancer.server.port: "8080"
  # browser-2 … browser-6: identical, with every "browser-1" replaced by the slot name.

networks:
  cdp:
    name: mastertutor-cdp
  dokploy-network:
    external: true

volumes:
  pgbackups: {}
```
Write out `browser-2` through `browser-6` in full, each with the same six router and service labels and its own name. YAML anchors cannot template names, so the six blocks are spelled out.

- [ ] **Step 4: Run it to verify it passes.**

Run: `pnpm test:int -- tests/compose && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add compose.prod.yml tests/compose/prod-overlay.int.test.ts
git commit -m "feat(deploy): Dokploy overlay with host-scoped per-slot /live routers, named cdp network, backup volume"
```

---

### Task 13: Host preparation (sysctl, firewall, Traefik attachment)

**Files:**
- Create: `infra/host/{99-mastertutor.conf,firewall.sh,attach-traefik.sh,host.test.ts}`

**Interfaces:**
- Consumes: `MEDIA_PORT_BASE`, `DEFAULT_SLOT_COUNT` and the Phase 0 note about `apparmor_restrict_unprivileged_userns`.
- Produces:
  - **`infra/host/firewall.sh [--turn]`:** idempotent ufw rules for 22, 80, 443 and `59001..5900N` UDP/TCP, plus 3478 UDP/TCP and 5349 TCP with `--turn`;
  - **`infra/host/attach-traefik.sh`:** connects `dokploy-traefik` to `mastertutor-cdp` at `.12`;
  - **`infra/host/99-mastertutor.conf`.**

- [ ] **Step 1: Write the failing test.**

`infra/host/host.test.ts`:
```ts
import { DEFAULT_SLOT_COUNT, MEDIA_PORT_BASE } from "@mastertutor/contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("host preparation", () => {
  it("firewall media ports come from the same constants as Compose", () => {
    const script = read("./firewall.sh");
    expect(script).toContain(`MEDIA_PORT_BASE=${MEDIA_PORT_BASE}`);
    expect(script).toContain(`SLOTS="\${SLOTS:-${DEFAULT_SLOT_COUNT}}"`);
  });
  it("keeps the Chromium sandbox working on Ubuntu 24.04+", () => {
    expect(read("./99-mastertutor.conf")).toMatch(/^kernel\.apparmor_restrict_unprivileged_userns\s*=\s*0$/m);
  });
  it("attaches Traefik at the fixed .12 address", () => {
    expect(read("./attach-traefik.sh")).toContain('--ip "${CDP_SUBNET_PREFIX:-172.30.231}.12"');
  });
});
```

Add `"infra/**/*.test.ts"` to the unit project `include` in `vitest.config.ts`.

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test -- infra/host`
Expected: FAIL.

- [ ] **Step 3: Write the files.**

`infra/host/99-mastertutor.conf`:
```conf
# MasterTutor slots run Chromium with its sandbox on (spec §13). Ubuntu 24.04+ blocks the
# unprivileged user namespaces it needs unless this is 0. Install: /etc/sysctl.d/, then `sysctl --system`.
kernel.apparmor_restrict_unprivileged_userns = 0
```

`infra/host/firewall.sh`:
```bash
#!/usr/bin/env bash
# Idempotent ufw rules for the Dokploy host (spec §13). Run as root: bash infra/host/firewall.sh [--turn]
# Note: Docker-published ports bypass ufw's INPUT chain. These rules document and open the intended
# ports. tests/compose/prod-overlay.int.test.ts guarantees Compose publishes nothing else.
set -euo pipefail
MEDIA_PORT_BASE=59000
SLOTS="${SLOTS:-6}"
TURN=0
[[ "${1:-}" == "--turn" ]] && TURN=1

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
for ((n = 1; n <= SLOTS; n++)); do
  port=$((MEDIA_PORT_BASE + n))
  ufw allow "${port}/udp"
  ufw allow "${port}/tcp"
done
if [[ "$TURN" == "1" ]]; then
  ufw allow 3478/udp
  ufw allow 3478/tcp
  ufw allow 5349/tcp
fi
ufw --force enable
ufw status numbered
```

`infra/host/attach-traefik.sh`:
```bash
#!/usr/bin/env bash
# Lets Dokploy's Traefik reach slot n.eko (8080) for /live signalling (spec §10.2). Slots accept
# 8080 only from .11 (web) and .12 (Traefik). Idempotent. Re-run after the stack is recreated.
set -euo pipefail
TRAEFIK_CONTAINER="${TRAEFIK_CONTAINER:-dokploy-traefik}"
if docker inspect -f '{{json .NetworkSettings.Networks}}' "$TRAEFIK_CONTAINER" | grep -q '"mastertutor-cdp"'; then
  echo "already attached"
  exit 0
fi
docker network connect --ip "${CDP_SUBNET_PREFIX:-172.30.231}.12" mastertutor-cdp "$TRAEFIK_CONTAINER"
echo "attached $TRAEFIK_CONTAINER to mastertutor-cdp at .12"
```

- [ ] **Step 4: Run it to verify it passes, then lint the shell.**

Run: `pnpm test -- infra/host && bash -n infra/host/firewall.sh && bash -n infra/host/attach-traefik.sh`
Expected: PASS and no syntax errors.

- [ ] **Step 5: Commit.**

```bash
git add infra/host vitest.config.ts
git commit -m "feat(deploy): host sysctl, firewall and Traefik cdp attachment scripts with contract checks"
```

---

### Task 14: Secrets check, backups and restore drill, deploy runbook

**Files:**
- Create: `scripts/deploy/check-env.ts`, `scripts/deploy/check-env.int.test.ts`, `scripts/deploy/restore-drill.sh`, `infra/deploy-runbook.md`
- Modify: `package.json` (scripts `deploy:check-env`, `deploy:restore-drill`)

**Interfaces:**
- Consumes:
  - `WebEnv`, `AgentEnv`, `MigrateEnv`, `GarageInitEnv`, `parseEnv` and `EnvError`;
  - `composeConfig`, `compose.prod.yml` and the test stack.
- Produces:
  - **`checkProductionEnv(envFile: string): string[]`**, which returns problems naming keys only and never values. It checks:
    - every service env parses with its schema;
    - `PUBLIC_URL` is `https://${DOMAIN}`;
    - `PUBLIC_IP` is not loopback or private;
    - `OPENAI_EMBEDDINGS_KEY` differs from `OPENAI_API_KEY`;
    - `AUTH_SIGNUP_OPEN` is off;
    - `AGENT_TEST_MODE` is off.
  - **`pnpm deploy:check-env <file>`.**
  - **`pnpm deploy:restore-drill`.**

- [ ] **Step 1: Write the failing test.**

`scripts/deploy/check-env.int.test.ts`:
```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProductionEnv } from "./check-env.ts";

function envFile(overrides: Record<string, string>): string {
  const lines = readFileSync(".env.test", "utf8").split("\n").filter((l) => !Object.keys(overrides).some((k) => l.startsWith(`${k}=`)));
  const file = join(mkdtempSync(join(tmpdir(), "mt-env-")), ".env.prod");
  writeFileSync(file, [...lines, ...Object.entries(overrides).map(([k, v]) => `${k}=${v}`)].join("\n"));
  return file;
}

const good = {
  DOMAIN: "notes.example.org",
  PUBLIC_URL: "https://notes.example.org",
  PUBLIC_IP: "203.0.113.10",
  OPENAI_EMBEDDINGS_KEY: "sk-test-embeddings-only-key",
  AGENT_TEST_MODE: "0",
  BROWSER_SLOTS: "browser-1,browser-2,browser-3,browser-4,browser-5,browser-6",
};

describe("checkProductionEnv", () => {
  it("accepts a complete production env", () => {
    expect(checkProductionEnv(envFile(good))).toEqual([]);
  });
  it("rejects http, a loopback public IP, a shared OpenAI key and test mode, naming keys only", () => {
    const problems = checkProductionEnv(
      envFile({ ...good, PUBLIC_URL: "http://notes.example.org", PUBLIC_IP: "127.0.0.1", OPENAI_EMBEDDINGS_KEY: "sk-test-not-a-real-key", AGENT_TEST_MODE: "1" }),
    );
    expect(problems.join("\n")).toMatch(/PUBLIC_URL/);
    expect(problems.join("\n")).toMatch(/PUBLIC_IP/);
    expect(problems.join("\n")).toMatch(/OPENAI_EMBEDDINGS_KEY/);
    expect(problems.join("\n")).toMatch(/AGENT_TEST_MODE/);
    expect(problems.join("\n")).not.toContain("sk-test");
  });
  it("reports a missing secret by key", () => {
    const problems = checkProductionEnv(envFile({ ...good, VAULT_PRIVATE_KEY: "" }));
    expect(problems.some((p) => p.includes("VAULT_PRIVATE_KEY"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test:int -- scripts/deploy`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`scripts/deploy/check-env.ts`:
```ts
// Validates a production env file against the service env contracts without printing values.
// Usage: pnpm deploy:check-env /path/to/prod.env   (keep that file outside the repo, or git-ignored)
import { AgentEnv, EnvError, GarageInitEnv, MigrateEnv, parseEnv, WebEnv } from "@mastertutor/contracts";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import type { z } from "zod";

const SCHEMAS: Record<string, z.ZodType> = { web: WebEnv, agent: AgentEnv, migrate: MigrateEnv, "garage-init": GarageInitEnv };

function readDotenv(file: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) map[match[1]!] = match[2]!;
  }
  return map;
}

const privateOrLoopback = (ip: string) =>
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(ip) || ip === "::1";

export function checkProductionEnv(envFile: string): string[] {
  const problems: string[] = [];
  const root = readDotenv(envFile);
  let config: { services: Record<string, { environment?: Record<string, string | null> }> };
  try {
    const text = execFileSync(
      "docker",
      ["compose", "--env-file", envFile, "-f", "compose.yml", "-f", "compose.prod.yml", "config", "--format", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    config = JSON.parse(text);
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const missing = [...stderr.matchAll(/set ([A-Z0-9_]+)/g)].map((m) => `${m[1]}: required`);
    return missing.length > 0 ? missing : ["compose config failed (run it manually to see which key)"];
  }
  for (const [service, schema] of Object.entries(SCHEMAS)) {
    const env = Object.fromEntries(Object.entries(config.services[service]?.environment ?? {}).map(([k, v]) => [k, v ?? undefined]));
    try {
      parseEnv(schema, env);
    } catch (error) {
      if (error instanceof EnvError) problems.push(...error.problems.map((p) => `${service}.${p}`));
      else throw error;
    }
  }
  if (!root.DOMAIN) problems.push("DOMAIN: required");
  if (root.PUBLIC_URL !== `https://${root.DOMAIN}`) problems.push("PUBLIC_URL: must be https://${DOMAIN}");
  if (!root.PUBLIC_IP || isIP(root.PUBLIC_IP) === 0 || privateOrLoopback(root.PUBLIC_IP)) {
    problems.push("PUBLIC_IP: must be the server's public IP");
  }
  if (root.OPENAI_EMBEDDINGS_KEY && root.OPENAI_EMBEDDINGS_KEY === root.OPENAI_API_KEY) {
    problems.push("OPENAI_EMBEDDINGS_KEY: must be a separate embeddings-only project key (spec §13)");
  }
  if (["1", "true"].includes(root.AGENT_TEST_MODE ?? "")) problems.push("AGENT_TEST_MODE: must be 0 in production");
  if (["1", "true"].includes(root.AUTH_SIGNUP_OPEN ?? "")) problems.push("AUTH_SIGNUP_OPEN: must be 0 in production");
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: pnpm deploy:check-env <env file>");
  const problems = checkProductionEnv(file);
  for (const problem of problems) console.error(`- ${problem}`);
  console.log(problems.length === 0 ? "production env OK" : `${problems.length} problem(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}
```

`scripts/deploy/restore-drill.sh`:
```bash
#!/usr/bin/env bash
# Backup/restore drill on the test stack (spec §13 backups). It:
#   1. creates data;
#   2. dumps it the way the Dokploy schedule does;
#   3. destroys every volume;
#   4. boots fresh, restores, and verifies the data and role grants.
set -euo pipefail
cd "$(dirname "$0")/../.."
DC=(docker compose --env-file .env.test -f compose.yml -f compose.test.yml)
trap '"${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true' EXIT
q() { "${DC[@]}" exec -T postgres psql -U owner -d mastertutor -tAc "$1"; }
BASE="http://localhost:$(grep -E '^TEST_HTTP_PORT=' .env.test | cut -d= -f2)"

"${DC[@]}" up -d --wait --wait-timeout 420
curl -fsS -o /dev/null -X POST "$BASE/api/auth/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"email":"drill@example.test","password":"restore-drill-password","name":"Drill"}'
q "insert into folders (workspace_id, name) select workspace_id, 'Restore drill' from workspace_members limit 1" >/dev/null
before="$(q "select count(*) from folders")"

# The same command the Dokploy schedule runs (infra/deploy-runbook.md).
"${DC[@]}" exec -T postgres sh -c 'pg_dump -U owner -d mastertutor -Fc -f /tmp/drill.dump'
"${DC[@]}" cp postgres:/tmp/drill.dump ./tests/security/.out/drill.dump

"${DC[@]}" down -v
"${DC[@]}" up -d --wait --wait-timeout 420
"${DC[@]}" cp ./tests/security/.out/drill.dump postgres:/tmp/drill.dump
"${DC[@]}" exec -T postgres pg_restore -U owner -d mastertutor --clean --if-exists --no-owner /tmp/drill.dump
"${DC[@]}" restart migrate >/dev/null  # re-applies grants.sql idempotently

[[ "$(q "select count(*) from folders")" == "$before" ]] || { echo "DRILL FAIL: folder count"; exit 1; }
[[ "$(q "select count(*) from \"user\" where email = 'drill@example.test'")" == "1" ]] || { echo "DRILL FAIL: user"; exit 1; }
[[ "$(q "select has_table_privilege('web_role', 'folders', 'select')")" == "t" ]] || { echo "DRILL FAIL: grants"; exit 1; }
rm -f ./tests/security/.out/drill.dump
echo "RESTORE DRILL OK"
```

Root scripts:
- `"deploy:check-env": "node scripts/deploy/check-env.ts"`;
- `"deploy:restore-drill": "bash scripts/deploy/restore-drill.sh"`.

`infra/deploy-runbook.md`, which is the first-deploy checklist for when a domain exists:
```markdown
# MasterTutor deploy runbook (Dokploy)

Status: ready; **not deployed** (no domain yet). Every step below runs only after the user approves a deploy.

## 1. Host (once)
- `sudo cp infra/host/99-mastertutor.conf /etc/sysctl.d/ && sudo sysctl --system`.
- `sudo bash infra/host/firewall.sh` (add `--turn` when the coturn profile is enabled).

## 2. Dokploy app
- Create a Compose app from `main`, with compose path `compose.yml`.
- Set the custom command to `docker compose -f compose.yml -f compose.prod.yml up -d --build`.
- Keep "isolated deployment" **off**: it rewrites networks and breaks `mastertutor-cdp`.
- Environment: `COMPOSE_PROFILES=pdf` (add `,turn` for coturn). Every key from `.env.example`, plus `DOMAIN`, with:
  - `PUBLIC_URL=https://$DOMAIN`;
  - `PUBLIC_IP=<server public IP>`;
  - a separate embeddings-only `OPENAI_EMBEDDINGS_KEY`.
- Generate secrets with `pnpm env:init` on a trusted machine, into a file **outside the repo**, then paste them into Dokploy.
  Validate first: `pnpm deploy:check-env /path/to/prod.env`.
- Domains tab: service `web`, port 3000, HTTPS with letsencrypt, host `$DOMAIN`.
- Deploy. Then run `sudo bash infra/host/attach-traefik.sh` (re-run after every stack recreate).

## 3. Backups
- **Dokploy schedule** on service `postgres`, daily 03:00:
  `pg_dump -U owner -d mastertutor -Fc -f /backups/mastertutor-$(date +%F).dump && find /backups -name '*.dump' -mtime +14 -delete`
- **Dokploy volume backups**, daily, to the user's own S3-compatible destination (D11: no paid service):
  `pgbackups`, `garage-meta`, `garage-data`.
- **Restore:**
  1. stop `web` and `agent`;
  2. copy the dump into `postgres:/tmp`;
  3. `pg_restore -U owner -d mastertutor --clean --if-exists --no-owner /tmp/<file>`;
  4. re-run `migrate`;
  5. start `web` and `agent`.

  Rehearsed by `pnpm deploy:restore-drill`.

## 4. Smoke after deploy
- Sign up the owner.
- Run a real note task with one takeover. The procedure is `tests/e2e/smoke/prod-smoke.spec.ts`, with `E2E_BASE_URL=https://$DOMAIN`.
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `pnpm test:int -- scripts/deploy && pnpm deploy:restore-drill`
Expected: PASS and `RESTORE DRILL OK`.

- [ ] **Step 5: Commit.**

```bash
git add scripts/deploy infra/deploy-runbook.md package.json
git commit -m "feat(deploy): production env checker via env contracts, backup schedule, restore drill, runbook"
```

---

### Task 15: Local production-like stack and smoke run (real model, includes a takeover)

**Files:**
- Create: `compose.local.yml`, `scripts/prod-smoke.sh`, `tests/e2e/smoke/prod-smoke.spec.ts`
- Modify: `package.json` (scripts `compose:local`, `prod:smoke`)

**Interfaces:**
- Consumes:
  - `compose.prod.yml` (T12) and the root `.env` (real secrets; never printed);
  - the e2e image (T1) and the `ui` helpers (T4).
- Produces:
  - **`pnpm compose:local <args>`**, which is `docker compose --env-file .env -f compose.yml -f compose.prod.yml -f compose.local.yml` with `DOMAIN=localhost TRAEFIK_ENTRYPOINT=web TRAEFIK_TLS=false`;
  - **local Traefik** (Docker provider, so it validates the real labels) on `127.0.0.1:18080`;
  - **`pnpm prod:smoke`**, which spends about $1.

- [ ] **Step 1: Write the overlay and the smoke spec.**

`compose.local.yml`:
```yaml
# Production-like local stack: real .env and the real Dokploy labels, read by a local Traefik's
# Docker provider. Never deploys anything. Run: pnpm compose:local up -d --build --wait
services:
  traefik:
    image: traefik:v3.7.13
    command:
      - --entrypoints.web.address=:18080
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --ping=true
      - --log.level=WARN
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    ports:
      - "127.0.0.1:18080:18080"
    healthcheck:
      test: ["CMD", "traefik", "healthcheck", "--ping"]
      interval: 2s
      timeout: 3s
      retries: 30
    networks:
      dokploy-network: {}
      cdp:
        ipv4_address: ${CDP_SUBNET_PREFIX:-172.30.231}.12

  web:
    environment:
      BETTER_AUTH_URL: http://localhost:18080
    labels:
      traefik.enable: "true"
      traefik.docker.network: dokploy-network
      traefik.http.routers.mastertutor-web.rule: "Host(`localhost`)"
      traefik.http.routers.mastertutor-web.entrypoints: web
      traefik.http.routers.mastertutor-web.priority: "1"
      traefik.http.services.mastertutor-web.loadbalancer.server.port: "3000"

  e2e:
    profiles: ["e2e"]
    image: mastertutor/e2e:local
    build:
      context: .
      dockerfile: tests/e2e/Dockerfile
    network_mode: "service:traefik"
    environment:
      E2E_BASE_URL: http://localhost:18080
    volumes:
      - ./tests/e2e/smoke:/repo/tests/e2e/smoke:ro
      - ./tests/e2e/.out:/repo/tests/e2e/.out
```
The local Traefik's Docker socket mount exists only in this local overlay.

`tests/e2e/smoke/prod-smoke.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { BASE_URL } from "../support/env.ts";
import { rpcOk } from "../support/rpc.ts";
import { waitForStatus } from "../support/runs.ts";
import { ui } from "../support/ui.ts";

// Spec §16 Phase 9 "done when": a real note is completed, including a takeover. Uses the real model.
const EMAIL = process.env.SMOKE_EMAIL ?? "smoke-owner@local.test";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "local-smoke-password-0123";

test("a real task produces a verified note and survives a takeover", async ({ page, request }) => {
  test.setTimeout(15 * 60_000);
  const headers = { origin: BASE_URL };
  const up = await request.post("/api/auth/sign-up/email", { headers, data: { email: EMAIL, password: PASSWORD, name: "Smoke" }, failOnStatusCode: false });
  if (!up.ok()) expect((await request.post("/api/auth/sign-in/email", { headers, data: { email: EMAIL, password: PASSWORD } })).ok()).toBe(true);
  await page.context().addCookies((await request.storageState()).cookies);

  const run = await rpcOk<{ id: string }>(request, "runs/create", {
    goal: "Open https://en.wikipedia.org/wiki/Ada_Lovelace and capture the article, with its images, as a note.",
    allowedOrigins: ["https://en.wikipedia.org", "https://upload.wikimedia.org"],
    budget: { maxSteps: 30, maxUsd: 1, maxActiveMinutes: 10 },
    approvalMode: "ask",
  });
  await waitForStatus(request, run.id, ["running"], 120_000);
  await page.goto(`/runs/${run.id}`);
  await expect.poll(() => ui.liveFrame(page).locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 60_000 }).toBe(1280);

  const box = (await ui.livePreview(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(ui.controlBanner(page)).toBeVisible({ timeout: 2_000 });
  await page.mouse.wheel(0, 600);
  await ui.handBack(page).click();
  await expect(ui.controlBanner(page)).toBeHidden({ timeout: 2_000 });

  const detail = await waitForStatus(request, run.id, ["completed", "failed", "cancelled", "waiting"], 12 * 60_000);
  expect(detail.status).toBe("completed");
  expect(detail.noteId).not.toBeNull();
  const note = await rpcOk<{ note: { fidelity: string }; blocks: unknown[] }>(request, "notes/get", { noteId: detail.noteId });
  expect(["verified", "partial"]).toContain(note.note.fidelity);
  expect(note.blocks.length).toBeGreaterThanOrEqual(10);
});
```

`scripts/prod-smoke.sh`:
```bash
#!/usr/bin/env bash
# Local production-like smoke (spec §16 Phase 9). It:
#   - uses the real .env (real OpenAI key, about $1);
#   - boots compose.yml + compose.prod.yml + compose.local.yml;
#   - runs the smoke spec.
# Never prints .env. Usage: bash scripts/prod-smoke.sh   (KEEP_STACK=1 keeps it up)
set -euo pipefail
cd "$(dirname "$0")/.."
export DOMAIN=localhost TRAEFIK_ENTRYPOINT=web TRAEFIK_TLS=false
DC=(docker compose --env-file .env -f compose.yml -f compose.prod.yml -f compose.local.yml)
trap '[[ "${KEEP_STACK:-0}" == "1" ]] || "${DC[@]}" --profile e2e down --remove-orphans >/dev/null 2>&1 || true' EXIT
docker network inspect dokploy-network >/dev/null 2>&1 || docker network create dokploy-network >/dev/null
mkdir -p tests/e2e/.out && chmod 777 tests/e2e/.out
"${DC[@]}" up -d --build --wait --wait-timeout 600
"${DC[@]}" --profile e2e run --rm e2e pnpm exec playwright test --project=prod-smoke
echo "PROD SMOKE OK"
```
The `down` deliberately keeps volumes (no `-v`). The local production-like data persists across runs and is reused by the Phase 10 benchmarks.

Root scripts:
- `"compose:local": "DOMAIN=localhost TRAEFIK_ENTRYPOINT=web TRAEFIK_TLS=false docker compose --env-file .env -f compose.yml -f compose.prod.yml -f compose.local.yml"`;
- `"prod:smoke": "bash scripts/prod-smoke.sh"`.

Make sure `PUBLIC_IP=127.0.0.1` in `.env`. That is `env:init`'s default. Check it with `grep -c '^PUBLIC_IP=127.0.0.1$' .env`, which prints a count, not a value.

- [ ] **Step 2: Run the smoke.**

Run: `pnpm prod:smoke`
Expected: `PROD SMOKE OK`. Real spend is ≤ $1, capped by the run budget.

If it fails, fix test-first in the owning package, the same as Task 4 Step 4.

- [ ] **Step 3: Reclaim disk and commit.**

Run: `docker builder prune -f && docker image prune -f`

```bash
git add compose.local.yml scripts/prod-smoke.sh tests/e2e/smoke package.json
git commit -m "feat(deploy): production-like local stack validating Dokploy labels, real-model smoke with takeover"
```

**Phase 9 exit:**
- `pnpm prod:smoke` passes;
- `pnpm deploy:restore-drill` passes;
- `pnpm deploy:check-env` and the runbook are ready;
- nothing is deployed.

---

# Phase 10: Benchmark suite

### Task 16: Contract additions — tool profiles, focused credential target, element boxes, takeovers

**Files:**
- Modify: `packages/contracts/src/{enums,tools}.ts`, `packages/contracts/src/api/dto.ts`, `packages/contracts/src/{tools,api/dto}.test.ts`
- Modify: `packages/db/src/schema/{enums,runs,benchmarks}.ts`
- Create: `packages/db/migrations/0003_tool_profiles.sql` (generated), `packages/db/src/tool-profiles.int.test.ts`
- Modify: S3 `createRun` and every `RunSummary`, `BenchmarkView` and `BenchmarkRunView` producer, as the compiler flags them

**Interfaces:**
- Consumes: Phase 0 Tasks 1, 3, 6, 7 and 8.
- Produces:
  - **Tool profiles (enums.ts):** `TOOL_PROFILES = ["browser_use","computer_use"]`, `ToolProfile`.
  - **Tools (tools.ts):**
    - `TOOL_PROFILE_TOOLS: {browser_use: TOOL_NAMES; computer_use: ["computer","fill_credential","use_passkey"]}`;
    - `isToolInProfile(profile: ToolProfile, tool: ToolName): boolean`;
    - `FOCUSED_TARGET = "focused"`;
    - `CredentialTarget` (a string matching `^(?:e[0-9]{1,6}|focused)$`);
    - `FillCredentialArgs.target: CredentialTarget`;
    - `CREDENTIAL_ERROR_CODES` gains `"no_focused_field"`;
    - `ReadPageElement.box: BBox | null` (viewport CSS px, null when off-screen).
  - **DTOs:**
    - `CreateRunInput.toolProfile` (default `"browser_use"`) and `RunSummary.toolProfile`;
    - `CreateBenchmarkInput.toolProfile` (default `"browser_use"`) and `BenchmarkView.toolProfile`;
    - `BenchmarkRunView.takeovers: number`.
  - **DB:**
    - enum `tool_profile`;
    - `runs.tool_profile` and `benchmarks.tool_profile` (not null, default `'browser_use'`);
    - `benchmark_runs.takeovers int not null default 0`.

**Why this is the minimal addition:**
- **Tool profile.** A benchmark track must change which tools the model receives. That is a per-run fact the agent reads, so it belongs on `runs` and is set through `CreateRunInput`. `browser_use` is the existing full set, so normal product runs are unchanged.
- **`"focused"` target.** Without `read_page` there are no element refs, so a pixel-only run could never use `fill_credential`, and secrets must never be typed by the model (§9). Click-to-focus followed by `focused` keeps every §9 check, because they run on the resolved element.
- **`box`.** "DOM-assisted actions" need coordinates for `read_page` elements, since `computer` acts in pixels.
- **`takeovers`.** It is a required benchmark metric.

- [ ] **Step 1: Write the failing tests.**

Append to `packages/contracts/src/tools.test.ts`:
```ts
import { FillCredentialArgs, isToolInProfile, ReadPageElement, TOOL_PROFILE_TOOLS } from "./tools.ts";

describe("tool profiles", () => {
  it("browser_use is the full product tool list", () => {
    expect(TOOL_PROFILE_TOOLS.browser_use).toEqual(TOOL_NAMES);
  });
  it("computer_use is pixels plus vault-only credential tools", () => {
    expect(TOOL_PROFILE_TOOLS.computer_use).toEqual(["computer", "fill_credential", "use_passkey"]);
    expect(isToolInProfile("computer_use", "read_page")).toBe(false);
    expect(isToolInProfile("computer_use", "capture")).toBe(false);
  });
});

describe("fill_credential target", () => {
  it.each(["e1", "e123456", "focused"])("accepts %s", (target) => {
    expect(FillCredentialArgs.safeParse({ alias: "zz", field: "password", target }).success).toBe(true);
  });
  it.each(["Focused", "body", "e", "e1234567", "#password"])("rejects %s", (target) => {
    expect(FillCredentialArgs.safeParse({ alias: "zz", field: "password", target }).success).toBe(false);
  });
});

describe("read_page element box", () => {
  it("carries a viewport box or null", () => {
    const base = { ref: "e1", tag: "button", role: "button", name: "Sign in", attrs: {} };
    expect(ReadPageElement.safeParse({ ...base, box: { x: 10, y: 20, width: 100, height: 44 } }).success).toBe(true);
    expect(ReadPageElement.safeParse({ ...base, box: null }).success).toBe(true);
    expect(ReadPageElement.safeParse(base).success).toBe(false);
  });
});
```

Append to `packages/contracts/src/api/dto.test.ts`:
```ts
describe("tool profile and takeovers", () => {
  it("defaults runs and benchmarks to browser_use", () => {
    expect(CreateRunInput.parse({ goal: "g", allowedOrigins: ["example.com"] }).toolProfile).toBe("browser_use");
    expect(
      CreateBenchmarkInput.parse({ name: "n", task: "t", allowedOrigins: ["example.com"], successCriteria: "s" }).toolProfile,
    ).toBe("browser_use");
  });
  it("rejects unknown profiles", () => {
    expect(CreateRunInput.safeParse({ goal: "g", allowedOrigins: ["example.com"], toolProfile: "exec" }).success).toBe(false);
  });
});
```
Add `takeovers: 0` and `toolProfile: "browser_use"` to every existing `BenchmarkRunView`, `BenchmarkView` and `RunSummary` fixture in that file.

`packages/db/src/tool-profiles.int.test.ts`:
```ts
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;
beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await db?.stop();
});

describe("0003 tool profiles", () => {
  it("adds tool_profile with a browser_use default and takeovers with 0", async () => {
    const rows = await owner<{ table_name: string; column_name: string; column_default: string }[]>`
      select table_name, column_name, column_default from information_schema.columns
      where (table_name, column_name) in (('runs','tool_profile'),('benchmarks','tool_profile'),('benchmark_runs','takeovers'))
      order by table_name, column_name`;
    expect(rows.map((r) => `${r.table_name}.${r.column_name}=${r.column_default}`)).toEqual([
      "benchmark_runs.takeovers=0",
      "benchmarks.tool_profile='browser_use'::tool_profile",
      "runs.tool_profile='browser_use'::tool_profile",
    ]);
  });
  it("still has 27 tables", async () => {
    const [row] = await owner`select count(*)::int as n from pg_tables where schemaname = 'public'`;
    expect(row?.n).toBe(27);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test -- packages/contracts && pnpm test:int -- packages/db/src/tool-profiles`
Expected: FAIL.

- [ ] **Step 3: Implement the contracts.**

`packages/contracts/src/enums.ts`, appended:
```ts
/** Per-run tool set (benchmark tracks). browser_use is the full product set and the default. */
export const TOOL_PROFILES = ["browser_use", "computer_use"] as const;
export const ToolProfile = z.enum(TOOL_PROFILES);
export type ToolProfile = z.infer<typeof ToolProfile>;
```

`packages/contracts/src/tools.ts` changes:
1. Import `BBox` from `./note.ts` and `ToolProfile` from `./enums.ts`.
2. Add `"no_focused_field"` to the end of `CREDENTIAL_ERROR_CODES`.
3. Add the target schema:
   ```ts
   export const FOCUSED_TARGET = "focused";
   /** A read_page element ref, or "focused": the element with keyboard focus (pixel-only runs). */
   export const CredentialTarget = z
     .string()
     .regex(/^(?:e[0-9]{1,6}|focused)$/, "Expected an element ref like e12, or focused");
   ```
   and set `FillCredentialArgs.target` to `CredentialTarget`.
4. In `ReadPageElement`, add `box: BBox.nullable()` as the last field.
5. Append:
   ```ts
   /** Tools the model receives per profile. computer_use: screenshots + computer, with vault-only credential tools. */
   export const TOOL_PROFILE_TOOLS = {
     browser_use: TOOL_NAMES,
     computer_use: ["computer", "fill_credential", "use_passkey"],
   } as const satisfies Record<ToolProfile, readonly ToolName[]>;

   export function isToolInProfile(profile: ToolProfile, tool: ToolName): boolean {
     return (TOOL_PROFILE_TOOLS[profile] as readonly ToolName[]).includes(tool);
   }
   ```

`packages/contracts/src/api/dto.ts`: import `ToolProfile`, then add:
- to `CreateRunInput`: `toolProfile: ToolProfile.default("browser_use"),`;
- to `RunSummary`: `toolProfile: ToolProfile,`;
- to `BenchmarkView`: `toolProfile: ToolProfile,`;
- to `CreateBenchmarkInput`: `toolProfile: ToolProfile.default("browser_use"),`;
- to `BenchmarkRunView`: `takeovers: Count,`.

- [ ] **Step 4: Implement the DB.**

`packages/db/src/schema/enums.ts`: `export const toolProfileEnum = pgEnum("tool_profile", TOOL_PROFILES);`, importing `TOOL_PROFILES`.

Add the columns:
- `runs`: `toolProfile: toolProfileEnum("tool_profile").notNull().default("browser_use"),` after `approvalMode`;
- `benchmarks`: the same line after `approvalMode`;
- `benchmarkRuns`: `takeovers: integer("takeovers").notNull().default(0),` after `outputTokens`.

Run: `pnpm --filter @mastertutor/db exec drizzle-kit generate --name=tool_profiles`
Expected: `migrations/0003_tool_profiles.sql` with `CREATE TYPE "public"."tool_profile"` and three `ALTER TABLE … ADD COLUMN`. No other changes. If drizzle-kit adds anything else, the schema drifted; stop and fix that first.

- [ ] **Step 5: Fix the compiler-flagged producers.**

Run: `pnpm typecheck`
Each error is a producer that is missing `toolProfile` or `takeovers`. Fix them:
- S3 `createRun` writes `toolProfile: input.toolProfile` to `runs` and returns it;
- run list and get mappers read `row.toolProfile`;
- `BenchmarkRunView` mappers are written in Task 18. Until then, any existing stub returns `takeovers: 0`.

`decideByPolicy` is unchanged.

- [ ] **Step 6: Run everything to verify it passes.**

Run: `pnpm test && pnpm test:int -- packages/db && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages apps/web
git commit -m "feat(contracts,db): per-run tool profiles, focused credential target, read_page element boxes, benchmark takeovers"
```

---

### Task 17: The agent honours the tool profile, the focused target and element boxes

**Files:**
- Create: `apps/agent/src/tools/{profile.ts,profile.test.ts,read-page-box.ts,read-page-box.test.ts}`, `apps/agent/src/vault/{focused-target.ts,focused-target.int.test.ts}`
- Modify (S11): `apps/agent/src/tools/registry.ts`, `apps/agent/src/tools/execute.ts`, `apps/agent/src/loop/observe.ts`, `apps/agent/src/tools/read-page.ts`, `apps/agent/src/vault/fill.ts`

**Interfaces:**
- Consumes: `isToolInProfile`, `ToolProfile`, `FOCUSED_TARGET`, `BBox`, `VIEWPORT`, the run row's `toolProfile` and S11.
  - Seam check: `grep -n "tools\b\|function_call\|computer" apps/agent/src/tools/registry.ts apps/agent/src/tools/execute.ts apps/agent/src/loop/observe.ts | head -40`.
- Produces:
  - `ToolNotInProfile` (an Error with `tool` and `profile`);
  - `filterToolsForProfile<T>(tools: readonly T[], nameOf: (t: T) => ToolName, profile: ToolProfile): T[]`;
  - `assertToolInProfile(profile, tool): void`;
  - `observesDom(profile): boolean`;
  - `viewportBox(rect: {x; y; width; height}, viewport?: {width; height}): BBox | null`;
  - `resolveFocusedElement(page: Page): Promise<{frame: Frame; element: ElementHandle<Element>} | null>`.

- [ ] **Step 1: Write the failing tests.**

`apps/agent/src/tools/profile.test.ts`:
```ts
import type { ToolName } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { assertToolInProfile, filterToolsForProfile, observesDom, ToolNotInProfile } from "./profile.ts";

const tools = (["computer", "read_page", "capture", "fill_credential", "use_passkey", "video", "annotate"] as ToolName[]).map((name) => ({ name }));

describe("tool profiles in the agent", () => {
  it("sends only pixel and vault tools in computer_use", () => {
    expect(filterToolsForProfile(tools, (t) => t.name, "computer_use").map((t) => t.name)).toEqual([
      "computer",
      "fill_credential",
      "use_passkey",
    ]);
  });
  it("sends everything in browser_use", () => {
    expect(filterToolsForProfile(tools, (t) => t.name, "browser_use")).toHaveLength(7);
  });
  it("refuses a hallucinated out-of-profile call in code, not by prompt", () => {
    expect(() => assertToolInProfile("computer_use", "read_page")).toThrow(ToolNotInProfile);
    expect(() => assertToolInProfile("browser_use", "read_page")).not.toThrow();
  });
  it("observes the DOM only in browser_use", () => {
    expect(observesDom("computer_use")).toBe(false);
    expect(observesDom("browser_use")).toBe(true);
  });
});
```

`apps/agent/src/tools/read-page-box.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { viewportBox } from "./read-page-box.ts";

describe("viewportBox", () => {
  it("rounds an on-screen box", () => {
    expect(viewportBox({ x: 10.4, y: 20.6, width: 100.2, height: 44 })).toEqual({ x: 10, y: 21, width: 100, height: 44 });
  });
  it("clips to the 1280x800 viewport", () => {
    expect(viewportBox({ x: 1200, y: 780, width: 200, height: 100 })).toEqual({ x: 1200, y: 780, width: 80, height: 20 });
  });
  it("is null off-screen or without size", () => {
    expect(viewportBox({ x: 0, y: 900, width: 100, height: 40 })).toBeNull();
    expect(viewportBox({ x: 10, y: 10, width: 0, height: 40 })).toBeNull();
  });
});
```

`apps/agent/src/vault/focused-target.int.test.ts`. It uses B1's Testcontainers slot helper, or a local `chromium.launch()` if B1 exposes one for tests. The seam is B1's test browser helper:
```ts
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFocusedElement } from "./focused-target.ts";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => browser?.close());

describe("resolveFocusedElement", () => {
  it("returns the focused input, through an open shadow root", async () => {
    const page = await browser.newPage();
    await page.setContent(`<div id="host"></div><script>
      const root = document.getElementById("host").attachShadow({ mode: "open" });
      root.innerHTML = '<input id="pw" type="password">';
    </script>`);
    await page.evaluate(() => (document.getElementById("host")!.shadowRoot!.getElementById("pw") as HTMLInputElement).focus());
    const found = await resolveFocusedElement(page);
    expect(await found?.element.evaluate((el) => (el as HTMLInputElement).type)).toBe("password");
    await page.close();
  });

  it("descends into a same-origin iframe and returns that frame", async () => {
    const page = await browser.newPage();
    await page.setContent(`<iframe srcdoc="<input id=u autofocus>"></iframe>`);
    await page.frames()[1]!.waitForSelector("#u");
    await page.frames()[1]!.focus("#u");
    const found = await resolveFocusedElement(page);
    expect(found?.frame).toBe(page.frames()[1]);
    await page.close();
  });

  it("returns null when nothing is focused", async () => {
    const page = await browser.newPage();
    await page.setContent(`<p>nothing</p>`);
    expect(await resolveFocusedElement(page)).toBeNull();
    await page.close();
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test -- apps/agent/src/tools && pnpm test:int -- apps/agent/src/vault/focused-target`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/agent/src/tools/profile.ts`:
```ts
import { isToolInProfile, type ToolName, type ToolProfile } from "@mastertutor/contracts";

export class ToolNotInProfile extends Error {
  readonly tool: ToolName;
  readonly profile: ToolProfile;
  constructor(tool: ToolName, profile: ToolProfile) {
    super(`Tool ${tool} is not available in the ${profile} profile`);
    this.name = "ToolNotInProfile";
    this.tool = tool;
    this.profile = profile;
  }
}

export function filterToolsForProfile<T>(tools: readonly T[], nameOf: (tool: T) => ToolName, profile: ToolProfile): T[] {
  return tools.filter((tool) => isToolInProfile(profile, nameOf(tool)));
}

export function assertToolInProfile(profile: ToolProfile, tool: ToolName): void {
  if (!isToolInProfile(profile, tool)) throw new ToolNotInProfile(tool, profile);
}

/** computer_use observes with masked screenshots only; no DOM text reaches the model. */
export function observesDom(profile: ToolProfile): boolean {
  return profile === "browser_use";
}
```

`apps/agent/src/tools/read-page-box.ts`:
```ts
import { VIEWPORT, type BBox } from "@mastertutor/contracts";

/** Viewport box in CSS px (DPR 1, so equal to screenshot pixels); null when off-screen or empty. */
export function viewportBox(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number } = VIEWPORT,
): BBox | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width);
  const bottom = Math.min(viewport.height, rect.y + rect.height);
  if (right <= left || bottom <= top) return null;
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}
```

`apps/agent/src/vault/focused-target.ts`:
```ts
import type { ElementHandle, Frame, Page } from "playwright-core";

const MAX_FRAME_DEPTH = 8;

/**
 * The element with keyboard focus, descending into open shadow roots and child frames. It is
 * used for fill_credential {target: "focused"}. The caller still runs every §9 check (origin,
 * frame origin, field type) on the result, so a cross-origin frame is refused there.
 */
export async function resolveFocusedElement(page: Page): Promise<{ frame: Frame; element: ElementHandle<Element> } | null> {
  let frame: Frame = page.mainFrame();
  for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
    const handle = await frame.evaluateHandle(() => {
      let el: Element | null = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return el;
    });
    const element = handle.asElement() as ElementHandle<Element> | null;
    if (!element) {
      await handle.dispose();
      return null;
    }
    const tag = await element.evaluate((el) => el.tagName);
    if (tag === "IFRAME" || tag === "FRAME") {
      const child = await element.contentFrame();
      await element.dispose();
      if (!child) return null;
      frame = child;
      continue;
    }
    if (tag === "BODY" || tag === "HTML") {
      await element.dispose();
      return null;
    }
    return { frame, element };
  }
  return null;
}
```

- [ ] **Step 4: Wire it into the agent (S11).** Each change is small, and each gets one assertion in B1's or B3's existing agent-behaviour suite:
  1. **`registry.ts`:** where the Responses `tools` array is built, wrap it in `filterToolsForProfile(tools, (t) => (t.type === "computer" ? "computer" : t.name), run.toolProfile)`.
     - *Test:* in B1's scenario harness, a `computer_use` run's first recorded mock request has exactly 3 tools.
  2. **`execute.ts`:** before dispatching any call, `assertToolInProfile(run.toolProfile, name)`. Catch `ToolNotInProfile` and answer the model with the function output `{"error":"tool_not_available"}` (the run continues, and the step is recorded `done` with that result).
     - *Test:* a scripted `read_page` call in a `computer_use` run yields that output and no DOM access.
  3. **`observe.ts`:** skip the automatic `read_page` and the DOM-hash text when `!observesDom(run.toolProfile)`. Loop detection keeps using URL plus DOM hash internally; that is never sent to the model.
  4. **`read-page.ts`:** in the in-page element serializer, return `getBoundingClientRect()` as `{x, y, width, height}`. In Node, set `box: viewportBox(rect)`.
     - *Test:* the B1 `read_page` fixture test now asserts that a visible button has a non-null box, and that a below-the-fold element has `box: null`.
  5. **`fill.ts` (B3):** when `args.target === FOCUSED_TARGET`, resolve with `resolveFocusedElement(page)`. If the result is null, return `{error: "no_focused_field"}`. Otherwise run the **same** origin, frame and field-type checks on `{frame, element}` as for a ref target, then fill.
     - *Test:* B3's field-type suite gains `focused` on a text input → `field_type_mismatch`, and `focused` on the password input → `ok`.

- [ ] **Step 5: Run everything to verify it passes.**

Run: `pnpm test && pnpm test:int -- apps/agent && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/agent
git commit -m "feat(agent): per-run tool profiles enforced in code, focused credential target, read_page element boxes"
```

---

### Task 18: `benchmarks` service in `web`

**Files:**
- Create: `apps/web/lib/server/benchmarks.ts`, `apps/web/lib/server/benchmarks.int.test.ts`, `apps/web/lib/server/rpc/benchmarks-errors.ts`
- Modify: S2 `apps/web/lib/server/rpc/router.ts`; `tests/e2e/specs/api-conformance.spec.ts` (remove the `benchmarks/*` `fixme`)

**Interfaces:**
- Consumes:
  - `benchmarks`, `benchmarkRuns`, `runs`, `runEvents` and `Database`;
  - the DTOs and `EMPTY_USAGE`;
  - S2 and S3.
  - Seam check: `grep -n "implement(apiContract)\|context\." apps/web/lib/server/rpc/router.ts | head`.
- Produces:
  - **Errors:** `BenchmarkNotFound`, `BenchmarkNameTaken`, `BenchmarkRunNotFinished`.
  - **`type CreateRunFn = (input: CreateRunInput) => Promise<RunSummary>`.**
  - **Functions:**
    - `createBenchmark(db, workspaceId, input: CreateBenchmarkInput): Promise<BenchmarkView>`;
    - `listBenchmarks(db, workspaceId): Promise<BenchmarkView[]>`;
    - `startBenchmark(db, workspaceId, benchmarkId, createRun: CreateRunFn): Promise<StartBenchmarkResult>`;
    - `listBenchmarkRuns(db, workspaceId, input: ListBenchmarkRunsInput): Promise<BenchmarkRunView[]>`. Pending rows show **live** metrics from `runs.usage` and `run_events`;
    - `gradeBenchmarkRun(db, workspaceId, gradedBy: string, input: GradeBenchmarkRunInput): Promise<BenchmarkRunView>`. It snapshots the metrics and refuses non-terminal runs;
    - `mapBenchmarkErrors<T>(fn: () => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing integration test.**

`apps/web/lib/server/benchmarks.int.test.ts`:
```ts
import { DEFAULT_BUDGET, type RunSummary } from "@mastertutor/contracts";
import { createDb, ensureWorkspaceMember, runs, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BenchmarkNameTaken,
  BenchmarkNotFound,
  BenchmarkRunNotFinished,
  createBenchmark,
  gradeBenchmarkRun,
  listBenchmarkRuns,
  listBenchmarks,
  startBenchmark,
  type CreateRunFn,
} from "./benchmarks.ts";

let tdb: TestDatabase;
let web: DbHandle;
let owner: postgres.Sql;
let workspaceId: string;
let otherWorkspaceId: string;

const input = (name: string) => ({
  name,
  task: "Complete the fixture activities",
  allowedOrigins: ["http://bench-fixtures:8080"],
  approvalMode: "auto_within_allowlist" as const,
  toolProfile: "computer_use" as const,
  budget: DEFAULT_BUDGET,
  successCriteria: "3 of 3 completed",
});

const fakeCreateRun = (ws: string): CreateRunFn => async (run) => {
  const [row] = await web.db
    .insert(runs)
    .values({ workspaceId: ws, goal: run.goal, allowedOrigins: run.allowedOrigins, approvalMode: run.approvalMode, toolProfile: run.toolProfile })
    .returning({ id: runs.id });
  return { id: row!.id } as RunSummary;
};

beforeAll(async () => {
  tdb = await startTestDatabase();
  web = createDb(tdb.webUrl, { max: 2 });
  owner = postgres(tdb.ownerUrl, { max: 2, onnotice: () => undefined });
  await owner`insert into "user" (id, name, email) values ('u1','U','u1@example.test'), ('u2','U','u2@example.test')`;
  workspaceId = (await ensureWorkspaceMember(web.db, "u1")).workspaceId;
  const [ws] = await owner`insert into workspaces (name) values ('other') returning id`;
  otherWorkspaceId = ws!.id as string;
});
afterAll(async () => {
  await owner?.end();
  await web?.close();
  await tdb?.stop();
});

describe("benchmarks service", () => {
  it("creates, lists and refuses duplicate names", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("fixture@computer_use#a1"));
    expect(view).toMatchObject({ name: "fixture@computer_use#a1", toolProfile: "computer_use", approvalMode: "auto_within_allowlist" });
    await expect(createBenchmark(web.db, workspaceId, input("fixture@computer_use#a1"))).rejects.toBeInstanceOf(BenchmarkNameTaken);
    expect((await listBenchmarks(web.db, workspaceId)).map((b) => b.name)).toContain("fixture@computer_use#a1");
    expect(await listBenchmarks(web.db, otherWorkspaceId)).toEqual([]);
  });

  it("starts a run with the benchmark's mode and profile, scoped to the workspace", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("start-test"));
    await expect(startBenchmark(web.db, otherWorkspaceId, view.id, fakeCreateRun(otherWorkspaceId))).rejects.toBeInstanceOf(BenchmarkNotFound);
    const started = await startBenchmark(web.db, workspaceId, view.id, fakeCreateRun(workspaceId));
    const [run] = await owner`select approval_mode, tool_profile from runs where id = ${started.runId}`;
    expect(run).toMatchObject({ approval_mode: "auto_within_allowlist", tool_profile: "computer_use" });
  });

  it("shows live metrics while pending, refuses early grading, then snapshots on grade", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("grade-test"));
    const { benchmarkRunId, runId } = await startBenchmark(web.db, workspaceId, view.id, fakeCreateRun(workspaceId));
    await owner`update runs set usage = ${owner.json({ steps: 12, inputTokens: 900, cachedInputTokens: 0, outputTokens: 80, usd: 0.42, activeMs: 9000 })} where id = ${runId}`;
    await owner`insert into run_events (run_id, type, payload) values
      (${runId}, 'control', ${owner.json({ type: "control", holder: "user" })}),
      (${runId}, 'control', ${owner.json({ type: "control", holder: "agent" })})`;

    const [pending] = await listBenchmarkRuns(web.db, workspaceId, { benchmarkId: view.id, limit: 10 });
    expect(pending).toMatchObject({ outcome: "pending", steps: 12, usd: 0.42, takeovers: 1, finishedAt: null });

    await expect(
      gradeBenchmarkRun(web.db, workspaceId, "harness", { benchmarkRunId, outcome: "failed", failureNotes: null }),
    ).rejects.toBeInstanceOf(BenchmarkRunNotFinished);

    await owner`update runs set status = 'completed', finished_at = now() where id = ${runId}`;
    const graded = await gradeBenchmarkRun(web.db, workspaceId, "harness", { benchmarkRunId, outcome: "partial", failureNotes: "class: action" });
    expect(graded).toMatchObject({ outcome: "partial", steps: 12, takeovers: 1, gradedBy: "harness", failureNotes: "class: action" });
    expect(graded.durationMs).toBeGreaterThanOrEqual(0);

    await owner`update runs set usage = ${owner.json({ steps: 99, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, usd: 9, activeMs: 0 })} where id = ${runId}`;
    const [after] = await listBenchmarkRuns(web.db, workspaceId, { benchmarkId: view.id, limit: 10 });
    expect(after).toMatchObject({ steps: 12, usd: 0.42 });
  });

  it("does not grade another workspace's run", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("cross-ws"));
    const { benchmarkRunId } = await startBenchmark(web.db, workspaceId, view.id, fakeCreateRun(workspaceId));
    await expect(
      gradeBenchmarkRun(web.db, otherWorkspaceId, "x", { benchmarkRunId, outcome: "failed", failureNotes: null }),
    ).rejects.toBeInstanceOf(BenchmarkNotFound);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test:int -- apps/web/lib/server/benchmarks`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement.**

`apps/web/lib/server/benchmarks.ts`:
```ts
import {
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  TERMINAL_RUN_STATUSES,
  type BenchmarkRunView,
  type BenchmarkView,
  type CreateBenchmarkInput,
  type CreateRunInput,
  type GradeBenchmarkRunInput,
  type ListBenchmarkRunsInput,
  type RunSummary,
  type StartBenchmarkResult,
} from "@mastertutor/contracts";
import { benchmarkRuns, benchmarks, runs, type Database } from "@mastertutor/db";
import { and, desc, eq, sql } from "drizzle-orm";

export class BenchmarkNotFound extends Error {
  constructor() {
    super("Benchmark not found");
    this.name = "BenchmarkNotFound";
  }
}
export class BenchmarkNameTaken extends Error {
  constructor() {
    super("A benchmark with this name already exists");
    this.name = "BenchmarkNameTaken";
  }
}
export class BenchmarkRunNotFinished extends Error {
  constructor() {
    super("The run has not finished; grade it after it completes, fails or is cancelled");
    this.name = "BenchmarkRunNotFinished";
  }
}

export type CreateRunFn = (input: CreateRunInput) => Promise<RunSummary>;

const iso = (date: Date | null) => (date === null ? null : date.toISOString());

function toView(row: typeof benchmarks.$inferSelect): BenchmarkView {
  return {
    id: row.id,
    name: row.name,
    task: row.task,
    allowedOrigins: row.allowedOrigins,
    approvalMode: row.approvalMode,
    toolProfile: row.toolProfile,
    budget: row.budget,
    successCriteria: row.successCriteria,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createBenchmark(db: Database, workspaceId: string, input: CreateBenchmarkInput): Promise<BenchmarkView> {
  const [row] = await db
    .insert(benchmarks)
    .values({
      workspaceId,
      name: input.name,
      task: input.task,
      allowedOrigins: input.allowedOrigins,
      approvalMode: input.approvalMode,
      toolProfile: input.toolProfile,
      budget: input.budget ?? DEFAULT_BUDGET,
      successCriteria: input.successCriteria,
    })
    .onConflictDoNothing({ target: [benchmarks.workspaceId, benchmarks.name] })
    .returning();
  if (!row) throw new BenchmarkNameTaken();
  return toView(row);
}

export async function listBenchmarks(db: Database, workspaceId: string): Promise<BenchmarkView[]> {
  const rows = await db.select().from(benchmarks).where(eq(benchmarks.workspaceId, workspaceId)).orderBy(desc(benchmarks.createdAt));
  return rows.map(toView);
}

export async function startBenchmark(
  db: Database,
  workspaceId: string,
  benchmarkId: string,
  createRun: CreateRunFn,
): Promise<StartBenchmarkResult> {
  const [benchmark] = await db
    .select()
    .from(benchmarks)
    .where(and(eq(benchmarks.id, benchmarkId), eq(benchmarks.workspaceId, workspaceId)));
  if (!benchmark) throw new BenchmarkNotFound();
  const [attempt] = await db.insert(benchmarkRuns).values({ benchmarkId }).returning({ id: benchmarkRuns.id });
  try {
    const run = await createRun({
      goal: benchmark.task,
      allowedOrigins: benchmark.allowedOrigins,
      budget: benchmark.budget,
      targetFolderId: null,
      approvalMode: benchmark.approvalMode,
      toolProfile: benchmark.toolProfile,
    });
    await db.update(benchmarkRuns).set({ runId: run.id }).where(eq(benchmarkRuns.id, attempt!.id));
    return { benchmarkRunId: attempt!.id, runId: run.id };
  } catch (error) {
    await db
      .update(benchmarkRuns)
      .set({ outcome: "error", failureNotes: "The run could not be created.", finishedAt: new Date() })
      .where(eq(benchmarkRuns.id, attempt!.id));
    throw error;
  }
}

const takeoversOf = sql<number>`(select count(*)::int from run_events e
  where e.run_id = ${benchmarkRuns.runId} and e.payload->>'type' = 'control' and e.payload->>'holder' = 'user')`;

function selectRuns(db: Database) {
  return db
    .select({ attempt: benchmarkRuns, usage: runs.usage, status: runs.status, runFinishedAt: runs.finishedAt, takeovers: takeoversOf })
    .from(benchmarkRuns)
    .innerJoin(benchmarks, eq(benchmarks.id, benchmarkRuns.benchmarkId))
    .leftJoin(runs, eq(runs.id, benchmarkRuns.runId));
}
type JoinedRun = Awaited<ReturnType<ReturnType<typeof selectRuns>["where"]>>[number];

function durationMs(startedAt: Date, finishedAt: Date | null): number | null {
  return finishedAt === null ? null : Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

function toRunView(row: JoinedRun): BenchmarkRunView {
  const a = row.attempt;
  const live = a.outcome === "pending";
  const usage = row.usage ?? EMPTY_USAGE;
  return {
    id: a.id,
    benchmarkId: a.benchmarkId,
    runId: a.runId,
    outcome: a.outcome,
    steps: live ? usage.steps : a.steps,
    usd: live ? usage.usd : a.usd,
    inputTokens: live ? usage.inputTokens : a.inputTokens,
    outputTokens: live ? usage.outputTokens : a.outputTokens,
    durationMs: live ? durationMs(a.startedAt, row.runFinishedAt) : a.durationMs,
    takeovers: live ? row.takeovers : a.takeovers,
    failureNotes: a.failureNotes,
    gradedBy: a.gradedBy,
    startedAt: a.startedAt.toISOString(),
    finishedAt: live ? iso(row.runFinishedAt) : iso(a.finishedAt),
  };
}

export async function listBenchmarkRuns(db: Database, workspaceId: string, input: ListBenchmarkRunsInput): Promise<BenchmarkRunView[]> {
  const rows = await selectRuns(db)
    .where(
      and(
        eq(benchmarks.workspaceId, workspaceId),
        input.benchmarkId === null ? undefined : eq(benchmarkRuns.benchmarkId, input.benchmarkId),
      ),
    )
    .orderBy(desc(benchmarkRuns.startedAt))
    .limit(input.limit);
  return rows.map(toRunView);
}

export async function gradeBenchmarkRun(
  db: Database,
  workspaceId: string,
  gradedBy: string,
  input: GradeBenchmarkRunInput,
): Promise<BenchmarkRunView> {
  return db.transaction(async (tx) => {
    const [row] = await selectRuns(tx as unknown as Database)
      .where(and(eq(benchmarkRuns.id, input.benchmarkRunId), eq(benchmarks.workspaceId, workspaceId)))
      .for("update", { of: benchmarkRuns });
    if (!row) throw new BenchmarkNotFound();
    const terminal = row.status !== null && (TERMINAL_RUN_STATUSES as readonly string[]).includes(row.status);
    if (row.attempt.runId !== null && !terminal) throw new BenchmarkRunNotFinished();
    const metrics = toRunView({ ...row, attempt: { ...row.attempt, outcome: "pending" } });
    const finishedAt = row.runFinishedAt ?? new Date();
    await tx
      .update(benchmarkRuns)
      .set({
        outcome: input.outcome,
        failureNotes: input.failureNotes,
        gradedBy,
        steps: metrics.steps,
        usd: metrics.usd,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        takeovers: metrics.takeovers,
        durationMs: durationMs(row.attempt.startedAt, finishedAt),
        finishedAt,
      })
      .where(eq(benchmarkRuns.id, row.attempt.id));
    const [updated] = await selectRuns(tx as unknown as Database).where(eq(benchmarkRuns.id, row.attempt.id));
    return toRunView(updated!);
  });
}
```
Re-grading a graded row is allowed. It rewrites the outcome and notes, and re-snapshots from the (finished, unchanged) run.

`apps/web/lib/server/rpc/benchmarks-errors.ts`:
```ts
import { ORPCError } from "@orpc/server";
import { BenchmarkNameTaken, BenchmarkNotFound, BenchmarkRunNotFinished } from "../benchmarks.ts";

export async function mapBenchmarkErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BenchmarkNotFound) throw new ORPCError("NOT_FOUND", { message: error.message });
    if (error instanceof BenchmarkNameTaken || error instanceof BenchmarkRunNotFinished) {
      throw new ORPCError("CONFLICT", { message: error.message });
    }
    throw error;
  }
}
```

Mount the procedures in S2's router. Use the real context names:
```ts
benchmarks: {
  list: os.benchmarks.list.handler(async ({ context }) => ({ items: await listBenchmarks(context.db, context.workspaceId) })),
  create: os.benchmarks.create.handler(({ context, input }) =>
    mapBenchmarkErrors(() => createBenchmark(context.db, context.workspaceId, input))),
  start: os.benchmarks.start.handler(({ context, input }) =>
    mapBenchmarkErrors(() => startBenchmark(context.db, context.workspaceId, input.benchmarkId, (run) => createRun(context, run)))),
  runs: os.benchmarks.runs.handler(async ({ context, input }) => ({ items: await listBenchmarkRuns(context.db, context.workspaceId, input) })),
  grade: os.benchmarks.grade.handler(({ context, input }) =>
    mapBenchmarkErrors(() => gradeBenchmarkRun(context.db, context.workspaceId, context.userId, input))),
},
```

- [ ] **Step 4: Run it to verify it passes, then re-enable the conformance probes.**

Remove the `benchmarks/*` `test.fixme` from `api-conformance.spec.ts`.

Run: `pnpm test:int -- apps/web/lib/server/benchmarks && pnpm typecheck && pnpm e2e -- specs/api-conformance.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web tests/e2e/specs/api-conformance.spec.ts
git commit -m "feat(web): benchmarks service (live pending metrics, takeover count, grade-after-finish snapshots)"
```

---

### Task 19: Harness core — config, app client, SSE reader, live watcher

**Files:**
- Create: `tests/bench/{package.json,tsconfig.json}`, `tests/bench/src/{types,config,app-client,sse,watch}.ts`, `tests/bench/src/{config,sse,watch}.test.ts`
- Modify: `.gitignore` (`.env.bench`, `orchestration/benchmarks/.raw/`)

**Interfaces:**
- Consumes: `apiContract`/`ApiContract`, `RunEventRecord`, `RunStatus`, `WaitReason`, `parseEnv`, S1 and S4.
- Produces:
  - **`types.ts`:** `FAILURE_CLASSES`, `FailureClass`, `SectionSpec`, `Criterion`, `VerifySpec`, `BenchmarkSpec`, `SuiteDefinition`, `StackName = "test" | "test-real" | "local"`.
  - **`config.ts`:**
    - `STACK_COMPOSE: Record<StackName, readonly string[]>`;
    - `BenchEnv` and `readBenchEnv(path?)`, `writeBenchEnv(path, env)` (mode 0600);
    - `assertNoSiteCredentialsInEnv(env: NodeJS.ProcessEnv): void`.
  - **`app-client.ts`:**
    - `authCookie(baseUrl, email, password, mode: "sign-in"|"sign-up"): Promise<string>`;
    - `createApi(baseUrl, cookie): BenchApi`, where `BenchApi = ContractRouterClient<ApiContract>`.
  - **`sse.ts`:**
    - `createSseParser(onMessage: (m: SseMessage) => void): (chunk: string) => void`;
    - `streamRunEvents(options: {baseUrl; cookie; runId; lastEventId: string|null; signal: AbortSignal}): AsyncGenerator<RunEventRecord>`.
  - **`watch.ts`:**
    - `WatchPolicy = {onBudget: "finish_now"|"extend_once"; humanTimeoutMs; stallMs}`;
    - `WatchState`, `WatchCommand`;
    - `initialWatchState(now)`;
    - `onRecord(state, record, now, policy): {state; commands}`;
    - `onTick(state, now, policy): {state; commands}`;
    - `watchRun(deps: WatchDeps, runId, policy): Promise<WatchState>`.

- [ ] **Step 1: Create the package.**

`tests/bench/package.json`:
```json
{
  "name": "@mastertutor/bench",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@mastertutor/contracts": "workspace:*",
    "@orpc/client": "1.15.4",
    "@orpc/contract": "1.15.4",
    "zod": "4.6.5"
  }
}
```
`tests/bench/tsconfig.json`: the same shape as `tests/e2e/tsconfig.json`, with `"lib": ["ES2024"]` and `"include": ["src/**/*.ts"]`.

Root script: `"bench": "node tests/bench/src/cli.ts"`.

Append to `.gitignore`:
```
.env.bench
orchestration/benchmarks/.raw/
```

- [ ] **Step 2: Write the failing tests.**

`tests/bench/src/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assertNoSiteCredentialsInEnv, STACK_COMPOSE } from "./config.ts";

describe("bench config", () => {
  it("refuses site credentials in the environment (D34)", () => {
    expect(() => assertNoSiteCredentialsInEnv({ ZYBOOKS_PASSWORD: "x" })).toThrow(/vault/i);
    expect(() => assertNoSiteCredentialsInEnv({ zybooks_user: "x" })).toThrow();
    expect(() => assertNoSiteCredentialsInEnv({ PATH: "/bin" })).not.toThrow();
  });
  it("uses the compose stacks defined by Phases 7 and 9", () => {
    expect(STACK_COMPOSE.test.join(" ")).toBe("docker compose --env-file .env.test -f compose.yml -f compose.test.yml");
    expect(STACK_COMPOSE["test-real"]).toContain("compose.bench-real.yml");
    expect(STACK_COMPOSE.local).toContain("compose.local.yml");
  });
});
```

`tests/bench/src/sse.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createSseParser, type SseMessage } from "./sse.ts";

describe("createSseParser", () => {
  it("parses id, event and multi-line data across chunk boundaries", () => {
    const got: SseMessage[] = [];
    const feed = createSseParser((m) => got.push(m));
    feed("id: 7\nda");
    feed("ta: {\"a\":\ndata: 1}\n\n: comment\n\nid: 8\nevent: x\ndata: z\n\n");
    expect(got).toEqual([
      { id: "7", event: null, data: '{"a":\n1}' },
      { id: "8", event: "x", data: "z" },
    ]);
  });
  it("handles CRLF line endings", () => {
    const got: SseMessage[] = [];
    createSseParser((m) => got.push(m))("id: 1\r\ndata: q\r\n\r\n");
    expect(got).toEqual([{ id: "1", event: null, data: "q" }]);
  });
});
```

`tests/bench/src/watch.test.ts`:
```ts
import type { RunEvent, RunEventRecord } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { initialWatchState, onRecord, onTick, type WatchPolicy } from "./watch.ts";

const RUN = "33333333-3333-4333-8333-333333333333";
let n = 0;
const rec = (event: RunEvent): RunEventRecord => ({ id: String(++n), runId: RUN, at: "2026-10-05T12:00:00.000Z", event });
const policy: WatchPolicy = { onBudget: "extend_once", humanTimeoutMs: 600_000, stallMs: 600_000 };
const budget = (approvalId: string) =>
  rec({
    type: "approval_requested",
    approvalId,
    request: {
      kind: "budget",
      exceeded: "steps",
      usage: { steps: 1, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, usd: 0, activeMs: 0 },
      budget: { maxSteps: 1, maxUsd: 1, maxActiveMinutes: 1 },
    },
  });

describe("watcher", () => {
  it("extends a budget once, then finishes", () => {
    let s = initialWatchState(0);
    const first = onRecord(s, budget("44444444-4444-4444-8444-444444444441"), 1, policy);
    expect(first.commands).toContainEqual({ type: "decide_budget", approvalId: "44444444-4444-4444-8444-444444444441", choice: "extend" });
    s = first.state;
    const second = onRecord(s, budget("44444444-4444-4444-8444-444444444442"), 2, policy);
    expect(second.commands).toContainEqual({ type: "decide_budget", approvalId: "44444444-4444-4444-8444-444444444442", choice: "finish_now" });
    expect(second.state.budgetHit).toBe(true);
  });

  it("counts takeovers and cancels after the human-wait timeout", () => {
    let s = initialWatchState(0);
    s = onRecord(s, rec({ type: "status", status: "waiting", waitReason: "takeover", reason: "stuck" }), 10, policy).state;
    s = onRecord(s, rec({ type: "control", holder: "user" }), 20, policy).state;
    expect(s.takeovers).toBe(1);
    expect(onTick(s, 10 + 599_000, policy).commands).toEqual([]);
    expect(onTick(s, 10 + 600_001, policy).commands).toContainEqual({ type: "cancel", reason: "human_timeout" });
  });

  it("cancels a stalled running run exactly once", () => {
    let s = initialWatchState(0);
    s = onRecord(s, rec({ type: "status", status: "running", waitReason: null, reason: null }), 0, policy).state;
    const stalled = onTick(s, 600_001, policy);
    expect(stalled.commands).toContainEqual({ type: "cancel", reason: "stall" });
    expect(onTick(stalled.state, 700_000, policy).commands.filter((c) => c.type === "cancel")).toEqual([]);
  });

  it("finishes on a terminal status", () => {
    const s = onRecord(initialWatchState(0), rec({ type: "status", status: "completed", waitReason: null, reason: null }), 5, policy).state;
    expect(s.done).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to verify they fail.**

Run: `pnpm install && pnpm test -- tests/bench`
Expected: FAIL.

- [ ] **Step 4: Implement.**

`tests/bench/src/types.ts`:
```ts
import type { Budget, ToolProfile } from "@mastertutor/contracts";
import { z } from "zod";

export const FAILURE_CLASSES = ["perception", "action", "navigation", "auth", "policy", "budget"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];
export type StackName = "test" | "test-real" | "local";

export const SectionSpec = z.object({
  reading: z.number().int().min(1).max(5),
  title: z.string().min(1).max(200),
  url: z.url(),
});
export type SectionSpec = z.infer<typeof SectionSpec>;

export type Criterion =
  | { kind: "page_text"; url: string; mustMatch: readonly string[] }
  | {
      kind: "sections_complete";
      sections: readonly SectionSpec[];
      activityPattern: string;
      completedPattern: string;
      requireInteraction: boolean;
    };

export interface VerifySpec {
  task: string;
  budget: Budget;
}

export interface BenchmarkSpec {
  key: string;
  task: string;
  allowedOrigins: readonly string[];
  budget: Budget;
  toolProfile: ToolProfile;
  criterion: Criterion;
  verify: VerifySpec;
  /** D32: zyBooks readings are already complete, so the page must show completion before the run starts. */
  baselineMustPass: boolean;
  requiredVaultItem: { alias: string; origin: string; fields: readonly string[] } | null;
  /** Fixture state reset command, run inside the stack before each attempt. */
  reset: readonly string[] | null;
  mockScenarios: { main: string; verify: string } | null;
}

export interface SuiteDefinition {
  id: string;
  benchmarks: readonly BenchmarkSpec[];
}
```

`tests/bench/src/config.ts`:
```ts
import { parseEnv } from "@mastertutor/contracts";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { StackName } from "./types.ts";

export const STACK_COMPOSE: Record<StackName, readonly string[]> = {
  test: ["docker", "compose", "--env-file", ".env.test", "-f", "compose.yml", "-f", "compose.test.yml"],
  "test-real": ["docker", "compose", "--env-file", ".env.test", "-f", "compose.yml", "-f", "compose.test.yml", "-f", "compose.bench-real.yml"],
  local: ["docker", "compose", "--env-file", ".env", "-f", "compose.yml", "-f", "compose.prod.yml", "-f", "compose.local.yml"],
};

export const BenchEnv = z.object({
  BENCH_STACK: z.enum(["test", "test-real", "local"]),
  BENCH_BASE_URL: z.url(),
  BENCH_EMAIL: z.email(),
  BENCH_PASSWORD: z.string().min(16),
});
export type BenchEnv = z.infer<typeof BenchEnv>;

export function readBenchEnv(path = ".env.bench"): BenchEnv {
  const map: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) map[match[1]!] = match[2]!;
  }
  return parseEnv(BenchEnv, map);
}

export function writeBenchEnv(path: string, env: BenchEnv): void {
  writeFileSync(path, `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n")}\n`, { mode: 0o600 });
}

/** D34: site credentials live only in the vault. The harness refuses to run if any are in its env. */
export function assertNoSiteCredentialsInEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): void {
  const offending = Object.keys(env).filter((key) => /zybook/i.test(key));
  if (offending.length > 0) {
    throw new Error(
      `Refusing to run: ${offending.join(", ")} looks like a site credential. Enter credentials only in the Vault UI.`,
    );
  }
}
```

`tests/bench/src/app-client.ts`:
```ts
import type { ApiContract } from "@mastertutor/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";

export type BenchApi = ContractRouterClient<ApiContract>;

export async function authCookie(baseUrl: string, email: string, password: string, mode: "sign-in" | "sign-up"): Promise<string> {
  const body = mode === "sign-up" ? { email, password, name: "Benchmark" } : { email, password };
  const response = await fetch(`${baseUrl}/api/auth/${mode}/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`${mode} failed with HTTP ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (cookie === "") throw new Error(`${mode} returned no session cookie`);
  return cookie;
}

export function createApi(baseUrl: string, cookie: string): BenchApi {
  const link = new RPCLink({ url: `${baseUrl}/api/rpc`, headers: () => ({ cookie, origin: baseUrl }) });
  return createORPCClient(link);
}
```

`tests/bench/src/sse.ts`:
```ts
import { RunEventRecord } from "@mastertutor/contracts";

export interface SseMessage {
  id: string | null;
  event: string | null;
  data: string;
}

export function createSseParser(onMessage: (message: SseMessage) => void): (chunk: string) => void {
  let buffer = "";
  let id: string | null = null;
  let event: string | null = null;
  let data: string[] = [];
  return (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + (buffer[newline] === "\r" ? 2 : 1));
      if (line === "") {
        if (data.length > 0) onMessage({ id, event, data: data.join("\n") });
        id = null;
        event = null;
        data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "id") id = value;
      else if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
  };
}

/** Streams a run's events and reconnects with Last-Event-ID until aborted (S4). */
export async function* streamRunEvents(options: {
  baseUrl: string;
  cookie: string;
  runId: string;
  lastEventId: string | null;
  signal: AbortSignal;
}): AsyncGenerator<RunEventRecord> {
  let lastEventId = options.lastEventId;
  while (!options.signal.aborted) {
    const queue: RunEventRecord[] = [];
    const feed = createSseParser((message) => {
      const parsed = RunEventRecord.safeParse(JSON.parse(message.data));
      if (parsed.success) queue.push(parsed.data);
    });
    try {
      const response = await fetch(`${options.baseUrl}/api/runs/${options.runId}/events`, {
        headers: { cookie: options.cookie, accept: "text/event-stream", ...(lastEventId ? { "last-event-id": lastEventId } : {}) },
        signal: options.signal,
      });
      if (!response.ok || !response.body) throw new Error(`event stream HTTP ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(value);
        while (queue.length > 0) {
          const record = queue.shift()!;
          lastEventId = record.id;
          yield record;
        }
      }
    } catch (error) {
      if (options.signal.aborted) return;
      if (error instanceof Error && /HTTP 4\d\d/.test(error.message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
```

`tests/bench/src/watch.ts`:
```ts
import type { RunEventRecord, RunStatus, WaitReason } from "@mastertutor/contracts";
import type { BenchApi } from "./app-client.ts";
import { streamRunEvents } from "./sse.ts";

export interface WatchPolicy {
  onBudget: "finish_now" | "extend_once";
  humanTimeoutMs: number;
  stallMs: number;
}
export interface WatchState {
  status: RunStatus;
  waitReason: WaitReason | null;
  lastProgressAt: number;
  humanSince: number | null;
  humanWait: "takeover" | "captcha" | "otp" | null;
  budgetExtended: boolean;
  budgetHit: boolean;
  takeovers: number;
  stalled: boolean;
  cancelRequested: boolean;
  done: boolean;
}
export type WatchCommand =
  | { type: "decide_budget"; approvalId: string; choice: "extend" | "finish_now" }
  | { type: "cancel"; reason: "stall" | "human_timeout" }
  | { type: "log"; line: string };

const TERMINAL: readonly RunStatus[] = ["completed", "failed", "cancelled"];

export function initialWatchState(now: number): WatchState {
  return {
    status: "queued",
    waitReason: null,
    lastProgressAt: now,
    humanSince: null,
    humanWait: null,
    budgetExtended: false,
    budgetHit: false,
    takeovers: 0,
    stalled: false,
    cancelRequested: false,
    done: false,
  };
}

export function onRecord(state: WatchState, record: RunEventRecord, now: number, policy: WatchPolicy): { state: WatchState; commands: WatchCommand[] } {
  const s = { ...state };
  const commands: WatchCommand[] = [];
  const event = record.event;
  switch (event.type) {
    case "status": {
      s.status = event.status;
      s.waitReason = event.waitReason;
      s.lastProgressAt = now;
      const human = event.status === "waiting" && event.waitReason !== "approval" ? event.waitReason : null;
      s.humanWait = human;
      s.humanSince = human === null ? null : (state.humanSince ?? now);
      if (human) commands.push({ type: "log", line: `NEEDS HUMAN (${human}): ${event.reason ?? ""}` });
      if (TERMINAL.includes(event.status)) s.done = true;
      commands.push({ type: "log", line: `status ${event.status}${event.waitReason ? `(${event.waitReason})` : ""}` });
      break;
    }
    case "step":
      s.lastProgressAt = now;
      if (event.state === "done") commands.push({ type: "log", line: `#${event.seq} ${event.phase} ${event.caption ?? ""}`.trim() });
      break;
    case "approval_requested":
      if (event.request.kind === "budget") {
        s.budgetHit = true;
        const choice = policy.onBudget === "extend_once" && !state.budgetExtended ? "extend" : "finish_now";
        if (choice === "extend") s.budgetExtended = true;
        commands.push({ type: "decide_budget", approvalId: event.approvalId, choice });
        commands.push({ type: "log", line: `budget hit (${event.request.exceeded}) -> ${choice}` });
      }
      break;
    case "control":
      if (event.holder === "user") s.takeovers = state.takeovers + 1;
      commands.push({ type: "log", line: `control -> ${event.holder}` });
      break;
    case "error":
      commands.push({ type: "log", line: `error ${event.code}: ${event.message}` });
      break;
    default:
      break;
  }
  return { state: s, commands };
}

export function onTick(state: WatchState, now: number, policy: WatchPolicy): { state: WatchState; commands: WatchCommand[] } {
  if (state.done || state.cancelRequested) return { state, commands: [] };
  if (state.humanSince !== null && now - state.humanSince > policy.humanTimeoutMs) {
    return { state: { ...state, cancelRequested: true }, commands: [{ type: "cancel", reason: "human_timeout" }] };
  }
  if (state.status === "running" && now - state.lastProgressAt > policy.stallMs) {
    return { state: { ...state, stalled: true, cancelRequested: true }, commands: [{ type: "cancel", reason: "stall" }] };
  }
  return { state, commands: [] };
}

export interface WatchDeps {
  api: BenchApi;
  baseUrl: string;
  cookie: string;
  log(line: string): void;
  now(): number;
}

export async function watchRun(deps: WatchDeps, runId: string, policy: WatchPolicy): Promise<WatchState> {
  let state = initialWatchState(deps.now());
  const controller = new AbortController();
  const apply = async (commands: WatchCommand[]) => {
    for (const command of commands) {
      if (command.type === "log") deps.log(`[${runId.slice(0, 8)}] ${command.line}`);
      else if (command.type === "decide_budget") {
        await deps.api.runs.decideApproval({ approvalId: command.approvalId, decision: "approved", instruction: null, budgetChoice: command.choice });
      } else {
        deps.log(`[${runId.slice(0, 8)}] cancelling: ${command.reason}`);
        await deps.api.runs.cancel({ runId });
      }
    }
  };
  const ticker = setInterval(() => {
    const result = onTick(state, deps.now(), policy);
    state = result.state;
    void apply(result.commands);
  }, 5_000);
  try {
    for await (const record of streamRunEvents({ baseUrl: deps.baseUrl, cookie: deps.cookie, runId, lastEventId: null, signal: controller.signal })) {
      const result = onRecord(state, record, deps.now(), policy);
      state = result.state;
      await apply(result.commands);
      if (state.done) break;
    }
  } finally {
    clearInterval(ticker);
    controller.abort();
  }
  return state;
}
```

- [ ] **Step 5: Run them to verify they pass.**

Run: `pnpm test -- tests/bench && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add tests/bench .gitignore package.json pnpm-lock.yaml
git commit -m "feat(bench): harness core (oRPC client, SSE reader, live watcher with budget, stall and human-wait handling)"
```

---

### Task 20: Evidence, grading criteria, failure classifier, reports and tickets

**Files:**
- Create: `tests/bench/src/{evidence,criteria,classify,report}.ts`, `tests/bench/src/{criteria,classify,report}.test.ts`

**Interfaces:**
- Consumes: `ReadPageResult`, `StepPhase`, `StepState`, `ToolName`, `ApprovalKind`, `ApprovalStatus`, `RunStatus`, `Uuid`, `BenchmarkRunView`, T19 types and S12.
- Produces:
  - **`evidence.ts`:**
    - `RunTrace`, `TraceStep`, `TraceApproval`;
    - `traceSql(runId: string): string`;
    - `parseTrace(runId, json: unknown): RunTrace`, which throws `SeamMismatch` when `read_page` results don't parse;
    - `loadRunTrace(compose: readonly string[], runId): Promise<RunTrace>`.
  - **`criteria.ts`:**
    - `Verdict = {outcome: "passed"|"partial"|"failed"; summary: string; unmet: string[]; unvisited: string[]}`;
    - `sameDocument(a, b): boolean`;
    - `evidenceText(trace, url): string | null`;
    - `evaluate(criterion, main: RunTrace | null, verify: RunTrace): Verdict`;
    - `finalOutcome(verdict, takeovers): "passed"|"partial"|"failed"`.
  - **`classify.ts`:**
    - `FailureSignals`;
    - `Failure = {cls: FailureClass; reason: string; step: {seq; url; screenshotKey} | null}`;
    - `suggestFailureClass(signals): Failure`.
  - **`report.ts`:**
    - `BenchmarkResult`, `SuiteRunResult`;
    - `renderReport(result: SuiteRunResult): string`;
    - `renderTicket(id: string, result: BenchmarkResult): string`;
    - `renderFailureNotes(failure: Failure | null, verdict: Verdict): string`.

- [ ] **Step 1: Write the failing tests.**

`tests/bench/src/criteria.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { evaluate, finalOutcome, sameDocument } from "./criteria.ts";
import type { RunTrace, TraceStep } from "./evidence.ts";

const step = (seq: number, over: Partial<TraceStep>): TraceStep => ({
  seq, phase: "act", state: "done", url: null, tool: "computer", caption: null, screenshotKey: null, readPage: null, credentialError: null, ...over,
});
const trace = (steps: TraceStep[], status: RunTrace["status"] = "completed"): RunTrace => ({
  runId: "r", status, waitReason: null, finalUrl: null, steps, approvals: [],
});
const readText = (seq: number, url: string, text: string) =>
  step(seq, { tool: "read_page", url, readPage: { hash: "a".repeat(64), url, title: "t", text } });

describe("page_text criterion", () => {
  const criterion = { kind: "page_text" as const, url: "http://bench-fixtures:8080/book", mustMatch: ["3 of 3 activities completed \\(100%\\)"] };
  it("passes from read_page evidence on the target page", () => {
    const verify = trace([readText(3, "http://bench-fixtures:8080/book?x=1", "Participation: 3 of 3 activities completed (100%)")]);
    expect(evaluate(criterion, null, verify).outcome).toBe("passed");
  });
  it("fails without evidence, or with evidence from another page", () => {
    expect(evaluate(criterion, null, trace([])).outcome).toBe("failed");
    const elsewhere = trace([readText(1, "http://bench-fixtures:8080/other", "3 of 3 activities completed (100%)")]);
    expect(evaluate(criterion, null, elsewhere).outcome).toBe("failed");
  });
});

describe("sections_complete criterion", () => {
  const s1 = "https://learn.example/book/chapter/1/section/1";
  const s2 = "https://learn.example/book/chapter/1/section/2";
  const criterion = {
    kind: "sections_complete" as const,
    sections: [{ reading: 1, title: "1.1", url: s1 }, { reading: 1, title: "1.2", url: s2 }],
    activityPattern: "PARTICIPATION ACTIVITY",
    completedPattern: "Activity completed",
    requireInteraction: true,
  };
  const page = (n: number, done: number) =>
    `${"PARTICIPATION ACTIVITY ".repeat(n)}${"Activity completed ".repeat(done)}`;

  it("passes when every section is complete and was worked on", () => {
    const main = trace([step(1, { url: s1 }), step(2, { url: s1 }), step(3, { url: s2 })]);
    const verify = trace([readText(1, s1, page(2, 2)), readText(2, s2, page(1, 1))]);
    expect(evaluate(criterion, main, verify)).toMatchObject({ outcome: "passed", unvisited: [] });
  });
  it("is partial when one section lacks interaction (already complete is not enough)", () => {
    const main = trace([step(1, { url: s1 }), step(2, { url: s1 })]);
    const verify = trace([readText(1, s1, page(2, 2)), readText(2, s2, page(1, 1))]);
    expect(evaluate(criterion, main, verify)).toMatchObject({ outcome: "partial", unvisited: [s2] });
  });
  it("fails when nothing is complete", () => {
    const verify = trace([readText(1, s1, page(2, 0)), readText(2, s2, page(1, 0))]);
    expect(evaluate(criterion, trace([]), verify).outcome).toBe("failed");
  });
  it("counts zero activities as not complete (wrong page or a perception gap)", () => {
    const verify = trace([readText(1, s1, "nothing here"), readText(2, s2, "nothing")]);
    expect(evaluate({ ...criterion, requireInteraction: false }, null, verify).outcome).toBe("failed");
  });
});

describe("finalOutcome", () => {
  it("never passes a run that needed a takeover", () => {
    expect(finalOutcome({ outcome: "passed", summary: "", unmet: [], unvisited: [] }, 1)).toBe("partial");
    expect(finalOutcome({ outcome: "passed", summary: "", unmet: [], unvisited: [] }, 0)).toBe("passed");
  });
});

describe("sameDocument", () => {
  it("ignores query, hash and trailing slash", () => {
    expect(sameDocument("https://a.b/x/?q=1#h", "https://a.b/x")).toBe(true);
    expect(sameDocument("https://a.b/x", "https://a.b/y")).toBe(false);
  });
});
```

`tests/bench/src/classify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { suggestFailureClass, type FailureSignals } from "./classify.ts";
import type { RunTrace } from "./evidence.ts";

const base: RunTrace = { runId: "r", status: "completed", waitReason: null, finalUrl: "https://x.test/book", steps: [], approvals: [] };
const verdict = { outcome: "failed" as const, summary: "", unmet: ["x"], unvisited: [] as string[] };
const signals = (over: Partial<FailureSignals>): FailureSignals => ({
  trace: base, verdict, budgetHit: false, stalled: false, humanWait: null, ...over,
});

describe("suggestFailureClass", () => {
  it("policy: a denied new origin", () => {
    const trace = { ...base, approvals: [{ kind: "new_origin" as const, status: "denied" as const, decidedBy: "policy" }] };
    expect(suggestFailureClass(signals({ trace })).cls).toBe("policy");
  });
  it("auth: a credential error or ending on a sign-in page", () => {
    const trace = { ...base, finalUrl: "https://x.test/signin" };
    expect(suggestFailureClass(signals({ trace })).cls).toBe("auth");
  });
  it("budget: the budget was hit", () => {
    expect(suggestFailureClass(signals({ budgetHit: true })).cls).toBe("budget");
  });
  it("navigation: target pages never visited", () => {
    expect(suggestFailureClass(signals({ verdict: { ...verdict, unvisited: ["https://x.test/s/1"] } })).cls).toBe("navigation");
  });
  it("action: stalled or stuck waiting for takeover", () => {
    expect(suggestFailureClass(signals({ stalled: true })).cls).toBe("action");
    expect(suggestFailureClass(signals({ humanWait: "takeover" })).cls).toBe("action");
  });
  it("perception: claimed done but the page disagrees", () => {
    expect(suggestFailureClass(signals({})).cls).toBe("perception");
  });
  it("points at the last acting step with a screenshot", () => {
    const trace = {
      ...base,
      steps: [
        { seq: 4, phase: "act" as const, state: "done" as const, url: "u", tool: "computer" as const, caption: null, screenshotKey: "k4", readPage: null, credentialError: null },
        { seq: 5, phase: "observe" as const, state: "done" as const, url: "u", tool: null, caption: null, screenshotKey: "k5", readPage: null, credentialError: null },
      ],
    };
    expect(suggestFailureClass(signals({ trace })).step).toEqual({ seq: 4, url: "u", screenshotKey: "k4" });
  });
});
```

`tests/bench/src/report.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { renderFailureNotes, renderReport, renderTicket, type BenchmarkResult } from "./report.ts";

const result: BenchmarkResult = {
  key: "reading-1",
  name: "zybooks/reading-1@computer_use#abc12345",
  toolProfile: "computer_use",
  benchmarkRunId: "55555555-5555-4555-8555-555555555555",
  runId: "66666666-6666-4666-8666-666666666666",
  verifyRunIds: ["77777777-7777-4777-8777-777777777777"],
  outcome: "partial",
  verdict: { outcome: "partial", summary: "3/5 sections", unmet: ["1.4", "1.5"], unvisited: ["https://x/1.5"] },
  metrics: { steps: 212, usd: 7.31, durationMs: 3_540_000, takeovers: 0 },
  failure: { cls: "navigation", reason: "1 target section never visited", step: { seq: 211, url: "https://x/1.4", screenshotKey: "runs/r/211.png" } },
  ticket: "BT-0003",
};

describe("report rendering", () => {
  it("renders a summary table row with every required metric", () => {
    const md = renderReport({ suite: "zybooks", stack: "local", mock: false, startedAt: "2026-10-05T10:00:00Z", finishedAt: "2026-10-05T11:00:00Z", results: [result] });
    expect(md).toContain("| zybooks/reading-1@computer_use#abc12345 | computer_use | partial | 212 | $7.31 | 59m 0s | 0 | navigation (BT-0003) |");
  });
  it("renders a ticket with step, screenshot key, class and reason", () => {
    const md = renderTicket("BT-0003", result);
    for (const text of ["BT-0003", "navigation", "211", "runs/r/211.png", "never visited", "Fix acceptance"]) expect(md).toContain(text);
  });
  it("renders failure notes stored on the benchmark run", () => {
    expect(renderFailureNotes(result.failure, result.verdict)).toMatch(/^class: navigation\nstep: 211/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test -- tests/bench`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`tests/bench/src/evidence.ts`:
```ts
import {
  ApprovalKind,
  ApprovalStatus,
  ReadPageResult,
  RunStatus,
  StepPhase,
  StepState,
  ToolName,
  Uuid,
  WaitReason,
} from "@mastertutor/contracts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

export class SeamMismatch extends Error {
  constructor(detail: string) {
    super(`run_steps shape does not match the harness's assumption (S12): ${detail}`);
    this.name = "SeamMismatch";
  }
}

const RawStep = z.object({
  seq: z.number().int(),
  phase: StepPhase,
  state: StepState,
  url: z.string().nullable(),
  tool: ToolName.nullable(),
  caption: z.string().nullable(),
  screenshotKey: z.string().nullable(),
  result: z.unknown().nullable(),
  credentialError: z.string().nullable(),
});
const RawTrace = z.object({
  status: RunStatus,
  waitReason: WaitReason.nullable(),
  finalUrl: z.string().nullable(),
  steps: z.array(RawStep),
  approvals: z.array(z.object({ kind: ApprovalKind, status: ApprovalStatus, decidedBy: z.string().nullable() })),
});

export interface TraceStep extends Omit<z.infer<typeof RawStep>, "result"> {
  readPage: ReadPageResult | null;
}
export type TraceApproval = z.infer<typeof RawTrace>["approvals"][number];
export interface RunTrace {
  runId: string;
  status: RunStatus;
  waitReason: WaitReason | null;
  finalUrl: string | null;
  steps: TraceStep[];
  approvals: TraceApproval[];
}

export function traceSql(runId: string): string {
  const id = Uuid.parse(runId);
  return `select json_build_object(
  'status', r.status, 'waitReason', r.wait_reason, 'finalUrl', r.current_url,
  'steps', coalesce((select json_agg(json_build_object(
      'seq', s.seq, 'phase', s.phase, 'state', s.state, 'url', s.url, 'tool', s.action->>'tool',
      'caption', s.caption, 'screenshotKey', s.screenshot_key,
      'result', case when s.action->>'tool' = 'read_page' and s.phase = 'act' then s.result end,
      'credentialError', case when s.action->>'tool' = 'fill_credential' then s.result->>'error' end
    ) order by s.seq) from run_steps s where s.run_id = r.id), '[]'::json),
  'approvals', coalesce((select json_agg(json_build_object('kind', a.kind, 'status', a.status, 'decidedBy', a.decided_by)
    order by a.created_at) from approvals a where a.run_id = r.id), '[]'::json)
) from runs r where r.id = '${id}'`;
}

export function parseTrace(runId: string, json: unknown): RunTrace {
  const raw = RawTrace.safeParse(json);
  if (!raw.success) throw new SeamMismatch(raw.error.issues[0]?.message ?? "invalid trace");
  return {
    runId,
    status: raw.data.status,
    waitReason: raw.data.waitReason,
    finalUrl: raw.data.finalUrl,
    approvals: raw.data.approvals,
    steps: raw.data.steps.map(({ result, ...step }) => {
      if (step.tool !== "read_page" || step.phase !== "act" || step.state !== "done" || result === null) return { ...step, readPage: null };
      const parsed = ReadPageResult.safeParse(result);
      if (!parsed.success) throw new SeamMismatch(`read_page result at seq ${step.seq}`);
      return { ...step, readPage: parsed.data };
    }),
  };
}

/** Reads the trace as the DB owner inside the stack. Postgres is not published on the host. */
export async function loadRunTrace(compose: readonly string[], runId: string): Promise<RunTrace> {
  const [command, ...args] = compose;
  const { stdout } = await run(
    command!,
    [...args, "exec", "-T", "postgres", "psql", "-U", "owner", "-d", "mastertutor", "-At", "-v", "ON_ERROR_STOP=1", "-c", traceSql(runId)],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  return parseTrace(runId, JSON.parse(stdout.trim()));
}
```

`tests/bench/src/criteria.ts`:
```ts
import type { ReadPageResult } from "@mastertutor/contracts";
import type { RunTrace } from "./evidence.ts";
import type { Criterion } from "./types.ts";

export interface Verdict {
  outcome: "passed" | "partial" | "failed";
  summary: string;
  unmet: string[];
  unvisited: string[];
}

export function sameDocument(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
}

function flatten(result: ReadPageResult): string {
  if ("unchanged" in result) return "";
  if ("text" in result) return result.text;
  return result.elements.map((e) => [e.name, ...Object.values(e.attrs)].join(" ")).join("\n");
}

/** All read_page evidence the agent's own tool recorded for one page, in both modes. */
export function evidenceText(trace: RunTrace, url: string): string | null {
  const parts = trace.steps
    .filter((s) => s.readPage !== null && !("unchanged" in s.readPage) && sameDocument(s.readPage.url, url))
    .map((s) => flatten(s.readPage!));
  return parts.length === 0 ? null : parts.join("\n");
}

const count = (text: string, pattern: string) => (text.match(new RegExp(pattern, "giu")) ?? []).length;

export function evaluate(criterion: Criterion, main: RunTrace | null, verify: RunTrace): Verdict {
  if (criterion.kind === "page_text") {
    const text = evidenceText(verify, criterion.url);
    if (text === null) return { outcome: "failed", summary: "no read_page evidence for the target page", unmet: [...criterion.mustMatch], unvisited: [] };
    const unmet = criterion.mustMatch.filter((p) => !new RegExp(p, "u").test(text));
    return { outcome: unmet.length === 0 ? "passed" : "failed", summary: `${criterion.mustMatch.length - unmet.length}/${criterion.mustMatch.length} checks`, unmet, unvisited: [] };
  }
  const unmet: string[] = [];
  const unvisited: string[] = [];
  let passed = 0;
  for (const section of criterion.sections) {
    const text = evidenceText(verify, section.url) ?? "";
    const activities = count(text, criterion.activityPattern);
    const completed = count(text, criterion.completedPattern);
    const complete = activities > 0 && completed >= activities;
    const acts = main?.steps.filter((s) => s.phase === "act" && s.state === "done" && s.tool !== "read_page" && s.url !== null && sameDocument(s.url, section.url)).length ?? 0;
    const interacted = !criterion.requireInteraction || acts >= Math.max(1, activities);
    if (criterion.requireInteraction && acts === 0) unvisited.push(section.url);
    if (complete && interacted) passed++;
    else unmet.push(`${section.title}: ${completed}/${activities} complete, ${acts} actions`);
  }
  const total = criterion.sections.length;
  const outcome = passed === total ? "passed" : passed === 0 ? "failed" : "partial";
  return { outcome, summary: `${passed}/${total} sections`, unmet, unvisited };
}

/** A takeover is a failure for benchmarking: it caps the outcome at partial. */
export function finalOutcome(verdict: Verdict, takeovers: number): Verdict["outcome"] {
  return takeovers > 0 && verdict.outcome === "passed" ? "partial" : verdict.outcome;
}
```

`tests/bench/src/classify.ts`:
```ts
import type { Verdict } from "./criteria.ts";
import type { RunTrace } from "./evidence.ts";
import type { FailureClass } from "./types.ts";

export interface FailureSignals {
  trace: RunTrace;
  verdict: Verdict;
  budgetHit: boolean;
  stalled: boolean;
  humanWait: "takeover" | "captcha" | "otp" | null;
}
export interface Failure {
  cls: FailureClass;
  reason: string;
  step: { seq: number; url: string | null; screenshotKey: string | null } | null;
}

/** A suggestion only: the orchestrator confirms or corrects the class in the ticket. */
export function suggestFailureClass(s: FailureSignals): Failure {
  const lastAct = [...s.trace.steps].reverse().find((x) => x.phase === "act" && x.screenshotKey !== null) ?? null;
  const step = lastAct === null ? null : { seq: lastAct.seq, url: lastAct.url, screenshotKey: lastAct.screenshotKey };
  const denied = s.trace.approvals.find((a) => a.status === "denied" && (a.kind === "new_origin" || a.kind === "download"));
  if (denied) return { cls: "policy", reason: `policy denied a ${denied.kind} request`, step };
  const credential = s.trace.steps.find((x) => x.credentialError !== null);
  if (credential || s.humanWait === "captcha" || /sign-?in|log-?in/i.test(s.trace.finalUrl ?? "")) {
    return { cls: "auth", reason: credential ? `fill_credential error ${credential.credentialError}` : "ended on a sign-in page or a CAPTCHA", step };
  }
  if (s.budgetHit) return { cls: "budget", reason: "the run hit its budget before finishing", step };
  if (s.verdict.unvisited.length > 0) return { cls: "navigation", reason: `${s.verdict.unvisited.length} target page(s) never visited`, step };
  if (s.stalled || s.humanWait === "takeover" || s.trace.waitReason === "takeover") {
    return { cls: "action", reason: s.stalled ? "no progress within the stall window" : "the loop detector asked for a takeover", step };
  }
  return { cls: "perception", reason: `the agent finished but the page shows: ${s.verdict.unmet.slice(0, 3).join("; ")}`, step };
}
```

`tests/bench/src/report.ts`:
```ts
import type { ToolProfile } from "@mastertutor/contracts";
import type { Failure } from "./classify.ts";
import type { Verdict } from "./criteria.ts";

export interface BenchmarkResult {
  key: string;
  name: string;
  toolProfile: ToolProfile;
  benchmarkRunId: string;
  runId: string;
  verifyRunIds: string[];
  outcome: "passed" | "partial" | "failed" | "error";
  verdict: Verdict;
  metrics: { steps: number; usd: number; durationMs: number | null; takeovers: number };
  failure: Failure | null;
  ticket: string | null;
}
export interface SuiteRunResult {
  suite: string;
  stack: string;
  mock: boolean;
  startedAt: string;
  finishedAt: string;
  results: BenchmarkResult[];
}

const duration = (ms: number | null) => (ms === null ? "–" : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

export function renderFailureNotes(failure: Failure | null, verdict: Verdict): string {
  if (failure === null) return `verdict: ${verdict.summary}`;
  return [
    `class: ${failure.cls}`,
    `step: ${failure.step?.seq ?? "none"}`,
    `screenshot: ${failure.step?.screenshotKey ?? "none"}`,
    `reason: ${failure.reason}`,
    `verdict: ${verdict.summary}`,
    ...verdict.unmet.slice(0, 10).map((u) => `unmet: ${u}`),
  ].join("\n");
}

export function renderReport(r: SuiteRunResult): string {
  const rows = r.results.map(
    (x) =>
      `| ${x.name} | ${x.toolProfile} | ${x.outcome} | ${x.metrics.steps} | $${x.metrics.usd.toFixed(2)} | ${duration(x.metrics.durationMs)} | ${x.metrics.takeovers} | ${x.failure ? `${x.failure.cls}${x.ticket ? ` (${x.ticket})` : ""}` : "–"} |`,
  );
  const total = r.results.reduce((sum, x) => sum + x.metrics.usd, 0);
  const tracks = (["computer_use", "browser_use"] as const).map((t) => {
    const of = r.results.filter((x) => x.toolProfile === t);
    return `| ${t} | ${of.filter((x) => x.outcome === "passed").length}/${of.length} | $${of.reduce((s, x) => s + x.metrics.usd, 0).toFixed(2)} | ${of.reduce((s, x) => s + x.metrics.steps, 0)} |`;
  });
  return [
    `# Benchmark report: ${r.suite}`,
    "",
    `- Stack: ${r.stack}${r.mock ? " (llm-mock)" : " (real model)"}`,
    `- Window: ${r.startedAt} → ${r.finishedAt}`,
    `- Total spend: $${total.toFixed(2)}`,
    "",
    "## Tracks",
    "",
    "| Track | Passed | Spend | Steps |",
    "|---|---|---|---|",
    ...tracks,
    "",
    "## Runs",
    "",
    "| Benchmark | Track | Outcome | Steps | Cost | Duration | Takeovers | Failure |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...r.results.flatMap((x) => [
      `### ${x.name}`,
      "",
      `- Run \`${x.runId}\`, benchmark run \`${x.benchmarkRunId}\`, verify runs ${x.verifyRunIds.map((v) => `\`${v}\``).join(", ") || "none"}`,
      `- Verdict: ${x.verdict.summary}`,
      ...x.verdict.unmet.map((u) => `  - unmet: ${u}`),
      "",
    ]),
  ].join("\n");
}

export function renderTicket(id: string, x: BenchmarkResult): string {
  return [
    `# ${id}: ${x.name} — ${x.failure?.cls ?? "unknown"}`,
    "",
    "| Field | Value |",
    "|---|---|",
    `| Benchmark | ${x.name} |`,
    `| Track | ${x.toolProfile} |`,
    `| Outcome | ${x.outcome} |`,
    `| Run | ${x.runId} |`,
    `| Failing step | ${x.failure?.step?.seq ?? "none"} |`,
    `| URL | ${x.failure?.step?.url ?? "none"} |`,
    `| Screenshot key | ${x.failure?.step?.screenshotKey ?? "none"} |`,
    `| Suggested class | ${x.failure?.cls ?? "unknown"} |`,
    `| Reason | ${x.failure?.reason ?? ""} |`,
    "",
    "## Orchestrator triage",
    "",
    "- Confirmed class (perception / action / navigation / auth / policy / budget):",
    "- What the agent saw vs. did (cite the replay steps):",
    "- Generic root cause in product code (no site-specific fix; see orchestration/benchmarks/README.md):",
    "",
    "## Fix acceptance",
    "",
    "- [ ] A failing test reproduces the cause on a fixture or in a unit test",
    "- [ ] The fix landed through the normal review (commit sha below)",
    "- [ ] `pnpm test`, `pnpm test:int` and `pnpm e2e` are green",
    `- [ ] A re-run of \`${x.key}\` (${x.toolProfile}) no longer fails this way`,
    "",
    "Fix commit:",
    "Re-run report:",
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run them to verify they pass.**

Run: `pnpm test -- tests/bench && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/bench
git commit -m "feat(bench): read_page evidence, grading criteria, takeover-capped outcome, failure classifier, reports and tickets"
```

---

### Task 21: Suite runner and CLI

**Files:**
- Create: `tests/bench/src/{mock,vault-check,run-suite,cli}.ts`, `tests/bench/src/run-suite.test.ts`

**Interfaces:**
- Consumes: Tasks 19 and 20, `scenarioGoal` (T1) and `benchmarks.*`/`runs.*`/`vault.list` via `BenchApi`.
- Produces:
  - **`mock.ts`:** `withScenario(task: string, scenario: string | null): string`.
  - **`vault-check.ts`:** `checkVaultItem(api, requirement): Promise<string | null>`, which returns user-facing instructions when the item is missing.
  - **`run-suite.ts`:**
    - `SuiteRunOptions`;
    - `RunnerDeps = WatchDeps & {compose: readonly string[]; loadTrace: typeof loadRunTrace; reset(cmd: readonly string[]): Promise<void>}`;
    - `specName(suiteId, spec, mock): string`;
    - `runBenchmark(suiteId, spec, options, deps): Promise<BenchmarkResult>`;
    - `runSuite(suite, options, deps): Promise<SuiteRunResult>`;
    - errors `BaselineIncomplete` and `PreconditionFailed`.
  - **`cli.ts`:** `pnpm bench init --stack <test|test-real|local>`, `pnpm bench run --suite <fixtures|zybooks> [options]` and `pnpm bench watch <runId>`.

- [ ] **Step 1: Write the failing test.**

`tests/bench/src/run-suite.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { RunTrace } from "./evidence.ts";
import { BaselineIncomplete, runBenchmark, specName, type RunnerDeps, type SuiteRunOptions } from "./run-suite.ts";
import type { BenchmarkSpec } from "./types.ts";

const spec: BenchmarkSpec = {
  key: "activities",
  task: "Do the activities",
  allowedOrigins: ["http://bench-fixtures:8080"],
  budget: { maxSteps: 60, maxUsd: 1, maxActiveMinutes: 10 },
  toolProfile: "computer_use",
  criterion: { kind: "page_text", url: "http://bench-fixtures:8080/book", mustMatch: ["3 of 3"] },
  verify: { task: "Read the book page", budget: { maxSteps: 20, maxUsd: 1, maxActiveMinutes: 5 } },
  baselineMustPass: true,
  requiredVaultItem: null,
  reset: null,
  mockScenarios: null,
};
const options: SuiteRunOptions = {
  mock: false,
  tracks: ["computer_use", "browser_use"],
  only: null,
  maxTotalUsd: 10,
  policy: { onBudget: "finish_now", humanTimeoutMs: 1, stallMs: 1 },
  allowIncompleteBaseline: false,
};
const trace = (text: string): RunTrace => ({
  runId: "r",
  status: "completed",
  waitReason: null,
  finalUrl: null,
  approvals: [],
  steps: [{ seq: 1, phase: "act", state: "done", url: "http://bench-fixtures:8080/book", tool: "read_page", caption: null, screenshotKey: null, credentialError: null, readPage: { hash: "a".repeat(64), url: "http://bench-fixtures:8080/book", title: "t", text } }],
});

function deps(verifyText: string): RunnerDeps {
  return {
    api: {
      benchmarks: {
        list: vi.fn(async () => ({ items: [] })),
        create: vi.fn(async () => ({ id: "b1" })),
        start: vi.fn(async () => ({ benchmarkRunId: "br1", runId: "main" })),
        runs: vi.fn(async () => ({ items: [{ id: "br1", steps: 5, usd: 0.1, durationMs: 1000, takeovers: 0 }] })),
        grade: vi.fn(async () => ({})),
      },
      runs: { create: vi.fn(async () => ({ id: "verify" })), cancel: vi.fn(), decideApproval: vi.fn() },
      vault: { list: vi.fn(async () => ({ items: [] })) },
    } as unknown as RunnerDeps["api"],
    baseUrl: "http://x",
    cookie: "c",
    log: () => undefined,
    now: () => 0,
    compose: ["docker", "compose"],
    loadTrace: vi.fn(async () => trace(verifyText)),
    reset: vi.fn(async () => undefined),
    watch: vi.fn(async () => ({ status: "completed", takeovers: 0, budgetHit: false, stalled: false, humanWait: null })),
  } as unknown as RunnerDeps;
}

describe("runBenchmark", () => {
  it("names benchmarks by suite, key, track and definition hash", () => {
    expect(specName("fixtures", spec, false)).toMatch(/^fixtures\/activities@computer_use#[0-9a-f]{8}$/);
    expect(specName("fixtures", spec, true)).not.toBe(specName("fixtures", spec, false));
  });

  it("stops before acting when the baseline is not already complete (D32)", async () => {
    const d = deps("1 of 3");
    await expect(runBenchmark("fixtures", spec, options, d)).rejects.toBeInstanceOf(BaselineIncomplete);
    expect(d.api.benchmarks.start).not.toHaveBeenCalled();
  });

  it("grades a passing run passed and records the metrics", async () => {
    const d = deps("Participation: 3 of 3");
    const result = await runBenchmark("fixtures", spec, options, d);
    expect(result.outcome).toBe("passed");
    expect(d.api.benchmarks.grade).toHaveBeenCalledWith(expect.objectContaining({ benchmarkRunId: "br1", outcome: "passed" }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test -- tests/bench/src/run-suite`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`tests/bench/src/mock.ts`:
```ts
import { scenarioGoal } from "../../llm-mock/select.ts";

export function withScenario(task: string, scenario: string | null): string {
  return scenario === null ? task : scenarioGoal(scenario, task);
}
```

`tests/bench/src/vault-check.ts`:
```ts
import type { BenchApi } from "./app-client.ts";

/** Returns null when the vault item is ready; otherwise instructions. Never asks for or accepts the secret. */
export async function checkVaultItem(
  api: BenchApi,
  requirement: { alias: string; origin: string; fields: readonly string[] },
): Promise<string | null> {
  const { items } = await api.vault.list({});
  const item = items.find((i) => i.alias === requirement.alias);
  const missing = item ? requirement.fields.filter((f) => !item.fields.includes(f as never)) : [...requirement.fields];
  if (item && item.origin === requirement.origin && missing.length === 0) return null;
  return [
    `Vault item "${requirement.alias}" is not ready.`,
    "Open the app's Vault page and add or fix the item:",
    `  alias:  ${requirement.alias}`,
    `  origin: ${requirement.origin}${item && item.origin !== requirement.origin ? ` (currently ${item.origin})` : ""}`,
    `  fields: ${requirement.fields.join(", ")}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
    "Type the credentials into the Vault UI only. Never put them in files, commands or env vars (D34).",
  ].join("\n");
}
```

`tests/bench/src/run-suite.ts`:
```ts
import { createHash } from "node:crypto";
import type { ToolProfile } from "@mastertutor/contracts";
import type { BenchApi } from "./app-client.ts";
import { suggestFailureClass } from "./classify.ts";
import { evaluate, finalOutcome, type Verdict } from "./criteria.ts";
import type { loadRunTrace, RunTrace } from "./evidence.ts";
import { withScenario } from "./mock.ts";
import { renderFailureNotes, type BenchmarkResult, type SuiteRunResult } from "./report.ts";
import type { BenchmarkSpec, SuiteDefinition } from "./types.ts";
import { checkVaultItem } from "./vault-check.ts";
import { watchRun, type WatchDeps, type WatchPolicy, type WatchState } from "./watch.ts";

export class BaselineIncomplete extends Error {
  constructor(detail: string) {
    super(`Baseline is not already complete (${detail}). D32 defines this benchmark over already-completed work. Ask the user before re-running with --allow-incomplete-baseline.`);
    this.name = "BaselineIncomplete";
  }
}
export class PreconditionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionFailed";
  }
}

export interface SuiteRunOptions {
  mock: boolean;
  tracks: readonly ToolProfile[];
  only: readonly string[] | null;
  maxTotalUsd: number;
  policy: WatchPolicy;
  allowIncompleteBaseline: boolean;
}
export interface RunnerDeps extends WatchDeps {
  api: BenchApi;
  compose: readonly string[];
  loadTrace: typeof loadRunTrace;
  reset(command: readonly string[]): Promise<void>;
  watch?: (deps: WatchDeps, runId: string, policy: WatchPolicy) => Promise<WatchState>;
}

export function specName(suiteId: string, spec: BenchmarkSpec, mock: boolean): string {
  const definition = JSON.stringify({ task: spec.task, origins: spec.allowedOrigins, budget: spec.budget, criterion: spec.criterion, mock: mock ? spec.mockScenarios : null });
  return `${suiteId}/${spec.key}@${spec.toolProfile}#${createHash("sha256").update(definition).digest("hex").slice(0, 8)}`;
}

async function ensureBenchmark(api: BenchApi, name: string, spec: BenchmarkSpec, task: string): Promise<string> {
  const existing = (await api.benchmarks.list({})).items.find((b) => b.name === name);
  if (existing) return existing.id;
  const created = await api.benchmarks.create({
    name,
    task,
    allowedOrigins: [...spec.allowedOrigins],
    approvalMode: "auto_within_allowlist",
    toolProfile: spec.toolProfile,
    budget: spec.budget,
    successCriteria: JSON.stringify(spec.criterion).slice(0, 4_000),
  });
  return created.id;
}

async function verifyRun(spec: BenchmarkSpec, options: SuiteRunOptions, deps: RunnerDeps): Promise<{ runId: string; trace: RunTrace }> {
  const run = await deps.api.runs.create({
    goal: withScenario(spec.verify.task, options.mock ? (spec.mockScenarios?.verify ?? null) : null),
    allowedOrigins: [...spec.allowedOrigins],
    budget: spec.verify.budget,
    targetFolderId: null,
    approvalMode: "auto_within_allowlist",
    toolProfile: "browser_use",
  });
  await (deps.watch ?? watchRun)(deps, run.id, options.policy);
  return { runId: run.id, trace: await deps.loadTrace(deps.compose, run.id) };
}

export async function runBenchmark(suiteId: string, spec: BenchmarkSpec, options: SuiteRunOptions, deps: RunnerDeps): Promise<BenchmarkResult> {
  if (spec.requiredVaultItem) {
    const problem = await checkVaultItem(deps.api, spec.requiredVaultItem);
    if (problem) throw new PreconditionFailed(problem);
  }
  if (spec.reset) await deps.reset(spec.reset);
  const verifyRunIds: string[] = [];

  if (spec.baselineMustPass) {
    const baseline = await verifyRun(spec, options, deps);
    verifyRunIds.push(baseline.runId);
    const verdict = evaluate(
      spec.criterion.kind === "sections_complete" ? { ...spec.criterion, requireInteraction: false } : spec.criterion,
      null,
      baseline.trace,
    );
    if (verdict.outcome !== "passed" && !options.allowIncompleteBaseline) throw new BaselineIncomplete(verdict.summary);
  }

  const name = specName(suiteId, spec, options.mock);
  const benchmarkId = await ensureBenchmark(deps.api, name, spec, withScenario(spec.task, options.mock ? (spec.mockScenarios?.main ?? null) : null));
  const started = await deps.api.benchmarks.start({ benchmarkId });
  deps.log(`started ${name}: run ${started.runId}`);
  const watched = await (deps.watch ?? watchRun)(deps, started.runId, options.policy);

  const after = await verifyRun(spec, options, deps);
  verifyRunIds.push(after.runId);
  const main = await deps.loadTrace(deps.compose, started.runId);
  const verdict: Verdict = evaluate(spec.criterion, main, after.trace);
  const view = (await deps.api.benchmarks.runs({ benchmarkId, limit: 20 })).items.find((r) => r.id === started.benchmarkRunId)!;
  const outcome = finalOutcome(verdict, view.takeovers);
  const failure =
    outcome === "passed"
      ? null
      : suggestFailureClass({ trace: main, verdict, budgetHit: watched.budgetHit, stalled: watched.stalled, humanWait: watched.humanWait });
  await deps.api.benchmarks.grade({ benchmarkRunId: started.benchmarkRunId, outcome, failureNotes: renderFailureNotes(failure, verdict) });
  return {
    key: spec.key,
    name,
    toolProfile: spec.toolProfile,
    benchmarkRunId: started.benchmarkRunId,
    runId: started.runId,
    verifyRunIds,
    outcome,
    verdict,
    metrics: { steps: view.steps, usd: view.usd, durationMs: view.durationMs, takeovers: view.takeovers },
    failure,
    ticket: null,
  };
}

export async function runSuite(suite: SuiteDefinition, options: SuiteRunOptions, deps: RunnerDeps, stack: string): Promise<SuiteRunResult> {
  const startedAt = new Date().toISOString();
  const results: BenchmarkResult[] = [];
  let spent = 0;
  for (const spec of suite.benchmarks) {
    if (!options.tracks.includes(spec.toolProfile)) continue;
    if (options.only && !options.only.includes(spec.key)) continue;
    if (spent >= options.maxTotalUsd) {
      deps.log(`spend cap $${options.maxTotalUsd} reached ($${spent.toFixed(2)}); not starting ${spec.key}`);
      break;
    }
    const result = await runBenchmark(suite.id, spec, options, deps);
    spent += result.metrics.usd;
    results.push(result);
  }
  return { suite: suite.id, stack, mock: options.mock, startedAt, finishedAt: new Date().toISOString(), results };
}
```
Verify-run spend counts against each run's own budget. The harness cap tracks main-run spend; the verify runs' small budgets are listed in the suite.

`tests/bench/src/cli.ts`:
```ts
// Benchmark harness CLI (Phase 10). Never accepts site credentials (D34).
//   pnpm bench init --stack test|test-real|local
//   pnpm bench run --suite fixtures|zybooks [--track computer_use|browser_use|both] [--only key]...
//        [--mock] [--max-total-usd 120] [--on-budget finish_now|extend_once]
//        [--human-timeout-min 10] [--stall-min 10] [--allow-incomplete-baseline]
//   pnpm bench watch <runId>
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs```ts
";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { authCookie, createApi } from "./app-client.ts";
import { assertNoSiteCredentialsInEnv, readBenchEnv, STACK_COMPOSE, writeBenchEnv, type BenchEnv } from "./config.ts";
import { loadRunTrace } from "./evidence.ts";
import { renderReport, renderTicket } from "./report.ts";
import { runSuite, type RunnerDeps } from "./run-suite.ts";
import { fixturesSuite } from "./suites/fixtures.ts";
import { zybooksSuite } from "./suites/zybooks.ts";
import type { StackName } from "./types.ts";
import { watchRun } from "./watch.ts";

const exec = promisify(execFile);
assertNoSiteCredentialsInEnv(process.env);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    stack: { type: "string" },
    suite: { type: "string" },
    track: { type: "string", default: "both" },
    only: { type: "string", multiple: true },
    mock: { type: "boolean", default: false },
    "max-total-usd": { type: "string", default: "120" },
    "on-budget": { type: "string", default: "finish_now" },
    "human-timeout-min": { type: "string", default: "10" },
    "stall-min": { type: "string", default: "10" },
    "allow-incomplete-baseline": { type: "boolean", default: false },
  },
});
const [command, arg] = positionals;
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

async function session(env: BenchEnv) {
  const cookie = await authCookie(env.BENCH_BASE_URL, env.BENCH_EMAIL, env.BENCH_PASSWORD, "sign-in");
  return { cookie, api: createApi(env.BENCH_BASE_URL, cookie) };
}

function nextTicketId(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const max = readdirSync(dir).reduce((m, f) => Math.max(m, Number(/^BT-(\d+)\.md$/.exec(f)?.[1] ?? 0)), 0);
  return `BT-${String(max + 1).padStart(4, "0")}`;
}

function runDir(suite: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const root = "orchestration/benchmarks";
  mkdirSync(root, { recursive: true });
  const n = readdirSync(root).filter((d) => d.startsWith(`${day}-${suite}-`)).length + 1;
  const dir = join(root, `${day}-${suite}-${n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

if (command === "init") {
  const stack = values.stack as StackName;
  if (!(stack in STACK_COMPOSE)) throw new Error("--stack must be test, test-real or local");
  const env: BenchEnv = {
    BENCH_STACK: stack,
    BENCH_BASE_URL: "http://localhost:18080",
    BENCH_EMAIL: "bench-owner@local.test",
    BENCH_PASSWORD: existsSync(".env.bench") ? readBenchEnv().BENCH_PASSWORD : randomBytes(24).toString("base64url"),
  };
  try {
    await authCookie(env.BENCH_BASE_URL, env.BENCH_EMAIL, env.BENCH_PASSWORD, "sign-up");
    log("created the app owner account for benchmarks");
  } catch {
    await authCookie(env.BENCH_BASE_URL, env.BENCH_EMAIL, env.BENCH_PASSWORD, "sign-in");
    log("signed in with the existing benchmark account");
  }
  writeBenchEnv(".env.bench", env);
  log(".env.bench written (mode 600). The app password is in that file; sign in to the UI with it to use the Vault.");
} else if (command === "watch") {
  const env = readBenchEnv();
  const { cookie, api } = await session(env);
  await watchRun({ api, baseUrl: env.BENCH_BASE_URL, cookie, log, now: Date.now }, arg!, {
    onBudget: "finish_now",
    humanTimeoutMs: Number.POSITIVE_INFINITY,
    stallMs: Number.POSITIVE_INFINITY,
  });
} else if (command === "run") {
  const env = readBenchEnv();
  const suite = values.suite === "fixtures" ? fixturesSuite() : values.suite === "zybooks" ? zybooksSuite() : null;
  if (!suite) throw new Error("--suite must be fixtures or zybooks");
  if (values.suite === "zybooks" && env.BENCH_STACK !== "local") throw new Error("zybooks runs only on the local stack");
  const { cookie, api } = await session(env);
  const compose = STACK_COMPOSE[env.BENCH_STACK];
  const deps: RunnerDeps = {
    api,
    baseUrl: env.BENCH_BASE_URL,
    cookie,
    log,
    now: Date.now,
    compose,
    loadTrace: loadRunTrace,
    reset: async (cmd) => {
      const [c, ...a] = compose;
      await exec(c!, [...a, ...cmd]);
    },
  };
  const tracks = values.track === "both" ? (["browser_use", "computer_use"] as const) : [values.track as "browser_use" | "computer_use"];
  const result = await runSuite(
    suite,
    {
      mock: values.mock ?? false,
      tracks,
      only: values.only ?? null,
      maxTotalUsd: Number(values["max-total-usd"]),
      policy: {
        onBudget: values["on-budget"] === "extend_once" ? "extend_once" : "finish_now",
        humanTimeoutMs: Number(values["human-timeout-min"]) * 60_000,
        stallMs: Number(values["stall-min"]) * 60_000,
      },
      allowIncompleteBaseline: values["allow-incomplete-baseline"] ?? false,
    },
    deps,
    env.BENCH_STACK,
  );
  const dir = runDir(suite.id);
  const tickets = "orchestration/benchmarks/tickets";
  for (const r of result.results.filter((x) => x.outcome !== "passed")) {
    r.ticket = nextTicketId(tickets);
    writeFileSync(join(tickets, `${r.ticket}.md`), renderTicket(r.ticket, r));
  }
  writeFileSync(join(dir, "report.md"), renderReport(result));
  log(`report: ${join(dir, "report.md")}`);
  process.exit(result.results.every((r) => r.outcome === "passed") ? 0 : 2);
} else {
  throw new Error("usage: pnpm bench <init|run|watch> …");
}
```
`suites/fixtures.ts` and `suites/zybooks.ts` are created in Tasks 22 and 23. Until then, add a stub that exports `fixturesSuite()` and `zybooksSuite()`, each returning `{ id, benchmarks: [] }`, so typecheck passes. Task 22 and Task 23 replace the stub bodies.

- [ ] **Step 4: Run it to verify it passes.**

Run: `pnpm test -- tests/bench && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/bench
git commit -m "feat(bench): suite runner (vault precondition, baseline guard, verify runs, grading, spend cap) and CLI"
```

---

### Task 22: Fixture benchmark: a dynamic activity site, mock scenarios and a CI job

**Files:**
- Create: `tests/fixtures/bench-activities/server.ts`, `tests/fixtures/bench-activities/server.test.ts`, `tests/bench/src/suites/fixtures.ts`, `compose.bench-real.yml`, `scripts/bench-real-fixtures.sh`
- Create in B1 format: `tests/llm-mock/scenarios/bench-activities-computer`, `bench-activities-browser`, `bench-verify`
- Modify: `compose.test.yml` (add the `bench-fixtures` service), `.env.test`, `.github/workflows/ci.yml` (add the `bench-mock` job), `package.json`

**Interfaces:**
- Consumes: S9 (the `fixtures` network) and Tasks 19–21.
- Produces:
  - Service `bench-fixtures` at `http://bench-fixtures:8080`. Routes:
    - `/signin`
    - `/book`
    - `/book/activities`
    - `POST /api/complete`
    - `POST /__reset`, loopback only
    - `/healthz`
  - `startFixtureServer(options: {user; password; port}): Promise<{url; close()}>`
  - `fixturesSuite(): SuiteDefinition` containing `activities@computer_use` and `activities@browser_use`.
  - `pnpm bench:real-fixtures`

**Fixed layout for coordinate scenarios** (viewport 1280×800):

| Element | Centre |
|---|---|
| email | (640,302) |
| password | (640,372) |
| Sign in | (640,442) |
| book link "Section 1.1 activities" | (640,322) |
| A1 "Mars" radio | (280,222) |
| A1 Check | (480,222) |
| A2 Start | (260,412) |
| A2 Next | (400,412) |
| A3 input | (280,602) |
| A3 Check | (440,602) |
| "Back to book" | (1100,62) |

- [ ] **Step 1: Write the failing test.**

`tests/fixtures/bench-activities/server.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer } from "./server.ts";

let server: { url: string; close(): Promise<void> };
beforeAll(async () => {
  server = await startFixtureServer({ user: "u@x.test", password: "pw-0123456789", port: 0 });
});
afterAll(async () => server.close());

async function signIn(): Promise<string> {
  const r = await fetch(`${server.url}/signin`, {
    method: "POST",
    body: new URLSearchParams({ email: "u@x.test", password: "pw-0123456789" }),
    redirect: "manual",
  });
  expect(r.status).toBe(303);
  return r.headers.get("set-cookie")!.split(";")[0]!;
}

describe("bench-activities fixture", () => {
  it("redirects to sign-in without a session and rejects a wrong password", async () => {
    expect((await fetch(`${server.url}/book`, { redirect: "manual" })).status).toBe(303);
    const bad = await fetch(`${server.url}/signin`, { method: "POST", body: new URLSearchParams({ email: "u@x.test", password: "no" }), redirect: "manual" });
    expect(bad.status).toBe(401);
  });

  it("tracks completion server-side across sessions, so a separate verify run sees it", async () => {
    const a = await signIn();
    for (const id of ["a1", "a2", "a3"]) {
      const r = await fetch(`${server.url}/api/complete`, { method: "POST", headers: { cookie: a, "content-type": "application/json" }, body: JSON.stringify({ id }) });
      expect(r.status).toBe(204);
    }
    const b = await signIn();
    const html = await (await fetch(`${server.url}/book`, { headers: { cookie: b } })).text();
    expect(html).toContain("Participation: 3 of 3 activities completed (100%)");
  });

  it("rejects unknown activities and resets only from loopback", async () => {
    const a = await signIn();
    expect((await fetch(`${server.url}/api/complete`, { method: "POST", headers: { cookie: a, "content-type": "application/json" }, body: JSON.stringify({ id: "zz" }) })).status).toBe(400);
    expect((await fetch(`${server.url}/__reset`, { method: "POST" })).status).toBe(204);
    const html = await (await fetch(`${server.url}/book`, { headers: { cookie: await signIn() } })).text();
    expect(html).toContain("0 of 3");
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test -- tests/fixtures/bench-activities`
Expected: FAIL.

- [ ] **Step 3: Implement the server.**

`tests/fixtures/bench-activities/server.ts`:
```ts
// Benchmark fixture (test-only, no dependencies). A sign-in form, then a book with three
// participation activities. Progress is kept server-side per user, so a separate run can verify
// completion from the page. Interactive elements sit at fixed coordinates for scripted mock runs.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const ACTIVITIES = ["a1", "a2", "a3"] as const;
type ActivityId = (typeof ACTIVITIES)[number];

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;font:16px system-ui;background:#fff}.at{position:absolute}.f{width:400px;height:44px;box-sizing:border-box}
button.at,input.at{height:44px;box-sizing:border-box}</style></head><body>${body}</body></html>`;

async function readBody(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 10_000) throw new Error("body too large");
  }
  return data;
}

export async function startFixtureServer(options: { user: string; password: string; port: number }): Promise<{ url: string; close(): Promise<void> }> {
  const sessions = new Set<string>();
  const done = new Set<ActivityId>();
  const sid = (req: IncomingMessage) => /(?:^|;\s*)sid=([a-f0-9]{32})/.exec(req.headers.cookie ?? "")?.[1] ?? null;
  const signedIn = (req: IncomingMessage) => {
    const id = sid(req);
    return id !== null && sessions.has(id);
  };
  const send = (res: ServerResponse, status: number, html = "", headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(html);
  };
  const status = (id: ActivityId, n: number) =>
    done.has(id)
      ? `<span role="img" aria-label="Activity ${n} completed">✓ Activity ${n} completed</span>`
      : `<span role="img" aria-label="Activity ${n} not completed">○ Activity ${n} not completed</span>`;
  const progress = () => `Participation: ${done.size} of 3 activities completed (${Math.round((done.size / 3) * 100)}%)`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    try {
      if (url.pathname === "/healthz") return send(res, 200, "ok");
      if (url.pathname === "/__reset" && req.method === "POST") {
        const ip = req.socket.remoteAddress ?? "";
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return send(res, 403);
        sessions.clear();
        done.clear();
        return send(res, 204);
      }
      if (url.pathname === "/signin" && req.method === "GET") {
        return send(res, 200, page("Sign in", `<h1 class="at" style="left:440px;top:180px">Sign in</h1>
<form method="post" action="/signin">
<input class="at f" style="left:440px;top:280px" name="email" type="email" autocomplete="username" aria-label="Email">
<input class="at f" style="left:440px;top:350px" name="password" type="password" autocomplete="current-password" aria-label="Password">
<button class="at f" style="left:440px;top:420px" type="submit">Sign in</button></form>`));
      }
      if (url.pathname === "/signin" && req.method === "POST") {
        const form = new URLSearchParams(await readBody(req));
        if (form.get("email") !== options.user || form.get("password") !== options.password) return send(res, 401, page("Sign in", "<p>Wrong email or password.</p>"));
        const id = randomBytes(16).toString("hex");
        sessions.add(id);
        return send(res, 303, "", { location: "/book", "set-cookie": `sid=${id}; HttpOnly; SameSite=Lax; Path=/` });
      }
      if (!signedIn(req)) return send(res, 303, "", { location: "/signin" });
      if (url.pathname === "/book") {
        return send(res, 200, page("Book", `<h1 class="at" style="left:440px;top:120px">Fixture Book</h1>
<p class="at" style="left:440px;top:200px">${progress()}</p>
<a class="at f" style="left:440px;top:300px;display:block;line-height:44px" href="/book/activities">Section 1.1 activities</a>`));
      }
      if (url.pathname === "/book/activities") {
        return send(res, 200, page("Section 1.1", `<a class="at" style="left:1000px;top:40px;width:200px;height:44px;line-height:44px;display:block" href="/book">Back to book</a>
<p class="at" style="left:200px;top:60px">${progress()}</p>
<h2 class="at" style="left:200px;top:140px;margin:0">PARTICIPATION ACTIVITY 1: Which planet is the Red Planet? ${status("a1", 1)}</h2>
<label class="at" style="left:40px;top:200px;width:120px;height:44px"><input type="radio" name="p" value="venus"> Venus</label>
<label class="at" style="left:200px;top:200px;width:160px;height:44px"><input type="radio" name="p" value="mars"> Mars</label>
<button class="at" style="left:420px;top:200px;width:120px" onclick="if(document.querySelector('input[value=mars]').checked)complete('a1')">Check</button>
<h2 class="at" style="left:200px;top:330px;margin:0">PARTICIPATION ACTIVITY 2: Press Start, then Next twice ${status("a2", 2)}</h2>
<button class="at" style="left:200px;top:390px;width:120px" onclick="window.s=1">Start</button>
<button class="at" style="left:340px;top:390px;width:120px" onclick="if(window.s&&++window.s>=3)complete('a2')">Next</button>
<h2 class="at" style="left:200px;top:520px;margin:0">PARTICIPATION ACTIVITY 3: Type the number 42 ${status("a3", 3)}</h2>
<input class="at" style="left:200px;top:580px;width:160px" aria-label="Answer" id="a3">
<button class="at" style="left:380px;top:580px;width:120px" onclick="if(document.getElementById('a3').value.trim()==='42')complete('a3')">Check</button>
<script>function complete(id){fetch('/api/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}).then(()=>location.reload())}</script>`));
      }
      if (url.pathname === "/api/complete" && req.method === "POST") {
        const id = (JSON.parse(await readBody(req)) as { id?: unknown }).id;
        if (!ACTIVITIES.includes(id as ActivityId)) return send(res, 400);
        done.add(id as ActivityId);
        return send(res, 204);
      }
      return send(res, 404, "Not found");
    } catch {
      return send(res, 400);
    }
  });
  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const user = process.env.BENCH_FIXTURE_USER ?? "";
  const password = process.env.BENCH_FIXTURE_PASSWORD ?? "";
  if (!user || !password) throw new Error("BENCH_FIXTURE_USER and BENCH_FIXTURE_PASSWORD are required");
  const { url } = await startFixtureServer({ user, password, port: Number(process.env.PORT ?? 8080) });
  console.log(`bench-activities on ${url}`);
}
```
A1's radios are inside labels, so the label centre (280,222) checks Mars.

- [ ] **Step 4: Run it to verify it passes.**

Run: `pnpm test -- tests/fixtures/bench-activities`
Expected: PASS.

- [ ] **Step 5: Wire the stack, scenarios and suite.**

1. `.env.test` additions (dummy values, not secret):
```
BENCH_FIXTURE_USER=bench-user@fixtures.test
BENCH_FIXTURE_PASSWORD=bench-fixture-password-not-secret-0123
```

2. `compose.test.yml`:
```yaml
  bench-fixtures:
    image: node:24-slim
    command: ["node", "/srv/server.ts"]
    environment:
      BENCH_FIXTURE_USER: ${BENCH_FIXTURE_USER:?set BENCH_FIXTURE_USER}
      BENCH_FIXTURE_PASSWORD: ${BENCH_FIXTURE_PASSWORD:?set BENCH_FIXTURE_PASSWORD}
      PORT: "8080"
    volumes:
      - ./tests/fixtures/bench-activities:/srv:ro
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 2s
      timeout: 3s
      retries: 30
    networks:
      fixtures: {}
```

3. `compose.bench-real.yml` (real model on the test stack; agent only):
```yaml
# Real-model fixture benchmarks: the test stack, but the agent calls OpenAI.
# The key comes from the environment of scripts/bench-real-fixtures.sh and is never echoed.
services:
  agent:
    environment:
      OPENAI_API_KEY: ${OPENAI_API_KEY_REAL:?run via scripts/bench-real-fixtures.sh}
      OPENAI_BASE_URL: ""
```

4. `scripts/bench-real-fixtures.sh`:
```bash
#!/usr/bin/env bash
# Fixture benchmarks with the real model (about $10 cap). Reads the key from .env without printing it.
set -euo pipefail
cd "$(dirname "$0")/.."
OPENAI_API_KEY_REAL="$(grep -E '^OPENAI_API_KEY=' .env | cut -d= -f2-)"
export OPENAI_API_KEY_REAL
DC=(docker compose --env-file .env.test -f compose.yml -f compose.test.yml -f compose.bench-real.yml)
"${DC[@]}" up -d --build --wait --wait-timeout 420
pnpm bench init --stack test-real
pnpm bench run --suite fixtures --max-total-usd "${MAX_USD:-10}" "$@"
```
Add these root scripts:
- `"bench:real-fixtures": "bash scripts/bench-real-fixtures.sh"`
- `"bench:mock": "bash scripts/bench-mock.sh"`

Then create `scripts/bench-mock.sh`. It is the same as the script above without the key and the overlay, and runs `pnpm bench init --stack test && pnpm bench run --suite fixtures --mock`.

5. Mock scenarios in B1's format. Each item is one model response.
   - `bench-activities-computer`, in order:
     1. click (640,302)
     2. `fill_credential {alias:"bench-fixture", field:"username", target:"focused"}`
     3. click (640,372)
     4. `fill_credential` password, focused
     5. click (640,442)
     6. click (640,322)
     7. click (280,222)
     8. click (480,222)
     9. click (260,412)
     10. click (400,412)
     11. click (400,412)
     12. click (280,602)
     13. type "42"
     14. click (440,602)
     15. `AgentTurn done`
   - `bench-activities-browser`: `read_page {mode:"interactive", sinceHash:null}` first, then the same steps as `bench-activities-computer`.
   - `bench-verify`, in order:
     1. click (640,302)
     2. `fill_credential` username, focused
     3. click (640,372)
     4. `fill_credential` password, focused
     5. click (640,442)
     6. `read_page {mode:"text", sinceHash:null}`
     7. `done`

     If the slot already holds a session and the page opens on `/book`, the clicks are no-ops and the run still ends on `/book`.

6. `tests/bench/src/suites/fixtures.ts`:
```ts
import type { BenchmarkSpec, SuiteDefinition } from "../types.ts";

const ORIGIN = "http://bench-fixtures:8080";
const LOGIN = `Sign in at ${ORIGIN}/signin with the fill_credential tool and vault alias "bench-fixture" (username, then password); never type credentials yourself.`;
const HINT = {
  computer_use: 'To fill a credential, click the field first, then call fill_credential with target "focused".',
  browser_use: "Use read_page to find elements; element boxes give click coordinates.",
} as const;

function spec(toolProfile: "computer_use" | "browser_use"): BenchmarkSpec {
  return {
    key: "activities",
    toolProfile,
    task: `${LOGIN} ${HINT[toolProfile]} Open the book, open "Section 1.1 activities", and complete all three participation activities. Finish when the book page shows 3 of 3 activities completed.`,
    allowedOrigins: [ORIGIN],
    budget: { maxSteps: 80, maxUsd: 3, maxActiveMinutes: 20 },
    criterion: { kind: "page_text", url: `${ORIGIN}/book`, mustMatch: ["Participation: 3 of 3 activities completed \\(100%\\)"] },
    verify: {
      task: `${LOGIN} ${HINT.computer_use} Then open ${ORIGIN}/book and call read_page with mode "text" once. Do not click anything else. Then finish.`,
      budget: { maxSteps: 20, maxUsd: 1, maxActiveMinutes: 5 },
    },
    baselineMustPass: false,
    requiredVaultItem: { alias: "bench-fixture", origin: ORIGIN, fields: ["username", "password"] },
    reset: ["exec", "-T", "bench-fixtures", "node", "-e", "fetch('http://127.0.0.1:8080/__reset',{method:'POST'}).then((r)=>process.exit(r.ok?0:1))"],
    mockScenarios: { main: toolProfile === "computer_use" ? "bench-activities-computer" : "bench-activities-browser", verify: "bench-verify" },
  };
}

export function fixturesSuite(): SuiteDefinition {
  return { id: "fixtures", benchmarks: [spec("browser_use"), spec("computer_use")] };
}
```

7. The harness creates the fixture vault item **only on test stacks**. In `cli.ts`, before `runSuite`, when `values.suite === "fixtures"`:
```ts
if (env.BENCH_STACK === "local") throw new Error("fixture suite runs on the test stacks only");
const fixtureEnv = Object.fromEntries(
  (await import("node:fs")).readFileSync(".env.test", "utf8").split("\n").map((l) => l.split("=")).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join("=")]),
);
const items = (await api.vault.list({})).items;
if (!items.some((i) => i.alias === "bench-fixture")) {
  await api.vault.create({
    alias: "bench-fixture",
    origin: "http://bench-fixtures:8080",
    label: "Benchmark fixture (dummy)",
    secrets: { username: fixtureEnv.BENCH_FIXTURE_USER!, password: fixtureEnv.BENCH_FIXTURE_PASSWORD! },
    imap: null,
  });
}
```

8. Add a CI job:
```yaml
  bench-mock:
    name: Benchmark harness (fixtures, llm-mock, both tracks)
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Allow unprivileged user namespaces (slot sandbox)
        run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
      - run: pnpm bench:mock
```

- [ ] **Step 6: Run the mock benchmark, then the real one.**

Run: `pnpm bench:mock`
Expected:
- exit 0;
- `orchestration/benchmarks/<date>-fixtures-1/report.md` lists both tracks as `passed`;
- the `benchmark_runs` rows are graded.

Delete that mock report directory before committing. It is CI evidence, not a result.

Run: `pnpm bench:real-fixtures`
Expected:
- a report under `orchestration/benchmarks/` with a real cost per track;
- tickets for any failures.

Do **not** commit fixes in this task. Failures go into the Task 25 loop. Commit the report.

- [ ] **Step 7: Commit.**

```bash
git add tests/fixtures/bench-activities tests/bench/src/suites/fixtures.ts tests/bench/src/cli.ts tests/llm-mock compose.test.yml compose.bench-real.yml .env.test scripts/bench-*.sh package.json .github/workflows/ci.yml orchestration/benchmarks
git commit -m "feat(bench): dynamic activity fixture, both-track mock scenarios, real-model fixture run, CI bench-mock job"
```

---

### Task 23: zyBooks suite: calibration, guards and the no-site-hacks rule

**Files:**
- Create: `tests/bench/src/suites/zybooks.ts`, `tests/bench/src/suites/zybooks.test.ts`, `tests/bench/src/no-site-hacks.test.ts`
- Create (output, committed after review): `orchestration/benchmarks/zybooks/sections.json`
- Modify: `tests/bench/src/cli.ts` (add the `survey` command)

**Interfaces:**
- Consumes:
  - `SectionSpec`, `BenchmarkSpec` and `evidenceText`;
  - D32 and D34.
- Produces:
  - `ZybooksCalibration`, a Zod schema: `{book: url; patterns: {activity; completed}; sections: SectionSpec[]; calibratedAt; surveyRunId}`
  - `zybooksSuite(calibration?: ZybooksCalibration | null): SuiteDefinition`. It contains:
    - `login`, both tracks;
    - `reading-1` … `reading-5`, both tracks, only when calibrated.
  - `surveySpec(): BenchmarkSpec`
  - `pnpm bench survey`, which writes raw `read_page` output to the git-ignored `orchestration/benchmarks/.raw/zybooks-survey-<date>.json`.

- [ ] **Step 1: Write the failing tests.**

`tests/bench/src/no-site-hacks.test.ts`:
```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".next", "coverage", "migrations"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|jsx?|json|css|sql|ya?ml|html)$/.test(name) ? [path] : [];
  });
}

describe("benchmark isolation", () => {
  it("product code contains no zyBooks-specific logic (benchmarks must measure generic ability)", () => {
    const offenders = ["apps", "packages"]
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((file) => /zybook/i.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([]);
  });
});
```

`tests/bench/src/suites/zybooks.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ZybooksCalibration, zybooksSuite } from "./zybooks.ts";

const calibration = ZybooksCalibration.parse({
  book: "https://learn.zybooks.com/zybook/UTDALLASCE2310EE2310AkourFall2026",
  patterns: { activity: "PARTICIPATION ACTIVITY", completed: "Activity completed" },
  sections: [1, 2, 3, 4, 5].map((reading) => ({
    reading,
    title: `${reading}.1`,
    url: `https://learn.zybooks.com/zybook/UTDALLASCE2310EE2310AkourFall2026/chapter/${reading}/section/1`,
  })),
  calibratedAt: "2026-10-06",
  surveyRunId: "88888888-8888-4888-8888-888888888888",
});

describe("zybooks suite", () => {
  it("has only login benchmarks until calibrated", () => {
    expect(zybooksSuite(null).benchmarks.map((b) => `${b.key}@${b.toolProfile}`)).toEqual(["login@browser_use", "login@computer_use"]);
  });
  it("adds readings 1-5 for both tracks once calibrated, pinned to one origin and the vault alias", () => {
    const suite = zybooksSuite(calibration);
    expect(suite.benchmarks).toHaveLength(12);
    for (const b of suite.benchmarks) {
      expect(b.allowedOrigins).toEqual(["https://learn.zybooks.com"]);
      expect(b.requiredVaultItem).toEqual({ alias: "zybooks", origin: "https://learn.zybooks.com", fields: ["username", "password"] });
      expect(b.task).not.toMatch(/password\s*[:=]/i);
    }
    const r1 = suite.benchmarks.find((b) => b.key === "reading-1" && b.toolProfile === "computer_use")!;
    expect(r1.baselineMustPass).toBe(true);
    expect(r1.criterion).toMatchObject({ kind: "sections_complete", requireInteraction: true });
    expect(r1.verify.task).toContain("/chapter/1/section/1");
  });
  it("rejects calibration with sections outside the book", () => {
    expect(ZybooksCalibration.safeParse({ ...calibration, sections: [{ reading: 1, title: "x", url: "https://evil.example/x" }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test -- tests/bench/src/suites tests/bench/src/no-site-hacks`
Expected: the suite test FAILS. The no-site-hacks test should already PASS; if it fails, the product contains a site hack, and that hack must be removed.

- [ ] **Step 3: Implement.**

`tests/bench/src/suites/zybooks.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { SectionSpec, type BenchmarkSpec, type SuiteDefinition } from "../types.ts";

const ORIGIN = "https://learn.zybooks.com";
const BOOK = `${ORIGIN}/zybook/UTDALLASCE2310EE2310AkourFall2026`;
const CALIBRATION_FILE = "orchestration/benchmarks/zybooks/sections.json";

export const ZybooksCalibration = z
  .object({
    book: z.literal(BOOK),
    patterns: z.object({ activity: z.string().min(3), completed: z.string().min(3) }),
    sections: z.array(SectionSpec).min(5).max(200),
    calibratedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    surveyRunId: z.string().uuid(),
  })
  .refine((c) => c.sections.every((s) => s.url.startsWith(`${BOOK}/`)), { message: "every section must be inside the book" })
  .refine((c) => [1, 2, 3, 4, 5].every((r) => c.sections.some((s) => s.reading === r)), { message: "readings 1-5 all need sections" });
export type ZybooksCalibration = z.infer<typeof ZybooksCalibration>;

const VAULT = { alias: "zybooks", origin: ORIGIN, fields: ["username", "password"] } as const;
const LOGIN =
  `Sign in to zyBooks at ${ORIGIN}/signin. Use the fill_credential tool with vault alias "zybooks" for the email field and then the password field; ` +
  "never type credentials yourself. Submit the sign-in form.";
const HINT = {
  computer_use: 'To fill a credential, click the field first, then call fill_credential with target "focused".',
  browser_use: "Use read_page to find elements and their boxes; prefer it over guessing from pixels.",
} as const;
const RULES =
  "Do not change account settings, do not open challenge activities, labs or zyLabs, and do not leave learn.zybooks.com.";

function loadCalibration(): ZybooksCalibration | null {
  return existsSync(CALIBRATION_FILE) ? ZybooksCalibration.parse(JSON.parse(readFileSync(CALIBRATION_FILE, "utf8"))) : null;
}

function verifyTask(urls: readonly string[]): string {
  return `${LOGIN} ${HINT.computer_use} Then, for each of these pages in order, open it, scroll to the bottom once, and call read_page with mode "text" and then with mode "interactive": ${urls.join(" ")} Do not click inside any activity. Then finish.`;
}

function login(toolProfile: "computer_use" | "browser_use"): BenchmarkSpec {
  return {
    key: "login",
    toolProfile,
    task: `${LOGIN} ${HINT[toolProfile]} Then open ${BOOK} and finish when the book's table of contents is visible. ${RULES}`,
    allowedOrigins: [ORIGIN],
    budget: { maxSteps: 40, maxUsd: 2, maxActiveMinutes: 10 },
    criterion: { kind: "page_text", url: BOOK, mustMatch: ["(?:Table of contents|Chapter\\s+1)"] },
    verify: { task: verifyTask([BOOK]), budget: { maxSteps: 30, maxUsd: 2, maxActiveMinutes: 10 } },
    baselineMustPass: false,
    requiredVaultItem: VAULT,
    reset: null,
    mockScenarios: null,
  };
}

function reading(n: number, toolProfile: "computer_use" | "browser_use", c: ZybooksCalibration): BenchmarkSpec {
  const sections = c.sections.filter((s) => s.reading === n);
  return {
    key: `reading-${n}`,
    toolProfile,
    task:
      `${LOGIN} ${HINT[toolProfile]} Open ${BOOK}. Reading assignment ${n} consists of these sections: ` +
      `${sections.map((s) => `${s.title} (${s.url})`).join("; ")}. For every section, open it and complete every participation activity in it ` +
      "(answer the questions, run each animation to its end with its own controls) until zyBooks shows that activity as completed. " +
      `${RULES} Finish when every participation activity in these sections shows as completed.`,
    allowedOrigins: [ORIGIN],
    budget: { maxSteps: 900, maxUsd: 40, maxActiveMinutes: 180 },
    criterion: { kind: "sections_complete", sections, activityPattern: c.patterns.activity, completedPattern: c.patterns.completed, requireInteraction: true },
    verify: { task: verifyTask(sections.map((s) => s.url)), budget: { maxSteps: 40 + sections.length * 12, maxUsd: 4, maxActiveMinutes: 30 } },
    baselineMustPass: true,
    requiredVaultItem: VAULT,
    reset: null,
    mockScenarios: null,
  };
}

export function surveySpec(): BenchmarkSpec {
  return {
    ...login("browser_use"),
    key: "survey",
    task:
      `${LOGIN} Open ${BOOK}. Call read_page with mode "text", then with mode "interactive". Open the book's assignments list, ` +
      'and call read_page with mode "text" and "interactive" there. For reading assignments 1 to 5, open each one\'s section list ' +
      'and call read_page with mode "interactive" once. Open the first section of reading 1 and call read_page in both modes. ' +
      `Do not complete or click inside any activity. ${RULES} Then finish.`,
    budget: { maxSteps: 80, maxUsd: 4, maxActiveMinutes: 20 },
  };
}

export function zybooksSuite(calibration: ZybooksCalibration | null = loadCalibration()): SuiteDefinition {
  const tracks = ["browser_use", "computer_use"] as const;
  const benchmarks: BenchmarkSpec[] = tracks.map(login);
  if (calibration) for (const n of [1, 2, 3, 4, 5]) for (const t of tracks) benchmarks.push(reading(n, t, calibration));
  return { id: "zybooks", benchmarks };
}
```
This file lives under `tests/`, so `no-site-hacks` does not scan it.

`cli.ts` `survey` command. It is a plain run, not graded:
```ts
} else if (command === "survey") {
  const env = readBenchEnv();
  if (env.BENCH_STACK !== "local") throw new Error("survey runs only on the local stack");
  const { cookie, api } = await session(env);
  const spec = surveySpec();
  const problem = await checkVaultItem(api, spec.requiredVaultItem!);
  if (problem) { console.error(problem); process.exit(3); }
  const run = await api.runs.create({ goal: spec.task, allowedOrigins: [...spec.allowedOrigins], budget: spec.budget, targetFolderId: null, approvalMode: "auto_within_allowlist", toolProfile: "browser_use" });
  await watchRun({ api, baseUrl: env.BENCH_BASE_URL, cookie, log, now: Date.now }, run.id, { onBudget: "finish_now", humanTimeoutMs: 600_000, stallMs: 600_000 });
  const trace = await loadRunTrace(STACK_COMPOSE.local, run.id);
  mkdirSync("orchestration/benchmarks/.raw", { recursive: true });
  const out = `orchestration/benchmarks/.raw/zybooks-survey-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(out, JSON.stringify({ runId: run.id, pages: trace.steps.filter((s) => s.readPage).map((s) => ({ seq: s.seq, readPage: s.readPage })) }, null, 2));
  log(`survey evidence: ${out} (git-ignored). Author orchestration/benchmarks/zybooks/sections.json from it.`);
```
Add these imports: `checkVaultItem` and `surveySpec`.

Also apply the same vault precondition in `run` for `zybooks`. On failure, exit with code 3 and print the instructions. `runBenchmark` already throws `PreconditionFailed`, so catch it in `cli.ts`, print the message, and `process.exit(3)`.

- [ ] **Step 4: Run them to verify they pass.**

Run: `pnpm test -- tests/bench && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/bench
git commit -m "feat(bench): zyBooks suite (login, readings 1-5 x 2 tracks), calibration schema, survey command, no-site-hacks guard"
```

---

### Task 24: Orchestrator protocols: live watching, the failure loop and the fix brief

**Files:**
- Create: `orchestration/benchmarks/README.md`, `orchestration/briefs/bench-fix.md`

**Interfaces:**
- Consumes: Tasks 19–23.
- Produces: the binding protocol that Task 25 follows.

- [ ] **Step 1: Write the protocol.**

`orchestration/benchmarks/README.md`:
```markdown
# Benchmarks: protocol (D32–D34)

The user's acceptance test: the agent signs into zyBooks and completes the participation activities in
reading assignments 1–5 in `auto_within_allowlist` mode, with **no takeover**, on both capability tracks:
- `computer_use`: masked screenshots plus `computer`, `fill_credential` and `use_passkey`;
- `browser_use`: the full tool set, including `read_page` with element boxes and `capture`.

## Rules
1. **Credentials (D34).**
   - zyBooks credentials go into the app's Vault UI only, as alias `zybooks`, origin `https://learn.zybooks.com`, fields username and password.
   - Prefer the user typing them. If the user gives them to the orchestrator in chat, the orchestrator types them into the Vault UI through the browser tool.
   - They never go into a file, command, env var, commit, log or report.
   - The harness refuses `ZYBOOKS*` env vars and only checks that the vault item exists.
2. **Precondition (D32).** Readings 1–5 are already complete on the account. Every reading attempt first runs a verify run. If the page does not show completion, the harness stops (`BaselineIncomplete`). Only the user may authorise `--allow-incomplete-baseline`.
3. **No site hacks.**
   - Fixes land in generic product code.
   - `tests/bench/src/no-site-hacks.test.ts` fails on any `zybook` string under `apps/` or `packages/`.
   - Prompts, patterns and section lists live only in `tests/bench/` and `orchestration/benchmarks/zybooks/`.
4. **Grading.**
   - Grades come only from `read_page` evidence recorded by the agent's own tool in a separate verify run, never from the model's claims.
   - A section passes when its completion indicators count ≥ its activity count, and the main run acted on that section at least once per activity.
   - Any takeover caps the outcome at `partial`.

## Budgets

| Benchmark | Steps | USD | Active min |
|---|---|---|---|
| fixtures/activities (real) | 80 | 3 | 20 |
| zybooks/survey | 80 | 4 | 20 |
| zybooks/login | 40 | 2 | 10 |
| zybooks/reading-N | 900 | 40 | 180 |
| verify runs | 30–100 | 2–4 | 10–30 |

- Harness cap per invocation: `--max-total-usd` (default 120).
- Budget hits use `--on-budget` (`finish_now` by default; `extend_once` at most once).
- Going past $120 in one sitting needs the user's OK.

## Order of work
1. Run `pnpm prod:smoke` (Phase 9). Then:
   ```
   pnpm compose:local up -d --wait
   pnpm bench init --stack local
   ```
2. Vault item `zybooks` (rule 1). Sign in to the UI at http://localhost:18080 with the account from `.env.bench`.
3. `pnpm bench run --suite zybooks --only login --track both`.
4. `pnpm bench survey`. The orchestrator then reads the raw survey JSON and writes `orchestration/benchmarks/zybooks/sections.json`:
   - section titles and URLs per reading;
   - `patterns.activity` and `patterns.completed`, the exact strings the page shows per participation activity and per completed one.

   Commit it. The JSON schema validates it.
5. Readings, one at a time, `browser_use` first:
   ```
   pnpm bench run --suite zybooks --only reading-1 --track browser_use
   ```
   Then repeat for `computer_use`, then reading 2, and so on.

## Watching a live run
- Run the harness with `run_in_background` and follow its log with Monitor. Lines include status, step captions, budget decisions, `NEEDS HUMAN` and `control`.
- Open `http://localhost:18080/runs/<runId>` in the browser tool to watch the n.eko stream and the timeline.
- Interventions, in order of preference:
  1. Do nothing. Let the run finish, stall (10 min) or time out a human wait (10 min). The harness cancels and grades it.
  2. Cancel from the run view if it is clearly looping and burning money. Write that in the ticket.
  3. **Takeover is a last resort**: only to unblock a CAPTCHA or a broken state that would invalidate the next attempts, and only after the failure (step, screenshot key, reason) is written down. It is counted, and the run cannot pass.

## Failure loop
For each non-passing result, the harness writes `tickets/BT-####.md`, prefilled with:
- the failing step and screenshot key;
- the URL;
- a suggested class: perception, action, navigation, auth, policy or budget.

Then:
1. **Triage.** The orchestrator opens the replay (step screenshots), confirms or corrects the class, and fills in "What the agent saw vs. did" and "Generic root cause".
2. **Fix.** Dispatch a fixer subagent with `orchestration/briefs/bench-fix.md` and the ticket. Fix by class:
   - perception: `read_page` coverage of state such as aria-labels or role=img, or screenshot timing and masking;
   - action: CDP input reliability, waits, scroll;
   - navigation: allowlist handling, URL/state restore;
   - auth: the vault fill path, focused target, storageState;
   - policy: the approval classifier, or the benchmark's allowed origins in `tests/bench` (with the reason);
   - budget: compaction, `{unchanged:true}` use, cheaper observation, or the benchmark budget (with evidence).
3. **Review.** A fresh reviewer subagent. CI is green (`pnpm test`, `pnpm test:int`, `pnpm e2e`, `pnpm bench:mock`).
4. **Re-run** the same benchmark and track. Link the new report in the ticket and close the ticket only if this failure is gone.
5. **Repeat** until every `reading-1..5` passes on `browser_use`, then on `computer_use`. Done means every reading is `passed` on both tracks in one final full invocation:
   ```
   pnpm bench run --suite zybooks --track both
   ```
   with zero takeovers.

If a track looks impossible within the budgets (for example `computer_use` needs over $40 per reading after three fix rounds), stop and report to the user with the numbers. Do not raise budgets silently.
```

`orchestration/briefs/bench-fix.md`:
```markdown
# Brief: benchmark fix (one ticket)

Ticket: **{{TICKET}}** (`orchestration/benchmarks/tickets/{{TICKET}}.md`). Save the run log under `orchestration/runs/`.

1. Read the ticket, the linked report and `orchestration/benchmarks/README.md`. The fix must be generic.
   Nothing site-specific goes under `apps/` or `packages/`; `no-site-hacks.test.ts` enforces this.
2. Reproduce the cause with a **failing test** first:
   - a fixture page under `tests/fixtures/` that has the same structural trait (for example a completion icon exposed only via aria-label), plus an agent-behaviour or unit test;
   - or a unit test of the failing module.
3. Implement the smallest fix that makes it pass. Follow CLAUDE.md (bloat-free, security-first; no new dependency unless essential).
4. Run `pnpm test && pnpm test:int && pnpm typecheck && pnpm lint && pnpm bench:mock`.
5. Commit with `fix(<area>): … (refs {{TICKET}})`. Add the sha to the ticket.
6. Do not run real-model benchmarks; the orchestrator re-runs them.
```

- [ ] **Step 2: Commit.**

```bash
git add orchestration/benchmarks/README.md orchestration/briefs/bench-fix.md
git commit -m "docs(bench): live-watch, takeover-as-last-resort, budgets and failure-loop protocol; fix brief"
```

---

### Task 25: Execute the benchmark loop until zyBooks fully completes

**Files:**
- Create (outputs): `orchestration/benchmarks/<date>-zybooks-<n>/report.md`, `orchestration/benchmarks/tickets/BT-*.md`, `orchestration/benchmarks/zybooks/sections.json`
- Modify: product code, via tickets only

**Interfaces:**
- Consumes: everything above.
- Produces: a final report in which `zybooks/reading-1..5` are `passed` on both tracks with 0 takeovers.

The orchestrator executes this task and follows `orchestration/benchmarks/README.md` exactly.

- [ ] **Step 1: Fixtures first.**

Run `pnpm bench:real-fixtures`. Loop any tickets through the failure loop until both fixture tracks pass. This de-risks the harness and the generic skills cheaply.

- [ ] **Step 2: Local stack and vault.**

Run `pnpm compose:local up -d --wait && pnpm bench init --stack local`.

Ask the user to enter the zyBooks credentials in the Vault UI, or to give them in chat so the orchestrator can type them there. Wait until `pnpm bench run --suite zybooks --only login --track browser_use` gets past the vault check.

- [ ] **Step 3: Login benchmarks.**

Run the login benchmark on both tracks. Loop on failures.

- [ ] **Step 4: Calibrate.**

Run `pnpm bench survey`, then author and commit `sections.json`:

```bash
git add orchestration/benchmarks/zybooks/sections.json
git commit -m "bench: zyBooks calibration (sections and completion patterns)"
```

If the survey shows that `read_page` cannot see per-activity completion in either mode, file a perception ticket. That is the first product fix.

- [ ] **Step 5: Readings, one at a time.**

For each reading N in 1..5:
1. Run the `browser_use` track, and loop until it passes.
2. Run the `computer_use` track, and loop until it passes.

Commit each report and each closed ticket as you go:

```bash
git commit -m "bench: zybooks reading-N <track> <outcome>"
```

- [ ] **Step 6: Final run.**

Run: `pnpm bench run --suite zybooks --track both --max-total-usd <user-approved cap>`
Expected:
- exit 0;
- all 12 benchmarks `passed`;
- 0 takeovers.

Commit the final report and update `orchestration/STATE.md` with the D32 result.

```bash
git add orchestration
git commit -m "bench: zyBooks acceptance passed on computer_use and browser_use (D32)"
```

If a blocking issue appears, stop and report to the user (D32). Examples:
- the account no longer shows readings complete;
- zyBooks blocks automated sessions;
- a track exceeds its budget after three fix rounds.

**Phase 10 exit:** the final report shows readings 1–5 `passed` on both tracks with zero takeovers, and CI `bench-mock` is green.

---

## Self-Review

**1. Spec coverage.**

| Requirement | Task(s) |
|---|---|
| §16 Phase 7: wire F to B over oRPC, SSE and the live iframe | 2, 3 |
| §12 E2E stack: `browser-1..2`, Traefik, fixtures, greenmail, llm-mock, `e2e` | 1, 4 |
| WebRTC playback over the TCP mux | 1 (UDP-disabled flag, NAT1TO1 per slot), 5 |
| Takeover E2E (§10.3: 2s control event, agent paused, real input, hand back) | 5 |
| §12 security tests in CI | 6 (canary scan incl. OCR and model requests, key placement, `security:` suite job) |
| D22 swarm at 5 widths × 2 themes, report format | 9, 11 |
| Automated backing: visual regression with the stubbed live iframe, overflow detector, axe | 7, 8 |
| D28 animation pass with a CDP trace | 10, 11 |
| Fix loop until zero open findings | 9 (ledger), 11 |
| §13 Dokploy labels, firewall ports, sysctl | 12, 13 |
| §13 secrets and backups | 14 |
| Local production-like smoke with a real note and a takeover; no deploy | 15 |
| D33 `approvalMode` and the `benchmarks`/`benchmark_runs` metrics, incl. takeovers | 16, 18 |
| Two tracks via a minimal contract addition | 16, 17 |
| Harness over the real oRPC API, Markdown reports | 19–21 |
| Fixture tasks with mock and real model | 22 |
| zyBooks login and readings 1–5; credentials via the Vault UI | 23, 25 |
| Success verifiable from the page via `read_page` | 20 (evidence from the agent's own tool results), 21 (verify runs) |
| Failure loop (step, screenshot, class, ticket, review, re-run) | 20, 21, 24, 25 |
| Budgets and live watching; takeover last resort and counted | 19 (watcher), 20 (cap), 24 |

**2. Placeholder scan.** These are the deliberately non-literal parts:
- **Seam adaptations (S1–S13).** Each one has a seam-check grep and a rule to adapt names without renaming the other phase's code.
- **Mock scenarios.** They are specified turn by turn but written in B1's unknown file format.
- **`browser-2..6` slot labels in `compose.prod.yml`.** They are spelled out as "identical with the name replaced", because YAML cannot template names.
- **Task 11 and Task 25.** They are operational loops whose fixes depend on findings.

No "TBD" or "add validation" remains.

**3. Type consistency.**
- `toolProfile` and `ToolProfile` match across contracts, DB (`tool_profile`), agent and harness.
- `takeovers` matches across DB, `BenchmarkRunView`, `toRunView` and `BenchmarkResult.metrics`.
- `scenarioGoal` is defined once (T1) and used in T4, T5 and T21.
- `RunTrace`/`TraceStep.credentialError` are used consistently in T20 and T21.
- `WatchState.humanWait` matches `FailureSignals.humanWait`.
- `RunnerDeps.watch` is an optional override, used only by tests.

**4. Review Focus mapping.**
1. NOT_FOUND/401 → Task 2.
2. SSE resume and dedupe, stale `openLive` → Tasks 3 and 4.
3. Early grading and snapshot stability → Task 18.
4. Takeover cap and baseline guard → Tasks 20 and 21.
5. Credential leakage → Tasks 6, 19 and 23.

**5. Recorded deviations and assumptions.**
- **Benchmark evidence** is read from `run_steps` via `psql` as owner inside the stack. Postgres is not published, and adding step results to the API would expose page text to the UI. A shape change raises `SeamMismatch` loudly.
- **Dokploy web routing** comes from Dokploy's Domains tab, not hand-written labels. Only the `/live` slot routers are labels, and they are scoped by `Host(DOMAIN)` because Dokploy's Traefik is shared.
- **CI frame time.** The motion trace's frame-time assertion runs only locally with a GPU (`MOTION_FRAMES=1`). Layout and paint counts gate everywhere, because headless CI frame timing is not meaningful.

---

Plan complete. The orchestrator saves it to `docs/superpowers/plans/2026-10-05-phase-7-10-integration-qa-deploy-benchmark.md`. Execution is subagent-driven, per D35.
