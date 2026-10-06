# Phase 0: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared foundations for later phases:
- a pnpm monorepo;
- every contract in `packages/contracts`;
- the full Drizzle schema, migrations, roles and triggers in `packages/db`;
- the Garage wrapper in `packages/storage`;
- skeleton `web` (Next.js 16 + Better Auth) and `agent` services;
- the n.eko `browser-slot` image;
- Compose with isolated networks, plus Traefik in the test overlay;
- CI.

Phase 0 is done when the stack boots healthy and a slot's CDP port is reachable only from `agent`.

**Architecture:**
- **TypeScript without a build step.** All TypeScript is ESM. Workspace packages export their `.ts` sources directly:
  - Node 24 runs them with native type stripping;
  - Next.js transpiles them through `transpilePackages`.
- **Contracts.** `packages/contracts` is browser-safe Zod 4. Its subpath `./server` holds the Node-only helpers: the pino logger and n.eko password derivation.
- **Database.** `packages/db` owns:
  - the Drizzle schema and drizzle-zod row schemas;
  - SQL migrations;
  - an idempotent grants file;
  - a `migrate` one-shot.
- **Storage.** `packages/storage` owns:
  - the S3 wrapper;
  - an idempotent Garage bootstrap that uses the Garage v2 admin API.
- **Compose.** Compose wires four networks: `edge`, `backend`, `cdp` (internal, with static IPs) and `egress`.
- **Browser slots.** Each slot runs n.eko with headed, sandboxed Chromium and `socat`. An iptables filter at startup lets only `agent` reach CDP, and only `web` and Traefik reach n.eko.

**Tech Stack:**
- Runtime and tooling: Node 24, pnpm 10.34.6, TypeScript 6.0.3, Zod 4.6.5, Vitest 5.0.3, ESLint 10 and typescript-eslint 8.71, Prettier 3.9.
- Libraries: oRPC 1.15.4 contracts, Drizzle 0.45.3 with drizzle-kit 0.31.11 and drizzle-zod 0.8.3, postgres.js 3.4.9, AWS SDK v3 (3.1146.0), pino 10.4.0, Next.js 16.3.8 with React 19.3, Better Auth 1.7.7.
- Images: `pgvector/pgvector:pg17`, `dxflrs/garage:v2.3.0`, `ghcr.io/m1k1o/neko/chromium:3.1.6`, `traefik:v3.7.13`, `node:24-slim`.
- Test infrastructure: Testcontainers 12.2.0.

**Spec:** `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` (final, commit a3a59f0). Decisions D1–D35 in `orchestration/STATE.md` override the spec. `CLAUDE.md` is mandatory. Executors read all three.

**Orchestrator amendments that apply here:**
1. **Benchmark mode.**
   - `runs.approval_mode` is `ask | auto_within_allowlist`. Auto mode still writes every decision to `approvals` with `decided_by='policy'`, and it still blocks out-of-allowlist navigation.
   - Two new tables, `benchmarks` and `benchmark_runs`.
2. **Test slots.** `compose.test.yml` runs only `browser-1` in Phase 0.
3. **Animation library.** `motion` is the only animation library. Nothing is installed in Phase 0.

---

## Planning-time verification (already proven on this machine; do not re-litigate)

These were verified empirically on 2026-10-05 (Docker 28.5 / Compose 2.40.3, macOS arm64):

1. **Chromium sandbox under Docker's default seccomp fails** with "Failed to move to new namespace … Operation not permitted". It works with a custom profile: Docker's default profile with `clone`, `clone3`, `unshare` and `setns` allowed. Task 14 generates that profile. **Never add `--no-sandbox`.**
2. **Chrome rejects DevTools HTTP requests whose `Host` header is a hostname.** `curl http://browser-1:9223/json/version` returns "Host header is specified and is not an IP address or localhost". Always resolve the slot name to an IP first. B1 must do the same before `connectOverCDP`.
3. The n.eko Xorg dummy config has **no 1280×800 mode**. Task 14 adds `Modeline "1280x800_30.00" 37.90 1280 1288 1416 1552 800 801 804 814 -HSync +Vsync`. This was verified: `xdotool getdisplaygeometry` returned `1280 800`.
4. **The iptables INPUT and OUTPUT filters work inside the slot with `cap_add: NET_ADMIN`.** Container DNS and internet access keep working with RFC1918 egress rejected.
5. **The supervisor event listener works.** It kills supervisord when Chromium exits, and the container then exits with code 0.
6. **n.eko `POST /api/login` with the HMAC-derived passwords works**: 200 for the right password, 401 for a wrong one. The bash `openssl dgst -sha256 -hmac` output matches Node's `createHmac`.
7. **Garage v2.3.0:**
   - The image has **no shell**.
   - `/health` returns 503 until a layout is applied.
   - The admin API at `/v2/*` works as used in Task 10.
   - `CreateBucket` and `ImportKey` return 409 if the item exists.
   - AWS SDK v3.1146 defaults (put, get, head, presign) work against it.
8. **Compose:**
   - A relative `seccomp=./…` path resolves relative to the compose file.
   - `profiles: !override [...]` disables a service in an overlay.
   - `up --wait` succeeds with one-shot `service_completed_successfully` dependencies.
9. **postgres.js:**
   - `sql.unsafe()` runs multi-statement SQL, including DO blocks.
   - String parameters bind into `uuid`, enum and `vector` columns.
   - Array membership must use `${sql.array(names)}`.

---

## Global Constraints

Every task implicitly includes all of these.

**Toolchain**
- **Node** ≥ 24.4. **pnpm** 10.34.6, pinned via `packageManager`. Install it with `corepack enable pnpm`, or `npm i -g pnpm@10.34.6` if corepack fails.
- **Exact versions only** (no `^`):

  | Group | Pins |
  |---|---|
  | Language and tooling | typescript 6.0.3, @types/node 24.19.1, eslint 10.12.0, @eslint/js 10.0.1, typescript-eslint 8.71.1, eslint-config-prettier 10.1.8, prettier 3.9.9, vitest 5.0.3, vite 8.3.2 |
  | Contracts and data | zod 4.6.5, @orpc/contract 1.15.4, pino 10.4.0, drizzle-orm 0.45.3, drizzle-zod 0.8.3, drizzle-kit 0.31.11, postgres 3.4.9 |
  | Storage | @aws-sdk/client-s3 3.1146.0, @aws-sdk/s3-request-presigner 3.1146.0 |
  | Test containers | testcontainers 12.2.0, @testcontainers/postgresql 12.2.0 |
  | Web | next 16.3.8, react 19.3.0, react-dom 19.3.0, @types/react 19.3.0, @types/react-dom 19.3.0, better-auth 1.7.7 |

  - TypeScript stays on 6.0.x because typescript-eslint requires `<6.1`.
  - Add no other dependency unless a step names it.

**TypeScript rules**
- ESM everywhere (`"type": "module"`).
- Relative imports carry the `.ts` extension, for Node type stripping.
- No TypeScript `enum`, `namespace` or parameter properties (`erasableSyntaxOnly`).
- Type-only imports use `import type`.

**Types and schemas**
- **One source per type.**
  - Every domain or API type is `z.infer` of a schema in `@mastertutor/contracts`.
  - DB row schemas come from drizzle-zod in `@mastertutor/db`.
- **Deviation from spec §3.2, recorded here:** DB row schemas are exported from `@mastertutor/db`, **not** re-exported through contracts. Re-exporting would create a contracts↔db cycle, and CLAUDE.md principle 5 forbids cycles. Wire DTOs live in contracts.
- **Model-facing schemas:** schemas sent to OpenAI (tool args, `AgentTurn`, `CompactionSummary`, `FilingDecision`) use `.nullable()`, never `.optional()`. Their root is a `z.object`. A test enforces this.

**Environment and secrets**
- Env is parsed at boot with `parseEnv(Schema, process.env)`. Errors name keys only and never values.
- Secrets never appear in logs, test output, commits or command echoes.
- Never `cat`, `echo` or print the root `.env`. `.env` is git-ignored. `.env.test` holds only dummy test values and is committed.

**Platform values**

| Item | Value |
|---|---|
| Models | `gpt-6-astra` (agent), `gpt-6.1-sol` (fallback), `gpt-6-luna` (filing), `gpt-4o-transcribe-diarize` (ASR), `text-embedding-3-small` (embeddings, 1536 dimensions) |
| Slots | N = 6, `browser-1..6`, always on |
| Media ports | `5900N` UDP and TCP (59001–59006) |
| Viewport | 1280×800 at device scale factor 1 |
| Ports inside a slot | CDP 9222 on loopback, `socat` on 9223, n.eko 8080, PulseAudio 4713 |

**Network membership**

| Service | `edge` | `backend` | `cdp` | `egress` |
|---|---|---|---|---|
| `web` | ✓ | ✓ | `.11` | |
| `agent` | | ✓ | `.10` | |
| Traefik (test overlay) | ✓ | | `.12` | |
| Slots | | | ✓ | ✓ |
| `postgres`, `garage`, `migrate`, `garage-init` | | ✓ | | |

- `cdp` is `internal: true`, with subnet `${CDP_SUBNET_PREFIX:-172.30.231}.0/24`.
- `web` and `agent` never call each other.

**Slot runtime**
- Chromium's sandbox stays **on**, via the custom seccomp profile.
- Ubuntu 24.04 hosts (CI and probably the Dokploy server) need `sysctl kernel.apparmor_restrict_unprivileged_userns=0`.

**Process**
- Commit at the end of each task.
- Work on the current branch. Do not push.
- End each commit message with the attribution lines your session's system reminder specifies.
- **Disk:** only about 19 GB is free. The n.eko base image is 2.2 GB and is already pulled.
  - After Docker-heavy tasks, run `docker builder prune -f` and `docker image prune -f`.
  - Never `docker system prune -a`, because it would delete the pulled base images.

## Review Focus

These are the inputs most likely to bite a real user that no other test pins. Each line has a test in the owning task.

1. **Origins typed in any form**, such as `Example.COM/path`, `example.com`, `https://x.com:443`, a Unicode IDN, `user:pw@host`, `javascript:…` or `file://`, normalize to exactly one `scheme://host[:port]` string or are rejected. Allowlists and vault pinning depend on this. *Test: Task 1, `primitives.test.ts`.*
2. **A malformed secret env var never echoes its value** in the boot error, which ends up in Dokploy logs. *Test: Task 5, `env.test.ts`.*
3. **Simultaneous or repeated first sign-ups** produce exactly one owner workspace. Sign-up closes after the first user unless `AUTH_SIGNUP_OPEN=1`. *Tests: Task 9, `queries.int.test.ts` (concurrent `ensureWorkspaceMember`), and Task 13, `auth.int.test.ts`.*
4. **A slot restart must not carry the previous run's browser profile.** Compose `restart: always` reuses the container's writable layer. *Test: Task 14, `verify.sh` (marker file in the profile, kill Chromium, restart, marker gone).*
5. **Untrusted file names** from pages (`../../etc/passwd`, `..`, control characters, 300-character names, Unicode) become one safe object-key segment, and the extension is kept. *Test: Task 11, `keys.test.ts`.*

---

## File Structure

```
package.json                     root scripts + dev tooling (Task 1; deps added Task 15)
pnpm-workspace.yaml              workspace globs + onlyBuiltDependencies
tsconfig.base.json               shared strict compiler options
tsconfig.json                    root typecheck for vitest.config.ts, scripts/, tests/, apps/browser-slot/
eslint.config.js                 flat config (TS, contracts browser-safety rule, prettier)
.prettierrc.json / .prettierignore
vitest.config.ts                 projects: unit (*.test.ts) and integration (*.int.test.ts)
.gitignore                       (modified)
.dockerignore                    (Task 15)
Dockerfile                       node-runtime + web targets (Task 15)
compose.yml / compose.test.yml   (Task 15)
.env.example / .env.test         (Task 15)
infra/garage/garage.toml         single Garage config (Task 10), used by Compose and Testcontainers
infra/traefik/test-dynamic.yml   Traefik file-provider routes for the test overlay (Task 15)
scripts/env-init.ts (+ .test.ts) fills missing local secrets into .env (Task 15)
scripts/compose-smoke.sh         Phase 0 "done when" check (Task 16)
tests/compose/compose-config.int.test.ts  compose ↔ env-contract and topology assertions (Task 15)
.github/workflows/ci.yml         (Task 17)

packages/contracts/              @mastertutor/contracts (Tasks 1–6)
  src/index.ts                   browser-safe barrel
  src/enums.ts                   every enum tuple + z.enum
  src/primitives.ts              ids, origins, aliases, slot names, key formats
  src/constants.ts               models, viewport, ports, limits
  src/budget.ts                  Budget, Usage, Plan
  src/run.ts                     RunError, ScrollPosition
  src/note.ts                    Anchor, NoteBlock
  src/agent-turn.ts              AgentTurn, CompactionSummary, FilingDecision
  src/tools.ts                   the 7 tools' args/results
  src/approval.ts                ApprovalRequest, RISKY_ACTION, auto-mode policy
  src/events.ts                  RunEvent union
  src/notify.ts                  NOTIFY channels + ≤200-byte payloads
  src/live.ts                    live-view (n.eko) contracts
  src/env.ts                     per-service env schemas + parseEnv
  src/api/dto.ts                 request/response DTOs
  src/api/contract.ts            oRPC router contract
  src/server/{index,logger,neko}.ts  Node-only helpers (subpath ./server)
  src/testing/strict-schema.ts   test helper (structured-output strictness)

packages/db/                     @mastertutor/db (Tasks 7–9)
  drizzle.config.ts
  src/schema/{columns,enums,auth,workspace,library,runs,vault,benchmarks,index}.ts
  src/zod.ts                     drizzle-zod select/insert schemas + row types
  src/client.ts                  createDb
  src/migrate.ts                 runMigrations (migrations + grants + role passwords + slot sync)
  src/queries/{slots,workspace,settings}.ts
  src/testing.ts                 startTestDatabase (subpath ./testing)
  src/bin/migrate.ts             compose one-shot entry
  sql/grants.sql                 idempotent role grants
  migrations/                    0000_extensions, 0001_init (generated), 0002_triggers

packages/storage/                @mastertutor/storage (Tasks 10–11)
  src/garage-admin.ts            bootstrapGarage, waitForGarageAdmin
  src/keys.ts                    objectKeys, safeFilename, isObjectKey
  src/s3.ts                      createStorage
  src/testing.ts                 startTestGarage (subpath ./testing)
  src/bin/garage-init.ts         compose one-shot entry

apps/agent/                      @mastertutor/agent (Task 12)
  src/main.ts, src/health.ts, src/boot-checks.ts, src/slots/probe.ts, src/bin/probe-slot.ts

apps/web/                        @mastertutor/web (Task 13)
  next.config.ts, tsconfig.json, instrumentation.ts
  app/layout.tsx, app/page.tsx, app/healthz/route.ts, app/api/auth/[...all]/route.ts
  lib/server/{env,db,auth}.ts (+ auth.int.test.ts)

apps/browser-slot/               slot image (Task 14), no package.json
  Dockerfile, .dockerignore, policies.json, supervisord/chromium.conf
  bin/{slot-entrypoint,exit-on-chromium,slot-health}
  seccomp/build-profile.ts (+ .test.ts), seccomp/chromium.json (generated, committed)
  test/verify.sh
```

---

### Task 1: Monorepo toolchain + contracts primitives

**Files:**
- Modify: `.gitignore`
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/{enums,primitives,constants,index}.ts`
- Test: `packages/contracts/src/{enums,primitives,constants}.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - **Root scripts:** `pnpm lint`, `pnpm format`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (the unit project), `pnpm test:int` (the integration project).
  - **Test file naming:**
    - `*.test.ts` is a unit test.
    - `*.int.test.ts` is an integration test with a 120s test timeout and 300s hook timeout, run serially.
  - **From `@mastertutor/contracts`, each enum below is a tuple plus a `z.enum` plus a type:**
    - `RUN_STATUSES`/`RunStatus` and `TERMINAL_RUN_STATUSES`;
    - `WAIT_REASONS`/`WaitReason`, `CONTROLLERS`/`Controller`, `APPROVAL_MODES`/`ApprovalMode`;
    - `STEP_PHASES`/`StepPhase`, `STEP_STATES`/`StepState`;
    - `APPROVAL_KINDS`/`ApprovalKind`, `APPROVAL_STATUSES`/`ApprovalStatus`;
    - `SOURCE_KINDS`/`SourceKind`, `FILED_BY`/`FiledBy`, `FIDELITIES`/`Fidelity`;
    - `BLOCK_TYPES`/`BlockType`, `BLOCK_ORIGINS`/`BlockOrigin`, `MEMBER_ROLES`/`MemberRole`;
    - `VAULT_SECRET_FIELDS`/`VaultSecretField`, `TYPED_SECRET_FIELDS`/`TypedSecretField`, `CREDENTIAL_FIELDS`/`CredentialField`, `VAULT_AUDIT_ACTIONS`/`VaultAuditAction`;
    - `SLOT_STATES`/`SlotState`, `LEASE_PRIORITIES`/`LeasePriority`, `WAKE_REASONS`/`WakeReason`;
    - `BENCHMARK_OUTCOMES`/`BenchmarkOutcome`, `ANNOTATE_KINDS`/`AnnotateKind`, `VIDEO_OPS`/`VideoOp`;
    - `NEED_HUMAN_REASONS`/`NeedHuman`, `AGENT_TURN_STATUSES`/`AgentTurnStatus`.
  - **Primitives:** `Uuid`, `UserId`, `IsoDateTime`, `IsoDate`, `Sha256Hex`, `Alias`, `SLOT_NAME_PATTERN`, `SlotName`, `ElementRef`, `DbPassword`, `GarageKeyId`, `GarageSecret`, `Base64Key32`, `PostgresUrl`, `BucketName`, `toOrigin(input: string): string | null`, `Origin`, `OriginInput`, `FolderName`.
  - **Constants:**
    - `MODELS` (`agentPrimary`, `agentFallback`, `filing`, `transcription`, `embeddings`) and `EMBEDDING_DIMENSIONS`;
    - `VIEWPORT`, `DEFAULT_SLOT_COUNT`, `DEFAULT_CONCURRENCY`, `NOTIFY_MAX_BYTES`;
    - `CDP_LOCAL_PORT`, `CDP_PROXY_PORT`, `NEKO_PORT`, `PULSE_TCP_PORT`, `MEDIA_PORT_BASE`;
    - `mediaPortForSlot(slot: string): number`.

- [ ] **Step 1: Install pnpm.**

Run:
```bash
corepack enable pnpm 2>/dev/null || npm i -g pnpm@10.34.6
pnpm --version
```
Expected: a version is printed. After Step 3 adds `packageManager`, `pnpm --version` inside the repo prints `10.34.6`. If corepack prints a permission error, the `npm i -g` fallback covers it.

- [ ] **Step 2: Write the workspace config files.**

`.gitignore` (replace the whole file):
```gitignore
.superpowers/
node_modules/
.env
.env.local
.next/
next-env.d.ts
coverage/
*.tsbuildinfo
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
onlyBuiltDependencies:
  - esbuild
```

`package.json`:
```json
{
  "name": "mastertutor",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.34.6",
  "engines": { "node": ">=24.4" },
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc -p tsconfig.json && pnpm -r typecheck",
    "test": "vitest run --project unit",
    "test:int": "vitest run --project integration"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "24.19.1",
    "eslint": "10.12.0",
    "eslint-config-prettier": "10.1.8",
    "prettier": "3.9.9",
    "typescript": "6.0.3",
    "typescript-eslint": "8.71.1",
    "vite": "8.3.2",
    "vitest": "5.0.3"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  }
}
```

`tsconfig.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "include": [
    "vitest.config.ts",
    "scripts/**/*.ts",
    "tests/**/*.ts",
    "apps/browser-slot/**/*.ts"
  ]
}
```

`eslint.config.js`:
```js
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "packages/db/migrations/**",
      "orchestration/**",
      "design/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["packages/contracts/src/**/*.ts"],
    ignores: ["packages/contracts/src/server/**", "packages/contracts/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "pino"],
              message:
                "The contracts root entry must stay browser-safe; put Node-only code in src/server/.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
```

`.prettierrc.json`:
```json
{ "printWidth": 100 }
```

`.prettierignore`:
```
pnpm-lock.yaml
packages/db/migrations/
apps/browser-slot/seccomp/chromium.json
orchestration/
design/
docs/
CLAUDE.md
ts.md
.superpowers/
**/.next/
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

const exclude = ["**/node_modules/**", "**/.next/**"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "packages/**/*.test.ts",
            "apps/**/*.test.ts",
            "scripts/**/*.test.ts",
            "tests/**/*.test.ts",
          ],
          exclude: [...exclude, "**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/**/*.int.test.ts", "apps/**/*.int.test.ts", "tests/**/*.int.test.ts"],
          exclude,
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
```

`packages/contracts/package.json`:
```json
{
  "name": "@mastertutor/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server/index.ts"
  },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@orpc/contract": "1.15.4",
    "pino": "10.4.0",
    "zod": "4.6.5"
  }
}
```

`packages/contracts/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Then run `pnpm install`. Expected: a lockfile is created and nothing fails.

- [ ] **Step 3: Write the failing tests.**

`packages/contracts/src/primitives.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  Alias,
  Base64Key32,
  DbPassword,
  ElementRef,
  FolderName,
  GarageKeyId,
  Origin,
  OriginInput,
  SlotName,
  toOrigin,
} from "./primitives.ts";

describe("OriginInput", () => {
  it.each([
    ["https://Example.COM/path?q=1", "https://example.com"],
    ["example.com", "https://example.com"],
    ["http://localhost:3000/", "http://localhost:3000"],
    ["https://example.com:443", "https://example.com"],
    ["  https://learn.zybooks.com  ", "https://learn.zybooks.com"],
    ["https://bücher.de", "https://xn--bcher-kva.de"],
  ])("normalizes %s", (input, expected) => {
    expect(OriginInput.parse(input)).toBe(expected);
  });

  it.each([
    "ftp://example.com",
    "javascript:alert(1)",
    "https://user:pw@example.com",
    "",
    "https://",
    "file:///etc/passwd",
  ])("rejects %s", (input) => {
    expect(OriginInput.safeParse(input).success).toBe(false);
  });
});

describe("Origin", () => {
  it("accepts only already-normalized origins", () => {
    expect(Origin.safeParse("https://example.com").success).toBe(true);
    expect(Origin.safeParse("https://example.com/").success).toBe(false);
    expect(Origin.safeParse("example.com").success).toBe(false);
    expect(toOrigin("not a url at all")).toBeNull();
  });
});

describe("identifiers", () => {
  it("validates slot names", () => {
    expect(SlotName.safeParse("browser-1").success).toBe(true);
    expect(SlotName.safeParse("browser-12").success).toBe(true);
    for (const bad of ["browser-0", "browser-01", "Browser-1", "browser-1 ", "browser"]) {
      expect(SlotName.safeParse(bad).success).toBe(false);
    }
  });

  it("validates aliases", () => {
    expect(Alias.safeParse("zybooks").success).toBe(true);
    expect(Alias.safeParse("my_site-2").success).toBe(true);
    for (const bad of ["Bad", "-x", "a".repeat(64), ""]) {
      expect(Alias.safeParse(bad).success).toBe(false);
    }
  });

  it("validates element refs and key formats", () => {
    expect(ElementRef.safeParse("e12").success).toBe(true);
    expect(ElementRef.safeParse("12").success).toBe(false);
    expect(GarageKeyId.safeParse("GK66316f1f1bd64a571eb1b439").success).toBe(true);
    expect(GarageKeyId.safeParse("GK123").success).toBe(false);
    expect(Base64Key32.safeParse("y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=").success).toBe(true);
    expect(DbPassword.safeParse("short").success).toBe(false);
    expect(DbPassword.safeParse("x'; drop table runs; --aaaaaaaaaaaa").success).toBe(false);
  });
});

describe("FolderName", () => {
  it("trims and accepts plain names", () => {
    expect(FolderName.parse("  Biology  ")).toBe("Biology");
  });
  it.each(["a/b", "tab\tname", "   ", "x".repeat(121)])("rejects %j", (bad) => {
    expect(FolderName.safeParse(bad).success).toBe(false);
  });
});
```

`packages/contracts/src/enums.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import * as enums from "./enums.ts";

describe("enum tuples", () => {
  it("have no duplicate values", () => {
    for (const [name, value] of Object.entries(enums)) {
      if (Array.isArray(value)) {
        expect(new Set(value).size, name).toBe(value.length);
      }
    }
  });

  it("matches the spec state machine and approval modes", () => {
    expect(enums.RUN_STATUSES).toEqual([
      "queued",
      "running",
      "waiting",
      "sleeping",
      "completed",
      "failed",
      "cancelled",
    ]);
    expect(enums.TERMINAL_RUN_STATUSES).toEqual(["completed", "failed", "cancelled"]);
    expect(enums.APPROVAL_MODES).toEqual(["ask", "auto_within_allowlist"]);
    expect(enums.RunStatus.safeParse("paused").success).toBe(false);
    expect(enums.STEP_STATES).toContain("aborted");
    expect(enums.CONTROLLERS).toEqual(["agent", "user"]);
  });
});
```

`packages/contracts/src/constants.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MODELS, VIEWPORT, mediaPortForSlot } from "./constants.ts";

describe("constants", () => {
  it("pins the verified model IDs", () => {
    expect(MODELS).toEqual({
      agentPrimary: "gpt-6-astra",
      agentFallback: "gpt-6.1-sol",
      filing: "gpt-6-luna",
      transcription: "gpt-4o-transcribe-diarize",
      embeddings: "text-embedding-3-small",
    });
    expect(VIEWPORT).toEqual({ width: 1280, height: 800 });
  });

  it("maps slots to their media port", () => {
    expect(mediaPortForSlot("browser-1")).toBe(59001);
    expect(mediaPortForSlot("browser-6")).toBe(59006);
    expect(() => mediaPortForSlot("browser-x")).toThrow();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail.**

Run: `pnpm test`
Expected: FAIL, with module-not-found errors for `./primitives.ts`, `./enums.ts` and `./constants.ts`.

- [ ] **Step 5: Implement.**

`packages/contracts/src/enums.ts`:
```ts
import { z } from "zod";

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "sleeping",
  "completed",
  "failed",
  "cancelled",
] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;
export const TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly RunStatus[];

export const WAIT_REASONS = ["approval", "takeover", "captcha", "otp"] as const;
export const WaitReason = z.enum(WAIT_REASONS);
export type WaitReason = z.infer<typeof WaitReason>;

export const CONTROLLERS = ["agent", "user"] as const;
export const Controller = z.enum(CONTROLLERS);
export type Controller = z.infer<typeof Controller>;

/** Benchmark mode: auto still records every decision (decided_by='policy') and still blocks new origins. */
export const APPROVAL_MODES = ["ask", "auto_within_allowlist"] as const;
export const ApprovalMode = z.enum(APPROVAL_MODES);
export type ApprovalMode = z.infer<typeof ApprovalMode>;

export const STEP_PHASES = ["observe", "decide", "approve", "act"] as const;
export const StepPhase = z.enum(STEP_PHASES);
export type StepPhase = z.infer<typeof StepPhase>;

export const STEP_STATES = ["started", "done", "skipped", "aborted"] as const;
export const StepState = z.enum(STEP_STATES);
export type StepState = z.infer<typeof StepState>;

export const APPROVAL_KINDS = [
  "risky_click",
  "form_submit",
  "download",
  "credential_first_use",
  "new_origin",
  "budget",
] as const;
export const ApprovalKind = z.enum(APPROVAL_KINDS);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const APPROVAL_STATUSES = ["pending", "approved", "denied", "edited", "superseded"] as const;
export const ApprovalStatus = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const SOURCE_KINDS = ["web", "pdf", "youtube"] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const FILED_BY = ["agent", "user"] as const;
export const FiledBy = z.enum(FILED_BY);
export type FiledBy = z.infer<typeof FiledBy>;

export const FIDELITIES = ["verified", "partial", "needs_review"] as const;
export const Fidelity = z.enum(FIDELITIES);
export type Fidelity = z.infer<typeof Fidelity>;

export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "quote",
  "code",
  "table",
  "math",
  "image",
  "figure",
  "transcript",
  "keyframe",
  "commentary",
] as const;
export const BlockType = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockType>;

export const BLOCK_ORIGINS = ["dom", "pdf", "captions", "asr", "ocr_model", "model", "user"] as const;
export const BlockOrigin = z.enum(BLOCK_ORIGINS);
export type BlockOrigin = z.infer<typeof BlockOrigin>;

export const MEMBER_ROLES = ["owner", "member"] as const;
export const MemberRole = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRole>;

export const VAULT_SECRET_FIELDS = [
  "username",
  "password",
  "totp",
  "pin",
  "imap_password",
  "passkey",
] as const;
export const VaultSecretField = z.enum(VAULT_SECRET_FIELDS);
export type VaultSecretField = z.infer<typeof VaultSecretField>;

/** Secret fields a user can type into the vault UI (passkeys are enrolled during takeover). */
export const TYPED_SECRET_FIELDS = [
  "username",
  "password",
  "totp",
  "pin",
  "imap_password",
] as const satisfies readonly VaultSecretField[];
export const TypedSecretField = z.enum(TYPED_SECRET_FIELDS);
export type TypedSecretField = z.infer<typeof TypedSecretField>;

export const CREDENTIAL_FIELDS = ["username", "password", "totp", "pin", "otp"] as const;
export const CredentialField = z.enum(CREDENTIAL_FIELDS);
export type CredentialField = z.infer<typeof CredentialField>;

export const VAULT_AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "fill",
  "passkey",
  "otp_received",
  "denied",
] as const;
export const VaultAuditAction = z.enum(VAULT_AUDIT_ACTIONS);
export type VaultAuditAction = z.infer<typeof VaultAuditAction>;

export const SLOT_STATES = ["idle", "leased", "restarting"] as const;
export const SlotState = z.enum(SLOT_STATES);
export type SlotState = z.infer<typeof SlotState>;

/** A queued run may lease a slot only if another idle slot remains; a wake may take the last one. */
export const LEASE_PRIORITIES = ["wake", "queued"] as const;
export const LeasePriority = z.enum(LEASE_PRIORITIES);
export type LeasePriority = z.infer<typeof LeasePriority>;

export const WAKE_REASONS = ["approval", "otp", "message", "takeover", "resume", "kill"] as const;
export const WakeReason = z.enum(WAKE_REASONS);
export type WakeReason = z.infer<typeof WakeReason>;

export const BENCHMARK_OUTCOMES = ["pending", "passed", "partial", "failed", "error"] as const;
export const BenchmarkOutcome = z.enum(BENCHMARK_OUTCOMES);
export type BenchmarkOutcome = z.infer<typeof BenchmarkOutcome>;

export const ANNOTATE_KINDS = ["summary", "commentary", "heading"] as const;
export const AnnotateKind = z.enum(ANNOTATE_KINDS);
export type AnnotateKind = z.infer<typeof AnnotateKind>;

export const VIDEO_OPS = ["captions", "chapters", "keyframes", "transcribe"] as const;
export const VideoOp = z.enum(VIDEO_OPS);
export type VideoOp = z.infer<typeof VideoOp>;

export const NEED_HUMAN_REASONS = ["captcha", "takeover"] as const;
export const NeedHuman = z.enum(NEED_HUMAN_REASONS);
export type NeedHuman = z.infer<typeof NeedHuman>;

export const AGENT_TURN_STATUSES = ["continue", "done", "need_human"] as const;
export const AgentTurnStatus = z.enum(AGENT_TURN_STATUSES);
export type AgentTurnStatus = z.infer<typeof AgentTurnStatus>;
```

`packages/contracts/src/primitives.ts`:
```ts
import { z } from "zod";

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

/** Better Auth user ids are opaque text. */
export const UserId = z.string().min(1).max(64);
export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase hex SHA-256");

export const Alias = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, "Aliases are 1-63 chars of a-z, 0-9, '_' or '-'");

export const SLOT_NAME_PATTERN = /^browser-[1-9][0-9]?$/;
export const SlotName = z.string().regex(SLOT_NAME_PATTERN, "Expected a slot name like browser-1");

export const ElementRef = z.string().regex(/^e[0-9]{1,6}$/, "Expected an element ref like e12");

/** Role passwords are interpolated into ALTER ROLE, so the alphabet is deliberately narrow. */
export const DbPassword = z
  .string()
  .regex(/^[A-Za-z0-9_-]{24,128}$/, "Expected 24-128 chars of A-Z, a-z, 0-9, '_' or '-'");
export const GarageKeyId = z.string().regex(/^GK[0-9a-f]{24}$/, "Expected GK followed by 24 hex chars");
export const GarageSecret = z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 hex chars");
export const Base64Key32 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, "Expected a base64-encoded 32-byte key");
export const PostgresUrl = z.string().regex(/^postgres(ql)?:\/\/\S+$/, "Expected a postgres:// URL");
export const BucketName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "Expected an S3 bucket name");

/**
 * Normalizes user input to a WHATWG origin ("https://example.com", "http://localhost:3000").
 * Bare hosts get https://. Non-http(s) schemes and URLs with credentials are rejected (null).
 */
export function toOrigin(input: string): string | null {
  const candidate = input.includes("://") ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "") return null;
  return url.origin;
}

/** An origin that is already normalized; use for stored values. */
export const Origin = z.string().refine((value) => toOrigin(value) === value, {
  message: "Expected a normalized http(s) origin such as https://example.com",
});

/** Anything a person might type; output is a normalized origin. Use for API inputs. */
export const OriginInput = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const origin = value === "" ? null : toOrigin(value);
    if (origin === null) {
      ctx.addIssue({ code: "custom", message: "Expected an http(s) URL or host name" });
      return z.NEVER;
    }
    return origin;
  });

export const FolderName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !value.includes("/") && !/\p{Cc}/u.test(value), {
    message: "Folder names cannot contain '/' or control characters",
  });
```

`packages/contracts/src/constants.ts`:
```ts
import { SLOT_NAME_PATTERN } from "./primitives.ts";

/** Verified against /v1/models on 2026-10-05 (D1, D31). */
export const MODELS = {
  agentPrimary: "gpt-6-astra",
  agentFallback: "gpt-6.1-sol",
  filing: "gpt-6-luna",
  transcription: "gpt-4o-transcribe-diarize",
  embeddings: "text-embedding-3-small",
} as const;

export const EMBEDDING_DIMENSIONS = 1536;
export const VIEWPORT = { width: 1280, height: 800 } as const;
export const DEFAULT_SLOT_COUNT = 6;
export const DEFAULT_CONCURRENCY = 6;
export const NOTIFY_MAX_BYTES = 200;

export const CDP_LOCAL_PORT = 9222;
export const CDP_PROXY_PORT = 9223;
export const NEKO_PORT = 8080;
export const PULSE_TCP_PORT = 4713;
export const MEDIA_PORT_BASE = 59000;

export function mediaPortForSlot(slot: string): number {
  if (!SLOT_NAME_PATTERN.test(slot)) throw new TypeError(`Invalid slot name: ${slot}`);
  return MEDIA_PORT_BASE + Number(slot.slice("browser-".length));
}
```

`packages/contracts/src/index.ts`:
```ts
export * from "./enums.ts";
export * from "./primitives.ts";
export * from "./constants.ts";
```

- [ ] **Step 6: Run the tests and the checks to verify they pass.**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format`
Expected: all three test files PASS. Typecheck and lint print no errors. Prettier rewrites only formatting.

- [ ] **Step 7: Commit.**

```bash
git add .gitignore package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json eslint.config.js .prettierrc.json .prettierignore vitest.config.ts packages/contracts
git commit -m "chore: pnpm monorepo toolchain and contracts primitives"
```

---

### Task 2: Contracts for budgets, runs, notes and agent turns

**Files:**
- Create: `packages/contracts/src/{budget,run,note,agent-turn}.ts`, `packages/contracts/src/testing/strict-schema.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/{budget,note,agent-turn}.test.ts`

**Interfaces:**
- Consumes (Task 1): `Uuid`, `Sha256Hex`, `IsoDateTime`, `BlockType`, `BlockOrigin`, `AgentTurnStatus`, `NeedHuman`.
- Produces:
  - `Budget` and `DEFAULT_BUDGET` (`{maxSteps: 150, maxUsd: 5, maxActiveMinutes: 60}`).
  - `Usage` (`{steps, inputTokens, cachedInputTokens, outputTokens, usd, activeMs}`) and `EMPTY_USAGE`.
  - `PlanItem` and `Plan` (`{items: {text, done}[]}`).
  - `RunError` (`{code, message}`) and `ScrollPosition` (`{x, y}`).
  - `BBox`, `Anchor` and `NoteBlock`.
  - `AgentTurn` (`{status, needHuman|null, reason, planUpdate|null}`), `CompactionSummary` (`{goal, plan, progress, facts, openQuestions}`) and `FilingDecision` (`{path, createLeaf}`).
  - **Test helper** `strictSchemaProblems(schema): string[]`, imported from `../testing/strict-schema.ts`. It returns an empty list when the root is an object and every property, at every depth, is required.

- [ ] **Step 1: Write the test helper and the failing tests.**

`packages/contracts/src/testing/strict-schema.ts`:
```ts
import { z } from "zod";

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
}

/**
 * OpenAI structured outputs and strict function tools need an object root and every
 * property required (nullable is fine, optional is not). Returns the violations found.
 */
export function strictSchemaProblems(schema: z.ZodType): string[] {
  const root = z.toJSONSchema(schema, { io: "input" }) as JsonSchemaNode;
  const problems: string[] = [];
  if (root.type !== "object") problems.push("$ root is not an object");
  walk(root, "$", problems);
  return problems;
}

function walk(node: JsonSchemaNode, path: string, problems: string[]): void {
  if (node.properties) {
    const required = new Set(node.required ?? []);
    for (const [key, child] of Object.entries(node.properties)) {
      if (!required.has(key)) problems.push(`${path}.${key} is optional`);
      walk(child, `${path}.${key}`, problems);
    }
  }
  if (node.items) walk(node.items, `${path}[]`, problems);
  for (const variants of [node.anyOf, node.oneOf, node.allOf]) {
    variants?.forEach((child, index) => walk(child, `${path}|${index}`, problems));
  }
}
```

`packages/contracts/src/budget.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Budget, DEFAULT_BUDGET, EMPTY_USAGE, Plan, Usage } from "./budget.ts";

describe("budget", () => {
  it("has the spec defaults", () => {
    expect(Budget.parse(DEFAULT_BUDGET)).toEqual({ maxSteps: 150, maxUsd: 5, maxActiveMinutes: 60 });
    expect(Usage.parse(EMPTY_USAGE).steps).toBe(0);
  });
  it("rejects nonsense limits", () => {
    expect(Budget.safeParse({ ...DEFAULT_BUDGET, maxSteps: 0 }).success).toBe(false);
    expect(Budget.safeParse({ ...DEFAULT_BUDGET, maxUsd: -1 }).success).toBe(false);
  });
  it("caps plan length", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ text: `step ${i}`, done: false }));
    expect(Plan.safeParse({ items }).success).toBe(false);
  });
});
```

`packages/contracts/src/note.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Anchor, NoteBlock } from "./note.ts";

const domAnchor = {
  selector: "main > p:nth-of-type(2)",
  xpath: "/html/body/main/p[2]",
  start: 0,
  end: 120,
  textFragment: "#:~:text=Photosynthesis",
};

describe("Anchor", () => {
  it("accepts DOM, PDF and video anchors", () => {
    expect(Anchor.safeParse(domAnchor).success).toBe(true);
    expect(
      Anchor.safeParse({ ...domAnchor, page: 3, bbox: { x: 1, y: 2, width: 3, height: 4 } }).success,
    ).toBe(true);
    expect(
      Anchor.safeParse({
        selector: null,
        xpath: null,
        start: null,
        end: null,
        textFragment: null,
        tStart: 12.5,
        tEnd: 20,
      }).success,
    ).toBe(true);
  });
  it("rejects inverted ranges", () => {
    expect(Anchor.safeParse({ ...domAnchor, start: 10, end: 5 }).success).toBe(false);
    expect(
      Anchor.safeParse({
        selector: null,
        xpath: null,
        start: null,
        end: null,
        textFragment: null,
        tStart: 30,
        tEnd: 10,
      }).success,
    ).toBe(false);
  });
});

describe("NoteBlock", () => {
  it("parses a captured block", () => {
    const block = {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      noteId: "6f9619ff-8b86-4d01-b42d-00c04fc964ff",
      position: "a0",
      type: "paragraph",
      markdown: "Plants convert light into chemical energy.",
      assetId: null,
      sourceId: null,
      origin: "dom",
      anchor: domAnchor,
      contentSha256: "a".repeat(64),
      verified: true,
      edited: false,
      originalMarkdown: null,
      createdAt: "2026-10-05T12:00:00.000Z",
    };
    expect(NoteBlock.parse(block).type).toBe("paragraph");
    expect(NoteBlock.safeParse({ ...block, origin: "llm" }).success).toBe(false);
  });
});
```

`packages/contracts/src/agent-turn.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { AgentTurn, CompactionSummary, FilingDecision } from "./agent-turn.ts";
import { strictSchemaProblems } from "./testing/strict-schema.ts";

describe("model-facing schemas are strict", () => {
  it.each([
    ["AgentTurn", AgentTurn],
    ["CompactionSummary", CompactionSummary],
    ["FilingDecision", FilingDecision],
  ])("%s", (_name, schema) => {
    expect(strictSchemaProblems(schema)).toEqual([]);
  });
});

describe("AgentTurn", () => {
  it("parses a continue turn", () => {
    const turn = AgentTurn.parse({
      status: "continue",
      needHuman: null,
      reason: "Reading section 1.2",
      planUpdate: { items: [{ text: "Open reading 1", done: true }] },
    });
    expect(turn.planUpdate?.items).toHaveLength(1);
  });
  it("rejects unknown statuses", () => {
    expect(
      AgentTurn.safeParse({ status: "pause", needHuman: null, reason: "", planUpdate: null }).success,
    ).toBe(false);
  });
});

describe("FilingDecision", () => {
  it("needs 1-8 path segments", () => {
    expect(FilingDecision.safeParse({ path: [], createLeaf: false }).success).toBe(false);
    expect(FilingDecision.safeParse({ path: Array(9).fill("x"), createLeaf: false }).success).toBe(
      false,
    );
    expect(FilingDecision.safeParse({ path: ["Biology", "Cells"], createLeaf: true }).success).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test`
Expected: FAIL, because `./budget.ts`, `./note.ts` and `./agent-turn.ts` are not found.

- [ ] **Step 3: Implement.**

`packages/contracts/src/budget.ts`:
```ts
import { z } from "zod";

export const Budget = z.object({
  maxSteps: z.number().int().min(1).max(10_000),
  maxUsd: z.number().positive().max(1_000),
  maxActiveMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
});
export type Budget = z.infer<typeof Budget>;
export const DEFAULT_BUDGET: Budget = { maxSteps: 150, maxUsd: 5, maxActiveMinutes: 60 };

const Count = z.number().int().nonnegative();
export const Usage = z.object({
  steps: Count,
  inputTokens: Count,
  cachedInputTokens: Count,
  outputTokens: Count,
  usd: z.number().nonnegative(),
  activeMs: Count,
});
export type Usage = z.infer<typeof Usage>;
export const EMPTY_USAGE: Usage = {
  steps: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  usd: 0,
  activeMs: 0,
};

export const PlanItem = z.object({ text: z.string().min(1).max(500), done: z.boolean() });
export type PlanItem = z.infer<typeof PlanItem>;
export const Plan = z.object({ items: z.array(PlanItem).max(50) });
export type Plan = z.infer<typeof Plan>;
```

`packages/contracts/src/run.ts`:
```ts
import { z } from "zod";

/** Stored in runs.error; message must be safe to show (never page text or secrets). */
export const RunError = z.object({ code: z.string().min(1).max(64), message: z.string().max(500) });
export type RunError = z.infer<typeof RunError>;

export const ScrollPosition = z.object({ x: z.number(), y: z.number() });
export type ScrollPosition = z.infer<typeof ScrollPosition>;
```

`packages/contracts/src/note.ts`:
```ts
import { z } from "zod";
import { BlockOrigin, BlockType } from "./enums.ts";
import { IsoDateTime, Sha256Hex, Uuid } from "./primitives.ts";

export const BBox = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type BBox = z.infer<typeof BBox>;

const Offset = z.number().int().nonnegative().nullable();
const Seconds = z.number().nonnegative();

/** Provenance anchor (spec §4): DOM fields, plus page/bbox for PDFs, plus tStart/tEnd for video. */
export const Anchor = z
  .object({
    selector: z.string().max(2000).nullable(),
    xpath: z.string().max(2000).nullable(),
    start: Offset,
    end: Offset,
    textFragment: z.string().max(2000).nullable(),
    page: z.number().int().positive().optional(),
    bbox: BBox.optional(),
    tStart: Seconds.optional(),
    tEnd: Seconds.optional(),
  })
  .refine((a) => a.start === null || a.end === null || a.end >= a.start, {
    message: "end must be >= start",
    path: ["end"],
  })
  .refine((a) => a.tStart === undefined || a.tEnd === undefined || a.tEnd >= a.tStart, {
    message: "tEnd must be >= tStart",
    path: ["tEnd"],
  });
export type Anchor = z.infer<typeof Anchor>;

export const NoteBlock = z.object({
  id: Uuid,
  noteId: Uuid,
  position: z.string().min(1).max(256),
  type: BlockType,
  markdown: z.string().max(200_000),
  assetId: Uuid.nullable(),
  sourceId: Uuid.nullable(),
  origin: BlockOrigin,
  anchor: Anchor.nullable(),
  contentSha256: Sha256Hex.nullable(),
  verified: z.boolean(),
  edited: z.boolean(),
  originalMarkdown: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type NoteBlock = z.infer<typeof NoteBlock>;
```

`packages/contracts/src/agent-turn.ts`:
```ts
import { z } from "zod";
import { Plan } from "./budget.ts";
import { AgentTurnStatus, NeedHuman } from "./enums.ts";

/** Parsed with zodTextFormat from every model message (spec §5.3). Nullable, never optional. */
export const AgentTurn = z.object({
  status: AgentTurnStatus,
  needHuman: NeedHuman.nullable(),
  reason: z.string().max(2000),
  planUpdate: Plan.nullable(),
});
export type AgentTurn = z.infer<typeof AgentTurn>;

/** Context compaction summary (spec §5.4). */
export const CompactionSummary = z.object({
  goal: z.string().max(4000),
  plan: Plan,
  progress: z.string().max(8000),
  facts: z.array(z.string().max(1000)).max(100),
  openQuestions: z.array(z.string().max(1000)).max(50),
});
export type CompactionSummary = z.infer<typeof CompactionSummary>;

/** Auto-filing answer from gpt-6-luna (spec §7). At most one new leaf folder. */
export const FilingDecision = z.object({
  path: z.array(z.string().min(1).max(120)).min(1).max(8),
  createLeaf: z.boolean(),
});
export type FilingDecision = z.infer<typeof FilingDecision>;
```

Append to `packages/contracts/src/index.ts`:
```ts
export * from "./budget.ts";
export * from "./run.ts";
export * from "./note.ts";
export * from "./agent-turn.ts";
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/contracts
git commit -m "feat(contracts): budgets, plan, anchors, note blocks and agent turn schemas"
```

---

### Task 3: Tool contracts and the approval policy

**Files:**
- Create: `packages/contracts/src/{tools,approval}.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/{tools,approval}.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Alias`, `ElementRef`, `Origin`, `Sha256Hex`, `Uuid`, `VIEWPORT`, the enums) and Task 2 (`Budget`, `Usage`).
- Produces, tools:
  - **Tool names:**
    - `TOOL_NAMES` (exactly 7) and `ToolName`;
    - `FUNCTION_TOOL_NAMES` and `FunctionToolName`, which are every tool except `computer`.
  - **`computer` tool:**
    - `COMPUTER_ACTION_TYPES` and `ComputerAction` (a discriminated union on `type`);
    - `ComputerResult` (`{screenshotKey}`).
  - **`read_page` tool:**
    - `READ_PAGE_ATTRS` and `ReadPageAttr`;
    - `ReadPageArgs` (`{mode, sinceHash|null}`);
    - `ReadPageElement` and `Unchanged` (`{unchanged: true}`);
    - `ReadPageResult`.
  - **`capture` tool:**
    - `CAPTURE_SCOPES`;
    - `CaptureArgs` (`{scope, selector|null, kind|null}`);
    - `CaptureResult`.
  - **Shared and credential results:**
    - `ToolOk` (`{ok: true}`);
    - `CREDENTIAL_ERROR_CODES` and `CredentialErrorCode`;
    - `FillCredentialArgs` and `FillCredentialResult`;
    - `PASSKEY_ERROR_CODES` and `PasskeyErrorCode`;
    - `UsePasskeyArgs` and `UsePasskeyResult`.
  - **`video` tool:**
    - `VideoRange`;
    - `VideoArgs` (`{op, range|null}`);
    - `VideoResult` (a discriminated union on `op`).
  - **`annotate` tool:** `AnnotateArgs` (`{noteId, afterBlockId|null, markdown, kind}`) and `AnnotateResult` (`{blockId}`).
  - **Registry:** `FUNCTION_TOOLS: Record<FunctionToolName, {args, result}>`.
- Produces, approvals:
  - `RISKY_ACTION` (a RegExp) and `isRiskyLabel(label: string): boolean`.
  - `ApprovalRequest`, a discriminated union on `kind` with one variant per `APPROVAL_KINDS`.
  - `BUDGET_CHOICES`/`BudgetChoice` and `ApprovalEdit` (`{instruction|null, budgetChoice|null}`).
  - `APPROVAL_DECISIONS`/`ApprovalDecision` and `ApprovalDecisionInput`.
  - `AUTO_MODE_DECISIONS`, `PolicyDecision` (`"approved" | "denied" | "ask"`) and `POLICY_DECIDER = "policy"`.
  - `decideByPolicy(mode: ApprovalMode, kind: ApprovalKind): PolicyDecision`.

- [ ] **Step 1: Write the failing tests.**

`packages/contracts/src/tools.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { strictSchemaProblems } from "./testing/strict-schema.ts";
import {
  CaptureArgs,
  ComputerAction,
  FUNCTION_TOOLS,
  ReadPageResult,
  TOOL_NAMES,
  VideoArgs,
} from "./tools.ts";

describe("tool list", () => {
  it("is exactly the 7 spec tools", () => {
    expect(TOOL_NAMES).toEqual([
      "computer",
      "read_page",
      "capture",
      "fill_credential",
      "use_passkey",
      "video",
      "annotate",
    ]);
    expect(TOOL_NAMES.some((name) => name.startsWith("exec"))).toBe(false);
    expect(["computer", ...Object.keys(FUNCTION_TOOLS)].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it.each(Object.entries(FUNCTION_TOOLS))("%s args are strict-mode safe", (_name, tool) => {
    expect(strictSchemaProblems(tool.args)).toEqual([]);
  });
});

describe("ComputerAction", () => {
  it("accepts allowlisted actions and defaults the button", () => {
    expect(ComputerAction.parse({ type: "click", x: 10, y: 20 })).toEqual({
      type: "click",
      x: 10,
      y: 20,
      button: "left",
    });
    expect(ComputerAction.safeParse({ type: "keypress", keys: ["CTRL", "L"] }).success).toBe(true);
  });
  it("rejects unknown actions and off-screen coordinates", () => {
    expect(ComputerAction.safeParse({ type: "exec", code: "rm -rf /" }).success).toBe(false);
    expect(ComputerAction.safeParse({ type: "click", x: 1280, y: 0 }).success).toBe(false);
    expect(ComputerAction.safeParse({ type: "drag", path: [{ x: 1, y: 1 }] }).success).toBe(false);
  });
});

describe("other tool schemas", () => {
  it("capture of an element needs a selector", () => {
    expect(CaptureArgs.safeParse({ scope: "element", selector: null, kind: null }).success).toBe(
      false,
    );
    expect(CaptureArgs.safeParse({ scope: "page", selector: null, kind: "web" }).success).toBe(true);
  });
  it("read_page keeps only allowlisted attributes", () => {
    const base = { hash: "a".repeat(64), url: "https://example.com/", title: "T" };
    expect(ReadPageResult.safeParse({ unchanged: true }).success).toBe(true);
    expect(
      ReadPageResult.safeParse({
        ...base,
        elements: [
          { ref: "e1", tag: "a", role: "link", name: "Next", attrs: { href: "/next" } },
        ],
      }).success,
    ).toBe(true);
    expect(
      ReadPageResult.safeParse({
        ...base,
        elements: [
          { ref: "e1", tag: "a", role: "link", name: "Next", attrs: { onclick: "steal()" } },
        ],
      }).success,
    ).toBe(false);
  });
  it("video ranges must move forward", () => {
    expect(VideoArgs.safeParse({ op: "keyframes", range: { start: 10, end: 5 } }).success).toBe(
      false,
    );
    expect(VideoArgs.safeParse({ op: "captions", range: null }).success).toBe(true);
  });
});
```

`packages/contracts/src/approval.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  ApprovalDecisionInput,
  ApprovalRequest,
  AUTO_MODE_DECISIONS,
  decideByPolicy,
  isRiskyLabel,
} from "./approval.ts";
import { APPROVAL_KINDS, type ApprovalKind } from "./enums.ts";
import { DEFAULT_BUDGET, EMPTY_USAGE } from "./budget.ts";

describe("isRiskyLabel", () => {
  it.each([
    "Submit",
    "Pay now",
    "Proceed to payment",
    "Delete note",
    "Removing item",
    "Check out",
    "Confirm order",
    "Unsubscribe",
    "ＳＵＢＭＩＴ",
    "Sub\u200Bmit",
  ])("flags %j", (label) => {
    expect(isRiskyLabel(label)).toBe(true);
  });
  it.each(["Check", "Next", "Show answer", "Continue reading", "Search"])("allows %j", (label) => {
    expect(isRiskyLabel(label)).toBe(false);
  });
});

describe("ApprovalRequest", () => {
  it("has one variant per approval kind", () => {
    const samples: Record<ApprovalKind, unknown> = {
      risky_click: {
        kind: "risky_click",
        action: { type: "click", x: 1, y: 1 },
        label: "Submit",
        url: "https://learn.zybooks.com/x",
        screenshotKey: null,
      },
      form_submit: {
        kind: "form_submit",
        url: "https://a.com/f",
        formSummary: "Feedback form",
        screenshotKey: null,
      },
      download: { kind: "download", url: "https://a.com/f.pdf", filename: "f.pdf" },
      credential_first_use: {
        kind: "credential_first_use",
        alias: "zybooks",
        origin: "https://learn.zybooks.com",
      },
      new_origin: { kind: "new_origin", origin: "https://b.com", url: "https://b.com/page" },
      budget: { kind: "budget", exceeded: "usd", usage: EMPTY_USAGE, budget: DEFAULT_BUDGET },
    };
    for (const kind of APPROVAL_KINDS) {
      expect(ApprovalRequest.parse(samples[kind]).kind).toBe(kind);
    }
  });
});

describe("decideByPolicy", () => {
  it("asks for everything in ask mode", () => {
    for (const kind of APPROVAL_KINDS) expect(decideByPolicy("ask", kind)).toBe("ask");
  });
  it("auto mode approves in-allowlist work, blocks new origins and downloads, never spends more", () => {
    expect(decideByPolicy("auto_within_allowlist", "risky_click")).toBe("approved");
    expect(decideByPolicy("auto_within_allowlist", "form_submit")).toBe("approved");
    expect(decideByPolicy("auto_within_allowlist", "credential_first_use")).toBe("approved");
    expect(decideByPolicy("auto_within_allowlist", "new_origin")).toBe("denied");
    expect(decideByPolicy("auto_within_allowlist", "download")).toBe("denied");
    expect(decideByPolicy("auto_within_allowlist", "budget")).toBe("ask");
    expect(Object.keys(AUTO_MODE_DECISIONS).sort()).toEqual([...APPROVAL_KINDS].sort());
  });
});

describe("ApprovalDecisionInput", () => {
  it("requires an instruction for edits", () => {
    const approvalId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(ApprovalDecisionInput.safeParse({ approvalId, decision: "edited" }).success).toBe(false);
    expect(
      ApprovalDecisionInput.parse({ approvalId, decision: "edited", instruction: "Click Check first" })
        .instruction,
    ).toBe("Click Check first");
    expect(ApprovalDecisionInput.parse({ approvalId, decision: "approved" }).budgetChoice).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test`
Expected: FAIL, because `./tools.ts` and `./approval.ts` are not found.

- [ ] **Step 3: Implement.**

`packages/contracts/src/tools.ts`:
```ts
import { z } from "zod";
import { VIEWPORT } from "./constants.ts";
import { ANNOTATE_KINDS, CredentialField, Fidelity, VideoOp } from "./enums.ts";
import { Alias, ElementRef, Sha256Hex, Uuid } from "./primitives.ts";

/** Exactly these tools reach the model (spec §6). There is no exec_* tool. */
export const TOOL_NAMES = [
  "computer",
  "read_page",
  "capture",
  "fill_credential",
  "use_passkey",
  "video",
  "annotate",
] as const;
export const ToolName = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolName>;
export const FUNCTION_TOOL_NAMES = [
  "read_page",
  "capture",
  "fill_credential",
  "use_passkey",
  "video",
  "annotate",
] as const satisfies readonly ToolName[];
export type FunctionToolName = (typeof FUNCTION_TOOL_NAMES)[number];

const X = z
  .number()
  .int()
  .min(0)
  .max(VIEWPORT.width - 1);
const Y = z
  .number()
  .int()
  .min(0)
  .max(VIEWPORT.height - 1);
const Point = z.object({ x: X, y: Y });
const ScrollDelta = z.number().int().min(-10_000).max(10_000);

export const COMPUTER_ACTION_TYPES = [
  "click",
  "double_click",
  "drag",
  "move",
  "scroll",
  "keypress",
  "type",
  "wait",
  "screenshot",
] as const;
/** Allowlist over OpenAI's native computer_call actions; anything else is rejected. */
export const ComputerAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: X,
    y: Y,
    button: z.enum(["left", "right", "wheel", "back", "forward"]).default("left"),
  }),
  z.object({ type: z.literal("double_click"), x: X, y: Y }),
  z.object({ type: z.literal("drag"), path: z.array(Point).min(2).max(100) }),
  z.object({ type: z.literal("move"), x: X, y: Y }),
  z.object({ type: z.literal("scroll"), x: X, y: Y, scroll_x: ScrollDelta, scroll_y: ScrollDelta }),
  z.object({ type: z.literal("keypress"), keys: z.array(z.string().min(1).max(32)).min(1).max(8) }),
  z.object({ type: z.literal("type"), text: z.string().max(5_000) }),
  z.object({ type: z.literal("wait") }),
  z.object({ type: z.literal("screenshot") }),
]);
export type ComputerAction = z.infer<typeof ComputerAction>;
export const ComputerResult = z.object({ screenshotKey: z.string().min(1).max(1024) });
export type ComputerResult = z.infer<typeof ComputerResult>;

/** D20: the compact element view keeps only these attributes. */
export const READ_PAGE_ATTRS = [
  "aria-label",
  "role",
  "alt",
  "title",
  "href",
  "name",
  "type",
  "data-label",
] as const;
export const ReadPageAttr = z.enum(READ_PAGE_ATTRS);
export type ReadPageAttr = z.infer<typeof ReadPageAttr>;
export const ReadPageArgs = z.object({
  mode: z.enum(["interactive", "text"]),
  sinceHash: Sha256Hex.nullable(),
});
export type ReadPageArgs = z.infer<typeof ReadPageArgs>;
export const ReadPageElement = z.object({
  ref: ElementRef,
  tag: z.string().min(1).max(32),
  role: z.string().max(64).nullable(),
  name: z.string().max(500),
  attrs: z.partialRecord(ReadPageAttr, z.string().max(2_000)),
});
export type ReadPageElement = z.infer<typeof ReadPageElement>;
/** D20: tools may answer {unchanged: true} instead of re-emitting large state. */
export const Unchanged = z.object({ unchanged: z.literal(true) });
const PageHeader = { hash: Sha256Hex, url: z.url(), title: z.string().max(1_000) };
export const ReadPageResult = z.union([
  Unchanged,
  z.object({ ...PageHeader, elements: z.array(ReadPageElement).max(2_000) }),
  z.object({ ...PageHeader, text: z.string().max(200_000) }),
]);
export type ReadPageResult = z.infer<typeof ReadPageResult>;

export const CAPTURE_SCOPES = ["page", "selection", "element"] as const;
export const CaptureArgs = z
  .object({
    scope: z.enum(CAPTURE_SCOPES),
    selector: z.string().min(1).max(2_000).nullable(),
    kind: z.enum(["web", "pdf"]).nullable(),
  })
  .superRefine((args, ctx) => {
    if (args.scope === "element" && args.selector === null) {
      ctx.addIssue({ code: "custom", path: ["selector"], message: "element scope needs a selector" });
    }
  });
export type CaptureArgs = z.infer<typeof CaptureArgs>;
export const CaptureResult = z.object({
  noteId: Uuid,
  blockIds: z.array(Uuid),
  coverage: z.number().min(0).max(1),
  fidelity: Fidelity,
});
export type CaptureResult = z.infer<typeof CaptureResult>;

export const ToolOk = z.object({ ok: z.literal(true) });
export type ToolOk = z.infer<typeof ToolOk>;

export const CREDENTIAL_ERROR_CODES = [
  "unknown_alias",
  "origin_mismatch",
  "frame_mismatch",
  "field_type_mismatch",
  "approval_required",
  "otp_unavailable",
  "fill_failed",
] as const;
export const CredentialErrorCode = z.enum(CREDENTIAL_ERROR_CODES);
export type CredentialErrorCode = z.infer<typeof CredentialErrorCode>;
export const FillCredentialArgs = z.object({
  alias: Alias,
  field: CredentialField,
  target: ElementRef,
});
export type FillCredentialArgs = z.infer<typeof FillCredentialArgs>;
export const FillCredentialResult = z.union([ToolOk, z.object({ error: CredentialErrorCode })]);
export type FillCredentialResult = z.infer<typeof FillCredentialResult>;

export const PASSKEY_ERROR_CODES = [
  "unknown_alias",
  "origin_mismatch",
  "no_passkey",
  "ceremony_failed",
] as const;
export const PasskeyErrorCode = z.enum(PASSKEY_ERROR_CODES);
export type PasskeyErrorCode = z.infer<typeof PasskeyErrorCode>;
export const UsePasskeyArgs = z.object({ alias: Alias });
export type UsePasskeyArgs = z.infer<typeof UsePasskeyArgs>;
export const UsePasskeyResult = z.union([ToolOk, z.object({ error: PasskeyErrorCode })]);
export type UsePasskeyResult = z.infer<typeof UsePasskeyResult>;

export const VideoRange = z
  .object({ start: z.number().min(0), end: z.number().positive() })
  .refine((range) => range.end > range.start, { message: "end must be after start" });
export type VideoRange = z.infer<typeof VideoRange>;
export const VideoArgs = z.object({ op: VideoOp, range: VideoRange.nullable() });
export type VideoArgs = z.infer<typeof VideoArgs>;
export const VideoResult = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("captions"),
    blockIds: z.array(Uuid),
    segments: z.number().int().nonnegative(),
    language: z.string().max(16).nullable(),
  }),
  z.object({
    op: z.literal("chapters"),
    chapters: z.array(z.object({ title: z.string().max(500), start: z.number().min(0) })),
  }),
  z.object({
    op: z.literal("keyframes"),
    blockIds: z.array(Uuid),
    kept: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    drm: z.boolean(),
  }),
  z.object({
    op: z.literal("transcribe"),
    blockIds: z.array(Uuid),
    seconds: z.number().nonnegative(),
  }),
]);
export type VideoResult = z.infer<typeof VideoResult>;

export const AnnotateArgs = z.object({
  noteId: Uuid,
  afterBlockId: Uuid.nullable(),
  markdown: z.string().min(1).max(20_000),
  kind: z.enum(ANNOTATE_KINDS),
});
export type AnnotateArgs = z.infer<typeof AnnotateArgs>;
export const AnnotateResult = z.object({ blockId: Uuid });
export type AnnotateResult = z.infer<typeof AnnotateResult>;

/** Function tools sent with zodResponsesFunction; `computer` is OpenAI's native tool. */
export const FUNCTION_TOOLS = {
  read_page: { args: ReadPageArgs, result: ReadPageResult },
  capture: { args: CaptureArgs, result: CaptureResult },
  fill_credential: { args: FillCredentialArgs, result: FillCredentialResult },
  use_passkey: { args: UsePasskeyArgs, result: UsePasskeyResult },
  video: { args: VideoArgs, result: VideoResult },
  annotate: { args: AnnotateArgs, result: AnnotateResult },
} as const satisfies Record<FunctionToolName, { args: z.ZodType; result: z.ZodType }>;
```

`packages/contracts/src/approval.ts`:
```ts
import { z } from "zod";
import { Budget, Usage } from "./budget.ts";
import type { ApprovalKind, ApprovalMode } from "./enums.ts";
import { Alias, Origin, Uuid } from "./primitives.ts";
import { ComputerAction } from "./tools.ts";

/** Spec §5.5 risky words, matched as word prefixes so "payment" and "deleting" are caught. */
export const RISKY_ACTION =
  /\b(?:buy|pay|order|check\s?out|delet|remov|send|post|publish|submit|confirm|subscrib|unsubscrib|transfer)\w*/iu;

/** NFKC folds full-width letters; format characters (zero-width) are stripped first. */
export function isRiskyLabel(label: string): boolean {
  return RISKY_ACTION.test(label.normalize("NFKC").replace(/\p{Cf}/gu, ""));
}

const PageUrl = z.string().min(1).max(4_096);
const ScreenshotKey = z.string().min(1).max(1_024).nullable();

export const ApprovalRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("risky_click"),
    action: ComputerAction,
    label: z.string().max(500),
    url: PageUrl,
    screenshotKey: ScreenshotKey,
  }),
  z.object({
    kind: z.literal("form_submit"),
    url: PageUrl,
    formSummary: z.string().max(1_000),
    screenshotKey: ScreenshotKey,
  }),
  z.object({ kind: z.literal("download"), url: PageUrl, filename: z.string().max(255).nullable() }),
  z.object({ kind: z.literal("credential_first_use"), alias: Alias, origin: Origin }),
  z.object({ kind: z.literal("new_origin"), origin: Origin, url: PageUrl }),
  z.object({
    kind: z.literal("budget"),
    exceeded: z.enum(["steps", "usd", "minutes"]),
    usage: Usage,
    budget: Budget,
  }),
]);
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/** Budget sheet: Extend +50% / Finish now (Cancel is a denial). */
export const BUDGET_CHOICES = ["extend", "finish_now"] as const;
export const BudgetChoice = z.enum(BUDGET_CHOICES);
export type BudgetChoice = z.infer<typeof BudgetChoice>;

/** Stored in approvals.edit. */
export const ApprovalEdit = z.object({
  instruction: z.string().max(2_000).nullable(),
  budgetChoice: BudgetChoice.nullable(),
});
export type ApprovalEdit = z.infer<typeof ApprovalEdit>;

export const APPROVAL_DECISIONS = ["approved", "denied", "edited"] as const;
export const ApprovalDecision = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalDecisionInput = z
  .object({
    approvalId: Uuid,
    decision: ApprovalDecision,
    instruction: z.string().trim().min(1).max(2_000).nullable().default(null),
    budgetChoice: BudgetChoice.nullable().default(null),
  })
  .superRefine((input, ctx) => {
    if (input.decision === "edited" && input.instruction === null) {
      ctx.addIssue({ code: "custom", path: ["instruction"], message: "An edit needs an instruction" });
    }
  });
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInput>;

export type PolicyDecision = "approved" | "denied" | "ask";

/**
 * Benchmark mode (approvalMode = auto_within_allowlist). Every decision is still written to
 * `approvals` with decided_by = POLICY_DECIDER. New origins and downloads stay blocked;
 * budget hits still wait for a human, so auto mode never spends beyond the budget.
 */
export const AUTO_MODE_DECISIONS = {
  risky_click: "approved",
  form_submit: "approved",
  download: "denied",
  credential_first_use: "approved",
  new_origin: "denied",
  budget: "ask",
} as const satisfies Record<ApprovalKind, PolicyDecision>;

export const POLICY_DECIDER = "policy";

export function decideByPolicy(mode: ApprovalMode, kind: ApprovalKind): PolicyDecision {
  return mode === "ask" ? "ask" : AUTO_MODE_DECISIONS[kind];
}
```

Append to `packages/contracts/src/index.ts`:
```ts
export * from "./tools.ts";
export * from "./approval.ts";
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/contracts
git commit -m "feat(contracts): the 7 tool contracts and the approval policy with benchmark auto mode"
```

---

### Task 4: Run events, NOTIFY channels and live-view contracts

**Files:**
- Create: `packages/contracts/src/{events,notify,live}.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/{events,notify,live}.test.ts`

**Interfaces:**
- Consumes: the enums and primitives, `Budget`/`Usage`, `ApprovalRequest`, `ToolName`, and `NOTIFY_MAX_BYTES`.
- Produces, run events:
  - `StepAction` (`{tool, summary, point|null}`).
  - `RunEvent`, a discriminated union on `type` over these 13 types: `status`, `step`, `control`, `slot`, `approval_requested`, `approval_resolved`, `block_added`, `budget`, `user_message`, `download_ready`, `error`, `filed`, `model_fallback`.
  - `RUN_EVENT_TYPES` and `RunEventType`.
  - `RunEventRecord` (`{id: digits string, runId, at, event}`).
- Produces, NOTIFY:
  - `NOTIFY_CHANNELS` and `NotifyChannel`;
  - `NotifyPayloads` and `NotifyPayload<C>`;
  - `assertNotifySize(text: string): void`;
  - `encodeNotify(channel, payload): string`;
  - `decodeNotify(channel, text)`.
- Produces, live view:
  - `LIVE_SLOT_COOKIE = "live_slot"` and `NEKO_MEMBERS = {agent, user}`;
  - `livePath(runId): string` (`/live/<runId>/`) and `liveEmbedPath(runId): string` (`/live/<runId>/?embed=1`);
  - `IceServer` and `OpenLiveResult` (`{sleeping: true}` or `{sleeping: false, slotName, embedPath, iceServers}`);
  - `TURN_CREDENTIAL_TTL_SECONDS = 600`.

- [ ] **Step 1: Write the failing tests.**

`packages/contracts/src/events.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, EMPTY_USAGE } from "./budget.ts";
import { RUN_EVENT_TYPES, RunEvent, RunEventRecord, type RunEventType } from "./events.ts";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("RunEvent", () => {
  it("covers every spec event type plus model_fallback", () => {
    const samples: Record<RunEventType, unknown> = {
      status: { type: "status", status: "waiting", waitReason: "approval", reason: null },
      step: {
        type: "step",
        seq: 3,
        phase: "act",
        state: "aborted",
        caption: "Clicking Check",
        url: "https://learn.zybooks.com/",
        screenshotKey: null,
        action: { tool: "computer", summary: "click Check", point: { x: 10, y: 20 } },
      },
      control: { type: "control", holder: "user" },
      slot: { type: "slot", slotName: "browser-2" },
      approval_requested: {
        type: "approval_requested",
        approvalId: id,
        request: { kind: "new_origin", origin: "https://b.com", url: "https://b.com/x" },
      },
      approval_resolved: {
        type: "approval_resolved",
        approvalId: id,
        status: "approved",
        decidedBy: "policy",
      },
      block_added: {
        type: "block_added",
        noteId: id,
        blockId: id,
        blockType: "paragraph",
        origin: "dom",
      },
      budget: { type: "budget", usage: EMPTY_USAGE, budget: DEFAULT_BUDGET },
      user_message: { type: "user_message", text: "Do reading 2 next" },
      download_ready: { type: "download_ready", downloadId: id, filename: "a.pdf", bytes: 10 },
      error: { type: "error", code: "openai_5xx", message: "Model unavailable" },
      filed: {
        type: "filed",
        noteId: id,
        folderId: id,
        path: ["CS", "zyBooks"],
        filedBy: "agent",
      },
      model_fallback: { type: "model_fallback", from: "gpt-6-astra", to: "gpt-6.1-sol" },
    };
    expect(Object.keys(samples).sort()).toEqual([...RUN_EVENT_TYPES].sort());
    for (const type of RUN_EVENT_TYPES) expect(RunEvent.parse(samples[type]).type).toBe(type);
  });

  it("rejects unknown event types", () => {
    expect(RunEvent.safeParse({ type: "screencast_frame" }).success).toBe(false);
  });

  it("wraps events in records with bigserial ids as strings", () => {
    const event = { type: "control", holder: "agent" };
    expect(
      RunEventRecord.safeParse({ id: "42", runId: id, at: "2026-10-05T12:00:00Z", event }).success,
    ).toBe(true);
    expect(
      RunEventRecord.safeParse({ id: "4x", runId: id, at: "2026-10-05T12:00:00Z", event }).success,
    ).toBe(false);
  });
});
```

`packages/contracts/src/notify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { NOTIFY_CHANNELS, assertNotifySize, decodeNotify, encodeNotify } from "./notify.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("NOTIFY payloads", () => {
  it("lists the spec channels", () => {
    expect(NOTIFY_CHANNELS).toEqual([
      "run_queued",
      "run_wake",
      "run_control",
      "otp_ready",
      "run_event",
    ]);
  });
  it("round-trips ids-only payloads", () => {
    const text = encodeNotify("run_wake", { runId, reason: "takeover" });
    expect(decodeNotify("run_wake", text)).toEqual({ runId, reason: "takeover" });
    expect(decodeNotify("run_wake", encodeNotify("run_wake", { runId: null, reason: "kill" })))
      .toEqual({ runId: null, reason: "kill" });
  });
  it("refuses extra keys so page content can never ride along", () => {
    expect(() =>
      encodeNotify("run_queued", { runId, note: "x" } as unknown as { runId: string }),
    ).toThrow();
  });
  it("enforces the 200-byte limit", () => {
    expect(() => assertNotifySize("x".repeat(201))).toThrow(/200/);
    expect(() => assertNotifySize("x".repeat(200))).not.toThrow();
  });
  it("rejects malformed text", () => {
    expect(() => decodeNotify("run_event", "not json")).toThrow();
    expect(() => decodeNotify("run_event", JSON.stringify({ runId, eventId: "abc" }))).toThrow();
  });
});
```

`packages/contracts/src/live.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { OpenLiveResult, liveEmbedPath, livePath } from "./live.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("live view contracts", () => {
  it("builds per-run paths", () => {
    expect(livePath(runId)).toBe(`/live/${runId}/`);
    expect(liveEmbedPath(runId)).toBe(`/live/${runId}/?embed=1`);
    expect(() => livePath("../etc")).toThrow();
  });
  it("parses both openLive shapes", () => {
    expect(OpenLiveResult.parse({ sleeping: true })).toEqual({ sleeping: true });
    const awake = OpenLiveResult.parse({
      sleeping: false,
      slotName: "browser-3",
      embedPath: liveEmbedPath(runId),
      iceServers: [
        { urls: ["turn:turn.example.com:3478"], username: "1700000000:run", credential: "x" },
      ],
    });
    expect(awake.sleeping).toBe(false);
  });
  it("rejects embed paths that are not per-run live paths", () => {
    expect(
      OpenLiveResult.safeParse({
        sleeping: false,
        slotName: "browser-1",
        embedPath: "/admin",
        iceServers: [],
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement.**

`packages/contracts/src/events.ts`:
```ts
import { z } from "zod";
import { ApprovalRequest } from "./approval.ts";
import { Budget, Usage } from "./budget.ts";
import {
  ApprovalStatus,
  BlockOrigin,
  BlockType,
  Controller,
  FiledBy,
  RunStatus,
  StepPhase,
  StepState,
  WaitReason,
} from "./enums.ts";
import { IsoDateTime, SlotName, Uuid } from "./primitives.ts";
import { ToolName } from "./tools.ts";

/** What the UI shows for a step; `point` drives the overlay cursor. */
export const StepAction = z.object({
  tool: ToolName,
  summary: z.string().max(300),
  point: z.object({ x: z.number().int(), y: z.number().int() }).nullable(),
});
export type StepAction = z.infer<typeof StepAction>;

export const RUN_EVENT_TYPES = [
  "status",
  "step",
  "control",
  "slot",
  "approval_requested",
  "approval_resolved",
  "block_added",
  "budget",
  "user_message",
  "download_ready",
  "error",
  "filed",
  "model_fallback",
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** Stored in run_events.payload and streamed over SSE (spec §6). */
export const RunEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: RunStatus,
    waitReason: WaitReason.nullable(),
    reason: z.string().max(500).nullable(),
  }),
  z.object({
    type: z.literal("step"),
    seq: z.number().int().nonnegative(),
    phase: StepPhase,
    state: StepState,
    caption: z.string().max(300).nullable(),
    url: z.string().max(4_096).nullable(),
    screenshotKey: z.string().max(1_024).nullable(),
    action: StepAction.nullable(),
  }),
  z.object({ type: z.literal("control"), holder: Controller }),
  z.object({ type: z.literal("slot"), slotName: SlotName.nullable() }),
  z.object({ type: z.literal("approval_requested"), approvalId: Uuid, request: ApprovalRequest }),
  z.object({
    type: z.literal("approval_resolved"),
    approvalId: Uuid,
    status: ApprovalStatus,
    decidedBy: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("block_added"),
    noteId: Uuid,
    blockId: Uuid,
    blockType: BlockType,
    origin: BlockOrigin,
  }),
  z.object({ type: z.literal("budget"), usage: Usage, budget: Budget }),
  z.object({ type: z.literal("user_message"), text: z.string().min(1).max(4_000) }),
  z.object({
    type: z.literal("download_ready"),
    downloadId: Uuid,
    filename: z.string().max(255),
    bytes: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1).max(64),
    message: z.string().max(500),
  }),
  z.object({
    type: z.literal("filed"),
    noteId: Uuid,
    folderId: Uuid,
    path: z.array(z.string().max(120)).max(8),
    filedBy: FiledBy,
  }),
  z.object({
    type: z.literal("model_fallback"),
    from: z.string().max(64),
    to: z.string().max(64),
  }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

export const RunEventRecord = z.object({
  id: z.string().regex(/^[0-9]+$/),
  runId: Uuid,
  at: IsoDateTime,
  event: RunEvent,
});
export type RunEventRecord = z.infer<typeof RunEventRecord>;
```

`packages/contracts/src/notify.ts`:
```ts
import { z } from "zod";
import { NOTIFY_MAX_BYTES } from "./constants.ts";
import { WakeReason } from "./enums.ts";
import { Uuid } from "./primitives.ts";

export const NOTIFY_CHANNELS = [
  "run_queued",
  "run_wake",
  "run_control",
  "otp_ready",
  "run_event",
] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

/** IDs only (spec §3.1). `run_wake` with runId null and reason "kill" addresses every agent. */
export const NotifyPayloads = {
  run_queued: z.strictObject({ runId: Uuid }),
  run_wake: z.strictObject({ runId: Uuid.nullable(), reason: WakeReason }),
  run_control: z.strictObject({ runId: Uuid }),
  otp_ready: z.strictObject({ runId: Uuid }),
  run_event: z.strictObject({ runId: Uuid, eventId: z.string().regex(/^[0-9]+$/) }),
} as const satisfies Record<NotifyChannel, z.ZodType>;
export type NotifyPayload<C extends NotifyChannel> = z.infer<(typeof NotifyPayloads)[C]>;

export function assertNotifySize(text: string): void {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > NOTIFY_MAX_BYTES) {
    throw new RangeError(`NOTIFY payload is ${bytes} bytes; the limit is ${NOTIFY_MAX_BYTES}`);
  }
}

export function encodeNotify<C extends NotifyChannel>(channel: C, payload: NotifyPayload<C>): string {
  const text = JSON.stringify(NotifyPayloads[channel].parse(payload));
  assertNotifySize(text);
  return text;
}

export function decodeNotify<C extends NotifyChannel>(channel: C, text: string): NotifyPayload<C> {
  assertNotifySize(text);
  return NotifyPayloads[channel].parse(JSON.parse(text)) as NotifyPayload<C>;
}
```

`packages/contracts/src/live.ts`:
```ts
import { z } from "zod";
import { SlotName, Uuid } from "./primitives.ts";

/** Signed cookie naming the slot for Traefik's per-slot routers (spec §10.2). */
export const LIVE_SLOT_COOKIE = "live_slot";
/** n.eko members in every slot; passwords are HMAC(secret, slotName). */
export const NEKO_MEMBERS = { agent: "agent", user: "user" } as const;
export const TURN_CREDENTIAL_TTL_SECONDS = 600;

export function livePath(runId: string): string {
  return `/live/${Uuid.parse(runId)}/`;
}
export function liveEmbedPath(runId: string): string {
  return `${livePath(runId)}?embed=1`;
}

export const IceServer = z.object({
  urls: z.array(z.string().regex(/^(stun|turns?):/)).min(1),
  username: z.string().max(256).optional(),
  credential: z.string().max(256).optional(),
});
export type IceServer = z.infer<typeof IceServer>;

/** Output of oRPC runs.openLive. A sleeping run holds no slot. */
export const OpenLiveResult = z.discriminatedUnion("sleeping", [
  z.object({ sleeping: z.literal(true) }),
  z.object({
    sleeping: z.literal(false),
    slotName: SlotName,
    embedPath: z.string().regex(/^\/live\/[0-9a-f-]{36}\/\?embed=1$/),
    iceServers: z.array(IceServer).max(4),
  }),
]);
export type OpenLiveResult = z.infer<typeof OpenLiveResult>;
```

Append to `packages/contracts/src/index.ts`:
```ts
export * from "./events.ts";
export * from "./notify.ts";
export * from "./live.ts";
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/contracts
git commit -m "feat(contracts): RunEvent union, NOTIFY channels and live-view contracts"
```

---

### Task 5: Env schemas, `parseEnv` and the server helpers

**Files:**
- Create: `packages/contracts/src/env.ts`, `packages/contracts/src/server/{index,logger,neko}.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/env.test.ts`, `packages/contracts/src/server/{logger,neko}.test.ts`

**Interfaces:**
- Consumes: the primitives from Task 1.
- Produces, from `@mastertutor/contracts`:
  - `LOG_LEVELS`/`LogLevel` and `SlotList` (a CSV string parsed to `string[]` of unique slot names).
  - Per-service env schemas and their inferred types: `WebEnv`, `AgentEnv`, `MigrateEnv`, `GarageInitEnv`.
  - `EnvError`, which has a `problems: string[]` field.
  - `parseEnv<S extends z.ZodType>(schema: S, source: Readonly<Record<string, string | undefined>>): z.output<S>`. Empty strings are treated as unset.
- Produces, from `@mastertutor/contracts/server`:
  - `REDACT_PATHS`;
  - `createLogger(opts: {service: string; level?: LogLevel; destination?: DestinationStream}): Logger`;
  - `deriveNekoPassword(secret: string, slotName: string): string`, which is lowercase hex HMAC-SHA256.
- **Keys per schema:**

  | Schema | Keys |
  |---|---|
  | `WebEnv` | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_SIGNUP_OPEN`, `VAULT_PUBLIC_KEY`, `NEKO_MEMBER_SECRET`, `LIVE_COOKIE_SECRET`, `TURN_SECRET`, `OPENAI_EMBEDDINGS_KEY`, `OPENAI_BASE_URL?`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `NODE_ENV`, `LOG_LEVEL` |
  | `AgentEnv` | `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL?`, `VAULT_PRIVATE_KEY`, `NEKO_ADMIN_SECRET`, the S3 keys above, `BROWSER_SLOTS`, `AGENT_TEST_MODE`, `AGENT_HEALTH_PORT` (default 8787), `NODE_ENV`, `LOG_LEVEL` |
  | `MigrateEnv` | `DATABASE_URL`, `WEB_DB_PASSWORD`, `AGENT_DB_PASSWORD`, `BROWSER_SLOTS`, `NODE_ENV`, `LOG_LEVEL` |
  | `GarageInitEnv` | `GARAGE_ADMIN_URL`, `GARAGE_ADMIN_TOKEN`, `S3_BUCKET`, `S3_WEB_ACCESS_KEY_ID`, `S3_WEB_SECRET_ACCESS_KEY`, `S3_AGENT_ACCESS_KEY_ID`, `S3_AGENT_SECRET_ACCESS_KEY`, `GARAGE_CAPACITY_BYTES`, `NODE_ENV`, `LOG_LEVEL` |

- [ ] **Step 1: Write the failing tests.**

`packages/contracts/src/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { AgentEnv, EnvError, GarageInitEnv, MigrateEnv, WebEnv, parseEnv } from "./env.ts";

const agentSource = {
  DATABASE_URL: "postgres://agent_role:pw@postgres:5432/mastertutor",
  OPENAI_API_KEY: "sk-test-not-a-real-key",
  OPENAI_BASE_URL: "",
  VAULT_PRIVATE_KEY: "kCNZsvnP2oSO4FaU/yZoEi4TCPUK/EKw1zn4wI/5s1c=",
  NEKO_ADMIN_SECRET: "neko-admin-secret-for-tests-0123456789",
  S3_ENDPOINT: "http://garage:3900",
  S3_ACCESS_KEY_ID: "GK5aa6eb9e4f040236e79864f3",
  S3_SECRET_ACCESS_KEY: "0974bfbf76eb6fb9faf77bf05f5b21d703c85dbd797421167285185ae7ff3568",
  BROWSER_SLOTS: "browser-1, browser-2",
};

describe("parseEnv", () => {
  it("parses the agent env with defaults", () => {
    const env = parseEnv(AgentEnv, agentSource);
    expect(env.BROWSER_SLOTS).toEqual(["browser-1", "browser-2"]);
    expect(env.S3_REGION).toBe("garage");
    expect(env.S3_BUCKET).toBe("mastertutor");
    expect(env.AGENT_HEALTH_PORT).toBe(8787);
    expect(env.AGENT_TEST_MODE).toBe(false);
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("parses boolean flags", () => {
    expect(parseEnv(AgentEnv, { ...agentSource, AGENT_TEST_MODE: "1" }).AGENT_TEST_MODE).toBe(true);
    expect(() => parseEnv(AgentEnv, { ...agentSource, AGENT_TEST_MODE: "yes" })).toThrow(EnvError);
  });

  it("rejects duplicate or malformed slot lists", () => {
    expect(() => parseEnv(AgentEnv, { ...agentSource, BROWSER_SLOTS: "browser-1,browser-1" })).toThrow(
      EnvError,
    );
    expect(() => parseEnv(AgentEnv, { ...agentSource, BROWSER_SLOTS: "slot-a" })).toThrow(EnvError);
    expect(() => parseEnv(AgentEnv, { ...agentSource, BROWSER_SLOTS: " , " })).toThrow(EnvError);
  });

  it("names the bad keys but never echoes their values", () => {
    const secretValue = "super-secret-value-123";
    try {
      parseEnv(AgentEnv, { ...agentSource, NEKO_ADMIN_SECRET: secretValue, OPENAI_API_KEY: undefined });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      expect(message).toContain("NEKO_ADMIN_SECRET");
      expect(message).toContain("OPENAI_API_KEY");
      expect(message).not.toContain(secretValue);
    }
  });
});

describe("least privilege per service (spec §13)", () => {
  const keys = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape);
  it("web never gets the vault private key, the n.eko admin secret or the agent's OpenAI key", () => {
    expect(keys(WebEnv)).not.toContain("VAULT_PRIVATE_KEY");
    expect(keys(WebEnv)).not.toContain("NEKO_ADMIN_SECRET");
    expect(keys(WebEnv)).not.toContain("OPENAI_API_KEY");
  });
  it("agent never gets web-only secrets", () => {
    for (const key of [
      "NEKO_MEMBER_SECRET",
      "BETTER_AUTH_SECRET",
      "LIVE_COOKIE_SECRET",
      "TURN_SECRET",
      "VAULT_PUBLIC_KEY",
    ]) {
      expect(keys(AgentEnv)).not.toContain(key);
    }
  });
  it("one-shots get only what they need", () => {
    expect(keys(MigrateEnv).sort()).toEqual(
      ["AGENT_DB_PASSWORD", "BROWSER_SLOTS", "DATABASE_URL", "LOG_LEVEL", "NODE_ENV", "WEB_DB_PASSWORD"].sort(),
    );
    expect(keys(GarageInitEnv)).not.toContain("DATABASE_URL");
  });
});
```

`packages/contracts/src/server/logger.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.ts";

function capture() {
  const lines: string[] = [];
  return { lines, destination: { write: (line: string) => void lines.push(line) } };
}

describe("createLogger", () => {
  it("redacts secret-bearing fields at the top level and one level deep", () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: "test", destination });
    log.info(
      {
        password: "p1",
        code: "123456",
        authorization: "Bearer x",
        fill: { password: "p2", sealed: "s", secret: "t", code: "654321" },
        alias: "zybooks",
      },
      "fill",
    );
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry.password).toBe("[redacted]");
    expect(entry.code).toBe("[redacted]");
    expect(entry.authorization).toBe("[redacted]");
    expect(entry.fill).toEqual({
      password: "[redacted]",
      sealed: "[redacted]",
      secret: "[redacted]",
      code: "[redacted]",
    });
    expect(entry.alias).toBe("zybooks");
    expect(entry.service).toBe("test");
    for (const secret of ["p1", "p2", "123456", "654321", "Bearer x"]) {
      expect(lines.join("\n")).not.toContain(secret);
    }
  });
});
```

`packages/contracts/src/server/neko.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deriveNekoPassword } from "./neko.ts";

describe("deriveNekoPassword", () => {
  it("matches the slot entrypoint (openssl dgst -sha256 -hmac)", () => {
    // printf '%s' browser-1 | openssl dgst -sha256 -hmac 'neko-admin-secret-for-tests-0123456789' -r
    expect(deriveNekoPassword("neko-admin-secret-for-tests-0123456789", "browser-1")).toBe(
      "a35f74afd3da16d9602bfa17a0637d2a482e320a6d90af6600987626cd6c9ef6",
    );
  });
  it("rejects bad slot names and short secrets", () => {
    expect(() => deriveNekoPassword("neko-admin-secret-for-tests-0123456789", "web")).toThrow();
    expect(() => deriveNekoPassword("short", "browser-1")).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement.**

`packages/contracts/src/env.ts`:
```ts
import { z } from "zod";
import {
  Base64Key32,
  BucketName,
  DbPassword,
  GarageKeyId,
  GarageSecret,
  PostgresUrl,
  SlotName,
} from "./primitives.ts";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export const LogLevel = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevel>;

const Secret = z.string().min(32, "Must be at least 32 characters");
const Flag = z
  .enum(["0", "1", "true", "false"])
  .default("0")
  .transform((value) => value === "1" || value === "true");

export const SlotList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(
    z
      .array(SlotName)
      .min(1, "List at least one slot")
      .refine((names) => new Set(names).size === names.length, "Slot names must be unique"),
  );

const Common = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: LogLevel.default("info"),
};
const S3Access = {
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("garage"),
  S3_BUCKET: BucketName.default("mastertutor"),
  S3_ACCESS_KEY_ID: GarageKeyId,
  S3_SECRET_ACCESS_KEY: GarageSecret,
};

/** web: encryption-only vault key, member-only n.eko secret, read-only S3 key (spec §13). */
export const WebEnv = z.object({
  ...Common,
  DATABASE_URL: PostgresUrl,
  BETTER_AUTH_SECRET: Secret,
  BETTER_AUTH_URL: z.url(),
  AUTH_SIGNUP_OPEN: Flag,
  VAULT_PUBLIC_KEY: Base64Key32,
  NEKO_MEMBER_SECRET: Secret,
  LIVE_COOKIE_SECRET: Secret,
  TURN_SECRET: Secret,
  OPENAI_EMBEDDINGS_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.url().optional(),
  ...S3Access,
});
export type WebEnv = z.infer<typeof WebEnv>;

/** agent: decryption key, n.eko admin secret, read/write S3 key. */
export const AgentEnv = z.object({
  ...Common,
  DATABASE_URL: PostgresUrl,
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.url().optional(),
  VAULT_PRIVATE_KEY: Base64Key32,
  NEKO_ADMIN_SECRET: Secret,
  ...S3Access,
  BROWSER_SLOTS: SlotList,
  AGENT_TEST_MODE: Flag,
  AGENT_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
});
export type AgentEnv = z.infer<typeof AgentEnv>;

/** migrate one-shot: owner connection plus the service-role passwords it sets. */
export const MigrateEnv = z.object({
  ...Common,
  DATABASE_URL: PostgresUrl,
  WEB_DB_PASSWORD: DbPassword,
  AGENT_DB_PASSWORD: DbPassword,
  BROWSER_SLOTS: SlotList,
});
export type MigrateEnv = z.infer<typeof MigrateEnv>;

/** garage-init one-shot: admin API token plus the two service keys it imports. */
export const GarageInitEnv = z.object({
  ...Common,
  GARAGE_ADMIN_URL: z.url(),
  GARAGE_ADMIN_TOKEN: Secret,
  S3_BUCKET: BucketName.default("mastertutor"),
  S3_WEB_ACCESS_KEY_ID: GarageKeyId,
  S3_WEB_SECRET_ACCESS_KEY: GarageSecret,
  S3_AGENT_ACCESS_KEY_ID: GarageKeyId,
  S3_AGENT_SECRET_ACCESS_KEY: GarageSecret,
  GARAGE_CAPACITY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 ** 3),
});
export type GarageInitEnv = z.infer<typeof GarageInitEnv>;

export class EnvError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid environment:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "EnvError";
    this.problems = problems;
  }
}

/** Parses env at boot. Empty strings count as unset. Errors name keys, never values. */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Readonly<Record<string, string | undefined>>,
): z.output<S> {
  const present: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") present[key] = value;
  }
  const result = schema.safeParse(present);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map(
        (issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}
```

`packages/contracts/src/server/logger.ts`:
```ts
import pino, { type DestinationStream, type Logger } from "pino";
import type { LogLevel } from "../env.ts";

/** Spec §9: redact secrets wherever they appear at the top level or one level down. */
export const REDACT_PATHS = [
  "password",
  "secret",
  "sealed",
  "code",
  "authorization",
  "*.password",
  "*.secret",
  "*.sealed",
  "*.code",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
] as const;

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  const config = {
    level: options.level ?? "info",
    base: { service: options.service },
    redact: { paths: [...REDACT_PATHS], censor: "[redacted]" },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
```

`packages/contracts/src/server/neko.ts`:
```ts
import { createHmac } from "node:crypto";
import { SlotName } from "../primitives.ts";

/** Same derivation as apps/browser-slot/bin/slot-entrypoint (openssl dgst -sha256 -hmac). */
export function deriveNekoPassword(secret: string, slotName: string): string {
  const slot = SlotName.parse(slotName);
  if (secret.length < 32) throw new RangeError("n.eko secrets must be at least 32 characters");
  return createHmac("sha256", secret).update(slot).digest("hex");
}
```

`packages/contracts/src/server/index.ts`:
```ts
export * from "./logger.ts";
export * from "./neko.ts";
```

Append to `packages/contracts/src/index.ts`:
```ts
export * from "./env.ts";
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/contracts
git commit -m "feat(contracts): per-service env schemas, parseEnv, redacting logger, n.eko password derivation"
```

---

### Task 6: oRPC API contract and DTOs

**Files:**
- Create: `packages/contracts/src/api/{dto,contract}.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/api/{dto,contract}.test.ts`

**Interfaces:**
- Consumes: everything defined so far.
- Produces, DTOs from `@mastertutor/contracts`:
  - **Shared:** `Ok`, `PageInput`, `Page(item)`.
  - **Runs:** `CreateRunInput`, `ListRunsInput`, `RunRef`, `RunSummary`, `ApprovalView`, `RunDetail`, `ListRunStepsInput`, `RunStepView`, `SendMessageInput`, `SubmitOtpInput`, `HandBackInput`.
  - **Notes:** `NoteRef`, `BlockRef`, `ListNotesInput`, `NoteSummary`, `SourceView`, `NoteDetail`, `UpdateBlockInput`, `MoveNoteInput`, `SearchInput`, `SearchHit`, `ExportResult`.
  - **Folders:** `FolderView`, `FolderRef`, `CreateFolderInput`, `RenameFolderInput`, `MoveFolderInput`.
  - **Vault:** `ImapConfig`, `VaultItemView`, `CreateVaultItemInput`, `VaultItemRef`, `SetSecretInput`, `RemoveSecretInput`, `ForgetSessionInput`, `VaultAuditView`.
  - **Settings:** `SettingsView`, `UpdateSettingsInput`, `SetKillSwitchInput`, `UsageInput`, `UsageReport`.
  - **Assets:** `AssetRef`, `SignedUrl`.
  - **Benchmarks:** `BenchmarkView`, `CreateBenchmarkInput`, `BenchmarkRef`, `StartBenchmarkResult`, `ListBenchmarkRunsInput`, `BenchmarkRunView`, `GradeBenchmarkRunInput`.
- Produces, the router:
  - `apiContract`, with these routers and procedures:

    | Router | Procedures |
    |---|---|
    | `runs` | `create`, `list`, `get`, `steps`, `cancel`, `resume`, `sendMessage`, `decideApproval`, `submitOtp`, `takeControl`, `handBack`, `openLive` |
    | `notes` | `list`, `get`, `updateBlock`, `markVerified`, `move`, `delete`, `export`, `search` |
    | `folders` | `tree`, `create`, `rename`, `move`, `delete` |
    | `vault` | `list`, `create`, `setSecret`, `removeSecret`, `delete`, `forgetSession`, `audit` |
    | `settings` | `get`, `update`, `setKillSwitch`, `usage` |
    | `assets` | `url` |
    | `benchmarks` | `list`, `create`, `start`, `runs`, `grade` |

  - `type ApiContract`.

- [ ] **Step 1: Write the failing tests.**

`packages/contracts/src/api/contract.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { apiContract } from "./contract.ts";

describe("apiContract", () => {
  it("exposes the agreed routers and procedures", () => {
    const shape = Object.fromEntries(
      Object.entries(apiContract).map(([router, procedures]) => [
        router,
        Object.keys(procedures).sort(),
      ]),
    );
    expect(shape).toEqual({
      runs: [
        "cancel",
        "create",
        "decideApproval",
        "get",
        "handBack",
        "list",
        "openLive",
        "resume",
        "sendMessage",
        "steps",
        "submitOtp",
        "takeControl",
      ],
      notes: ["delete", "export", "get", "list", "markVerified", "move", "search", "updateBlock"],
      folders: ["create", "delete", "move", "rename", "tree"],
      vault: ["audit", "create", "delete", "forgetSession", "list", "removeSecret", "setSecret"],
      settings: ["get", "setKillSwitch", "update", "usage"],
      assets: ["url"],
      benchmarks: ["create", "grade", "list", "runs", "start"],
    });
  });
});
```

`packages/contracts/src/api/dto.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  CreateBenchmarkInput,
  CreateRunInput,
  CreateVaultItemInput,
  GradeBenchmarkRunInput,
  ListNotesInput,
  SubmitOtpInput,
  UsageInput,
} from "./dto.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("run inputs", () => {
  it("normalizes origins and defaults to ask mode", () => {
    const input = CreateRunInput.parse({
      goal: "Take notes on reading 1",
      allowedOrigins: ["learn.zybooks.com/zybook/X"],
    });
    expect(input.allowedOrigins).toEqual(["https://learn.zybooks.com"]);
    expect(input.approvalMode).toBe("ask");
    expect(input.targetFolderId).toBeNull();
    expect(input.budget).toBeUndefined();
  });
  it("needs a goal and at least one origin", () => {
    expect(CreateRunInput.safeParse({ goal: " ", allowedOrigins: ["a.com"] }).success).toBe(false);
    expect(CreateRunInput.safeParse({ goal: "x", allowedOrigins: [] }).success).toBe(false);
  });
  it("accepts only 4-8 digit OTP codes", () => {
    expect(SubmitOtpInput.safeParse({ runId, code: "123456" }).success).toBe(true);
    expect(SubmitOtpInput.safeParse({ runId, code: "12a456" }).success).toBe(false);
    expect(SubmitOtpInput.safeParse({ runId, code: "123" }).success).toBe(false);
  });
});

describe("benchmark inputs", () => {
  it("defaults to auto approval within the allowlist", () => {
    const input = CreateBenchmarkInput.parse({
      name: "zyBooks readings 1-5",
      task: "Complete all participation activities in reading assignments 1-5",
      allowedOrigins: ["https://learn.zybooks.com"],
      successCriteria: "All participation activities in readings 1-5 show complete",
    });
    expect(input.approvalMode).toBe("auto_within_allowlist");
  });
  it("cannot grade a run as pending", () => {
    expect(GradeBenchmarkRunInput.safeParse({ benchmarkRunId: runId, outcome: "pending" }).success).toBe(
      false,
    );
    expect(
      GradeBenchmarkRunInput.parse({ benchmarkRunId: runId, outcome: "partial" }).failureNotes,
    ).toBeNull();
  });
});

describe("other inputs", () => {
  it("lists notes by all, unfiled or a folder id", () => {
    expect(ListNotesInput.parse({}).folder).toBe("all");
    expect(ListNotesInput.parse({ folder: "unfiled" }).folder).toBe("unfiled");
    expect(ListNotesInput.parse({ folder: runId }).folder).toBe(runId);
    expect(ListNotesInput.safeParse({ folder: "../x" }).success).toBe(false);
  });
  it("never accepts passkeys typed into the vault form", () => {
    expect(
      CreateVaultItemInput.safeParse({
        alias: "site",
        origin: "https://a.com",
        label: "A",
        secrets: { passkey: "x" },
      }).success,
    ).toBe(false);
  });
  it("orders usage ranges", () => {
    expect(UsageInput.safeParse({ from: "2026-10-05", to: "2026-10-01" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement.**

`packages/contracts/src/api/dto.ts`:
```ts
import { z } from "zod";
import { ApprovalRequest } from "../approval.ts";
import { Budget, Plan, Usage } from "../budget.ts";
import {
  ApprovalKind,
  ApprovalMode,
  ApprovalStatus,
  BenchmarkOutcome,
  Controller,
  Fidelity,
  FiledBy,
  RunStatus,
  SourceKind,
  StepPhase,
  StepState,
  TypedSecretField,
  VaultAuditAction,
  VaultSecretField,
  WaitReason,
} from "../enums.ts";
import { StepAction } from "../events.ts";
import { NoteBlock } from "../note.ts";
import {
  Alias,
  FolderName,
  IsoDate,
  IsoDateTime,
  Origin,
  OriginInput,
  SlotName,
  Uuid,
} from "../primitives.ts";

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;

export const PageInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).nullable().default(null),
});
export type PageInput = z.infer<typeof PageInput>;

export function Page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

const Count = z.number().int().nonnegative();

/* ---------------------------------- runs ---------------------------------- */

export const CreateRunInput = z.object({
  goal: z.string().trim().min(1).max(4_000),
  allowedOrigins: z.array(OriginInput).min(1).max(50),
  budget: Budget.optional(),
  targetFolderId: Uuid.nullable().default(null),
  approvalMode: ApprovalMode.default("ask"),
});
export type CreateRunInput = z.infer<typeof CreateRunInput>;

export const ListRunsInput = PageInput.extend({ status: RunStatus.nullable().default(null) });
export type ListRunsInput = z.infer<typeof ListRunsInput>;

export const RunRef = z.object({ runId: Uuid });
export type RunRef = z.infer<typeof RunRef>;

export const RunSummary = z.object({
  id: Uuid,
  goal: z.string(),
  status: RunStatus,
  waitReason: WaitReason.nullable(),
  controller: Controller,
  approvalMode: ApprovalMode,
  model: z.string(),
  noteId: Uuid.nullable(),
  usage: Usage,
  budget: Budget,
  createdAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const ApprovalView = z.object({
  id: Uuid,
  runId: Uuid,
  stepSeq: Count,
  kind: ApprovalKind,
  request: ApprovalRequest,
  status: ApprovalStatus,
  decidedBy: z.string().nullable(),
  decidedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type ApprovalView = z.infer<typeof ApprovalView>;

export const RunDetail = RunSummary.extend({
  plan: Plan.nullable(),
  allowedOrigins: z.array(Origin),
  currentUrl: z.string().nullable(),
  slotName: SlotName.nullable(),
  targetFolderId: Uuid.nullable(),
  pendingApprovals: z.array(ApprovalView),
  lastEventId: z.string().regex(/^[0-9]+$/).nullable(),
});
export type RunDetail = z.infer<typeof RunDetail>;

export const ListRunStepsInput = z.object({
  runId: Uuid,
  afterSeq: Count.nullable().default(null),
  limit: z.number().int().min(1).max(500).default(200),
});
export type ListRunStepsInput = z.infer<typeof ListRunStepsInput>;

export const RunStepView = z.object({
  seq: Count,
  phase: StepPhase,
  state: StepState,
  caption: z.string().nullable(),
  url: z.string().nullable(),
  screenshotKey: z.string().nullable(),
  action: StepAction.nullable(),
  createdAt: IsoDateTime,
});
export type RunStepView = z.infer<typeof RunStepView>;

export const SendMessageInput = z.object({ runId: Uuid, text: z.string().trim().min(1).max(4_000) });
export type SendMessageInput = z.infer<typeof SendMessageInput>;

/** The code is sealed by web the moment it arrives (spec §9); never logged. */
export const SubmitOtpInput = z.object({ runId: Uuid, code: z.string().regex(/^[0-9]{4,8}$/) });
export type SubmitOtpInput = z.infer<typeof SubmitOtpInput>;

export const HandBackInput = z.object({
  runId: Uuid,
  note: z.string().trim().min(1).max(4_000).nullable().default(null),
});
export type HandBackInput = z.infer<typeof HandBackInput>;

/* ------------------------------ notes/folders ----------------------------- */

export const NoteRef = z.object({ noteId: Uuid });
export type NoteRef = z.infer<typeof NoteRef>;
export const BlockRef = z.object({ blockId: Uuid });
export type BlockRef = z.infer<typeof BlockRef>;

export const ListNotesInput = PageInput.extend({
  folder: z.union([z.literal("all"), z.literal("unfiled"), Uuid]).default("all"),
  kind: SourceKind.nullable().default(null),
});
export type ListNotesInput = z.infer<typeof ListNotesInput>;

export const NoteSummary = z.object({
  id: Uuid,
  folderId: Uuid.nullable(),
  title: z.string(),
  lede: z.string().nullable(),
  fidelity: Fidelity,
  coverage: z.number().min(0).max(1).nullable(),
  filedBy: FiledBy,
  runId: Uuid.nullable(),
  sourceKinds: z.array(SourceKind),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type NoteSummary = z.infer<typeof NoteSummary>;

export const SourceView = z.object({
  id: Uuid,
  kind: SourceKind,
  url: z.string(),
  canonicalUrl: z.string().nullable(),
  origin: Origin,
  title: z.string().nullable(),
  faviconAssetId: Uuid.nullable(),
  capturedAt: IsoDateTime,
});
export type SourceView = z.infer<typeof SourceView>;

export const NoteDetail = z.object({
  note: NoteSummary,
  blocks: z.array(NoteBlock),
  sources: z.array(SourceView),
});
export type NoteDetail = z.infer<typeof NoteDetail>;

export const UpdateBlockInput = z.object({ blockId: Uuid, markdown: z.string().max(100_000) });
export type UpdateBlockInput = z.infer<typeof UpdateBlockInput>;
export const MoveNoteInput = z.object({ noteId: Uuid, folderId: Uuid.nullable() });
export type MoveNoteInput = z.infer<typeof MoveNoteInput>;

export const SearchInput = z.object({
  q: z.string().trim().min(1).max(500),
  kind: SourceKind.nullable().default(null),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchInput = z.infer<typeof SearchInput>;
export const SearchHit = z.object({
  noteId: Uuid,
  blockId: Uuid.nullable(),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
});
export type SearchHit = z.infer<typeof SearchHit>;

/** Obsidian-compatible Markdown + assets/ zip, served by web. */
export const ExportResult = z.object({ downloadUrl: z.string().min(1), expiresAt: IsoDateTime });
export type ExportResult = z.infer<typeof ExportResult>;

export const FolderView = z.object({
  id: Uuid,
  parentId: Uuid.nullable(),
  name: z.string(),
  sort: z.number().int(),
});
export type FolderView = z.infer<typeof FolderView>;
export const FolderRef = z.object({ folderId: Uuid });
export type FolderRef = z.infer<typeof FolderRef>;
export const CreateFolderInput = z.object({
  name: FolderName,
  parentId: Uuid.nullable().default(null),
});
export type CreateFolderInput = z.infer<typeof CreateFolderInput>;
export const RenameFolderInput = z.object({ folderId: Uuid, name: FolderName });
export type RenameFolderInput = z.infer<typeof RenameFolderInput>;
export const MoveFolderInput = z.object({ folderId: Uuid, parentId: Uuid.nullable() });
export type MoveFolderInput = z.infer<typeof MoveFolderInput>;

/* ---------------------------------- vault --------------------------------- */

/** The IMAP password is a sealed vault field (imap_password), never part of this object. */
export const ImapConfig = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  user: z.string().min(1).max(320),
  senderFilter: z.string().min(1).max(320),
});
export type ImapConfig = z.infer<typeof ImapConfig>;

export const VaultItemView = z.object({
  id: Uuid,
  alias: Alias,
  origin: Origin,
  label: z.string(),
  fields: z.array(VaultSecretField),
  hasImap: z.boolean(),
  sessionSaved: z.boolean(),
  createdAt: IsoDateTime,
});
export type VaultItemView = z.infer<typeof VaultItemView>;

const SecretValue = z.string().min(1).max(4_096);
export const CreateVaultItemInput = z.object({
  alias: Alias,
  origin: OriginInput,
  label: z.string().trim().min(1).max(120),
  secrets: z.partialRecord(TypedSecretField, SecretValue),
  imap: ImapConfig.nullable().default(null),
});
export type CreateVaultItemInput = z.infer<typeof CreateVaultItemInput>;
export const VaultItemRef = z.object({ itemId: Uuid });
export type VaultItemRef = z.infer<typeof VaultItemRef>;
export const SetSecretInput = z.object({ itemId: Uuid, field: TypedSecretField, value: SecretValue });
export type SetSecretInput = z.infer<typeof SetSecretInput>;
export const RemoveSecretInput = z.object({ itemId: Uuid, field: VaultSecretField });
export type RemoveSecretInput = z.infer<typeof RemoveSecretInput>;
export const ForgetSessionInput = z.object({ alias: Alias, origin: OriginInput });
export type ForgetSessionInput = z.infer<typeof ForgetSessionInput>;

export const VaultAuditView = z.object({
  id: Uuid,
  alias: z.string(),
  origin: z.string().nullable(),
  field: z.string().nullable(),
  action: VaultAuditAction,
  runId: Uuid.nullable(),
  approvedBy: z.string().nullable(),
  outcome: z.string(),
  at: IsoDateTime,
});
export type VaultAuditView = z.infer<typeof VaultAuditView>;

/* -------------------------------- settings -------------------------------- */

export const SettingsView = z.object({
  killSwitch: z.boolean(),
  defaultBudget: Budget,
  defaultAllowedOrigins: z.array(Origin),
  concurrency: z.number().int().min(1),
});
export type SettingsView = z.infer<typeof SettingsView>;
export const UpdateSettingsInput = z.object({
  defaultBudget: Budget.optional(),
  defaultAllowedOrigins: z.array(OriginInput).max(50).optional(),
  concurrency: z.number().int().min(1).max(64).optional(),
});
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;
export const SetKillSwitchInput = z.object({ on: z.boolean() });
export type SetKillSwitchInput = z.infer<typeof SetKillSwitchInput>;

export const UsageInput = z
  .object({ from: IsoDate, to: IsoDate })
  .refine((range) => range.from <= range.to, { message: "from must not be after to" });
export type UsageInput = z.infer<typeof UsageInput>;
export const UsageReport = z.object({
  perDay: z.array(z.object({ day: IsoDate, runs: Count, usd: z.number(), steps: Count })),
  perRun: z.array(
    z.object({ runId: Uuid, goal: z.string(), status: RunStatus, usd: z.number(), steps: Count }),
  ),
  stepLatencyMs: z.object({ p50: z.number().nullable(), p95: z.number().nullable() }),
  openaiErrorRate: z.number().min(0).max(1).nullable(),
});
export type UsageReport = z.infer<typeof UsageReport>;

/* --------------------------------- assets --------------------------------- */

export const AssetRef = z.object({ assetId: Uuid });
export type AssetRef = z.infer<typeof AssetRef>;
export const SignedUrl = z.object({ url: z.string().min(1), expiresAt: IsoDateTime });
export type SignedUrl = z.infer<typeof SignedUrl>;

/* ------------------------------- benchmarks ------------------------------- */

export const BenchmarkView = z.object({
  id: Uuid,
  name: z.string(),
  task: z.string(),
  allowedOrigins: z.array(Origin),
  approvalMode: ApprovalMode,
  budget: Budget,
  successCriteria: z.string(),
  createdAt: IsoDateTime,
});
export type BenchmarkView = z.infer<typeof BenchmarkView>;
export const CreateBenchmarkInput = z.object({
  name: z.string().trim().min(1).max(120),
  task: z.string().trim().min(1).max(4_000),
  allowedOrigins: z.array(OriginInput).min(1).max(50),
  approvalMode: ApprovalMode.default("auto_within_allowlist"),
  budget: Budget.optional(),
  successCriteria: z.string().trim().min(1).max(4_000),
});
export type CreateBenchmarkInput = z.infer<typeof CreateBenchmarkInput>;
export const BenchmarkRef = z.object({ benchmarkId: Uuid });
export type BenchmarkRef = z.infer<typeof BenchmarkRef>;
export const StartBenchmarkResult = z.object({ benchmarkRunId: Uuid, runId: Uuid });
export type StartBenchmarkResult = z.infer<typeof StartBenchmarkResult>;
export const ListBenchmarkRunsInput = z.object({
  benchmarkId: Uuid.nullable().default(null),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListBenchmarkRunsInput = z.infer<typeof ListBenchmarkRunsInput>;
export const BenchmarkRunView = z.object({
  id: Uuid,
  benchmarkId: Uuid,
  runId: Uuid.nullable(),
  outcome: BenchmarkOutcome,
  steps: Count,
  usd: z.number().nonnegative(),
  inputTokens: Count,
  outputTokens: Count,
  durationMs: Count.nullable(),
  failureNotes: z.string().nullable(),
  gradedBy: z.string().nullable(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type BenchmarkRunView = z.infer<typeof BenchmarkRunView>;
export const GradeBenchmarkRunInput = z.object({
  benchmarkRunId: Uuid,
  outcome: BenchmarkOutcome.exclude(["pending"]),
  failureNotes: z.string().trim().max(10_000).nullable().default(null),
});
export type GradeBenchmarkRunInput = z.infer<typeof GradeBenchmarkRunInput>;
```

`packages/contracts/src/api/contract.ts`:
```ts
import { oc } from "@orpc/contract";
import { z } from "zod";
import { ApprovalDecisionInput } from "../approval.ts";
import { OpenLiveResult } from "../live.ts";
import {
  AssetRef,
  BenchmarkRef,
  BenchmarkRunView,
  BenchmarkView,
  BlockRef,
  CreateBenchmarkInput,
  CreateFolderInput,
  CreateRunInput,
  CreateVaultItemInput,
  ExportResult,
  FolderRef,
  FolderView,
  ForgetSessionInput,
  GradeBenchmarkRunInput,
  HandBackInput,
  ListBenchmarkRunsInput,
  ListNotesInput,
  ListRunStepsInput,
  ListRunsInput,
  MoveFolderInput,
  MoveNoteInput,
  NoteDetail,
  NoteRef,
  NoteSummary,
  Ok,
  Page,
  PageInput,
  RemoveSecretInput,
  RenameFolderInput,
  RunDetail,
  RunRef,
  RunStepView,
  RunSummary,
  SearchHit,
  SearchInput,
  SendMessageInput,
  SetKillSwitchInput,
  SetSecretInput,
  SettingsView,
  SignedUrl,
  StartBenchmarkResult,
  SubmitOtpInput,
  UpdateBlockInput,
  UpdateSettingsInput,
  UsageInput,
  UsageReport,
  VaultAuditView,
  VaultItemRef,
  VaultItemView,
} from "./dto.ts";
import { NoteBlock } from "../note.ts";

const Empty = z.object({});

/** Contract-first oRPC router (spec §6). web implements it; the UI and tests consume it. */
export const apiContract = {
  runs: {
    create: oc.input(CreateRunInput).output(RunSummary),
    list: oc.input(ListRunsInput).output(Page(RunSummary)),
    get: oc.input(RunRef).output(RunDetail),
    steps: oc.input(ListRunStepsInput).output(z.object({ items: z.array(RunStepView) })),
    cancel: oc.input(RunRef).output(Ok),
    resume: oc.input(RunRef).output(Ok),
    sendMessage: oc.input(SendMessageInput).output(Ok),
    decideApproval: oc.input(ApprovalDecisionInput).output(Ok),
    submitOtp: oc.input(SubmitOtpInput).output(Ok),
    takeControl: oc.input(RunRef).output(Ok),
    handBack: oc.input(HandBackInput).output(Ok),
    openLive: oc.input(RunRef).output(OpenLiveResult),
  },
  notes: {
    list: oc.input(ListNotesInput).output(Page(NoteSummary)),
    get: oc.input(NoteRef).output(NoteDetail),
    updateBlock: oc.input(UpdateBlockInput).output(NoteBlock),
    markVerified: oc.input(BlockRef).output(NoteBlock),
    move: oc.input(MoveNoteInput).output(Ok),
    delete: oc.input(NoteRef).output(Ok),
    export: oc.input(NoteRef).output(ExportResult),
    search: oc.input(SearchInput).output(z.object({ items: z.array(SearchHit) })),
  },
  folders: {
    tree: oc.input(Empty).output(z.object({ folders: z.array(FolderView) })),
    create: oc.input(CreateFolderInput).output(FolderView),
    rename: oc.input(RenameFolderInput).output(FolderView),
    move: oc.input(MoveFolderInput).output(FolderView),
    delete: oc.input(FolderRef).output(Ok),
  },
  vault: {
    list: oc.input(Empty).output(z.object({ items: z.array(VaultItemView) })),
    create: oc.input(CreateVaultItemInput).output(VaultItemView),
    setSecret: oc.input(SetSecretInput).output(Ok),
    removeSecret: oc.input(RemoveSecretInput).output(Ok),
    delete: oc.input(VaultItemRef).output(Ok),
    forgetSession: oc.input(ForgetSessionInput).output(Ok),
    audit: oc.input(PageInput).output(Page(VaultAuditView)),
  },
  settings: {
    get: oc.input(Empty).output(SettingsView),
    update: oc.input(UpdateSettingsInput).output(SettingsView),
    setKillSwitch: oc.input(SetKillSwitchInput).output(SettingsView),
    usage: oc.input(UsageInput).output(UsageReport),
  },
  assets: {
    url: oc.input(AssetRef).output(SignedUrl),
  },
  benchmarks: {
    list: oc.input(Empty).output(z.object({ items: z.array(BenchmarkView) })),
    create: oc.input(CreateBenchmarkInput).output(BenchmarkView),
    start: oc.input(BenchmarkRef).output(StartBenchmarkResult),
    runs: oc.input(ListBenchmarkRunsInput).output(z.object({ items: z.array(BenchmarkRunView) })),
    grade: oc.input(GradeBenchmarkRunInput).output(BenchmarkRunView),
  },
};
export type ApiContract = typeof apiContract;
```

Append to `packages/contracts/src/index.ts`:
```ts
export * from "./api/dto.ts";
export * from "./api/contract.ts";
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS. If `format:check` fails, run `pnpm format` and re-check.

- [ ] **Step 5: Commit.**

```bash
git add packages/contracts
git commit -m "feat(contracts): oRPC router contract and API DTOs including benchmarks"
```

---

### Task 7: DB schema, drizzle-zod schemas and client

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema/{columns,enums,auth,workspace,library,runs,vault,benchmarks,index}.ts`, `packages/db/src/{zod,client,index}.ts`
- Test: `packages/db/src/schema/schema.test.ts`, `packages/db/src/zod.test.ts`

**Interfaces:**
- Consumes: contracts enum tuples, `DEFAULT_BUDGET`, `EMPTY_USAGE`, `MODELS`, `DEFAULT_CONCURRENCY`, `EMBEDDING_DIMENSIONS`, and the types `Budget`, `Usage`, `Plan`, `Anchor`, `ApprovalRequest`, `ApprovalEdit`, `RunEvent`, `RunError`, `ScrollPosition` and `ImapConfig`.
- Produces, from `@mastertutor/db`:
  - **Tables:**
    - auth: `user`, `session`, `account`, `verification`;
    - workspace: `workspaces`, `workspaceMembers`, `settings`, `browserSlots`;
    - library: `folders`, `sources`, `notes`, `noteBlocks`, `assets`;
    - runs: `runs`, `runSteps`, `runTranscript`, `runEvents`, `approvals`, `downloads`;
    - vault: `vaultItems`, `vaultSecrets`, `vaultGrants`, `otpCodes`, `browserSessions`, `vaultAudit`;
    - benchmarks: `benchmarks`, `benchmarkRuns`.
  - **pgEnums:**
    - `runStatusEnum`, `waitReasonEnum`, `controllerEnum`, `approvalModeEnum`;
    - `stepPhaseEnum`, `stepStateEnum`;
    - `approvalKindEnum`, `approvalStatusEnum`;
    - `sourceKindEnum`, `filedByEnum`, `fidelityEnum`, `blockTypeEnum`, `blockOriginEnum`;
    - `memberRoleEnum`, `vaultSecretFieldEnum`, `vaultAuditActionEnum`;
    - `slotStateEnum`, `benchmarkOutcomeEnum`.
  - **drizzle-zod schemas:** for each table, `select<Name>Schema` and `insert<Name>Schema`, plus a row type `<Name>Row`. The names are `User`, `Session`, `Account`, `Verification`, `Workspace`, `WorkspaceMember`, `Settings`, `BrowserSlot`, `Folder`, `Source`, `Note`, `NoteBlockRow`→`NoteBlock`, `Asset`, `Run`, `RunStep`, `RunTranscript`, `RunEventRow`→`RunEvent`, `Approval`, `Download`, `VaultItem`, `VaultSecret`, `VaultGrant`, `OtpCode`, `BrowserSession`, `VaultAudit`, `Benchmark`, `BenchmarkRun`. The exact identifiers are listed in `zod.ts` below.
  - **Client:** `createDb(databaseUrl: string, options?: {max?: number}): DbHandle`, where `DbHandle` is `{db: Database; sql: Sql; close(): Promise<void>}`, and `type Database = PostgresJsDatabase<typeof schema>`.
- **Column decisions that later phases must know:**
  - `runs.controller` (not `control`), `runs.approval_mode` and `runs.slot_name` (FK to `browser_slots.name`, unique).
  - `browser_slots.run_id` is unique.
  - `notes.run_id` has **no FK**, to avoid a runs↔notes module cycle.
  - `vault_audit` has **no FKs**, so deleting an item or a workspace never fights the append-only trigger.
  - `run_events.id` is `bigserial` (mode `number`).
  - `approvals.decided_by` is text: a user id or `"policy"`.
  - CHECK `runs_wait_reason_matches_status`: `(status = 'waiting') = (wait_reason IS NOT NULL)`.

- [ ] **Step 1: Create the package config.**

`packages/db/package.json`:
```json
{
  "name": "@mastertutor/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@mastertutor/contracts": "workspace:*",
    "drizzle-orm": "0.45.3",
    "drizzle-zod": "0.8.3",
    "postgres": "3.4.9",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "12.2.0",
    "drizzle-kit": "0.31.11"
  }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "drizzle.config.ts"]
}
```

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
```

Then run `pnpm install`.

- [ ] **Step 2: Write the failing tests.**

`packages/db/src/schema/schema.test.ts`:
```ts
import {
  APPROVAL_KINDS,
  APPROVAL_MODES,
  BENCHMARK_OUTCOMES,
  BLOCK_TYPES,
  CONTROLLERS,
  RUN_STATUSES,
  SLOT_STATES,
  STEP_STATES,
} from "@mastertutor/contracts";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./index.ts";

const tables = Object.values(schema).filter((value): value is PgTable => is(value, PgTable));
const config = (table: PgTable) => getTableConfig(table);
const columns = (table: PgTable) => config(table).columns.map((column) => column.name);

describe("schema", () => {
  it("defines exactly the spec tables plus benchmarks", () => {
    expect(tables.map((table) => config(table).name).sort()).toEqual([
      "account",
      "approvals",
      "assets",
      "benchmark_runs",
      "benchmarks",
      "browser_sessions",
      "browser_slots",
      "downloads",
      "folders",
      "note_blocks",
      "notes",
      "otp_codes",
      "run_events",
      "run_steps",
      "run_transcript",
      "runs",
      "session",
      "settings",
      "sources",
      "user",
      "vault_audit",
      "vault_grants",
      "vault_items",
      "vault_secrets",
      "verification",
      "workspace_members",
      "workspaces",
    ]);
  });

  it("keeps pg enums in sync with contracts", () => {
    expect(schema.runStatusEnum.enumValues).toEqual([...RUN_STATUSES]);
    expect(schema.controllerEnum.enumValues).toEqual([...CONTROLLERS]);
    expect(schema.approvalModeEnum.enumValues).toEqual([...APPROVAL_MODES]);
    expect(schema.approvalKindEnum.enumValues).toEqual([...APPROVAL_KINDS]);
    expect(schema.stepStateEnum.enumValues).toEqual([...STEP_STATES]);
    expect(schema.blockTypeEnum.enumValues).toEqual([...BLOCK_TYPES]);
    expect(schema.slotStateEnum.enumValues).toEqual([...SLOT_STATES]);
    expect(schema.benchmarkOutcomeEnum.enumValues).toEqual([...BENCHMARK_OUTCOMES]);
  });

  it("has the run columns the runtime and live view rely on", () => {
    expect(columns(schema.runs)).toEqual(
      expect.arrayContaining([
        "controller",
        "approval_mode",
        "slot_name",
        "lease_owner",
        "lease_expires_at",
        "wake_requested_at",
        "previous_response_id",
        "video_time",
      ]),
    );
    expect(columns(schema.browserSlots)).toEqual(
      expect.arrayContaining(["name", "state", "run_id", "lease_owner", "lease_expires_at", "restarted_at"]),
    );
    expect(columns(schema.benchmarkRuns)).toEqual(
      expect.arrayContaining([
        "outcome",
        "steps",
        "usd",
        "input_tokens",
        "output_tokens",
        "duration_ms",
        "failure_notes",
      ]),
    );
  });

  it("keeps the audit log free of foreign keys", () => {
    expect(config(schema.vaultAudit).foreignKeys).toHaveLength(0);
    expect(config(schema.notes).foreignKeys.map((fk) => fk.reference().columns[0]?.name)).not.toContain(
      "run_id",
    );
  });
});
```

`packages/db/src/zod.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { insertBenchmarkSchema, insertRunSchema, selectRunSchema } from "./zod.ts";

const workspaceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("drizzle-zod schemas", () => {
  it("validates run inserts", () => {
    expect(
      insertRunSchema.safeParse({ workspaceId, goal: "Notes", allowedOrigins: ["https://a.com"] }).success,
    ).toBe(true);
    expect(insertRunSchema.safeParse({ workspaceId, allowedOrigins: [] }).success).toBe(false);
    expect(Object.keys(selectRunSchema.shape)).toContain("approvalMode");
  });
  it("validates benchmark inserts", () => {
    expect(
      insertBenchmarkSchema.safeParse({
        workspaceId,
        name: "zyBooks 1-5",
        task: "Complete participation activities",
        allowedOrigins: ["https://learn.zybooks.com"],
        successCriteria: "All complete",
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm test -- packages/db`
Expected: FAIL, because `./index.ts` and `./zod.ts` are missing.

- [ ] **Step 4: Implement the schema.**

`packages/db/src/schema/columns.ts`:
```ts
import { sql } from "drizzle-orm";
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** jsonb DEFAULT from a contracts constant, so the value is defined once. */
export const jsonbDefault = (value: unknown) =>
  sql.raw(`'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`);
```

`packages/db/src/schema/enums.ts`:
```ts
import {
  APPROVAL_KINDS,
  APPROVAL_MODES,
  APPROVAL_STATUSES,
  BENCHMARK_OUTCOMES,
  BLOCK_ORIGINS,
  BLOCK_TYPES,
  CONTROLLERS,
  FIDELITIES,
  FILED_BY,
  MEMBER_ROLES,
  RUN_STATUSES,
  SLOT_STATES,
  SOURCE_KINDS,
  STEP_PHASES,
  STEP_STATES,
  VAULT_AUDIT_ACTIONS,
  VAULT_SECRET_FIELDS,
  WAIT_REASONS,
} from "@mastertutor/contracts";
import { pgEnum } from "drizzle-orm/pg-core";

export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const waitReasonEnum = pgEnum("wait_reason", WAIT_REASONS);
export const controllerEnum = pgEnum("controller", CONTROLLERS);
export const approvalModeEnum = pgEnum("approval_mode", APPROVAL_MODES);
export const stepPhaseEnum = pgEnum("step_phase", STEP_PHASES);
export const stepStateEnum = pgEnum("step_state", STEP_STATES);
export const approvalKindEnum = pgEnum("approval_kind", APPROVAL_KINDS);
export const approvalStatusEnum = pgEnum("approval_status", APPROVAL_STATUSES);
export const sourceKindEnum = pgEnum("source_kind", SOURCE_KINDS);
export const filedByEnum = pgEnum("filed_by", FILED_BY);
export const fidelityEnum = pgEnum("fidelity", FIDELITIES);
export const blockTypeEnum = pgEnum("block_type", BLOCK_TYPES);
export const blockOriginEnum = pgEnum("block_origin", BLOCK_ORIGINS);
export const memberRoleEnum = pgEnum("member_role", MEMBER_ROLES);
export const vaultSecretFieldEnum = pgEnum("vault_secret_field", VAULT_SECRET_FIELDS);
export const vaultAuditActionEnum = pgEnum("vault_audit_action", VAULT_AUDIT_ACTIONS);
export const slotStateEnum = pgEnum("slot_state", SLOT_STATES);
export const benchmarkOutcomeEnum = pgEnum("benchmark_outcome", BENCHMARK_OUTCOMES);
```

`packages/db/src/schema/auth.ts`:
```ts
import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, tstz, updatedAt } from "./columns.ts";

/** Better Auth core tables; JS property names must match Better Auth's field names. */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
```

`packages/db/src/schema/workspace.ts`:
```ts
import { DEFAULT_BUDGET, DEFAULT_CONCURRENCY, type Budget } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt, id, jsonbDefault, updatedAt } from "./columns.ts";
import { memberRoleEnum } from "./enums.ts";

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("workspace_members_workspace_user_uq").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const settings = pgTable(
  "settings",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    killSwitch: boolean("kill_switch").notNull().default(false),
    defaultBudget: jsonb("default_budget").$type<Budget>().notNull().default(jsonbDefault(DEFAULT_BUDGET)),
    defaultAllowedOrigins: text("default_allowed_origins")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    concurrency: integer("concurrency").notNull().default(DEFAULT_CONCURRENCY),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("settings_concurrency_positive", sql`${t.concurrency} >= 1`)],
);
```

`packages/db/src/schema/library.ts`:
```ts
import { EMBEDDING_DIMENSIONS, type Anchor } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { createdAt, id, tstz, tsvector, updatedAt } from "./columns.ts";
import { blockOriginEnum, blockTypeEnum, fidelityEnum, filedByEnum, sourceKindEnum } from "./enums.ts";
import { workspaces } from "./workspace.ts";

const workspaceRef = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const assets = pgTable(
  "assets",
  {
    id: id(),
    workspaceId: workspaceRef(),
    sha256: text("sha256").notNull(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    mime: text("mime").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    sourceUrl: text("source_url"),
    createdAt: createdAt(),
  },
  (t) => [unique("assets_workspace_sha256_uq").on(t.workspaceId, t.sha256)],
);

/** Depth <= 8, no cycles, same-workspace parent: enforced by trigger folders_check_tree (0002). */
export const folders = pgTable(
  "folders",
  {
    id: id(),
    workspaceId: workspaceRef(),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("folders_workspace_parent_name_uq").on(t.workspaceId, t.parentId, t.name).nullsNotDistinct(),
    index("folders_parent_idx").on(t.parentId),
    check(
      "folders_name_valid",
      sql`length(btrim(${t.name})) between 1 and 120 and position('/' in ${t.name}) = 0`,
    ),
  ],
);

export const sources = pgTable("sources", {
  id: id(),
  workspaceId: workspaceRef(),
  kind: sourceKindEnum("kind").notNull(),
  url: text("url").notNull(),
  canonicalUrl: text("canonical_url"),
  origin: text("origin").notNull(),
  title: text("title"),
  faviconAssetId: uuid("favicon_asset_id").references(() => assets.id, { onDelete: "set null" }),
  capturedAt: tstz("captured_at").notNull().defaultNow(),
  mhtmlKey: text("mhtml_key"),
  screenshotKey: text("screenshot_key"),
  snapshotSha256: text("snapshot_sha256"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const notes = pgTable(
  "notes",
  {
    id: id(),
    workspaceId: workspaceRef(),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    filedBy: filedByEnum("filed_by").notNull().default("agent"),
    /** No FK: runs references notes, and notes outlive pruning anyway. */
    runId: uuid("run_id"),
    title: text("title").notNull(),
    lede: text("lede"),
    fidelity: fidelityEnum("fidelity").notNull().default("needs_review"),
    coverage: doublePrecision("coverage"),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce("title", '') || ' ' || coalesce("lede", ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("notes_workspace_folder_idx").on(t.workspaceId, t.folderId),
    index("notes_run_idx").on(t.runId),
    index("notes_search_idx").using("gin", t.search),
  ],
);

export const noteBlocks = pgTable(
  "note_blocks",
  {
    id: id(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    position: text("position").notNull(),
    type: blockTypeEnum("type").notNull(),
    markdown: text("markdown").notNull(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    origin: blockOriginEnum("origin").notNull(),
    anchor: jsonb("anchor").$type<Anchor>(),
    contentSha256: text("content_sha256"),
    verified: boolean("verified").notNull().default(false),
    edited: boolean("edited").notNull().default(false),
    originalMarkdown: text("original_markdown"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("note_blocks_note_position_uq").on(t.noteId, t.position),
    index("note_blocks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);
```

`packages/db/src/schema/runs.ts`:
```ts
import {
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  MODELS,
  type ApprovalEdit,
  type ApprovalRequest,
  type Budget,
  type Plan,
  type RunError,
  type RunEvent,
  type ScrollPosition,
  type Usage,
} from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, jsonbDefault, tstz, updatedAt } from "./columns.ts";
import {
  approvalKindEnum,
  approvalModeEnum,
  approvalStatusEnum,
  controllerEnum,
  runStatusEnum,
  slotStateEnum,
  stepPhaseEnum,
  stepStateEnum,
  waitReasonEnum,
} from "./enums.ts";
import { assets, folders, notes } from "./library.ts";
import { workspaces } from "./workspace.ts";

/** One row per Compose slot; rows are synced from BROWSER_SLOTS by migrate. */
export const browserSlots = pgTable(
  "browser_slots",
  {
    name: text("name").primaryKey(),
    state: slotStateEnum("state").notNull().default("restarting"),
    runId: uuid("run_id").references((): AnyPgColumn => runs.id, { onDelete: "set null" }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: tstz("lease_expires_at"),
    restartedAt: tstz("restarted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("browser_slots_run_uq").on(t.runId),
    check("browser_slots_name_valid", sql`${t.name} ~ '^browser-[1-9][0-9]?$'`),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    waitReason: waitReasonEnum("wait_reason"),
    controller: controllerEnum("controller").notNull().default("agent"),
    approvalMode: approvalModeEnum("approval_mode").notNull().default("ask"),
    model: text("model").notNull().default(MODELS.agentPrimary),
    previousResponseId: text("previous_response_id"),
    plan: jsonb("plan").$type<Plan>(),
    budget: jsonb("budget").$type<Budget>().notNull().default(jsonbDefault(DEFAULT_BUDGET)),
    usage: jsonb("usage").$type<Usage>().notNull().default(jsonbDefault(EMPTY_USAGE)),
    allowedOrigins: text("allowed_origins").array().notNull(),
    targetFolderId: uuid("target_folder_id").references(() => folders.id, { onDelete: "set null" }),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    slotName: text("slot_name").references((): AnyPgColumn => browserSlots.name, {
      onDelete: "set null",
    }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: tstz("lease_expires_at"),
    wakeRequestedAt: tstz("wake_requested_at"),
    lastActivityAt: tstz("last_activity_at"),
    currentUrl: text("current_url"),
    scroll: jsonb("scroll").$type<ScrollPosition>(),
    videoTime: doublePrecision("video_time"),
    error: jsonb("error").$type<RunError>(),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("runs_claim_idx").on(t.status, t.leaseExpiresAt),
    index("runs_workspace_created_idx").on(t.workspaceId, t.createdAt),
    unique("runs_slot_name_uq").on(t.slotName),
    check("runs_wait_reason_matches_status", sql`(${t.status} = 'waiting') = (${t.waitReason} is not null)`),
  ],
);

const runRef = () =>
  uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" });

export const runSteps = pgTable(
  "run_steps",
  {
    id: id(),
    runId: runRef(),
    seq: integer("seq").notNull(),
    phase: stepPhaseEnum("phase").notNull(),
    state: stepStateEnum("state").notNull(),
    action: jsonb("action").$type<unknown>(),
    result: jsonb("result").$type<unknown>(),
    caption: text("caption"),
    url: text("url"),
    screenshotKey: text("screenshot_key"),
    usage: jsonb("usage").$type<Usage>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("run_steps_run_seq_uq").on(t.runId, t.seq)],
);

export const runTranscript = pgTable(
  "run_transcript",
  {
    id: id(),
    runId: runRef(),
    seq: integer("seq").notNull(),
    item: jsonb("item").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("run_transcript_run_seq_uq").on(t.runId, t.seq)],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: runRef(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<RunEvent>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("run_events_run_id_idx").on(t.runId, t.id)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    runId: runRef(),
    stepSeq: integer("step_seq").notNull(),
    kind: approvalKindEnum("kind").notNull(),
    request: jsonb("request").$type<ApprovalRequest>().notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    edit: jsonb("edit").$type<ApprovalEdit>(),
    /** A user id, or "policy" when approvalMode decided it. */
    decidedBy: text("decided_by"),
    decidedAt: tstz("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_run_status_idx").on(t.runId, t.status)],
);

export const downloads = pgTable("downloads", {
  id: id(),
  runId: runRef(),
  filename: text("filename").notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  approvedBy: text("approved_by").notNull(),
  createdAt: createdAt(),
});
```

`packages/db/src/schema/vault.ts`:
```ts
import type { ImapConfig } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, id, tstz, updatedAt } from "./columns.ts";
import { vaultAuditActionEnum, vaultSecretFieldEnum } from "./enums.ts";
import { runs } from "./runs.ts";
import { workspaces } from "./workspace.ts";

export const vaultItems = pgTable(
  "vault_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    origin: text("origin").notNull(),
    label: text("label").notNull(),
    fields: vaultSecretFieldEnum("fields")
      .array()
      .notNull()
      .default(sql`'{}'`),
    imap: jsonb("imap").$type<ImapConfig>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("vault_items_workspace_alias_uq").on(t.workspaceId, t.alias),
    check("vault_items_alias_valid", sql`${t.alias} ~ '^[a-z0-9][a-z0-9_-]{0,62}$'`),
  ],
);

const itemRef = () =>
  uuid("item_id")
    .notNull()
    .references(() => vaultItems.id, { onDelete: "cascade" });

export const vaultSecrets = pgTable(
  "vault_secrets",
  {
    id: id(),
    itemId: itemRef(),
    field: vaultSecretFieldEnum("field").notNull(),
    sealed: bytea("sealed").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("vault_secrets_item_field_uq").on(t.itemId, t.field)],
);

export const vaultGrants = pgTable(
  "vault_grants",
  {
    id: id(),
    itemId: itemRef(),
    origin: text("origin").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: tstz("approved_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [unique("vault_grants_item_origin_uq").on(t.itemId, t.origin)],
);

export const otpCodes = pgTable("otp_codes", {
  id: id(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => vaultItems.id, { onDelete: "cascade" }),
  sealed: bytea("sealed").notNull(),
  expiresAt: tstz("expires_at")
    .notNull()
    .default(sql`now() + interval '5 minutes'`),
  consumedAt: tstz("consumed_at"),
  createdAt: createdAt(),
});

export const browserSessions = pgTable(
  "browser_sessions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    origin: text("origin").notNull(),
    sealedState: bytea("sealed_state").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("browser_sessions_workspace_alias_origin_uq").on(t.workspaceId, t.alias, t.origin)],
);

/** Append-only (grants + trigger in migration 0002). No FKs, so deletes elsewhere never touch it. */
export const vaultAudit = pgTable(
  "vault_audit",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    itemId: uuid("item_id"),
    alias: text("alias").notNull(),
    origin: text("origin"),
    field: text("field"),
    action: vaultAuditActionEnum("action").notNull(),
    runId: uuid("run_id"),
    approvedBy: text("approved_by"),
    outcome: text("outcome").notNull(),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [index("vault_audit_workspace_at_idx").on(t.workspaceId, t.at)],
);
```

`packages/db/src/schema/benchmarks.ts`:
```ts
import { DEFAULT_BUDGET, type Budget } from "@mastertutor/contracts";
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, jsonbDefault, tstz, updatedAt } from "./columns.ts";
import { approvalModeEnum, benchmarkOutcomeEnum } from "./enums.ts";
import { runs } from "./runs.ts";
import { workspaces } from "./workspace.ts";

/** A repeatable acceptance task, e.g. "zyBooks readings 1-5 participation activities". */
export const benchmarks = pgTable(
  "benchmarks",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    task: text("task").notNull(),
    allowedOrigins: text("allowed_origins").array().notNull(),
    approvalMode: approvalModeEnum("approval_mode").notNull().default("auto_within_allowlist"),
    budget: jsonb("budget").$type<Budget>().notNull().default(jsonbDefault(DEFAULT_BUDGET)),
    successCriteria: text("success_criteria").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("benchmarks_workspace_name_uq").on(t.workspaceId, t.name)],
);

/** One attempt: outcome, steps, cost and duration are snapshotted when the run finishes. */
export const benchmarkRuns = pgTable(
  "benchmark_runs",
  {
    id: id(),
    benchmarkId: uuid("benchmark_id")
      .notNull()
      .references(() => benchmarks.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .unique("benchmark_runs_run_uq")
      .references(() => runs.id, { onDelete: "set null" }),
    outcome: benchmarkOutcomeEnum("outcome").notNull().default("pending"),
    steps: integer("steps").notNull().default(0),
    usd: doublePrecision("usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    durationMs: bigint("duration_ms", { mode: "number" }),
    failureNotes: text("failure_notes"),
    gradedBy: text("graded_by"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("benchmark_runs_benchmark_started_idx").on(t.benchmarkId, t.startedAt)],
);
```

`packages/db/src/schema/index.ts`:
```ts
export * from "./enums.ts";
export * from "./auth.ts";
export * from "./workspace.ts";
export * from "./library.ts";
export * from "./runs.ts";
export * from "./vault.ts";
export * from "./benchmarks.ts";
```

`packages/db/src/zod.ts`:
```ts
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type { z } from "zod";
import * as t from "./schema/index.ts";

export const selectUserSchema = createSelectSchema(t.user);
export const insertUserSchema = createInsertSchema(t.user);
export type UserRow = z.infer<typeof selectUserSchema>;
export const selectSessionSchema = createSelectSchema(t.session);
export const insertSessionSchema = createInsertSchema(t.session);
export type SessionRow = z.infer<typeof selectSessionSchema>;
export const selectAccountSchema = createSelectSchema(t.account);
export const insertAccountSchema = createInsertSchema(t.account);
export type AccountRow = z.infer<typeof selectAccountSchema>;
export const selectVerificationSchema = createSelectSchema(t.verification);
export const insertVerificationSchema = createInsertSchema(t.verification);
export type VerificationRow = z.infer<typeof selectVerificationSchema>;

export const selectWorkspaceSchema = createSelectSchema(t.workspaces);
export const insertWorkspaceSchema = createInsertSchema(t.workspaces);
export type WorkspaceRow = z.infer<typeof selectWorkspaceSchema>;
export const selectWorkspaceMemberSchema = createSelectSchema(t.workspaceMembers);
export const insertWorkspaceMemberSchema = createInsertSchema(t.workspaceMembers);
export type WorkspaceMemberRow = z.infer<typeof selectWorkspaceMemberSchema>;
export const selectSettingsSchema = createSelectSchema(t.settings);
export const insertSettingsSchema = createInsertSchema(t.settings);
export type SettingsRow = z.infer<typeof selectSettingsSchema>;
export const selectBrowserSlotSchema = createSelectSchema(t.browserSlots);
export const insertBrowserSlotSchema = createInsertSchema(t.browserSlots);
export type BrowserSlotRow = z.infer<typeof selectBrowserSlotSchema>;

export const selectFolderSchema = createSelectSchema(t.folders);
export const insertFolderSchema = createInsertSchema(t.folders);
export type FolderRow = z.infer<typeof selectFolderSchema>;
export const selectSourceSchema = createSelectSchema(t.sources);
export const insertSourceSchema = createInsertSchema(t.sources);
export type SourceRow = z.infer<typeof selectSourceSchema>;
export const selectNoteSchema = createSelectSchema(t.notes);
export const insertNoteSchema = createInsertSchema(t.notes);
export type NoteRow = z.infer<typeof selectNoteSchema>;
export const selectNoteBlockSchema = createSelectSchema(t.noteBlocks);
export const insertNoteBlockSchema = createInsertSchema(t.noteBlocks);
export type NoteBlockRow = z.infer<typeof selectNoteBlockSchema>;
export const selectAssetSchema = createSelectSchema(t.assets);
export const insertAssetSchema = createInsertSchema(t.assets);
export type AssetRow = z.infer<typeof selectAssetSchema>;

export const selectRunSchema = createSelectSchema(t.runs);
export const insertRunSchema = createInsertSchema(t.runs);
export type RunRow = z.infer<typeof selectRunSchema>;
export const selectRunStepSchema = createSelectSchema(t.runSteps);
export const insertRunStepSchema = createInsertSchema(t.runSteps);
export type RunStepRow = z.infer<typeof selectRunStepSchema>;
export const selectRunTranscriptSchema = createSelectSchema(t.runTranscript);
export const insertRunTranscriptSchema = createInsertSchema(t.runTranscript);
export type RunTranscriptRow = z.infer<typeof selectRunTranscriptSchema>;
export const selectRunEventSchema = createSelectSchema(t.runEvents);
export const insertRunEventSchema = createInsertSchema(t.runEvents);
export type RunEventRow = z.infer<typeof selectRunEventSchema>;
export const selectApprovalSchema = createSelectSchema(t.approvals);
export const insertApprovalSchema = createInsertSchema(t.approvals);
export type ApprovalRow = z.infer<typeof selectApprovalSchema>;
export const selectDownloadSchema = createSelectSchema(t.downloads);
export const insertDownloadSchema = createInsertSchema(t.downloads);
export type DownloadRow = z.infer<typeof selectDownloadSchema>;

export const selectVaultItemSchema = createSelectSchema(t.vaultItems);
export const insertVaultItemSchema = createInsertSchema(t.vaultItems);
export type VaultItemRow = z.infer<typeof selectVaultItemSchema>;
export const selectVaultSecretSchema = createSelectSchema(t.vaultSecrets);
export const insertVaultSecretSchema = createInsertSchema(t.vaultSecrets);
export type VaultSecretRow = z.infer<typeof selectVaultSecretSchema>;
export const selectVaultGrantSchema = createSelectSchema(t.vaultGrants);
export const insertVaultGrantSchema = createInsertSchema(t.vaultGrants);
export type VaultGrantRow = z.infer<typeof selectVaultGrantSchema>;
export const selectOtpCodeSchema = createSelectSchema(t.otpCodes);
export const insertOtpCodeSchema = createInsertSchema(t.otpCodes);
export type OtpCodeRow = z.infer<typeof selectOtpCodeSchema>;
export const selectBrowserSessionSchema = createSelectSchema(t.browserSessions);
export const insertBrowserSessionSchema = createInsertSchema(t.browserSessions);
export type BrowserSessionRow = z.infer<typeof selectBrowserSessionSchema>;
export const selectVaultAuditSchema = createSelectSchema(t.vaultAudit);
export const insertVaultAuditSchema = createInsertSchema(t.vaultAudit);
export type VaultAuditRow = z.infer<typeof selectVaultAuditSchema>;

export const selectBenchmarkSchema = createSelectSchema(t.benchmarks);
export const insertBenchmarkSchema = createInsertSchema(t.benchmarks);
export type BenchmarkRow = z.infer<typeof selectBenchmarkSchema>;
export const selectBenchmarkRunSchema = createSelectSchema(t.benchmarkRuns);
export const insertBenchmarkRunSchema = createInsertSchema(t.benchmarkRuns);
export type BenchmarkRunRow = z.infer<typeof selectBenchmarkRunSchema>;
```

`packages/db/src/client.ts`:
```ts
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema/index.ts";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  readonly db: Database;
  readonly sql: Sql;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  max?: number;
}

export function createDb(databaseUrl: string, options: CreateDbOptions = {}): DbHandle {
  const sql = postgres(databaseUrl, { max: options.max ?? 10, onnotice: () => undefined });
  const db = drizzle({ client: sql, schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
```

`packages/db/src/index.ts`:
```ts
export * from "./schema/index.ts";
export * from "./zod.ts";
export * from "./client.ts";
```

- [ ] **Step 5: Run the tests and checks to verify they pass.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. A drizzle-zod type error on a custom column (`bytea` or `tsvector`) is acceptable to fix with a `$type` annotation on that column. Do not delete the schema export.

- [ ] **Step 6: Commit.**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): Drizzle schema for all spec tables plus benchmarks, drizzle-zod schemas, client"
```

---

### Task 8: Migrations, triggers, grants and the migrate runner

**Files:**
- Create: `packages/db/migrations/` (generated, then the custom files edited), `packages/db/sql/grants.sql`
- Create: `packages/db/src/{migrate,testing}.ts`, `packages/db/src/queries/slots.ts`, `packages/db/src/bin/migrate.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/{migrate,security,library}.int.test.ts`

**Interfaces:**
- Consumes: the Task 7 schema, plus `DbPassword`, `SlotName`, `MigrateEnv`, `parseEnv` and `createLogger`.
- Produces:
  - `runMigrations(options: MigrateOptions): Promise<void>`, where `MigrateOptions` is `{databaseUrl; webPassword; agentPassword; slots: readonly string[]}`. It applies migrations, re-applies `grants.sql`, sets the role passwords and syncs the slot rows, all idempotently.
  - `syncBrowserSlots(sql: Sql, names: readonly string[]): Promise<void>`. It inserts missing slots as `restarting` and deletes unlisted rows that are not `leased`.
  - `listBrowserSlots(db: Database, names: readonly string[]): Promise<{name; state; runId}[]>`.
  - From `@mastertutor/db/testing`:
    - `startTestDatabase(options?: {slots?: string[]}): Promise<TestDatabase>`, where `TestDatabase` is `{ownerUrl; webUrl; agentUrl; stop()}`;
    - `TEST_ROLE_PASSWORDS`.
  - **SQL objects:** the roles `web_role` and `agent_role` (LOGIN); the triggers `folders_check_tree` and `vault_audit_no_update_delete`/`vault_audit_no_truncate`; the extension `vector`.
  - **Compose entry:** `node packages/db/src/bin/migrate.ts`.

- [ ] **Step 1: Write the failing integration tests.**

`packages/db/src/migrate.int.test.ts`:
```ts
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.ts";
import { startTestDatabase, TEST_ROLE_PASSWORDS, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  db = await startTestDatabase({ slots: ["browser-1", "browser-2", "browser-3"] });
  owner = postgres(db.ownerUrl, { max: 2, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await db?.stop();
});

describe("runMigrations", () => {
  it("creates all 27 tables and the vector extension", async () => {
    const tables = await owner`select count(*)::int as n from pg_tables where schemaname = 'public'`;
    expect(tables[0]?.n).toBe(27);
    const ext = await owner`select extname from pg_extension where extname = 'vector'`;
    expect(ext).toHaveLength(1);
  });

  it("is idempotent and syncs slot rows to the configured list", async () => {
    await runMigrations({
      databaseUrl: db.ownerUrl,
      webPassword: TEST_ROLE_PASSWORDS.web,
      agentPassword: TEST_ROLE_PASSWORDS.agent,
      slots: ["browser-1", "browser-2"],
    });
    const rows = await owner`select name, state from browser_slots order by name`;
    expect(rows).toEqual([
      { name: "browser-1", state: "restarting" },
      { name: "browser-2", state: "restarting" },
    ]);
  });

  it("lets both service roles log in", async () => {
    for (const [url, role] of [
      [db.webUrl, "web_role"],
      [db.agentUrl, "agent_role"],
    ] as const) {
      const client = postgres(url, { max: 1 });
      const [row] = await client`select current_user as name`;
      expect(row?.name).toBe(role);
      await client.end();
    }
  });

  it("refuses role passwords that could escape the ALTER ROLE literal", async () => {
    await expect(
      runMigrations({
        databaseUrl: db.ownerUrl,
        webPassword: "x'; drop table runs; --aaaaaaaaaaa",
        agentPassword: TEST_ROLE_PASSWORDS.agent,
        slots: ["browser-1"],
      }),
    ).rejects.toThrow();
  });
});
```

`packages/db/src/security.int.test.ts`:
```ts
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;
let web: postgres.Sql;
let agent: postgres.Sql;
let workspaceId: string;
let itemId: string;
let runId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 2, onnotice: () => undefined });
  web = postgres(db.webUrl, { max: 2, onnotice: () => undefined });
  agent = postgres(db.agentUrl, { max: 2, onnotice: () => undefined });
  [{ id: workspaceId }] = (await owner`insert into workspaces (name) values ('W') returning id`) as [
    { id: string },
  ];
  [{ id: itemId }] = (await owner`
    insert into vault_items (workspace_id, alias, origin, label)
    values (${workspaceId}, 'site', 'https://example.com', 'Site') returning id`) as [{ id: string }];
  [{ id: runId }] = (await owner`
    insert into runs (workspace_id, goal, allowed_origins)
    values (${workspaceId}, 'goal', ${["https://example.com"]}) returning id`) as [{ id: string }];
  await owner`insert into vault_audit (workspace_id, item_id, alias, action, outcome)
              values (${workspaceId}, ${itemId}, 'site', 'create', 'ok')`;
  await owner`insert into browser_sessions (workspace_id, alias, origin, sealed_state)
              values (${workspaceId}, 'site', 'https://example.com', ${Buffer.from([1])})`;
});
afterAll(async () => {
  await Promise.all([web?.end(), agent?.end(), owner?.end()]);
  await db?.stop();
});

describe("web_role", () => {
  it("cannot read the run transcript", async () => {
    await expect(web`select * from run_transcript`).rejects.toThrow(/permission denied/);
  });
  it("can seal secrets but never read them back", async () => {
    const [row] = await web`insert into vault_secrets (item_id, field, sealed)
                            values (${itemId}, 'password', ${Buffer.from([1, 2, 3])}) returning id`;
    expect(row?.id).toBeTruthy();
    expect(await web`select id, field from vault_secrets`).toHaveLength(1);
    await expect(web`select sealed from vault_secrets`).rejects.toThrow(/permission denied/);
  });
  it("can submit OTP codes but not read them", async () => {
    await web`insert into otp_codes (run_id, sealed) values (${runId}, ${Buffer.from([9])})`;
    await expect(web`select sealed from otp_codes`).rejects.toThrow(/permission denied/);
  });
  it("can list and forget browser sessions without reading their state", async () => {
    expect(await web`select alias, origin from browser_sessions`).toHaveLength(1);
    await expect(web`select sealed_state from browser_sessions`).rejects.toThrow(/permission denied/);
  });
  it("cannot create tables", async () => {
    await expect(web`create table sneaky (a int)`).rejects.toThrow(/permission denied/);
  });
});

describe("agent_role", () => {
  it("cannot touch auth tables", async () => {
    for (const table of ["user", "session", "account", "verification"]) {
      await expect(agent.unsafe(`select * from "${table}"`)).rejects.toThrow(/permission denied/);
    }
  });
  it("can read transcripts and sealed values", async () => {
    await agent`select * from run_transcript`;
    await agent`select sealed from vault_secrets`;
  });
});

describe("vault_audit is append-only", () => {
  it("rejects update and delete from both service roles", async () => {
    for (const client of [web, agent]) {
      await client`insert into vault_audit (workspace_id, alias, action, outcome)
                   values (${workspaceId}, 'site', 'fill', 'ok')`;
      await expect(client`update vault_audit set outcome = 'x'`).rejects.toThrow(/permission denied/);
      await expect(client`delete from vault_audit`).rejects.toThrow(/permission denied/);
    }
  });
  it("rejects update, delete and truncate even from the owner", async () => {
    await expect(owner`update vault_audit set outcome = 'x'`).rejects.toThrow(/append-only/);
    await expect(owner`delete from vault_audit`).rejects.toThrow(/append-only/);
    await expect(owner`truncate vault_audit`).rejects.toThrow(/append-only/);
  });
  it("does not block deleting the vault item it describes", async () => {
    await owner`delete from vault_items where id = ${itemId}`;
    const rows = await owner`select count(*)::int as n from vault_audit where item_id = ${itemId}`;
    expect(rows[0]?.n).toBe(1);
  });
});
```

`packages/db/src/library.int.test.ts`:
```ts
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  db = await startTestDatabase({ slots: ["browser-1"] });
  owner = postgres(db.ownerUrl, { max: 2, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await db?.stop();
});

async function workspace(): Promise<string> {
  const [row] = await owner`insert into workspaces (name) values ('W') returning id`;
  return row!.id as string;
}
async function folder(ws: string, name: string, parentId: string | null): Promise<string> {
  const [row] = await owner`insert into folders (workspace_id, name, parent_id)
                            values (${ws}, ${name}, ${parentId}) returning id`;
  return row!.id as string;
}
async function chain(ws: string, depth: number): Promise<string[]> {
  const ids: string[] = [];
  for (let level = 0; level < depth; level++) {
    ids.push(await folder(ws, `level-${level}`, ids.at(-1) ?? null));
  }
  return ids;
}

describe("folders", () => {
  it("rejects duplicate names at the root", async () => {
    const ws = await workspace();
    await folder(ws, "Biology", null);
    await expect(folder(ws, "Biology", null)).rejects.toThrow(/folders_workspace_parent_name_uq/);
  });
  it("allows 8 levels and rejects a 9th", async () => {
    const ws = await workspace();
    const ids = await chain(ws, 8);
    await expect(folder(ws, "too-deep", ids[7]!)).rejects.toThrow(/depth exceeds 8/);
  });
  it("rejects moving a folder into its own descendant", async () => {
    const ws = await workspace();
    const [a, b] = await chain(ws, 2);
    await expect(owner`update folders set parent_id = ${b!} where id = ${a!}`).rejects.toThrow(/cycle/);
  });
  it("rejects a move that would push a subtree past depth 8", async () => {
    const ws = await workspace();
    const deep = await chain(ws, 6);
    const x = await folder(ws, "x", null);
    const y = await folder(ws, "y", x);
    await folder(ws, "z", y);
    await expect(owner`update folders set parent_id = ${deep[5]!} where id = ${x}`).rejects.toThrow(
      /depth exceeds 8/,
    );
  });
  it("rejects a parent from another workspace", async () => {
    const parent = await folder(await workspace(), "p", null);
    await expect(folder(await workspace(), "child", parent)).rejects.toThrow(/another workspace/);
  });
  it("rejects '/' in names", async () => {
    await expect(folder(await workspace(), "a/b", null)).rejects.toThrow(/folders_name_valid/);
  });
});

describe("notes and blocks", () => {
  it("indexes title and lede for full-text search", async () => {
    const ws = await workspace();
    await owner`insert into notes (workspace_id, title, lede)
                values (${ws}, 'Photosynthesis in plants', 'Light reactions')`;
    const hits = await owner`select title from notes
                             where search @@ plainto_tsquery('english', 'photosynthesis')`;
    expect(hits.map((h) => h.title)).toContain("Photosynthesis in plants");
  });
  it("stores 1536-dim embeddings and answers cosine queries", async () => {
    const ws = await workspace();
    const [note] = await owner`insert into notes (workspace_id, title) values (${ws}, 'v') returning id`;
    const embedding = JSON.stringify(Array.from({ length: 1536 }, (_, i) => (i % 7) / 7));
    await owner`insert into note_blocks (note_id, position, type, markdown, origin, embedding)
                values (${note!.id}, 'a0', 'paragraph', 'text', 'dom', ${embedding}::vector)`;
    const [nearest] = await owner`select markdown from note_blocks
                                  order by embedding <=> ${embedding}::vector limit 1`;
    expect(nearest?.markdown).toBe("text");
  });
});

describe("runs constraints", () => {
  it("requires a wait reason exactly when waiting", async () => {
    const ws = await workspace();
    await expect(owner`insert into runs (workspace_id, goal, allowed_origins, status)
                       values (${ws}, 'g', ${["https://a.com"]}, 'waiting')`).rejects.toThrow(
      /runs_wait_reason_matches_status/,
    );
  });
  it("allows at most one run per slot", async () => {
    const ws = await workspace();
    await owner`insert into runs (workspace_id, goal, allowed_origins, slot_name)
                values (${ws}, 'g', ${["https://a.com"]}, 'browser-1')`;
    await expect(owner`insert into runs (workspace_id, goal, allowed_origins, slot_name)
                       values (${ws}, 'g2', ${["https://a.com"]}, 'browser-1')`).rejects.toThrow(
      /runs_slot_name_uq/,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test:int -- packages/db`
Expected: FAIL, because `./testing.ts` and `./migrate.ts` are not found.

- [ ] **Step 3: Generate the migrations.**

Run:
```bash
pnpm --filter @mastertutor/db exec drizzle-kit generate --custom --name=extensions
```
Expected: this creates `packages/db/migrations/0000_extensions.sql`. Replace its whole content with:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Run:
```bash
pnpm --filter @mastertutor/db exec drizzle-kit generate --name=init
```
Expected: this creates `packages/db/migrations/0001_init.sql` containing `CREATE TABLE "runs"` and `CREATE TYPE "public"."approval_mode"`.
- **Check:** `grep -c 'CREATE TABLE' packages/db/migrations/0001_init.sql` should print `27`.
- **If drizzle-kit cannot load `@mastertutor/contracts`:** this happens when an ESM loader error mentions `@orpc/contract`. Add `"./enums": "./src/enums.ts"` and `"./constants": "./src/constants.ts"` subpath exports to contracts, and import from those in `packages/db/src/schema/*.ts`.

Run:
```bash
pnpm --filter @mastertutor/db exec drizzle-kit generate --custom --name=triggers
```
Replace the whole content of `packages/db/migrations/0002_triggers.sql` with:
```sql
CREATE OR REPLACE FUNCTION folders_check_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  depth integer := 1;
  subtree_height integer := 0;
  cur uuid := NEW.parent_id;
  parent_workspace uuid;
BEGIN
  -- Serialize tree edits per workspace so two concurrent moves cannot form a cycle.
  PERFORM pg_advisory_xact_lock(hashtext('folders:' || NEW.workspace_id::text));
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT workspace_id INTO parent_workspace FROM folders WHERE id = NEW.parent_id;
  IF parent_workspace IS NULL THEN
    RAISE EXCEPTION 'folder parent % does not exist', NEW.parent_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'folder parent belongs to another workspace' USING ERRCODE = 'check_violation';
  END IF;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'folder move would create a cycle' USING ERRCODE = 'check_violation';
    END IF;
    depth := depth + 1;
    SELECT parent_id INTO cur FROM folders WHERE id = cur;
  END LOOP;
  IF TG_OP = 'UPDATE' THEN
    WITH RECURSIVE sub(id, h) AS (
      SELECT f.id, 1 FROM folders f WHERE f.parent_id = NEW.id
      UNION ALL
      SELECT f.id, s.h + 1 FROM folders f JOIN sub s ON f.parent_id = s.id
    )
    SELECT coalesce(max(h), 0) INTO subtree_height FROM sub;
  END IF;
  IF depth + subtree_height > 8 THEN
    RAISE EXCEPTION 'folder depth exceeds 8' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER folders_check_tree
  BEFORE INSERT OR UPDATE OF parent_id, workspace_id ON folders
  FOR EACH ROW EXECUTE FUNCTION folders_check_tree();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vault_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'vault_audit is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER vault_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON vault_audit
  FOR EACH ROW EXECUTE FUNCTION vault_audit_append_only();
--> statement-breakpoint
CREATE TRIGGER vault_audit_no_truncate
  BEFORE TRUNCATE ON vault_audit
  FOR EACH STATEMENT EXECUTE FUNCTION vault_audit_append_only();
```

- [ ] **Step 4: Write the grants file.**

`packages/db/sql/grants.sql`:
```sql
-- Idempotent least-privilege grants (spec §3.1 rule 5). Re-applied by every migrate run,
-- inside one transaction, so new tables get the policy below automatically.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_role') THEN
    CREATE ROLE web_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_role') THEN
    CREATE ROLE agent_role NOLOGIN;
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM web_role, agent_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM web_role, agent_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO web_role, agent_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO web_role, agent_role;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    -- web: everything except the transcript, sealed material and the audit log (handled below).
    IF t NOT IN ('run_transcript', 'vault_secrets', 'otp_codes', 'browser_sessions', 'vault_audit') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO web_role', t);
    END IF;
    -- agent: everything except Better Auth's tables and the audit log (handled below).
    IF t NOT IN ('user', 'session', 'account', 'verification', 'vault_audit') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO agent_role', t);
    END IF;
  END LOOP;
END $$;

-- web seals but cannot read sealed columns back.
GRANT INSERT, UPDATE, DELETE ON vault_secrets TO web_role;
GRANT SELECT (id, item_id, field, created_at, updated_at) ON vault_secrets TO web_role;
GRANT INSERT ON otp_codes TO web_role;
GRANT SELECT (id, run_id, item_id, expires_at, consumed_at, created_at) ON otp_codes TO web_role;
GRANT DELETE ON browser_sessions TO web_role;
GRANT SELECT (id, workspace_id, alias, origin, created_at, updated_at) ON browser_sessions TO web_role;

-- The audit log is append-only for both services (a trigger also blocks the owner).
GRANT SELECT, INSERT ON vault_audit TO web_role, agent_role;
```

- [ ] **Step 5: Implement the runner, slot queries, test helper and bin.**

`packages/db/src/queries/slots.ts`:
```ts
import { SlotName, type SlotState } from "@mastertutor/contracts";
import { asc, inArray } from "drizzle-orm";
import type { Sql } from "postgres";
import { z } from "zod";
import type { Database } from "../client.ts";
import { browserSlots } from "../schema/index.ts";

/** Makes browser_slots match BROWSER_SLOTS: new slots start 'restarting' until agent sees CDP. */
export async function syncBrowserSlots(sql: Sql, names: readonly string[]): Promise<void> {
  const valid = z.array(SlotName).min(1).parse([...names]);
  await sql`insert into browser_slots ${sql(valid.map((name) => ({ name })))} on conflict (name) do nothing`;
  await sql`delete from browser_slots
            where not (name = any(${sql.array(valid)})) and state <> 'leased'`;
}

export interface SlotStatus {
  name: string;
  state: SlotState;
  runId: string | null;
}

export async function listBrowserSlots(
  db: Database,
  names: readonly string[],
): Promise<SlotStatus[]> {
  if (names.length === 0) return [];
  return db
    .select({ name: browserSlots.name, state: browserSlots.state, runId: browserSlots.runId })
    .from(browserSlots)
    .where(inArray(browserSlots.name, [...names]))
    .orderBy(asc(browserSlots.name));
}
```

`packages/db/src/migrate.ts`:
```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DbPassword, SlotName } from "@mastertutor/contracts";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { z } from "zod";
import { syncBrowserSlots } from "./queries/slots.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
const GRANTS_FILE = fileURLToPath(new URL("../sql/grants.sql", import.meta.url));

export interface MigrateOptions {
  /** Owner (superuser) connection; never given to web or agent. */
  databaseUrl: string;
  webPassword: string;
  agentPassword: string;
  slots: readonly string[];
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  // DbPassword's alphabet has no quotes or backslashes, so interpolation below is safe.
  const webPassword = DbPassword.parse(options.webPassword);
  const agentPassword = DbPassword.parse(options.agentPassword);
  const slots = z.array(SlotName).min(1).parse([...options.slots]);
  const sql = postgres(options.databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle({ client: sql }), { migrationsFolder: MIGRATIONS_DIR });
    const grants = await readFile(GRANTS_FILE, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(grants);
      await tx.unsafe(`ALTER ROLE web_role WITH LOGIN PASSWORD '${webPassword}'`);
      await tx.unsafe(`ALTER ROLE agent_role WITH LOGIN PASSWORD '${agentPassword}'`);
      await syncBrowserSlots(tx, slots);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
```
If TypeScript rejects passing `tx` (a `TransactionSql`) where `Sql` is expected, change the `syncBrowserSlots` parameter type to `Sql | postgres.TransactionSql` and keep the body unchanged.

`packages/db/src/testing.ts`:
```ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "./migrate.ts";

export const TEST_ROLE_PASSWORDS = {
  web: "test_web_password_0123456789ab",
  agent: "test_agent_password_0123456789",
} as const;

export interface TestDatabase {
  ownerUrl: string;
  webUrl: string;
  agentUrl: string;
  stop(): Promise<void>;
}

/** A migrated pgvector Postgres in Testcontainers with web_role/agent_role ready to log in. */
export async function startTestDatabase(options: { slots?: string[] } = {}): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg17")
    .withDatabase("mastertutor")
    .withUsername("owner")
    .withPassword("owner_password")
    .start();
  const ownerUrl = container.getConnectionUri();
  await runMigrations({
    databaseUrl: ownerUrl,
    webPassword: TEST_ROLE_PASSWORDS.web,
    agentPassword: TEST_ROLE_PASSWORDS.agent,
    slots: options.slots ?? ["browser-1"],
  });
  const asRole = (role: string, password: string) => {
    const url = new URL(ownerUrl);
    url.username = role;
    url.password = password;
    return url.toString();
  };
  return {
    ownerUrl,
    webUrl: asRole("web_role", TEST_ROLE_PASSWORDS.web),
    agentUrl: asRole("agent_role", TEST_ROLE_PASSWORDS.agent),
    stop: async () => {
      await container.stop();
    },
  };
}
```

`packages/db/src/bin/migrate.ts`:
```ts
import { MigrateEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { runMigrations } from "../migrate.ts";

const env = parseEnv(MigrateEnv, process.env);
const log = createLogger({ service: "migrate", level: env.LOG_LEVEL });
await runMigrations({
  databaseUrl: env.DATABASE_URL,
  webPassword: env.WEB_DB_PASSWORD,
  agentPassword: env.AGENT_DB_PASSWORD,
  slots: env.BROWSER_SLOTS,
});
log.info({ slots: env.BROWSER_SLOTS.length }, "migrations, grants and slot rows applied");
```

Append to `packages/db/src/index.ts`:
```ts
export * from "./migrate.ts";
export * from "./queries/slots.ts";
```

- [ ] **Step 6: Run the tests to verify they pass.**

Run: `pnpm test:int -- packages/db && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. The first run pulls `pgvector/pgvector:pg17` (about 150 MB) and Testcontainers' ryuk image.

- [ ] **Step 7: Commit.**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): migrations with pgvector, folder-tree and append-only audit triggers, role grants, migrate runner"
```

---

### Task 9: Workspace bootstrap and settings queries

**Files:**
- Create: `packages/db/src/queries/{workspace,settings}.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/queries.int.test.ts`

**Interfaces:**
- Consumes: `Database`, the tables, `startTestDatabase` and `DEFAULT_CONCURRENCY`.
- Produces:
  - `hasAnyUser(db: Database): Promise<boolean>`.
  - `ensureWorkspaceMember(db: Database, userId: string): Promise<{workspaceId: string; role: MemberRole}>`:
    - it is idempotent and serialized with an advisory lock;
    - the first caller creates the workspace, `settings` (with `concurrency = least(6, greatest(1, slot count))`) and an owner membership;
    - later users become members.
  - `getMaxConcurrency(db: Database): Promise<number | null>`.

- [ ] **Step 1: Write the failing test.**

`packages/db/src/queries.int.test.ts`:
```ts
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.ts";
import { getMaxConcurrency } from "./queries/settings.ts";
import { listBrowserSlots } from "./queries/slots.ts";
import { ensureWorkspaceMember, hasAnyUser } from "./queries/workspace.ts";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;
let web: DbHandle;
let agent: DbHandle;

beforeAll(async () => {
  db = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  owner = postgres(db.ownerUrl, { max: 2, onnotice: () => undefined });
  web = createDb(db.webUrl, { max: 4 });
  agent = createDb(db.agentUrl, { max: 2 });
});
afterAll(async () => {
  await Promise.all([web?.close(), agent?.close(), owner?.end()]);
  await db?.stop();
});

async function createUser(id: string): Promise<void> {
  await owner`insert into "user" (id, name, email) values (${id}, 'U', ${`${id}@example.test`})`;
}

describe("workspace bootstrap", () => {
  it("knows when no user exists", async () => {
    expect(await hasAnyUser(web.db)).toBe(false);
  });

  it("creates exactly one owner even when first sign-ups race", async () => {
    await Promise.all(["u1", "u2", "u3"].map(createUser));
    const results = await Promise.all(["u1", "u2", "u3"].map((id) => ensureWorkspaceMember(web.db, id)));
    expect(results.filter((r) => r.role === "owner")).toHaveLength(1);
    expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1);
    const settingsRows = await owner`select concurrency from settings`;
    expect(settingsRows).toEqual([{ concurrency: 2 }]);
    expect(await hasAnyUser(web.db)).toBe(true);
  });

  it("is idempotent per user", async () => {
    const first = await ensureWorkspaceMember(web.db, "u1");
    const again = await ensureWorkspaceMember(web.db, "u1");
    expect(again).toEqual(first);
    const members = await owner`select count(*)::int as n from workspace_members where user_id = 'u1'`;
    expect(members[0]?.n).toBe(1);
  });
});

describe("agent-side reads", () => {
  it("reports the highest configured concurrency", async () => {
    expect(await getMaxConcurrency(agent.db)).toBe(2);
    await owner`update settings set concurrency = 7`;
    expect(await getMaxConcurrency(agent.db)).toBe(7);
  });
  it("lists only the requested slots, sorted", async () => {
    expect(await listBrowserSlots(agent.db, ["browser-2", "browser-1", "browser-9"])).toEqual([
      { name: "browser-1", state: "restarting", runId: null },
      { name: "browser-2", state: "restarting", runId: null },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test:int -- packages/db/src/queries.int.test.ts`
Expected: FAIL, because `./queries/workspace.ts` is not found.

- [ ] **Step 3: Implement.**

`packages/db/src/queries/workspace.ts`:
```ts
import { DEFAULT_CONCURRENCY, type MemberRole } from "@mastertutor/contracts";
import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { settings, user, workspaceMembers, workspaces } from "../schema/index.ts";

export async function hasAnyUser(db: Database): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).limit(1);
  return rows.length > 0;
}

export interface Membership {
  workspaceId: string;
  role: MemberRole;
}

/**
 * v1 has one workspace (D4). The first user becomes its owner and creates its settings;
 * later users join as members. Serialized with an advisory lock so racing sign-ups agree.
 */
export async function ensureWorkspaceMember(db: Database, userId: string): Promise<Membership> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mastertutor.workspace_bootstrap'))`);
    const [existing] = await tx
      .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .limit(1);
    if (existing) return existing;

    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .orderBy(asc(workspaces.createdAt))
      .limit(1);
    if (workspace) {
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "member" });
      return { workspaceId: workspace.id, role: "member" };
    }

    const [created] = await tx
      .insert(workspaces)
      .values({ name: "Workspace" })
      .returning({ id: workspaces.id });
    if (!created) throw new Error("workspace insert returned no row");
    await tx.insert(settings).values({
      workspaceId: created.id,
      concurrency: sql`least(${sql.raw(String(DEFAULT_CONCURRENCY))}, greatest(1, (select count(*) from browser_slots)))::int`,
    });
    await tx.insert(workspaceMembers).values({ workspaceId: created.id, userId, role: "owner" });
    return { workspaceId: created.id, role: "owner" };
  });
}
```

`packages/db/src/queries/settings.ts`:
```ts
import { max } from "drizzle-orm";
import type { Database } from "../client.ts";
import { settings } from "../schema/index.ts";

/** Highest settings.concurrency across workspaces; null when no workspace exists yet. */
export async function getMaxConcurrency(db: Database): Promise<number | null> {
  const [row] = await db.select({ value: max(settings.concurrency) }).from(settings);
  return row?.value ?? null;
}
```

Append to `packages/db/src/index.ts`:
```ts
export * from "./queries/workspace.ts";
export * from "./queries/settings.ts";
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test:int -- packages/db && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/db
git commit -m "feat(db): single-workspace bootstrap with race-safe owner creation, settings and slot queries"
```

---

### Task 10: Garage bootstrap (`garage-init`)

**Files:**
- Create: `infra/garage/garage.toml`
- Create: `packages/storage/package.json`, `packages/storage/tsconfig.json`, `packages/storage/src/{garage-admin,testing,index}.ts`, `packages/storage/src/bin/garage-init.ts`
- Test: `packages/storage/src/garage-admin.test.ts`, `packages/storage/src/garage.int.test.ts`

**Interfaces:**
- Consumes: `GarageInitEnv`, `parseEnv` and `createLogger`.
- Produces, from `@mastertutor/storage`:
  - `GarageKeySpec` (`{name, accessKeyId, secretAccessKey, read, write}`).
  - `GarageBootstrapOptions` (`{adminUrl, adminToken, bucket, keys, zone?, capacityBytes?, fetchImpl?, healthTimeoutMs?}`).
  - `bootstrapGarage(options): Promise<{bucketId; layoutVersion; createdBucket; importedKeys: string[]}>`, which is idempotent.
  - `waitForGarageAdmin(options: {adminUrl; adminToken; timeoutMs?; fetchImpl?}): Promise<void>`.
  - `GarageAdminError` (`operation`, `status`, `code`). Its message never includes the token.
- Produces, from `@mastertutor/storage/testing`: `startTestGarage(): Promise<{s3Endpoint; adminUrl; adminToken; stop()}>`.
- **Compose entry:** `node packages/storage/src/bin/garage-init.ts`. It imports the web key read-only and the agent key read+write.

- [ ] **Step 1: Create the package and the Garage config.**

`infra/garage/garage.toml`:
```toml
# Single-node Garage v2 (spec §3.1). Secrets come from GARAGE_RPC_SECRET and GARAGE_ADMIN_TOKEN.
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.internal"

[admin]
api_bind_addr = "[::]:3903"
```

`packages/storage/package.json`:
```json
{
  "name": "@mastertutor/storage",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing.ts"
  },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@aws-sdk/client-s3": "3.1146.0",
    "@aws-sdk/s3-request-presigner": "3.1146.0",
    "@mastertutor/contracts": "workspace:*",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "testcontainers": "12.2.0"
  }
}
```

`packages/storage/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Then run `pnpm install`.

- [ ] **Step 2: Write the failing tests.**

`packages/storage/src/garage-admin.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { bootstrapGarage, GarageAdminError } from "./garage-admin.ts";

const TOKEN = "garage-admin-token-for-tests-0123456789";
const KEY = {
  name: "agent",
  accessKeyId: "GK5aa6eb9e4f040236e79864f3",
  secretAccessKey: "0".repeat(64),
  read: true,
  write: true,
};

function fakeGarage(state: { layoutVersion: number; buckets: string[]; keys: string[] }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const op = url.pathname.replace("/v2/", "");
    calls.push(op);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    switch (op) {
      case "GetClusterStatus":
        return json({ layoutVersion: state.layoutVersion, nodes: [{ id: "node-1", isUp: true }] });
      case "/health":
        return new Response("ok", { status: 200 });
      case "ListBuckets":
        return json(state.buckets.map((alias) => ({ id: `id-${alias}`, globalAliases: [alias] })));
      case "CreateBucket":
        return json({ id: "id-new" });
      case "ListKeys":
        return json(state.keys.map((id) => ({ id, name: "x" })));
      default:
        return json({});
    }
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("bootstrapGarage", () => {
  it("lays out a fresh cluster, creates the bucket and imports keys", async () => {
    const { calls, fetchImpl } = fakeGarage({ layoutVersion: 0, buckets: [], keys: [] });
    const result = await bootstrapGarage({
      adminUrl: "http://garage:3903",
      adminToken: TOKEN,
      bucket: "mastertutor",
      keys: [KEY],
      fetchImpl,
    });
    expect(result).toEqual({
      bucketId: "id-new",
      layoutVersion: 1,
      createdBucket: true,
      importedKeys: ["agent"],
    });
    expect(calls).toEqual([
      "GetClusterStatus",
      "UpdateClusterLayout",
      "ApplyClusterLayout",
      "/health",
      "ListBuckets",
      "CreateBucket",
      "ListKeys",
      "ImportKey",
      "AllowBucketKey",
      "DenyBucketKey",
    ]);
  });

  it("changes nothing structural on an initialized cluster", async () => {
    const { calls, fetchImpl } = fakeGarage({
      layoutVersion: 1,
      buckets: ["mastertutor"],
      keys: [KEY.accessKeyId],
    });
    const result = await bootstrapGarage({
      adminUrl: "http://garage:3903/",
      adminToken: TOKEN,
      bucket: "mastertutor",
      keys: [KEY],
      fetchImpl,
    });
    expect(result.createdBucket).toBe(false);
    expect(result.importedKeys).toEqual([]);
    expect(calls).not.toContain("UpdateClusterLayout");
    expect(calls).not.toContain("CreateBucket");
    expect(calls).not.toContain("ImportKey");
  });

  it("reports admin failures without leaking the token", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: "Forbidden" }), { status: 403 })) as typeof fetch;
    const error = await bootstrapGarage({
      adminUrl: "http://garage:3903",
      adminToken: TOKEN,
      bucket: "mastertutor",
      keys: [],
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarageAdminError);
    expect((error as Error).message).toContain("GetClusterStatus");
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
```

`packages/storage/src/garage.int.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapGarage, waitForGarageAdmin, type GarageKeySpec } from "./garage-admin.ts";
import { startTestGarage, type TestGarage } from "./testing.ts";

const keys: GarageKeySpec[] = [
  {
    name: "web",
    accessKeyId: "GK111111111111111111111111",
    secretAccessKey: "1".repeat(64),
    read: true,
    write: false,
  },
  {
    name: "agent",
    accessKeyId: "GK222222222222222222222222",
    secretAccessKey: "2".repeat(64),
    read: true,
    write: true,
  },
];
let garage: TestGarage;

beforeAll(async () => {
  garage = await startTestGarage();
  await waitForGarageAdmin({ adminUrl: garage.adminUrl, adminToken: garage.adminToken });
});
afterAll(async () => {
  await garage?.stop();
});

describe("bootstrapGarage against Garage v2.3.0", () => {
  it("initializes once and is idempotent", async () => {
    const options = {
      adminUrl: garage.adminUrl,
      adminToken: garage.adminToken,
      bucket: "mastertutor",
      keys,
      capacityBytes: 1024 ** 3,
    };
    const first = await bootstrapGarage(options);
    expect(first.createdBucket).toBe(true);
    expect(first.importedKeys).toEqual(["web", "agent"]);
    expect(first.layoutVersion).toBe(1);
    const second = await bootstrapGarage(options);
    expect(second).toEqual({ ...first, createdBucket: false, importedKeys: [] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm test -- packages/storage && pnpm test:int -- packages/storage`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement.**

`packages/storage/src/garage-admin.ts`:
```ts
import { z } from "zod";

export interface GarageKeySpec {
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
  read: boolean;
  write: boolean;
}

export interface GarageBootstrapOptions {
  adminUrl: string;
  adminToken: string;
  bucket: string;
  keys: readonly GarageKeySpec[];
  zone?: string;
  capacityBytes?: number;
  fetchImpl?: typeof fetch;
  healthTimeoutMs?: number;
}

export interface GarageBootstrapResult {
  bucketId: string;
  layoutVersion: number;
  createdBucket: boolean;
  importedKeys: string[];
}

export class GarageAdminError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly code: string | null;
  constructor(operation: string, status: number, code: string | null) {
    super(`Garage admin ${operation} failed with HTTP ${status}${code ? ` (${code})` : ""}`);
    this.name = "GarageAdminError";
    this.operation = operation;
    this.status = status;
    this.code = code;
  }
}

const ClusterStatus = z.object({
  layoutVersion: z.number().int(),
  nodes: z.array(z.object({ id: z.string(), isUp: z.boolean() })),
});
const BucketList = z.array(z.object({ id: z.string(), globalAliases: z.array(z.string()) }));
const BucketInfo = z.object({ id: z.string() });
const KeyList = z.array(z.object({ id: z.string() }));
const ErrorBody = z.object({ code: z.string() });

const DEFAULT_CAPACITY_BYTES = 10 * 1024 ** 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function adminClient(options: { adminUrl: string; adminToken: string; fetchImpl?: typeof fetch }) {
  const doFetch = options.fetchImpl ?? fetch;
  const base = options.adminUrl.replace(/\/+$/, "");
  return async function call(operation: string, method: "GET" | "POST", body?: unknown) {
    const headers: Record<string, string> = { authorization: `Bearer ${options.adminToken}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await doFetch(`${base}/v2/${operation}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const parsed = ErrorBody.safeParse(json);
      throw new GarageAdminError(operation, response.status, parsed.success ? parsed.data.code : null);
    }
    return json;
  };
}

/** Polls until the admin API answers (one-shot startup only; not a hot path). */
export async function waitForGarageAdmin(options: {
  adminUrl: string;
  adminToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const call = adminClient(options);
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    try {
      await call("GetClusterStatus", "GET");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(500);
    }
  }
}

async function waitForHealthy(options: GarageBootstrapOptions): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${options.adminUrl.replace(/\/+$/, "")}/health`;
  const deadline = Date.now() + (options.healthTimeoutMs ?? 30_000);
  for (;;) {
    const response = await doFetch(url).catch(() => null);
    if (response?.ok) return;
    if (Date.now() > deadline) throw new GarageAdminError("health", response?.status ?? 0, null);
    await sleep(500);
  }
}

/**
 * Idempotent single-node setup through the Garage v2 admin API: layout, bucket, imported keys
 * and exact per-key permissions (web read-only, agent read/write).
 */
export async function bootstrapGarage(options: GarageBootstrapOptions): Promise<GarageBootstrapResult> {
  const call = adminClient(options);
  const status = ClusterStatus.parse(await call("GetClusterStatus", "GET"));
  let layoutVersion = status.layoutVersion;
  if (layoutVersion === 0) {
    const node = status.nodes.find((candidate) => candidate.isUp);
    if (!node) throw new Error("Garage has no live node to assign a layout to");
    await call("UpdateClusterLayout", "POST", {
      roles: [
        {
          id: node.id,
          zone: options.zone ?? "dc1",
          capacity: options.capacityBytes ?? DEFAULT_CAPACITY_BYTES,
          tags: [],
        },
      ],
    });
    await call("ApplyClusterLayout", "POST", { version: 1 });
    layoutVersion = 1;
  }
  await waitForHealthy(options);

  const buckets = BucketList.parse(await call("ListBuckets", "GET"));
  let bucketId = buckets.find((bucket) => bucket.globalAliases.includes(options.bucket))?.id;
  const createdBucket = bucketId === undefined;
  if (bucketId === undefined) {
    bucketId = BucketInfo.parse(await call("CreateBucket", "POST", { globalAlias: options.bucket })).id;
  }

  const existingKeys = new Set(KeyList.parse(await call("ListKeys", "GET")).map((key) => key.id));
  const importedKeys: string[] = [];
  for (const key of options.keys) {
    if (!existingKeys.has(key.accessKeyId)) {
      await call("ImportKey", "POST", {
        accessKeyId: key.accessKeyId,
        secretAccessKey: key.secretAccessKey,
        name: key.name,
      });
      importedKeys.push(key.name);
    }
    await call("AllowBucketKey", "POST", {
      bucketId,
      accessKeyId: key.accessKeyId,
      permissions: { read: key.read, write: key.write, owner: false },
    });
    await call("DenyBucketKey", "POST", {
      bucketId,
      accessKeyId: key.accessKeyId,
      permissions: { read: !key.read, write: !key.write, owner: true },
    });
  }
  return { bucketId, layoutVersion, createdBucket, importedKeys };
}
```

Note on the fake in the unit test: the health URL is `http://garage:3903/health`, so `url.pathname.replace("/v2/", "")` yields `"/health"`. That is why the expected call list contains `"/health"`.

`packages/storage/src/testing.ts`:
```ts
import { readFile } from "node:fs/promises";
import { GenericContainer, Wait } from "testcontainers";

export const TEST_GARAGE_ADMIN_TOKEN = "test-garage-admin-token-0123456789abcdef";
const TEST_RPC_SECRET = "efd683210a10ca343e2e01c81ed7586298bad59fd9748ede668ed26eea2c871f";

export interface TestGarage {
  s3Endpoint: string;
  adminUrl: string;
  adminToken: string;
  stop(): Promise<void>;
}

/** Garage v2.3.0 with the same garage.toml Compose uses. /health is 503 until bootstrapped. */
export async function startTestGarage(): Promise<TestGarage> {
  const toml = await readFile(new URL("../../../infra/garage/garage.toml", import.meta.url), "utf8");
  const container = await new GenericContainer("dxflrs/garage:v2.3.0")
    .withCopyContentToContainer([{ content: toml, target: "/etc/garage.toml" }])
    .withEnvironment({ GARAGE_RPC_SECRET: TEST_RPC_SECRET, GARAGE_ADMIN_TOKEN: TEST_GARAGE_ADMIN_TOKEN })
    .withExposedPorts(3900, 3903)
    .withWaitStrategy(
      Wait.forHttp("/health", 3903).forStatusCodeMatching((code) => code === 200 || code === 503),
    )
    .start();
  const host = container.getHost();
  return {
    s3Endpoint: `http://${host}:${container.getMappedPort(3900)}`,
    adminUrl: `http://${host}:${container.getMappedPort(3903)}`,
    adminToken: TEST_GARAGE_ADMIN_TOKEN,
    stop: async () => {
      await container.stop();
    },
  };
}
```

`packages/storage/src/bin/garage-init.ts`:
```ts
import { GarageInitEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { bootstrapGarage, waitForGarageAdmin } from "../garage-admin.ts";

const env = parseEnv(GarageInitEnv, process.env);
const log = createLogger({ service: "garage-init", level: env.LOG_LEVEL });
await waitForGarageAdmin({ adminUrl: env.GARAGE_ADMIN_URL, adminToken: env.GARAGE_ADMIN_TOKEN });
const result = await bootstrapGarage({
  adminUrl: env.GARAGE_ADMIN_URL,
  adminToken: env.GARAGE_ADMIN_TOKEN,
  bucket: env.S3_BUCKET,
  capacityBytes: env.GARAGE_CAPACITY_BYTES,
  keys: [
    {
      name: "web",
      accessKeyId: env.S3_WEB_ACCESS_KEY_ID,
      secretAccessKey: env.S3_WEB_SECRET_ACCESS_KEY,
      read: true,
      write: false,
    },
    {
      name: "agent",
      accessKeyId: env.S3_AGENT_ACCESS_KEY_ID,
      secretAccessKey: env.S3_AGENT_SECRET_ACCESS_KEY,
      read: true,
      write: true,
    },
  ],
});
log.info(
  { bucket: env.S3_BUCKET, createdBucket: result.createdBucket, importedKeys: result.importedKeys },
  "garage ready",
);
```

`packages/storage/src/index.ts`:
```ts
export * from "./garage-admin.ts";
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm test -- packages/storage && pnpm test:int -- packages/storage && pnpm typecheck && pnpm lint`
Expected: PASS. The first run pulls `dxflrs/garage:v2.3.0`, which is about 20 MB and may already be cached.

- [ ] **Step 6: Commit.**

```bash
git add infra/garage packages/storage pnpm-lock.yaml
git commit -m "feat(storage): idempotent Garage v2 bootstrap via the admin API and garage-init entry"
```

---

### Task 11: Object keys and the S3 wrapper

**Files:**
- Create: `packages/storage/src/{keys,s3}.ts`
- Modify: `packages/storage/src/index.ts`
- Test: `packages/storage/src/{keys,s3}.test.ts`, `packages/storage/src/s3.int.test.ts`

**Interfaces:**
- Consumes: `bootstrapGarage` and `startTestGarage` from Task 10.
- Produces, keys:
  - `objectKeys`, which builds these keys and throws `TypeError` on a malformed id:

    | Function | Key |
    |---|---|
    | `asset(workspaceId, sha256)` | `assets/<ws>/<sha>` |
    | `snapshot(sourceId, "page.mhtml" \| "page.png")` | `snapshots/<id>/<name>` |
    | `stepScreenshot(runId, seq)` | `runs/<id>/steps/<seq>.png` |
    | `transcriptImage(runId, seq, index)` | `runs/<id>/transcript/<seq>-<index>.png` |
    | `download(runId, filename)` | `downloads/<id>/<safe>` |

  - `SNAPSHOT_NAMES` and `SnapshotName`;
  - `safeFilename(input: string): string`;
  - `isObjectKey(key: string): boolean`.
- Produces, S3:
  - `StorageConfig` (`{endpoint, region, bucket, accessKeyId, secretAccessKey}`).
  - `Storage`, with these members:
    - `bucket`;
    - `put(key, body, {contentType, sha256?})`;
    - `getBytes(key): Promise<Uint8Array>`;
    - `head(key): Promise<{bytes, contentType, sha256} | null>`;
    - `delete(key)`;
    - `presignGet(key, ttlSeconds): Promise<string>` (TTL from 1 to 3600);
    - `ping()`.
  - `createStorage(config): Storage` and `MAX_PRESIGN_SECONDS = 3600`.

- [ ] **Step 1: Write the failing tests.**

`packages/storage/src/keys.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isObjectKey, objectKeys, safeFilename } from "./keys.ts";

const run = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("safeFilename", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\win.ini", "win.ini"],
    ["..", "download"],
    ["", "download"],
    [".hidden", "hidden"],
    ["résumé (final).pdf", "résumé _final_.pdf"],
    ["a\u0000b.txt", "a_b.txt"],
    ["ｒｅｐｏｒｔ.pdf", "report.pdf"],
  ])("%j becomes %j", (input, expected) => {
    expect(safeFilename(input)).toBe(expected);
  });
  it("caps names at 200 bytes and keeps the extension", () => {
    const name = safeFilename(`${"x".repeat(300)}.pdf`);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("objectKeys", () => {
  it("builds the spec layout", () => {
    expect(objectKeys.asset(run, "a".repeat(64))).toBe(`assets/${run}/${"a".repeat(64)}`);
    expect(objectKeys.snapshot(run, "page.mhtml")).toBe(`snapshots/${run}/page.mhtml`);
    expect(objectKeys.stepScreenshot(run, 7)).toBe(`runs/${run}/steps/7.png`);
    expect(objectKeys.transcriptImage(run, 7, 2)).toBe(`runs/${run}/transcript/7-2.png`);
    expect(objectKeys.download(run, "../x.pdf")).toBe(`downloads/${run}/x.pdf`);
  });
  it("refuses malformed ids", () => {
    expect(() => objectKeys.asset("../../", "a".repeat(64))).toThrow(TypeError);
    expect(() => objectKeys.asset(run, "ABC")).toThrow(TypeError);
    expect(() => objectKeys.stepScreenshot(run, -1)).toThrow(TypeError);
  });
  it("validates raw keys", () => {
    expect(isObjectKey(`runs/${run}/steps/1.png`)).toBe(true);
    for (const bad of ["", "/abs", "a//b", "a/../b", "a/./b", "a\nb"]) {
      expect(isObjectKey(bad)).toBe(false);
    }
  });
});
```

`packages/storage/src/s3.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createStorage } from "./s3.ts";

const storage = createStorage({
  endpoint: "http://127.0.0.1:1",
  region: "garage",
  bucket: "mastertutor",
  accessKeyId: "GK222222222222222222222222",
  secretAccessKey: "2".repeat(64),
});

describe("presignGet", () => {
  it("signs locally with the requested TTL", async () => {
    const url = await storage.presignGet("runs/x/steps/1.png", 300);
    expect(url).toContain("X-Amz-Expires=300");
    expect(url).toContain("/mastertutor/runs/x/steps/1.png");
  });
  it.each([0, 3601, 1.5])("rejects a TTL of %s seconds", async (ttl) => {
    await expect(storage.presignGet("a/b", ttl)).rejects.toThrow(RangeError);
  });
  it("rejects malformed keys before any network call", async () => {
    await expect(storage.presignGet("../etc", 60)).rejects.toThrow(TypeError);
  });
});
```

`packages/storage/src/s3.int.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapGarage, waitForGarageAdmin } from "./garage-admin.ts";
import { createStorage, type Storage } from "./s3.ts";
import { startTestGarage, type TestGarage } from "./testing.ts";

const WEB = {
  name: "web",
  accessKeyId: "GK111111111111111111111111",
  secretAccessKey: "1".repeat(64),
  read: true,
  write: false,
};
const AGENT = {
  name: "agent",
  accessKeyId: "GK222222222222222222222222",
  secretAccessKey: "2".repeat(64),
  read: true,
  write: true,
};
let garage: TestGarage;
let agent: Storage;
let web: Storage;

beforeAll(async () => {
  garage = await startTestGarage();
  await waitForGarageAdmin({ adminUrl: garage.adminUrl, adminToken: garage.adminToken });
  await bootstrapGarage({
    adminUrl: garage.adminUrl,
    adminToken: garage.adminToken,
    bucket: "mastertutor",
    keys: [WEB, AGENT],
    capacityBytes: 1024 ** 3,
  });
  const as = (key: typeof WEB) =>
    createStorage({
      endpoint: garage.s3Endpoint,
      region: "garage",
      bucket: "mastertutor",
      accessKeyId: key.accessKeyId,
      secretAccessKey: key.secretAccessKey,
    });
  agent = as(AGENT);
  web = as(WEB);
});
afterAll(async () => {
  await garage?.stop();
});

describe("Storage against Garage", () => {
  it("round-trips an object with its sha256 metadata", async () => {
    await agent.ping();
    await agent.put("runs/r/steps/1.png", new Uint8Array([1, 2, 3]), {
      contentType: "image/png",
      sha256: "a".repeat(64),
    });
    expect(Array.from(await agent.getBytes("runs/r/steps/1.png"))).toEqual([1, 2, 3]);
    expect(await agent.head("runs/r/steps/1.png")).toEqual({
      bytes: 3,
      contentType: "image/png",
      sha256: "a".repeat(64),
    });
    const response = await fetch(await agent.presignGet("runs/r/steps/1.png", 60));
    expect(response.status).toBe(200);
    await agent.delete("runs/r/steps/1.png");
    expect(await agent.head("runs/r/steps/1.png")).toBeNull();
  });

  it("gives web a read-only key", async () => {
    await agent.put("assets/x/readable", "hello", { contentType: "text/plain" });
    expect(new TextDecoder().decode(await web.getBytes("assets/x/readable"))).toBe("hello");
    await expect(web.put("assets/x/forbidden", "nope", { contentType: "text/plain" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- packages/storage`
Expected: FAIL, because `./keys.ts` and `./s3.ts` are missing.

- [ ] **Step 3: Implement.**

`packages/storage/src/keys.ts`:
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_FILENAME_BYTES = 200;
const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;

function uuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) throw new TypeError(`${what} must be a lowercase UUID`);
  return value;
}
function count(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${what} must be a non-negative integer`);
  return value;
}
function truncateUtf8(value: string, maxBytes: number): string {
  let out = "";
  for (const char of value) {
    if (byteLength(out + char) > maxBytes) break;
    out += char;
  }
  return out;
}

/** One safe key segment from an untrusted name: basename only, letters/digits/._- and space, 200 bytes max. */
export function safeFilename(input: string): string {
  const base = input.normalize("NFKC").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^[.\s]+/, "")
    .replace(/\s+$/, "");
  if (cleaned.length === 0) return "download";
  if (byteLength(cleaned) <= MAX_FILENAME_BYTES) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
  const stem = extension ? cleaned.slice(0, dot) : cleaned;
  const kept = truncateUtf8(stem, MAX_FILENAME_BYTES - byteLength(extension)) + extension;
  return kept.length > 0 ? kept : "download";
}

export function isObjectKey(key: string): boolean {
  return (
    key.length > 0 &&
    byteLength(key) <= 1024 &&
    !key.startsWith("/") &&
    !/\p{Cc}/u.test(key) &&
    !key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

export const SNAPSHOT_NAMES = ["page.mhtml", "page.png"] as const;
export type SnapshotName = (typeof SNAPSHOT_NAMES)[number];

/** The only place object keys are built (spec §7, §10.2). */
export const objectKeys = {
  asset(workspaceId: string, sha256: string): string {
    if (!SHA256_RE.test(sha256)) throw new TypeError("sha256 must be 64 lowercase hex chars");
    return `assets/${uuid(workspaceId, "workspaceId")}/${sha256}`;
  },
  snapshot(sourceId: string, name: SnapshotName): string {
    if (!SNAPSHOT_NAMES.includes(name)) throw new TypeError("unknown snapshot name");
    return `snapshots/${uuid(sourceId, "sourceId")}/${name}`;
  },
  stepScreenshot(runId: string, seq: number): string {
    return `runs/${uuid(runId, "runId")}/steps/${count(seq, "seq")}.png`;
  },
  transcriptImage(runId: string, seq: number, index: number): string {
    return `runs/${uuid(runId, "runId")}/transcript/${count(seq, "seq")}-${count(index, "index")}.png`;
  },
  download(runId: string, filename: string): string {
    return `downloads/${uuid(runId, "runId")}/${safeFilename(filename)}`;
  },
} as const;
```

`packages/storage/src/s3.ts`:
```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isObjectKey } from "./keys.ts";

export const MAX_PRESIGN_SECONDS = 3600;

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PutOptions {
  contentType: string;
  sha256?: string;
}

export interface ObjectHead {
  bytes: number;
  contentType: string | null;
  sha256: string | null;
}

/** The single S3 boundary (spec §3.2); swap the store by reimplementing this interface. */
export interface Storage {
  readonly bucket: string;
  put(key: string, body: Uint8Array | string, options: PutOptions): Promise<void>;
  getBytes(key: string): Promise<Uint8Array>;
  head(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
  presignGet(key: string, ttlSeconds: number): Promise<string>;
  ping(): Promise<void>;
}

function assertKey(key: string): void {
  if (!isObjectKey(key)) throw new TypeError("invalid object key");
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === "NotFound" || error.$metadata.httpStatusCode === 404)
  );
}

export function createStorage(config: StorageConfig): Storage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.bucket;
  return {
    bucket: Bucket,
    async put(key, body, options) {
      assertKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          Metadata: options.sha256 ? { sha256: options.sha256 } : undefined,
        }),
      );
    },
    async getBytes(key) {
      assertKey(key);
      const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!response.Body) throw new Error("object has no body");
      return response.Body.transformToByteArray();
    },
    async head(key) {
      assertKey(key);
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          bytes: response.ContentLength ?? 0,
          contentType: response.ContentType ?? null,
          sha256: response.Metadata?.sha256 ?? null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async presignGet(key, ttlSeconds) {
      assertKey(key);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_PRESIGN_SECONDS) {
        throw new RangeError(`ttlSeconds must be an integer from 1 to ${MAX_PRESIGN_SECONDS}`);
      }
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttlSeconds });
    },
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket }));
    },
  };
}
```

Append to `packages/storage/src/index.ts`:
```ts
export * from "./keys.ts";
export * from "./s3.ts";
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- packages/storage && pnpm test:int -- packages/storage && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/storage
git commit -m "feat(storage): object-key helpers with safe filenames and the S3 wrapper over Garage"
```

---

### Task 12: Agent skeleton (env, health, slot probe, boot check)

**Files:**
- Create: `apps/agent/package.json`, `apps/agent/tsconfig.json`
- Create: `apps/agent/src/{main,health,boot-checks}.ts`, `apps/agent/src/slots/probe.ts`, `apps/agent/src/bin/probe-slot.ts`
- Test: `apps/agent/src/{health,boot-checks}.test.ts`, `apps/agent/src/slots/probe.test.ts`

**Interfaces:**
- Consumes: `AgentEnv`, `parseEnv`, `createLogger`, `CDP_PROXY_PORT`, `SlotName`, `createDb`, `getMaxConcurrency`, `listBrowserSlots`, `Database` and `createStorage`.
- Produces:
  - **Health:**
    - `startHealthServer(options: {port; host?; checks: Record<string, () => Promise<unknown>>; details?; timeoutMs?}): Promise<{port; close()}>`;
    - `runHealthChecks(...)`.
    - `GET /healthz` returns 200 or 503 with `{status: "ok" | "fail", checks: {...}, details?}`. Error text is never included.
  - **Boot checks:**
    - `concurrencyProblem(maxConcurrency: number | null, slotCount: number): string | null`;
    - `assertConcurrencyFitsSlots(db: Database, slotCount: number): Promise<void>`.
  - **Slots:**
    - `slotCdpBaseUrl(name, options?): Promise<string>`, which **always uses the IP**;
    - `probeSlot(name, options?: {resolveHost?; port?; timeoutMs?}): Promise<{name; baseUrl; browser; protocolVersion}>`.
  - **CLI:** `node apps/agent/src/bin/probe-slot.ts browser-1` prints JSON.

- [ ] **Step 1: Create the package.**

`apps/agent/package.json`:
```json
{
  "name": "@mastertutor/agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "start": "node src/main.ts"
  },
  "dependencies": {
    "@mastertutor/contracts": "workspace:*",
    "@mastertutor/db": "workspace:*",
    "@mastertutor/storage": "workspace:*",
    "zod": "4.6.5"
  }
}
```

`apps/agent/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Then run `pnpm install`.

- [ ] **Step 2: Write the failing tests.**

`apps/agent/src/health.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { startHealthServer, type HealthServer } from "./health.ts";

let server: HealthServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function get(path: string) {
  const response = await fetch(`http://127.0.0.1:${server!.port}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("health server", () => {
  it("is ok when every check passes, with details", async () => {
    server = await startHealthServer({
      port: 0,
      host: "127.0.0.1",
      checks: { db: async () => undefined, storage: async () => undefined },
      details: async () => ({ slots: { "browser-1": "idle" } }),
    });
    expect(await get("/healthz")).toEqual({
      status: 200,
      body: {
        status: "ok",
        checks: { db: "ok", storage: "ok" },
        details: { slots: { "browser-1": "idle" } },
      },
    });
  });

  it("fails without leaking error text, and times out slow checks", async () => {
    server = await startHealthServer({
      port: 0,
      host: "127.0.0.1",
      timeoutMs: 50,
      checks: {
        db: async () => {
          throw new Error("password authentication failed for postgres://agent_role:secret@x");
        },
        storage: () => new Promise(() => undefined),
      },
    });
    const { status, body } = await get("/healthz");
    expect(status).toBe(503);
    expect(body).toEqual({ status: "fail", checks: { db: "fail", storage: "fail" } });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("answers 404 elsewhere", async () => {
    server = await startHealthServer({ port: 0, host: "127.0.0.1", checks: {} });
    expect((await get("/")).status).toBe(404);
  });
});
```

`apps/agent/src/boot-checks.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { concurrencyProblem } from "./boot-checks.ts";

describe("concurrencyProblem", () => {
  it("passes when no workspace exists yet or concurrency fits", () => {
    expect(concurrencyProblem(null, 1)).toBeNull();
    expect(concurrencyProblem(6, 6)).toBeNull();
    expect(concurrencyProblem(1, 6)).toBeNull();
  });
  it("explains a concurrency above the slot count", () => {
    expect(concurrencyProblem(7, 6)).toMatch(/concurrency \(7\) exceeds .* slots \(6\)/);
  });
});
```

`apps/agent/src/slots/probe.test.ts`:
```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeSlot, slotCdpBaseUrl } from "./probe.ts";

let server: Server | undefined;
afterEach(() => server?.close());

async function fakeCdp(body: string, status = 200): Promise<number> {
  server = createServer((req, res) => {
    expect(req.headers.host).toMatch(/^127\.0\.0\.1:/);
    res.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as AddressInfo).port;
}

describe("probeSlot", () => {
  it("addresses the slot by IP and reads the browser version", async () => {
    const port = await fakeCdp(
      JSON.stringify({
        Browser: "Chrome/154.0.8037.57",
        "Protocol-Version": "1.3",
        webSocketDebuggerUrl: "ws://x",
      }),
    );
    const result = await probeSlot("browser-1", { resolveHost: async () => "127.0.0.1", port });
    expect(result).toEqual({
      name: "browser-1",
      baseUrl: `http://127.0.0.1:${port}`,
      browser: "Chrome/154.0.8037.57",
      protocolVersion: "1.3",
    });
  });
  it("rejects invalid slot names before resolving", async () => {
    await expect(slotCdpBaseUrl("postgres", { resolveHost: async () => "127.0.0.1" })).rejects.toThrow();
  });
  it("rejects non-CDP answers", async () => {
    const port = await fakeCdp("Host header is specified and is not an IP address or localhost.", 500);
    await expect(probeSlot("browser-1", { resolveHost: async () => "127.0.0.1", port })).rejects.toThrow(
      /HTTP 500/,
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm test -- apps/agent`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement.**

`apps/agent/src/health.ts`:
```ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type HealthCheck = () => Promise<unknown>;
export type CheckStatus = "ok" | "fail";

export interface HealthReport {
  status: CheckStatus;
  checks: Record<string, CheckStatus>;
  details?: Record<string, unknown>;
}

export interface HealthServerOptions {
  port: number;
  host?: string;
  checks: Readonly<Record<string, HealthCheck>>;
  details?: () => Promise<Record<string, unknown>>;
  timeoutMs?: number;
}

export interface HealthServer {
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 2_000;

function within<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
    Promise.resolve()
      .then(work)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
  });
}

export async function runHealthChecks(
  options: Pick<HealthServerOptions, "checks" | "details" | "timeoutMs">,
): Promise<HealthReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results = await Promise.all(
    Object.entries(options.checks).map(async ([name, check]): Promise<[string, CheckStatus]> => {
      try {
        await within(check, timeoutMs);
        return [name, "ok"];
      } catch {
        return [name, "fail"];
      }
    }),
  );
  const report: HealthReport = {
    status: results.every(([, status]) => status === "ok") ? "ok" : "fail",
    checks: Object.fromEntries(results),
  };
  if (options.details) {
    try {
      report.details = await within(options.details, timeoutMs);
    } catch {
      report.details = { error: "unavailable" };
    }
  }
  return report;
}

/** Internal-only /healthz (spec §14); never exposed through Traefik. */
export async function startHealthServer(options: HealthServerOptions): Promise<HealthServer> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET" || path !== "/healthz") {
      res.writeHead(404, { "content-type": "application/json" }).end('{"status":"not_found"}');
      return;
    }
    void runHealthChecks(options).then((report) => {
      res
        .writeHead(report.status === "ok" ? 200 : 503, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify(report));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
```

`apps/agent/src/boot-checks.ts`:
```ts
import { getMaxConcurrency, type Database } from "@mastertutor/db";

export function concurrencyProblem(maxConcurrency: number | null, slotCount: number): string | null {
  if (maxConcurrency === null || maxConcurrency <= slotCount) return null;
  return `settings.concurrency (${maxConcurrency}) exceeds the number of browser slots (${slotCount}); change the Compose slots, BROWSER_SLOTS and settings.concurrency together`;
}

/** Spec §3.1 rule 4: boot fails if concurrency > slot count. */
export async function assertConcurrencyFitsSlots(db: Database, slotCount: number): Promise<void> {
  const problem = concurrencyProblem(await getMaxConcurrency(db), slotCount);
  if (problem) throw new Error(problem);
}
```

`apps/agent/src/slots/probe.ts`:
```ts
import { lookup } from "node:dns/promises";
import { CDP_PROXY_PORT, SlotName } from "@mastertutor/contracts";
import { z } from "zod";

const CdpVersion = z.object({
  Browser: z.string().min(1),
  "Protocol-Version": z.string(),
  webSocketDebuggerUrl: z.string(),
});

export interface ProbeOptions {
  resolveHost?: (host: string) => Promise<string>;
  port?: number;
  timeoutMs?: number;
}

export interface SlotProbe {
  name: string;
  baseUrl: string;
  browser: string;
  protocolVersion: string;
}

const resolveIpv4 = async (host: string) => (await lookup(host, { family: 4 })).address;

/**
 * Chrome rejects DevTools HTTP requests whose Host header is a hostname ("Host header is
 * specified and is not an IP address or localhost"), so slots are always addressed by IP.
 * B1 must use this URL for chromium.connectOverCDP.
 */
export async function slotCdpBaseUrl(name: string, options: ProbeOptions = {}): Promise<string> {
  const slot = SlotName.parse(name);
  const ip = await (options.resolveHost ?? resolveIpv4)(slot);
  return `http://${ip}:${options.port ?? CDP_PROXY_PORT}`;
}

export async function probeSlot(name: string, options: ProbeOptions = {}): Promise<SlotProbe> {
  const baseUrl = await slotCdpBaseUrl(name, options);
  const response = await fetch(`${baseUrl}/json/version`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
  });
  if (!response.ok) throw new Error(`Slot ${name} answered HTTP ${response.status}`);
  const version = CdpVersion.parse(await response.json());
  return { name, baseUrl, browser: version.Browser, protocolVersion: version["Protocol-Version"] };
}
```

`apps/agent/src/bin/probe-slot.ts`:
```ts
import { probeSlot } from "../slots/probe.ts";

const name = process.argv[2];
if (!name) {
  console.error("usage: node apps/agent/src/bin/probe-slot.ts <browser-N>");
  process.exit(64);
}
console.log(JSON.stringify(await probeSlot(name)));
```

`apps/agent/src/main.ts`:
```ts
import { AgentEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { createDb, listBrowserSlots } from "@mastertutor/db";
import { createStorage } from "@mastertutor/storage";
import { assertConcurrencyFitsSlots } from "./boot-checks.ts";
import { startHealthServer } from "./health.ts";

const env = parseEnv(AgentEnv, process.env);
const log = createLogger({ service: "agent", level: env.LOG_LEVEL });
const database = createDb(env.DATABASE_URL, { max: 10 });
const storage = createStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});

try {
  await assertConcurrencyFitsSlots(database.db, env.BROWSER_SLOTS.length);
} catch (error) {
  log.fatal({ err: error }, "boot check failed");
  await database.close();
  process.exit(1);
}

const health = await startHealthServer({
  port: env.AGENT_HEALTH_PORT,
  checks: {
    db: async () => database.sql`select 1`,
    storage: () => storage.ping(),
  },
  details: async () => ({
    slots: Object.fromEntries(
      (await listBrowserSlots(database.db, env.BROWSER_SLOTS)).map((slot) => [slot.name, slot.state]),
    ),
  }),
});
log.info({ port: health.port, slots: env.BROWSER_SLOTS.length }, "agent ready");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  await health.close();
  await database.close();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
```

- [ ] **Step 5: Run the tests and the boot smoke check.**

Run: `pnpm test -- apps/agent && pnpm typecheck && pnpm lint`
Expected: PASS.

Run (env deliberately empty): `env -i PATH="$PATH" node apps/agent/src/main.ts; echo "exit=$?"`
Expected: an `EnvError` listing `DATABASE_URL`, `OPENAI_API_KEY` and the other missing keys, with no values printed, and `exit=1`. Node may print an ExperimentalWarning about type stripping; that is fine.

- [ ] **Step 6: Commit.**

```bash
git add apps/agent pnpm-lock.yaml
git commit -m "feat(agent): skeleton with env parsing, internal /healthz, slot CDP probe by IP, concurrency boot check"
```

---

### Task 13: Web skeleton with Better Auth and `/healthz`

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/instrumentation.ts`
- Create: `apps/web/app/{layout.tsx,page.tsx}`, `apps/web/app/healthz/route.ts`, `apps/web/app/api/auth/[...all]/route.ts`
- Create: `apps/web/lib/server/{env,db,auth}.ts`
- Test: `apps/web/lib/server/auth.int.test.ts`

**Interfaces:**
- Consumes: `WebEnv`, `parseEnv`, `createDb`, `DbHandle`, `Database`, the auth tables, `hasAnyUser`, `ensureWorkspaceMember` and `startTestDatabase`.
- Produces:
  - **Functions:**
    - `getWebEnv(): WebEnv`, memoized;
    - `getDb(): DbHandle`, memoized;
    - `createAuth(deps: {db: Database; secret: string; baseURL: string; signupOpen: boolean})`;
    - `getAuth()` and `type Auth`.
  - **Routes:**
    - `GET /healthz` returns `{status: "ok"}`, or 503 when the DB is unreachable;
    - `/api/auth/*` is Better Auth (email and password, minimum 12 characters).
  - **Sign-up policy:**
    - the first sign-up creates the owner workspace;
    - later sign-ups get 403 unless `AUTH_SIGNUP_OPEN=1`, in which case they become members.

- [ ] **Step 1: Create the package.**

`apps/web/package.json`:
```json
{
  "name": "@mastertutor/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@mastertutor/contracts": "workspace:*",
    "@mastertutor/db": "workspace:*",
    "better-auth": "1.7.7",
    "drizzle-orm": "0.45.3",
    "next": "16.3.8",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@types/node": "24.19.1",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "typescript": "6.0.3"
  }
}
```
`drizzle-orm` is listed so that Better Auth's drizzle-adapter peer resolves. `typescript` is listed so that `next build` finds it inside Docker.

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "es2024"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "verbatimModuleSyntax": false,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

`apps/web/next.config.ts`:
```ts
import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // pnpm runs scripts from apps/web, so the monorepo root is two levels up.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@mastertutor/contracts", "@mastertutor/db"],
  poweredByHeader: false,
};

export default config;
```

Then run `pnpm install`.

- [ ] **Step 2: Write the failing test.**

`apps/web/lib/server/auth.int.test.ts`:
```ts
import { createDb, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "./auth.ts";

let testDb: TestDatabase;
let handle: DbHandle;
const baseURL = "http://localhost:3000";
const secret = "test-better-auth-secret-0123456789abcdef";

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  handle = createDb(testDb.webUrl, { max: 4 });
});
afterAll(async () => {
  await handle?.close();
  await testDb?.stop();
});

function signUp(signupOpen: boolean, email: string) {
  const auth = createAuth({ db: handle.db, secret, baseURL, signupOpen });
  return auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery-staple", name: "Test" },
  });
}

describe("Better Auth wiring", () => {
  it("makes the first user the workspace owner with slot-clamped concurrency", async () => {
    const result = await signUp(false, "owner@example.test");
    const rows = await handle.sql`
      select wm.role, s.concurrency from workspace_members wm
      join settings s on s.workspace_id = wm.workspace_id
      where wm.user_id = ${result.user.id}`;
    expect(rows).toEqual([{ role: "owner", concurrency: 2 }]);
  });

  it("closes sign-up after the first user", async () => {
    await expect(signUp(false, "intruder@example.test")).rejects.toMatchObject({ status: "FORBIDDEN" });
    const users = await handle.sql`select count(*)::int as n from "user"`;
    expect(users[0]?.n).toBe(1);
  });

  it("adds later users as members when sign-up is open", async () => {
    const result = await signUp(true, "teammate@example.test");
    const rows = await handle.sql`select role from workspace_members where user_id = ${result.user.id}`;
    expect(rows).toEqual([{ role: "member" }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm test:int -- apps/web`
Expected: FAIL, because `./auth.ts` is not found.

- [ ] **Step 4: Implement.**

`apps/web/lib/server/env.ts`:
```ts
import { WebEnv, parseEnv } from "@mastertutor/contracts";

let cached: WebEnv | undefined;

/** Parsed once per process; instrumentation.ts calls it at server start so bad env fails fast. */
export function getWebEnv(): WebEnv {
  cached ??= parseEnv(WebEnv, process.env);
  return cached;
}
```

`apps/web/lib/server/db.ts`:
```ts
import { createDb, type DbHandle } from "@mastertutor/db";
import { getWebEnv } from "./env.ts";

let handle: DbHandle | undefined;

export function getDb(): DbHandle {
  handle ??= createDb(getWebEnv().DATABASE_URL, { max: 10 });
  return handle;
}
```

`apps/web/lib/server/auth.ts`:
```ts
import {
  account,
  ensureWorkspaceMember,
  hasAnyUser,
  session,
  user,
  verification,
  type Database,
} from "@mastertutor/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { getDb } from "./db.ts";
import { getWebEnv } from "./env.ts";

export interface AuthDeps {
  db: Database;
  secret: string;
  baseURL: string;
  signupOpen: boolean;
}

/** v1 is one trusted workspace (D4): the first sign-up owns it; later sign-ups need AUTH_SIGNUP_OPEN. */
export function createAuth({ db, secret, baseURL, signupOpen }: AuthDeps) {
  return betterAuth({
    secret,
    baseURL,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!signupOpen && (await hasAnyUser(db))) {
              throw new APIError("FORBIDDEN", { message: "Sign-up is closed" });
            }
          },
          after: async (created) => {
            await ensureWorkspaceMember(db, created.id);
          },
        },
      },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | undefined;

export function getAuth(): Auth {
  if (!cached) {
    const env = getWebEnv();
    cached = createAuth({
      db: getDb().db,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      signupOpen: env.AUTH_SIGNUP_OPEN,
    });
  }
  return cached;
}
```

`apps/web/app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "../../../../lib/server/auth.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
```

`apps/web/app/healthz/route.ts`:
```ts
import { getDb } from "../../lib/server/db.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  try {
    await getDb().sql`select 1`;
    return Response.json({ status: "ok" }, { headers });
  } catch {
    return Response.json({ status: "fail" }, { status: 503, headers });
  }
}
```

`apps/web/instrumentation.ts`:
```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWebEnv } = await import("./lib/server/env.ts");
    getWebEnv();
  }
}
```

`apps/web/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "MasterTutor" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </```tsx
    </html>
  );
}
```

`apps/web/app/page.tsx`:
```tsx
/** Placeholder; F1 replaces it with the app shell. */
export default function Home() {
  return (
    <main>
      <h1>MasterTutor</h1>
    </main>
  );
}
```

- [ ] **Step 5: Run the tests and the build to verify they pass.**

Run: `pnpm test:int -- apps/web && pnpm typecheck && pnpm lint`
Expected: PASS.

Run: `pnpm --filter @mastertutor/web build`
Expected:
- The build succeeds.
- `apps/web/.next/standalone/apps/web/server.js` exists.
- `/healthz` and `/api/auth/[...all]` are listed as dynamic (ƒ).
- If Next rewrites `apps/web/tsconfig.json` (for example adding `.next/dev/types/**/*.ts` or `"incremental"`), keep its edits and rerun `pnpm typecheck`.

- [ ] **Step 6: Commit.**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Next.js 16 skeleton with Better Auth, single-workspace bootstrap hooks and /healthz"
```

---

### Task 14: The `browser-slot` image

**Files:**
- Create: `apps/browser-slot/Dockerfile`, `apps/browser-slot/.dockerignore`, `apps/browser-slot/policies.json`, `apps/browser-slot/supervisord/chromium.conf`
- Create: `apps/browser-slot/bin/{slot-entrypoint,exit-on-chromium,slot-health}`
- Create: `apps/browser-slot/seccomp/build-profile.ts`, `apps/browser-slot/seccomp/chromium.json` (generated)
- Test: `apps/browser-slot/seccomp/build-profile.test.ts`, `apps/browser-slot/test/verify.sh`

**Interfaces:**
- Consumes: the n.eko password derivation contract from Task 5. The slot's bash HMAC must equal `deriveNekoPassword`.
- Produces the image `mastertutor/browser-slot:local`.
- **Required env:** `SLOT_NAME`, `NEKO_ADMIN_SECRET`, `NEKO_MEMBER_SECRET` (each ≥ 32 characters), `CDP_ALLOWED_IP`, `NEKO_ALLOWED_IPS` (comma-separated).
- **Optional env:** `SLOT_EGRESS_ALLOW_CIDRS`, which B1 uses to allow the `fixtures` network, and `NEKO_WEBRTC_*`.
- **Runtime requirements:** `cap_add: [NET_ADMIN]`, `security_opt: seccomp=apps/browser-slot/seccomp/chromium.json`, `shm_size: 2gb`, and a tmpfs at `/tmp/chromium-profile` (`uid=1000,gid=1000,mode=0700`).
- **Ports:**
  - CDP on 9223 (socat to loopback 9222), from `CDP_ALLOWED_IP` only;
  - n.eko on 8080, from `NEKO_ALLOWED_IPS` only.
- **n.eko members:**
  - `agent` (admin) with password `HMAC(NEKO_ADMIN_SECRET, SLOT_NAME)`;
  - `user` (can_host, no clipboard) with password `HMAC(NEKO_MEMBER_SECRET, SLOT_NAME)`.
- **Health:** `/usr/local/bin/slot-health` (CDP `/json/version`).
- **Lifecycle:** when Chromium exits, supervisord stops and the container exits.

- [ ] **Step 1: Write the failing seccomp-generator test.**

`apps/browser-slot/seccomp/build-profile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { allowNamespaceSyscalls } from "./build-profile.ts";

describe("allowNamespaceSyscalls", () => {
  it("replaces Docker's namespace restrictions with one allow rule and keeps everything else", () => {
    const profile = {
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [
        { names: ["read", "write"], action: "SCMP_ACT_ALLOW" },
        { names: ["bpf", "clone", "unshare"], action: "SCMP_ACT_ALLOW", includes: { caps: ["CAP_SYS_ADMIN"] } },
        { names: ["clone"], action: "SCMP_ACT_ALLOW", args: [{ index: 0, value: 2114060288, op: "SCMP_CMP_MASKED_EQ" }] },
        { names: ["clone3"], action: "SCMP_ACT_ERRNO", errnoRet: 38, excludes: { caps: ["CAP_SYS_ADMIN"] } },
        { names: ["chroot"], action: "SCMP_ACT_ALLOW", includes: { caps: ["CAP_SYS_CHROOT"] } },
      ],
    };
    const result = allowNamespaceSyscalls(profile);
    expect(result.defaultAction).toBe("SCMP_ACT_ERRNO");
    expect(result.syscalls.map((rule) => rule.names)).toEqual([
      ["read", "write"],
      ["bpf", "clone", "unshare"],
      ["chroot"],
      ["clone", "clone3", "unshare", "setns"],
    ]);
    expect(result.syscalls.at(-1)?.action).toBe("SCMP_ACT_ALLOW");
  });
});
```

Run: `pnpm test -- apps/browser-slot`
Expected: FAIL, because `./build-profile.ts` is not found.

- [ ] **Step 2: Implement the generator and generate the profile.**

`apps/browser-slot/seccomp/build-profile.ts`:
```ts
// Generates seccomp/chromium.json: Docker's default seccomp profile plus the namespace
// syscalls Chromium's sandbox needs (clone, clone3, unshare, setns). The slot then runs
// Chromium WITH its sandbox and without CAP_SYS_ADMIN. Verified 2026-10-05: with Docker's
// stock profile Chromium dies with "Failed to move to new namespace ... Operation not permitted".
// Regenerate: node apps/browser-slot/seccomp/build-profile.ts
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const MOBY_PROFILE_URL =
  "https://raw.githubusercontent.com/moby/profiles/seccomp/v0.2.4/seccomp/default.json";
const NAMESPACE_SYSCALLS = ["clone", "clone3", "unshare", "setns"] as const;

interface SeccompRule {
  names: string[];
  action: string;
  includes?: { caps?: string[] };
  [key: string]: unknown;
}
interface SeccompProfile {
  syscalls: SeccompRule[];
  [key: string]: unknown;
}

export function allowNamespaceSyscalls(profile: SeccompProfile): SeccompProfile {
  const namespaceCalls = new Set<string>(NAMESPACE_SYSCALLS);
  const syscalls = profile.syscalls.filter((rule) => {
    const onlyNamespaceCalls = rule.names.every((name) => namespaceCalls.has(name));
    const sysAdminOnly = rule.includes?.caps?.includes("CAP_SYS_ADMIN") ?? false;
    return !(onlyNamespaceCalls && !sysAdminOnly);
  });
  syscalls.push({
    names: [...NAMESPACE_SYSCALLS],
    action: "SCMP_ACT_ALLOW",
    comment: "Chromium namespace sandbox without CAP_SYS_ADMIN",
  });
  return { ...profile, syscalls };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const response = await fetch(MOBY_PROFILE_URL);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const profile = (await response.json()) as SeccompProfile;
  const out = fileURLToPath(new URL("./chromium.json", import.meta.url));
  await writeFile(out, `${JSON.stringify(allowNamespaceSyscalls(profile), null, 2)}\n`);
  console.log(`wrote ${out}`);
}
```

Run:
```bash
pnpm test -- apps/browser-slot
node apps/browser-slot/seccomp/build-profile.ts
grep -c '"SCMP_ACT_ALLOW"' apps/browser-slot/seccomp/chromium.json
```
Expected:
- the test PASSes;
- the script prints `wrote …/chromium.json`;
- the grep count is about 30 or more.

- [ ] **Step 3: Write the verification script (the failing test).**

`apps/browser-slot/test/verify.sh`:
```bash
#!/usr/bin/env bash
# Verifies the browser-slot image in isolation:
#   - Chromium runs with its sandbox on;
#   - CDP is reachable only from the agent IP, and n.eko only from allowed IPs;
#   - private egress is blocked;
#   - the display is 1280x800;
#   - n.eko passwords are derived from the shared secrets;
#   - the profile is fresh after Chromium exits.
# Usage: bash apps/browser-slot/test/verify.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="mastertutor/browser-slot:verify"
NET="mt-slot-verify"
PREFIX="172.30.239"
SLOT="mt-slot-verify-slot"
PEER="mt-slot-verify-peer"
CURL="curlimages/curl:8.22.0"
ADMIN_SECRET="neko-admin-secret-for-tests-0123456789"
MEMBER_SECRET="neko-member-secret-for-tests-0123456789"

cleanup() {
  docker rm -f "$SLOT" "$PEER" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() { echo "VERIFY FAIL: $*" >&2; docker logs --tail 60 "$SLOT" >&2 2>/dev/null || true; exit 1; }
pass() { echo "ok - $*"; }
from_ip() { local ip="$1"; shift; docker run --rm --network "$NET" --ip "$ip" "$CURL" -s -m 4 "$@"; }
wait_healthy() {
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$SLOT" 2>/dev/null)" == "healthy" ]] && return 0
    sleep 1
  done
  return 1
}
hmac() { printf '%s' browser-1 | openssl dgst -sha256 -hmac "$1" -r | cut -d' ' -f1; }
login() {
  from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" "http://$PREFIX.20:8080/api/login"
}

docker build -q -t "$IMAGE" "$HERE" >/dev/null
cleanup
docker network create --internal --subnet "$PREFIX.0/24" "$NET" >/dev/null
docker run -d --name "$PEER" --network "$NET" --ip "$PREFIX.40" busybox:1.37 httpd -f -p 80 -h /tmp >/dev/null
docker run -d --name "$SLOT" --network "$NET" --ip "$PREFIX.20" \
  --cap-add NET_ADMIN --security-opt "seccomp=$HERE/seccomp/chromium.json" \
  --shm-size 2g --tmpfs /tmp/chromium-profile:uid=1000,gid=1000,mode=0700 \
  -e SLOT_NAME=browser-1 -e NEKO_ADMIN_SECRET="$ADMIN_SECRET" -e NEKO_MEMBER_SECRET="$MEMBER_SECRET" \
  -e CDP_ALLOWED_IP="$PREFIX.10" -e NEKO_ALLOWED_IPS="$PREFIX.11,$PREFIX.12" \
  -e NEKO_WEBRTC_NAT1TO1=127.0.0.1 \
  "$IMAGE" >/dev/null

wait_healthy || fail "slot did not become healthy"
pass "healthy"

from_ip "$PREFIX.10" "http://$PREFIX.20:9223/json/version" | grep -q '"Browser"' || fail "CDP not reachable from the agent IP"
pass "CDP reachable from the agent IP"
if from_ip "$PREFIX.11" "http://$PREFIX.20:9223/json/version" >/dev/null; then fail "CDP reachable from a non-agent IP"; fi
pass "CDP blocked for other IPs"

[[ "$(from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' "http://$PREFIX.20:8080/health")" == "200" ]] || fail "n.eko not reachable from the web IP"
pass "n.eko reachable from the web IP"
if from_ip "$PREFIX.30" -o /dev/null "http://$PREFIX.20:8080/health"; then fail "n.eko reachable from an unlisted IP"; fi
pass "n.eko blocked for other IPs"

[[ "$(login agent "$(hmac "$ADMIN_SECRET")")" == "200" ]] || fail "agent member login"
[[ "$(login user "$(hmac "$MEMBER_SECRET")")" == "200" ]] || fail "user member login"
[[ "$(login user wrong-password)" == "401" ]] || fail "wrong password accepted"
pass "n.eko member passwords derived from the secrets"

if docker exec "$SLOT" sh -c 'tr "\0" "\n" < /proc/$(pgrep -o -f "neko serve")/environ' | grep -q -E '^NEKO_(ADMIN|MEMBER)_SECRET='; then
  fail "raw secrets reached the n.eko process"
fi
pass "raw secrets scrubbed before supervisord"

[[ "$(docker exec -u neko "$SLOT" sh -c 'DISPLAY=:99.0 xdotool getdisplaygeometry')" == "1280 800" ]] || fail "display is not 1280x800"
pass "display 1280x800"

if docker exec "$SLOT" sh -c 'for p in $(pgrep -f /usr/lib/chromium/chromium); do tr "\0" " " < /proc/$p/cmdline; echo; done' | grep -q -- '--no-sandbox'; then
  fail "Chromium runs with --no-sandbox"
fi
docker exec "$SLOT" sh -c 'r=$(pgrep -f "type=renderer" | head -1); test -n "$r" && test "$(readlink /proc/1/ns/user)" != "$(readlink /proc/$r/ns/user 2>/dev/null || echo hidden)"' \
  || fail "renderer shares the container user namespace (sandbox off)"
pass "Chromium sandbox on"

from_ip "$PREFIX.10" -o /dev/null "http://$PREFIX.40/" || fail "control: peer not reachable from the test network"
if docker exec "$SLOT" curl -s -m 3 -o /dev/null "http://$PREFIX.40/"; then fail "slot reached a private address"; fi
pass "private egress blocked"

docker exec "$SLOT" touch /tmp/chromium-profile/previous-run-marker
docker exec "$SLOT" pkill -INT -f '^/usr/lib/chromium/chromium' || true
for _ in $(seq 1 20); do
  [[ "$(docker inspect -f '{{.State.Status}}' "$SLOT")" == "exited" ]] && break
  sleep 1
done
[[ "$(docker inspect -f '{{.State.Status}}' "$SLOT")" == "exited" ]] || fail "container kept running after Chromium exited"
pass "container exits with Chromium"
docker start "$SLOT" >/dev/null
wait_healthy || fail "slot did not come back healthy"
if docker exec "$SLOT" test -e /tmp/chromium-profile/previous-run-marker; then fail "previous profile survived the restart"; fi
pass "fresh profile after restart"

docker image rm -f "$IMAGE" >/dev/null 2>&1 || true
echo "browser-slot verify: all checks passed"
```

Run: `bash apps/browser-slot/test/verify.sh`
Expected: FAIL, with a Docker build error about the missing Dockerfile.

- [ ] **Step 4: Write the image files.**

`apps/browser-slot/.dockerignore`:
```
test/
seccomp/
```

`apps/browser-slot/Dockerfile`:
```dockerfile
# Browser slot (spec §3.1, run 15 §8): n.eko v3.1.6 (Apache-2.0, amd64+arm64) + headed
# Chromium with its sandbox + socat CDP proxy + an iptables ingress/egress filter.
FROM ghcr.io/m1k1o/neko/chromium:3.1.6

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends socat iptables; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# n.eko's Xorg dummy config has no 1280x800 mode; add a GTF 30 Hz modeline and prefer it.
RUN set -eux; \
    sed -i 's/^\(\s*\)Modeline "1280x720_30.00".*/&\n\1Modeline "1280x800_30.00" 37.90 1280 1288 1416 1552 800 801 804 814 -HSync +Vsync/' /etc/neko/xorg.conf; \
    sed -i 's/Modes "1920x1080_60.00"/Modes "1280x800_30.00" "1920x1080_60.00"/' /etc/neko/xorg.conf; \
    grep -q 'Modeline "1280x800_30.00" 37.90' /etc/neko/xorg.conf

COPY supervisord/chromium.conf /etc/neko/supervisord/chromium.conf
COPY policies.json /etc/chromium/policies/managed/policies.json
COPY --chmod=0755 bin/slot-entrypoint bin/exit-on-chromium bin/slot-health /usr/local/bin/

ENV NEKO_DESKTOP_SCREEN=1280x800@30 \
    NEKO_LOG_LEVEL=warn \
    NEKO_FILETRANSFER_ENABLED=false

HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=6 CMD ["/usr/local/bin/slot-health"]
ENTRYPOINT ["/usr/local/bin/slot-entrypoint"]
CMD ["/usr/bin/supervisord", "-c", "/etc/neko/supervisord.conf"]
```

`apps/browser-slot/policies.json`. This is n.eko's policy file with DevTools allowed, downloads allowed (the agent gates them through approvals and CDP), and the n.eko extensions removed:
```json
{
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "BrowserSignin": 0,
  "DefaultNotificationsSetting": 2,
  "DeveloperToolsAvailability": 1,
  "EditBookmarksEnabled": false,
  "FullscreenAllowed": true,
  "IncognitoModeAvailability": 1,
  "SyncDisabled": true,
  "AutoplayAllowed": true,
  "BrowserAddPersonEnabled": false,
  "BrowserGuestModeEnabled": false,
  "DefaultPopupsSetting": 2,
  "PromptForDownloadLocation": false,
  "BookmarkBarEnabled": false,
  "PasswordManagerEnabled": false,
  "BrowserLabsEnabled": false,
  "CommandLineFlagSecurityWarningsEnabled": false,
  "MetricsReportingEnabled": false,
  "URLBlocklist": ["file://*", "chrome://policy"],
  "ExtensionInstallBlocklist": ["*"]
}
```

`apps/browser-slot/supervisord/chromium.conf`:
```ini
; Replaces n.eko's chromium.conf:
;   - CDP on loopback 9222, which socat exposes on 9223;
;   - Chromium's sandbox ON;
;   - the profile on tmpfs;
;   - the container exits when Chromium exits.
[program:chromium]
environment=HOME="/home/%(ENV_USER)s",USER="%(ENV_USER)s",DISPLAY="%(ENV_DISPLAY)s"
command=/usr/bin/chromium
  --window-position=0,0
  --window-size=1280,800
  --display=%(ENV_DISPLAY)s
  --user-data-dir=/tmp/chromium-profile
  --no-first-run
  --no-default-browser-check
  --disable-gpu
  --disable-software-rasterizer
  --log-level=1
  --remote-debugging-address=127.0.0.1
  --remote-debugging-port=9222
stopsignal=INT
autorestart=false
startretries=0
priority=800
user=%(ENV_USER)s
stdout_logfile=/var/log/neko/chromium.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=1
redirect_stderr=true

[program:openbox]
environment=HOME="/home/%(ENV_USER)s",USER="%(ENV_USER)s",DISPLAY="%(ENV_DISPLAY)s"
command=/usr/bin/openbox --config-file /etc/neko/openbox.xml
autorestart=true
priority=300
user=%(ENV_USER)s
stdout_logfile=/var/log/neko/openbox.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=1
redirect_stderr=true

[program:cdp-proxy]
command=/usr/bin/socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222
autorestart=true
priority=900
user=%(ENV_USER)s
stdout_logfile=/var/log/neko/cdp-proxy.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=1
redirect_stderr=true

[eventlistener:exit-on-chromium]
command=/usr/local/bin/exit-on-chromium
events=PROCESS_STATE_EXITED,PROCESS_STATE_FATAL
priority=100
stderr_logfile=/var/log/neko/exit-on-chromium.log
```

`apps/browser-slot/bin/exit-on-chromium`:
```bash
#!/bin/bash
# Supervisor event listener: when Chromium exits, stop supervisord so the container exits
# and Compose `restart: always` brings the slot back with an empty tmpfs profile (spec §5.2).
set -u
while true; do
  printf 'READY\n'
  read -r header
  len=$(printf '%s' "$header" | sed -n 's/.*len:\([0-9]*\).*/\1/p')
  payload=$(head -c "${len:-0}")
  case "$payload" in
    *processname:chromium*) kill -TERM "$(cat /var/run/supervisord.pid)" ;;
  esac
  printf 'RESULT 2\nOK'
done
```

`apps/browser-slot/bin/slot-health`:
```sh
#!/bin/sh
# Healthy when Chromium answers CDP through the socat proxy (spec §14).
exec curl -fsS --max-time 2 -o /dev/null http://127.0.0.1:9223/json/version
```

`apps/browser-slot/bin/slot-entrypoint`:
```bash
#!/bin/bash
# Browser-slot entrypoint. It:
#   1. derives the n.eko member passwords;
#   2. installs the network filter;
#   3. wipes any previous browser state;
#   4. execs n.eko's supervisord.
set -euo pipefail

for name in SLOT_NAME NEKO_ADMIN_SECRET NEKO_MEMBER_SECRET CDP_ALLOWED_IP NEKO_ALLOWED_IPS; do
  if [[ -z "${!name:-}" ]]; then echo "slot-entrypoint: $name is required" >&2; exit 64; fi
done
if [[ ! "$SLOT_NAME" =~ ^browser-[1-9][0-9]?$ ]]; then echo "slot-entrypoint: invalid SLOT_NAME" >&2; exit 64; fi
if (( ${#NEKO_ADMIN_SECRET} < 32 || ${#NEKO_MEMBER_SECRET} < 32 )); then
  echo "slot-entrypoint: n.eko secrets must be at least 32 characters" >&2; exit 64
fi

# Same derivation as deriveNekoPassword() in @mastertutor/contracts/server.
hmac_hex() { printf '%s' "$SLOT_NAME" | openssl dgst -sha256 -hmac "$1" -r | cut -d' ' -f1; }
admin_password="$(hmac_hex "$NEKO_ADMIN_SECRET")"
user_password="$(hmac_hex "$NEKO_MEMBER_SECRET")"
unset NEKO_ADMIN_SECRET NEKO_MEMBER_SECRET

profile() { # name is_admin can_host can_share_media can_access_clipboard
  printf '{"name":"%s","is_admin":%s,"can_login":true,"can_connect":true,"can_watch":true,"can_host":%s,"can_share_media":%s,"can_access_clipboard":%s,"sends_inactive_cursor":false,"can_see_inactive_cursors":false}' \
    "$1" "$2" "$3" "$4" "$5"
}
export NEKO_MEMBER_PROVIDER=object
NEKO_MEMBER_OBJECT_USERS="[{\"username\":\"agent\",\"password\":\"${admin_password}\",\"profile\":$(profile agent true true true true)},{\"username\":\"user\",\"password\":\"${user_password}\",\"profile\":$(profile user false true false false)}]"
export NEKO_MEMBER_OBJECT_USERS
unset admin_password user_password

# Ingress: CDP (9223) and PulseAudio (4713) from the agent only; n.eko (8080) from web/Traefik only.
iptables -F INPUT
iptables -F OUTPUT
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for port in 9223 4713; do
  iptables -A INPUT -p tcp --dport "$port" -s "$CDP_ALLOWED_IP" -j ACCEPT
  iptables -A INPUT -p tcp --dport "$port" -j DROP
done
IFS=',' read -r -a neko_ips <<< "$NEKO_ALLOWED_IPS"
for ip in "${neko_ips[@]}"; do iptables -A INPUT -p tcp --dport 8080 -s "$ip" -j ACCEPT; done
iptables -A INPUT -p tcp --dport 8080 -j DROP

# Egress: the browser may reach the internet but never private ranges (other slots, web,
# the metadata address). Replies to inbound connections are allowed by conntrack.
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
if [[ -n "${SLOT_EGRESS_ALLOW_CIDRS:-}" ]]; then
  IFS=',' read -r -a allowed <<< "$SLOT_EGRESS_ALLOW_CIDRS"
  for cidr in "${allowed[@]}"; do iptables -A OUTPUT -d "$cidr" -j ACCEPT; done
fi
for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4; do
  iptables -A OUTPUT -d "$cidr" -j REJECT
done

# Compose restarts the same container, so wipe state even though the profile is on tmpfs.
mkdir -p /tmp/chromium-profile /downloads
find /tmp/chromium-profile -mindepth 1 -delete
chown neko:neko /tmp/chromium-profile /downloads
chmod 700 /tmp/chromium-profile

exec "$@"
```

- [ ] **Step 5: Run the verification to see it pass.**

Run: `bash apps/browser-slot/test/verify.sh`
Expected: every line `ok - …`, then `browser-slot verify: all checks passed`.
- **If the sandbox check fails on a Linux host:** run `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (Ubuntu 24.04+) and rerun. Never add `--no-sandbox`.

Run: `pnpm lint && pnpm typecheck && docker builder prune -f`

- [ ] **Step 6: Commit.**

```bash
git add apps/browser-slot
git commit -m "feat(browser-slot): n.eko Chromium slot with sandbox seccomp profile, CDP proxy, network filter and verify script"
```

---

### Task 15: Compose, Dockerfile, env files and topology tests

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `compose.yml`, `compose.test.yml`, `infra/traefik/test-dynamic.yml`, `.env.example`, `.env.test`
- Create: `scripts/env-init.ts`, `scripts/env-init.test.ts`, `tests/compose/compose-config.int.test.ts`
- Modify: `package.json`, adding the scripts `env:init` and `compose:test` and the devDependency `"@mastertutor/contracts": "workspace:*"`

**Interfaces:**
- Consumes: every service entry so far, `WebEnv`/`AgentEnv`/`MigrateEnv`/`GarageInitEnv`/`parseEnv`, and the contract primitives used by the env-init test.
- Produces:
  - **Images:** `mastertutor/node-runtime:local` (agent, migrate, garage-init), `mastertutor/web:local` and `mastertutor/browser-slot:local`.
  - **The test stack command:** `pnpm compose:test <args>`, which is `docker compose --env-file .env.test -f compose.yml -f compose.test.yml <args>`.
  - **Static `cdp` IPs:** agent `.10`, web `.11`, Traefik `.12`. Dynamic slot IPs come from `.128/25`.
  - **Test overlay:** Traefik on `127.0.0.1:${TEST_HTTP_PORT:-18080}`, and only `browser-1` active.
  - **env-init script:** `pnpm env:init` fills missing or empty keys in the root `.env` and never prints values. It exports `generateSecrets(): Record<string,string>`, `ENV_DEFAULTS`, `MANUAL_KEYS` and `fillEnv(existing: string, generated: Record<string,string>): {text; filled: string[]; missingManual: string[]}`.

- [ ] **Step 1: Write the failing tests.**

Add to the root `package.json`:
- under `scripts`:
  - `"env:init": "node scripts/env-init.ts"`;
  - `"compose:test": "docker compose --env-file .env.test -f compose.yml -f compose.test.yml"`;
- under `devDependencies`: `"@mastertutor/contracts": "workspace:*"`.

Then run `pnpm install`.

`scripts/env-init.test.ts`:
```ts
import {
  Base64Key32,
  DbPassword,
  GarageKeyId,
  GarageSecret,
} from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { ENV_DEFAULTS, fillEnv, generateSecrets } from "./env-init.ts";

describe("generateSecrets", () => {
  it("produces values that satisfy the env contracts", () => {
    const s = generateSecrets();
    for (const key of ["POSTGRES_PASSWORD", "WEB_DB_PASSWORD", "AGENT_DB_PASSWORD"]) {
      expect(DbPassword.safeParse(s[key]).success, key).toBe(true);
    }
    for (const key of ["S3_WEB_ACCESS_KEY_ID", "S3_AGENT_ACCESS_KEY_ID"]) {
      expect(GarageKeyId.safeParse(s[key]).success, key).toBe(true);
    }
    for (const key of ["S3_WEB_SECRET_ACCESS_KEY", "S3_AGENT_SECRET_ACCESS_KEY", "GARAGE_RPC_SECRET"]) {
      expect(GarageSecret.safeParse(s[key]).success, key).toBe(true);
    }
    expect(Base64Key32.safeParse(s.VAULT_PUBLIC_KEY).success).toBe(true);
    expect(Base64Key32.safeParse(s.VAULT_PRIVATE_KEY).success).toBe(true);
    for (const key of ["BETTER_AUTH_SECRET", "NEKO_ADMIN_SECRET", "NEKO_MEMBER_SECRET", "LIVE_COOKIE_SECRET", "TURN_SECRET", "GARAGE_ADMIN_TOKEN"]) {
      expect(s[key]!.length, key).toBeGreaterThanOrEqual(32);
    }
  });
});

describe("fillEnv", () => {
  const generated = { ...generateSecrets() };

  it("never touches existing values, fills empty ones and appends missing ones", () => {
    const existing = "OPENAI_API_KEY=sk-real\nPOSTGRES_PASSWORD=\nNEKO_ADMIN_SECRET=keep-me-keep-me-keep-me-keep-me-1\n";
    const result = fillEnv(existing, generated);
    expect(result.text).toContain("OPENAI_API_KEY=sk-real\n");
    expect(result.text).toContain("NEKO_ADMIN_SECRET=keep-me-keep-me-keep-me-keep-me-1\n");
    expect(result.text).toContain(`POSTGRES_PASSWORD=${generated.POSTGRES_PASSWORD}\n`);
    expect(result.text).toContain(`BROWSER_SLOTS=${ENV_DEFAULTS.BROWSER_SLOTS}`);
    expect(result.filled).toContain("POSTGRES_PASSWORD");
    expect(result.filled).not.toContain("NEKO_ADMIN_SECRET");
    expect(result.missingManual).toEqual(["OPENAI_EMBEDDINGS_KEY"]);
  });

  it("is a no-op the second time", () => {
    const once = fillEnv("", generated).text;
    expect(fillEnv(once, generateSecrets()).text).toBe(once);
  });

  it("refuses a half-present vault key pair", () => {
    expect(() => fillEnv("VAULT_PUBLIC_KEY=y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=\n", generated)).toThrow(
      /VAULT_PUBLIC_KEY and VAULT_PRIVATE_KEY/,
    );
  });
});
```

`tests/compose/compose-config.int.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AgentEnv, GarageInitEnv, MigrateEnv, WebEnv, parseEnv } from "@mastertutor/contracts";
import { beforeAll, describe, expect, it } from "vitest";

interface Port { target: number; published?: string; protocol?: string; host_ip?: string }
interface Service {
  image?: string;
  environment?: Record<string, string | null>;
  networks?: Record<string, { ipv4_address?: string } | null>;
  ports?: Port[];
  cap_add?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  tmpfs?: string[];
  restart?: string;
}
interface Config { services: Record<string, Service>; networks: Record<string, { internal?: boolean }> }

const root = fileURLToPath(new URL("../..", import.meta.url));
const load = (files: string[]): Config =>
  JSON.parse(
    execFileSync(
      "docker",
      ["compose", "--env-file", ".env.test", ...files.flatMap((f) => ["-f", f]), "config", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    ),
  ) as Config;
const env = (service: Service) =>
  Object.fromEntries(
    Object.entries(service.environment ?? {}).filter((entry): entry is [string, string] => entry[1] !== null),
  );
const nets = (service: Service) => Object.keys(service.networks ?? {}).sort();
const slots = ["browser-1", "browser-2", "browser-3", "browser-4", "browser-5", "browser-6"];

let base: Config;
let test: Config;
beforeAll(() => {
  base = load(["compose.yml"]);
  test = load(["compose.yml", "compose.test.yml"]);
});

describe("compose.yml", () => {
  it("defines the Phase 0 services and six always-on slots", () => {
    expect(Object.keys(base.services).sort()).toEqual(
      ["agent", "garage", "garage-init", "migrate", "postgres", "web", ...slots].sort(),
    );
  });

  it("gives every service an env that its contract accepts", () => {
    expect(() => parseEnv(WebEnv, env(base.services.web!))).not.toThrow();
    expect(() => parseEnv(AgentEnv, env(base.services.agent!))).not.toThrow();
    expect(() => parseEnv(MigrateEnv, env(base.services.migrate!))).not.toThrow();
    expect(() => parseEnv(GarageInitEnv, env(base.services["garage-init"]!))).not.toThrow();
  });

  it("places secrets with least privilege (spec §12 key placement)", () => {
    const web = Object.keys(env(base.services.web!));
    const agent = Object.keys(env(base.services.agent!));
    for (const key of ["VAULT_PRIVATE_KEY", "NEKO_ADMIN_SECRET", "OPENAI_API_KEY", "S3_AGENT_SECRET_ACCESS_KEY"]) {
      expect(web).not.toContain(key);
    }
    for (const key of ["NEKO_MEMBER_SECRET", "BETTER_AUTH_SECRET", "LIVE_COOKIE_SECRET", "TURN_SECRET", "VAULT_PUBLIC_KEY"]) {
      expect(agent).not.toContain(key);
    }
    expect(env(base.services.web!).DATABASE_URL).toMatch(/^postgres:\/\/web_role:/);
    expect(env(base.services.agent!).DATABASE_URL).toMatch(/^postgres:\/\/agent_role:/);
    for (const slot of slots) {
      for (const key of Object.keys(env(base.services[slot]!))) {
        expect(key, slot).not.toMatch(/^(VAULT_|OPENAI_|S3_|DATABASE_URL|BETTER_AUTH|LIVE_COOKIE|TURN_SECRET)/);
      }
    }
  });

  it("isolates networks", () => {
    expect(base.networks.cdp?.internal).toBe(true);
    expect(nets(base.services.postgres!)).toEqual(["backend"]);
    expect(nets(base.services.garage!)).toEqual(["backend"]);
    expect(nets(base.services.web!)).toEqual(["backend", "cdp", "edge"]);
    expect(nets(base.services.agent!)).toEqual(["backend", "cdp"]);
    expect(base.services.agent!.networks!.cdp!.ipv4_address).toBe("172.30.231.10");
    expect(base.services.web!.networks!.cdp!.ipv4_address).toBe("172.30.231.11");
    expect(base.services.agent!.cap_drop).toEqual(["ALL"]);
  });

  it("defines slots once: only name and media port differ, and only media is published", () => {
    slots.forEach((slot, index) => {
      const service = base.services[slot]!;
      const port = String(59001 + index);
      expect(service.image).toBe("mastertutor/browser-slot:local");
      expect(nets(service)).toEqual(["cdp", "egress"]);
      expect(service.cap_add).toEqual(["NET_ADMIN"]);
      expect(service.restart).toBe("always");
      expect(service.security_opt?.some((opt) => /seccomp=.*apps\/browser-slot\/seccomp\/chromium\.json$/.test(opt))).toBe(true);
      expect(service.tmpfs?.some((t) => t.startsWith("/tmp/chromium-profile"))).toBe(true);
      expect(env(service).SLOT_NAME).toBe(slot);
      expect(env(service).NEKO_WEBRTC_UDPMUX).toBe(port);
      expect(env(service).NEKO_WEBRTC_TCPMUX).toBe(port);
      expect((service.ports ?? []).map((p) => `${p.published}:${p.target}/${p.protocol}`).sort()).toEqual(
        [`${port}:${port}/tcp`, `${port}:${port}/udp`],
      );
    });
    for (const name of ["postgres", "garage", "web", "agent", "migrate", "garage-init"]) {
      expect(base.services[name]!.ports ?? [], name).toEqual([]);
    }
  });
});

describe("compose.test.yml overlay", () => {
  it("runs one slot behind a loopback-only Traefik", () => {
    const active = Object.keys(test.services).filter((name) => name.startsWith("browser-"));
    expect(active).toEqual(["browser-1"]);
    expect(env(test.services.agent!).BROWSER_SLOTS).toBe("browser-1");
    const traefik = test.services.traefik!;
    expect(traefik.ports?.map((p) => `${p.host_ip}:${p.published}:${p.target}`)).toEqual(["127.0.0.1:18080:80"]);
    expect(traefik.networks!.cdp!.ipv4_address).toBe("172.30.231.12");
  });
});
```

Run: `pnpm test -- scripts && pnpm test:int -- tests/compose`
Expected: FAIL, because `env-init.ts`, `compose.yml` and `.env.test` are missing.

- [ ] **Step 2: Implement `scripts/env-init.ts`.**

```ts
// Fills missing or empty keys in the root .env with fresh secrets and safe local defaults.
// Never prints or overwrites an existing value. Usage: pnpm env:init
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const b64url = (bytes: number) => randomBytes(bytes).toString("base64url");
const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export const ENV_DEFAULTS = {
  PUBLIC_IP: "127.0.0.1",
  PUBLIC_URL: "http://localhost:18080",
  BROWSER_SLOTS: "browser-1,browser-2,browser-3,browser-4,browser-5,browser-6",
  AUTH_SIGNUP_OPEN: "0",
} as const;
export const MANUAL_KEYS = ["OPENAI_API_KEY", "OPENAI_EMBEDDINGS_KEY"] as const;

export function generateSecrets(): Record<string, string> {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pub = publicKey.export({ format: "jwk" }).x;
  const priv = privateKey.export({ format: "jwk" }).d;
  if (!pub || !priv) throw new Error("x25519 key export failed");
  return {
    POSTGRES_PASSWORD: b64url(24),
    WEB_DB_PASSWORD: b64url(24),
    AGENT_DB_PASSWORD: b64url(24),
    BETTER_AUTH_SECRET: b64url(32),
    NEKO_ADMIN_SECRET: b64url(32),
    NEKO_MEMBER_SECRET: b64url(32),
    LIVE_COOKIE_SECRET: b64url(32),
    TURN_SECRET: b64url(32),
    GARAGE_ADMIN_TOKEN: b64url(32),
    GARAGE_RPC_SECRET: hex(32),
    S3_WEB_ACCESS_KEY_ID: `GK${hex(12)}`,
    S3_WEB_SECRET_ACCESS_KEY: hex(32),
    S3_AGENT_ACCESS_KEY_ID: `GK${hex(12)}`,
    S3_AGENT_SECRET_ACCESS_KEY: hex(32),
    // libsodium crypto_box keys are raw X25519 keys; base64 (standard) for the env.
    VAULT_PUBLIC_KEY: Buffer.from(pub, "base64url").toString("base64"),
    VAULT_PRIVATE_KEY: Buffer.from(priv, "base64url").toString("base64"),
  };
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export function fillEnv(
  existing: string,
  generated: Record<string, string>,
): { text: string; filled: string[]; missingManual: string[] } {
  const wanted: Record<string, string> = { ...ENV_DEFAULTS, ...generated };
  const values = new Map<string, string>();
  for (const line of existing.split("\n")) {
    const match = LINE.exec(line);
    if (match) values.set(match[1]!, match[2]!.trim());
  }
  const hasPublic = (values.get("VAULT_PUBLIC_KEY") ?? "") !== "";
  const hasPrivate = (values.get("VAULT_PRIVATE_KEY") ?? "") !== "";
  if (hasPublic !== hasPrivate) {
    throw new Error("VAULT_PUBLIC_KEY and VAULT_PRIVATE_KEY must be set together; fix .env by hand");
  }
  const filled: string[] = [];
  const lines = existing.split("\n").map((line) => {
    const match = LINE.exec(line);
    if (!match) return line;
    const [, key, value] = match;
    if (value!.trim() === "" && key! in wanted) {
      filled.push(key!);
      return `${key}=${wanted[key!]}`;
    }
    return line;
  });
  const appended = Object.keys(wanted).filter((key) => !values.has(key));
  let text = lines.join("\n");
  if (appended.length > 0) {
    if (text.length > 0 && !text.endsWith("\n")) text += "\n";
    text += `# Added by pnpm env:init\n${appended.map((key) => `${key}=${wanted[key]}`).join("\n")}\n`;
    filled.push(...appended);
  }
  const missingManual = MANUAL_KEYS.filter((key) => (values.get(key) ?? "") === "");
  return { text, filled, missingManual };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = fileURLToPath(new URL("../.env", import.meta.url));
  const existing = await readFile(path, "utf8").catch(() => "");
  const result = fillEnv(existing, generateSecrets());
  await writeFile(path, result.text, { mode: 0o600 });
  await chmod(path, 0o600);
  console.log(result.filled.length ? `filled: ${result.filled.join(", ")}` : "nothing to fill");
  if (result.missingManual.length) console.log(`set by hand: ${result.missingManual.join(", ")}`);
}
```

- [ ] **Step 3: Write the env files.**

`.env.example`:
```dotenv
# Copy to .env, then run `pnpm env:init` to generate everything below except the OpenAI keys.
# Never commit .env.

# Set by hand (real OpenAI keys).
OPENAI_API_KEY=
OPENAI_EMBEDDINGS_KEY=
OPENAI_BASE_URL=

# Local defaults.
PUBLIC_IP=127.0.0.1
PUBLIC_URL=http://localhost:18080
BROWSER_SLOTS=browser-1,browser-2,browser-3,browser-4,browser-5,browser-6
AUTH_SIGNUP_OPEN=0
CDP_SUBNET_PREFIX=172.30.231
SLOT_EGRESS_ALLOW_CIDRS=
LOG_LEVEL=info

# Generated secrets.
POSTGRES_PASSWORD=
WEB_DB_PASSWORD=
AGENT_DB_PASSWORD=
BETTER_AUTH_SECRET=
VAULT_PUBLIC_KEY=
VAULT_PRIVATE_KEY=
NEKO_ADMIN_SECRET=
NEKO_MEMBER_SECRET=
LIVE_COOKIE_SECRET=
TURN_SECRET=
GARAGE_RPC_SECRET=
GARAGE_ADMIN_TOKEN=
S3_WEB_ACCESS_KEY_ID=
S3_WEB_SECRET_ACCESS_KEY=
S3_AGENT_ACCESS_KEY_ID=
S3_AGENT_SECRET_ACCESS_KEY=
```

`.env.test`. These are dummy values for local and CI tests only; they protect nothing:
```dotenv
# Dummy values for compose.test.yml and CI. They protect nothing; never reuse them.
TEST_HTTP_PORT=18080
PUBLIC_IP=127.0.0.1
PUBLIC_URL=http://localhost:18080
BROWSER_SLOTS=browser-1
AUTH_SIGNUP_OPEN=0
AGENT_TEST_MODE=1
LOG_LEVEL=info
OPENAI_API_KEY=sk-test-not-a-real-key
OPENAI_EMBEDDINGS_KEY=sk-test-not-a-real-key
POSTGRES_PASSWORD=test_owner_password_0123456789
WEB_DB_PASSWORD=test_web_password_0123456789ab
AGENT_DB_PASSWORD=test_agent_password_0123456789
BETTER_AUTH_SECRET=test-better-auth-secret-0123456789abcdef
VAULT_PUBLIC_KEY=y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=
VAULT_PRIVATE_KEY=kCNZsvnP2oSO4FaU/yZoEi4TCPUK/EKw1zn4wI/5s1c=
NEKO_ADMIN_SECRET=neko-admin-secret-for-tests-0123456789
NEKO_MEMBER_SECRET=neko-member-secret-for-tests-0123456789
LIVE_COOKIE_SECRET=live-cookie-secret-for-tests-0123456789
TURN_SECRET=turn-secret-for-tests-0123456789abcdef
GARAGE_RPC_SECRET=efd683210a10ca343e2e01c81ed7586298bad59fd9748ede668ed26eea2c871f
GARAGE_ADMIN_TOKEN=garage-admin-token-for-tests-0123456789
S3_WEB_ACCESS_KEY_ID=GK66316f1f1bd64a571eb1b439
S3_WEB_SECRET_ACCESS_KEY=16b2df8b12b3996e4916bd7de64631b3aa2704355137354988fcc6ac4cb1ab82
S3_AGENT_ACCESS_KEY_ID=GK5aa6eb9e4f040236e79864f3
S3_AGENT_SECRET_ACCESS_KEY=0974bfbf76eb6fb9faf77bf05f5b21d703c85dbd797421167285185ae7ff3568
```

- [ ] **Step 4: Write the Dockerfile and `.dockerignore`.**

`.dockerignore`:
```
**/node_modules
**/.next
**/coverage
.git
.env
.env.*
.superpowers
orchestration
design
docs
apps/browser-slot
*.md
```

`Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.7
# Node services. Two targets:
#   node-runtime: agent, migrate, garage-init (TS via Node type stripping);
#   web: the Next.js standalone server.
FROM node:24-slim AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.34.6 && npm cache clean --force
WORKDIR /repo

FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --store-dir /pnpm/store

FROM fetch AS web-build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store --filter "@mastertutor/web..."
RUN pnpm --filter @mastertutor/web build

FROM fetch AS runtime-build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --prod --store-dir /pnpm/store --filter "@mastertutor/agent..."

# Workspace packages stay symlinked outside node_modules, which Node type stripping requires.
FROM node:24-slim AS node-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-build --chown=node:node /repo/package.json ./package.json
COPY --from=runtime-build --chown=node:node /repo/node_modules ./node_modules
COPY --from=runtime-build --chown=node:node /repo/packages ./packages
COPY --from=runtime-build --chown=node:node /repo/apps/agent ./apps/agent
USER node
CMD ["node", "apps/agent/src/main.ts"]

FROM node:24-slim AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 5: Write `compose.yml`.**

```yaml
# MasterTutor: one Compose app (spec §3.1, §13). Local: `pnpm env:init`, then use compose.test.yml.
name: mastertutor

x-node-runtime: &node-runtime
  image: mastertutor/node-runtime:local
  build:
    context: .
    target: node-runtime
  networks:
    - backend

x-node-health: &node-health
  interval: 5s
  timeout: 3s
  retries: 20
  start_period: 10s

x-slot-env: &slot-env
  NEKO_WEBRTC_NAT1TO1: ${PUBLIC_IP:?set PUBLIC_IP}
  NEKO_ADMIN_SECRET: ${NEKO_ADMIN_SECRET:?set NEKO_ADMIN_SECRET}
  NEKO_MEMBER_SECRET: ${NEKO_MEMBER_SECRET:?set NEKO_MEMBER_SECRET}
  CDP_ALLOWED_IP: ${CDP_SUBNET_PREFIX:-172.30.231}.10
  NEKO_ALLOWED_IPS: ${CDP_SUBNET_PREFIX:-172.30.231}.11,${CDP_SUBNET_PREFIX:-172.30.231}.12
  SLOT_EGRESS_ALLOW_CIDRS: ${SLOT_EGRESS_ALLOW_CIDRS:-}

x-browser-slot: &browser-slot
  image: mastertutor/browser-slot:local
  build:
    context: ./apps/browser-slot
  restart: always
  shm_size: 2gb
  cap_add:
    - NET_ADMIN
  security_opt:
    - seccomp=./apps/browser-slot/seccomp/chromium.json
  tmpfs:
    - /tmp/chromium-profile:uid=1000,gid=1000,mode=0700
  volumes:
    - downloads:/downloads
  networks:
    cdp: {}
    egress: {}

services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_USER: owner
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}
      POSTGRES_DB: mastertutor
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U owner -d mastertutor"]
      interval: 2s
      timeout: 3s
      retries: 30
    networks:
      - backend

  garage:
    image: dxflrs/garage:v2.3.0
    restart: unless-stopped
    environment:
      GARAGE_RPC_SECRET: ${GARAGE_RPC_SECRET:?set GARAGE_RPC_SECRET}
      GARAGE_ADMIN_TOKEN: ${GARAGE_ADMIN_TOKEN:?set GARAGE_ADMIN_TOKEN}
    volumes:
      - ./infra/garage/garage.toml:/etc/garage.toml:ro
      - garage-meta:/var/lib/garage/meta
      - garage-data:/var/lib/garage/data
    healthcheck:
      test: ["CMD", "/garage", "status"]
      interval: 2s
      timeout: 5s
      retries: 30
    networks:
      - backend

  garage-init:
    <<: *node-runtime
    restart: "no"
    command: ["node", "packages/storage/src/bin/garage-init.ts"]
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
      GARAGE_ADMIN_URL: http://garage:3903
      GARAGE_ADMIN_TOKEN: ${GARAGE_ADMIN_TOKEN:?set GARAGE_ADMIN_TOKEN}
      S3_BUCKET: mastertutor
      S3_WEB_ACCESS_KEY_ID: ${S3_WEB_ACCESS_KEY_ID:?set S3_WEB_ACCESS_KEY_ID}
      S3_WEB_SECRET_ACCESS_KEY: ${S3_WEB_SECRET_ACCESS_KEY:?set S3_WEB_SECRET_ACCESS_KEY}
      S3_AGENT_ACCESS_KEY_ID: ${S3_AGENT_ACCESS_KEY_ID:?set S3_AGENT_ACCESS_KEY_ID}
      S3_AGENT_SECRET_ACCESS_KEY: ${S3_AGENT_SECRET_ACCESS_KEY:?set S3_AGENT_SECRET_ACCESS_KEY}
    depends_on:
      garage:
        condition: service_healthy

  migrate:
    <<: *node-runtime
    restart: "no"
    command: ["node", "packages/db/src/bin/migrate.ts"]
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
      DATABASE_URL: postgres://owner:${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}@postgres:5432/mastertutor
      WEB_DB_PASSWORD: ${WEB_DB_PASSWORD:?set WEB_DB_PASSWORD}
      AGENT_DB_PASSWORD: ${AGENT_DB_PASSWORD:?set AGENT_DB_PASSWORD}
      BROWSER_SLOTS: ${BROWSER_SLOTS:-browser-1,browser-2,browser-3,browser-4,browser-5,browser-6}
    depends_on:
      postgres:
        condition: service_healthy

  web:
    image: mastertutor/web:local
    build:
      context: .
      target: web
    restart: unless-stopped
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
      DATABASE_URL: postgres://web_role:${WEB_DB_PASSWORD:?set WEB_DB_PASSWORD}@postgres:5432/mastertutor
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${PUBLIC_URL:?set PUBLIC_URL}
      AUTH_SIGNUP_OPEN: ${AUTH_SIGNUP_OPEN:-0}
      VAULT_PUBLIC_KEY: ${VAULT_PUBLIC_KEY:?set VAULT_PUBLIC_KEY}
      NEKO_MEMBER_SECRET: ${NEKO_MEMBER_SECRET:?set NEKO_MEMBER_SECRET}
      LIVE_COOKIE_SECRET: ${LIVE_COOKIE_SECRET:?set LIVE_COOKIE_SECRET}
      TURN_SECRET: ${TURN_SECRET:?set TURN_SECRET}
      OPENAI_EMBEDDINGS_KEY: ${OPENAI_EMBEDDINGS_KEY:?set OPENAI_EMBEDDINGS_KEY}
      OPENAI_BASE_URL: ${OPENAI_BASE_URL:-}
      S3_ENDPOINT: http://garage:3900
      S3_REGION: garage
      S3_BUCKET: mastertutor
      S3_ACCESS_KEY_ID: ${S3_WEB_ACCESS_KEY_ID:?set S3_WEB_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_WEB_SECRET_ACCESS_KEY:?set S3_WEB_SECRET_ACCESS_KEY}
    healthcheck:
      <<: *node-health
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      garage-init:
        condition: service_completed_successfully
    networks:
      edge: {}
      backend: {}
      cdp:
        ipv4_address: ${CDP_SUBNET_PREFIX:-172.30.231}.11

  agent:
    <<: *node-runtime
    restart: unless-stopped
    command: ["node", "apps/agent/src/main.ts"]
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
      DATABASE_URL: postgres://agent_role:${AGENT_DB_PASSWORD:?set AGENT_DB_PASSWORD}@postgres:5432/mastertutor
      OPENAI_API_KEY: ${OPENAI_API_KEY:?set OPENAI_API_KEY}
      OPENAI_BASE_URL: ${OPENAI_BASE_URL:-}
      VAULT_PRIVATE_KEY: ${VAULT_PRIVATE_KEY:?set VAULT_PRIVATE_KEY}
      NEKO_ADMIN_SECRET: ${NEKO_ADMIN_SECRET:?set NEKO_ADMIN_SECRET}
      S3_ENDPOINT: http://garage:3900
      S3_REGION: garage
      S3_BUCKET: mastertutor
      S3_ACCESS_KEY_ID: ${S3_AGENT_ACCESS_KEY_ID:?set S3_AGENT_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_AGENT_SECRET_ACCESS_KEY:?set S3_AGENT_SECRET_ACCESS_KEY}
      BROWSER_SLOTS: ${BROWSER_SLOTS:-browser-1,browser-2,browser-3,browser-4,browser-5,browser-6}
      AGENT_TEST_MODE: ${AGENT_TEST_MODE:-0}
      AGENT_HEALTH_PORT: "8787"
    volumes:
      - downloads:/downloads
    healthcheck:
      <<: *node-health
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8787/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      garage-init:
        condition: service_completed_successfully
    networks:
      backend: {}
      cdp:
        ipv4_address: ${CDP_SUBNET_PREFIX:-172.30.231}.10

  browser-1:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-1
      NEKO_WEBRTC_UDPMUX: "59001"
      NEKO_WEBRTC_TCPMUX: "59001"
    ports: ["59001:59001/udp", "59001:59001/tcp"]

  browser-2:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-2
      NEKO_WEBRTC_UDPMUX: "59002"
      NEKO_WEBRTC_TCPMUX: "59002"
    ports: ["59002:59002/udp", "59002:59002/tcp"]

  browser-3:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-3
      NEKO_WEBRTC_UDPMUX: "59003"
      NEKO_WEBRTC_TCPMUX: "59003"
    ports: ["59003:59003/udp", "59003:59003/tcp"]

  browser-4:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-4
      NEKO_WEBRTC_UDPMUX: "59004"
      NEKO_WEBRTC_TCPMUX: "59004"
    ports: ["59004:59004/udp", "59004:59004/tcp"]

  browser-5:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-5
      NEKO_WEBRTC_UDPMUX: "59005"
      NEKO_WEBRTC_TCPMUX: "59005"
    ports: ["59005:59005/udp", "59005:59005/tcp"]

  browser-6:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-6
      NEKO_WEBRTC_UDPMUX: "59006"
      NEKO_WEBRTC_TCPMUX: "59006"
    ports: ["59006:59006/udp", "59006:59006/tcp"]

networks:
  edge: {}
  backend: {}
  egress: {}
  cdp:
    internal: true
    ipam:
      config:
        - subnet: ${CDP_SUBNET_PREFIX:-172.30.231}.0/24
          ip_range: ${CDP_SUBNET_PREFIX:-172.30.231}.128/25

volumes:
  pgdata: {}
  garage-meta: {}
  garage-data: {}
  downloads: {}
```

- [ ] **Step 6: Write the test overlay and the Traefik routes.**

`compose.test.yml`:
```yaml
# Test overlay. Run: pnpm compose:test up -d --build --wait
# Production Traefik is Dokploy's; B6 adds the per-slot /live routers.
services:
  traefik:
    image: traefik:v3.7.13
    command:
      - --entrypoints.web.address=:80
      - --providers.file.filename=/etc/traefik/dynamic.yml
      - --ping=true
      - --log.level=WARN
    volumes:
      - ./infra/traefik/test-dynamic.yml:/etc/traefik/dynamic.yml:ro
    ports:
      - "127.0.0.1:${TEST_HTTP_PORT:-18080}:80"
    healthcheck:
      test: ["CMD", "traefik", "healthcheck", "--ping"]
      interval: 2s
      timeout: 3s
      retries: 30
    depends_on:
      web:
        condition: service_healthy
    networks:
      edge: {}
      cdp:
        ipv4_address: ${CDP_SUBNET_PREFIX:-172.30.231}.12

  # Phase 0 runs a single slot to save memory and disk. Later E2E phases re-enable browser-2.
  browser-2:
    profiles: !override ["extra-slots"]
  browser-3:
    profiles: !override ["extra-slots"]
  browser-4:
    profiles: !override ["extra-slots"]
  browser-5:
    profiles: !override ["extra-slots"]
  browser-6:
    profiles: !override ["extra-slots"]
```

`infra/traefik/test-dynamic.yml`:
```yaml
http:
  routers:
    web:
      rule: PathPrefix(`/`)
      entryPoints: [web]
      service: web
  services:
    web:
      loadBalancer:
        servers:
          - url: http://web:3000
```

- [ ] **Step 7: Run the tests to verify they pass.**

Run: `pnpm test -- scripts && pnpm test:int -- tests/compose && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS. If `format:check` fails on YAML, run `pnpm format`, keep the `!override` tags, and rerun.

Run: `pnpm env:init`
Expected:
- it prints only key names;
- `set by hand: OPENAI_EMBEDDINGS_KEY` appears if that key is not set yet;
- **do not open or print `.env`.**

Run: `pnpm compose:test build`
Expected: three images build.

Then reclaim disk: `docker builder prune -f`.

- [ ] **Step 8: Commit.**

```bash
git add Dockerfile .dockerignore compose.yml compose.test.yml infra/traefik .env.example .env.test scripts tests package.json pnpm-lock.yaml
git commit -m "feat(infra): Compose topology with isolated networks and six slots, test overlay with Traefik, env tooling"
```

---

### Task 16: Phase 0 smoke test (the "done when" check)

**Files:**
- Create: `scripts/compose-smoke.sh`
- Modify: `package.json`, adding the script `"smoke": "bash scripts/compose-smoke.sh"`

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm smoke`. It exits 0 only when the spec §16 Phase 0 exit holds: the stack is healthy and slot CDP is reachable only from `agent`. `KEEP_STACK=1` leaves the stack running.

- [ ] **Step 1: Write the smoke script.**

`scripts/compose-smoke.sh`:
```bash
#!/usr/bin/env bash
# Phase 0 smoke test. It boots the stack with the test overlay and checks that:
#   - every service is healthy and the one-shots succeeded;
#   - migrations applied;
#   - auth works through Traefik;
#   - slot CDP is reachable only from the agent;
#   - the slot cannot reach backend services.
# Usage: bash scripts/compose-smoke.sh   (KEEP_STACK=1 leaves the stack running)
set -euo pipefail
cd "$(dirname "$0")/.."

DC=(docker compose --env-file .env.test -f compose.yml -f compose.test.yml)
PORT="$(grep -E '^TEST_HTTP_PORT=' .env.test | cut -d= -f2)"
BASE="http://localhost:${PORT:-18080}"

cleanup() { if [[ "${KEEP_STACK:-0}" != "1" ]]; then "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
fail() { echo "SMOKE FAIL: $*" >&2; "${DC[@]}" ps -a >&2 || true; "${DC[@]}" logs --tail=60 >&2 || true; exit 1; }
pass() { echo "ok - $*"; }
psql_value() { "${DC[@]}" exec -T postgres psql -U owner -d mastertutor -tAc "$1"; }
signup() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/sign-up/email" \
    -H 'Content-Type: application/json' -H "Origin: $BASE" \
    -d "{\"email\":\"$1\",\"password\":\"correct-horse-battery-staple\",\"name\":\"Smoke\"}"
}

"${DC[@]}" up -d --build --wait --wait-timeout 300 || fail "stack did not become healthy"
pass "stack healthy"

for svc in migrate garage-init; do
  id="$("${DC[@]}" ps -a -q "$svc")"
  [[ "$(docker inspect -f '{{.State.ExitCode}}' "$id")" == "0" ]] || fail "$svc did not exit 0"
done
pass "migrate and garage-init completed"

[[ "$(psql_value "select count(*) from browser_slots")" == "1" ]] || fail "browser_slots not synced to BROWSER_SLOTS"
[[ "$(psql_value "select count(*) from pg_extension where extname = 'vector'")" == "1" ]] || fail "pgvector missing"
pass "migrations applied"

curl -fsS "$BASE/healthz" | grep -q '"status":"ok"' || fail "web /healthz through Traefik"
pass "web healthy through Traefik"

[[ "$(signup owner@example.test)" == "200" ]] || fail "first sign-up"
[[ "$(signup intruder@example.test)" == "403" ]] || fail "sign-up stayed open after the first user"
[[ "$(psql_value "select role from workspace_members")" == "owner" ]] || fail "owner workspace not created"
pass "Better Auth sign-up and workspace bootstrap"

"${DC[@]}" exec -T agent node -e "fetch('http://127.0.0.1:8787/healthz').then(async (r) => { const b = await r.json(); process.exit(r.ok && b.status === 'ok' ? 0 : 1); }, () => process.exit(1))" \
  || fail "agent /healthz"
pass "agent healthy (db + storage)"

"${DC[@]}" exec -T agent node apps/agent/src/bin/probe-slot.ts browser-1 | grep -q '"browser":"Chrome/' \
  || fail "agent cannot reach slot CDP"
pass "slot CDP reachable from agent"

"${DC[@]}" exec -T web node -e "const s = require('node:net').connect(9223, 'browser-1'); s.setTimeout(3000); s.on('connect', () => process.exit(1)); s.on('timeout', () => process.exit(0)); s.on('error', () => process.exit(0));" \
  || fail "slot CDP reachable from web"
pass "slot CDP blocked for web"

"${DC[@]}" exec -T web node -e "fetch('http://browser-1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
  || fail "web cannot reach n.eko"
pass "n.eko reachable from web"

"${DC[@]}" exec -T browser-1 curl -s -m 3 -o /dev/null http://web:3000/healthz && fail "slot reached web:3000"
"${DC[@]}" exec -T browser-1 curl -s -m 3 -o /dev/null http://169.254.169.254/ && fail "slot reached the metadata address"
"${DC[@]}" exec -T browser-1 getent hosts postgres >/dev/null && fail "slot resolves postgres (must not share backend)"
pass "slot cannot reach web, metadata or backend"

for port in 9223 8080; do
  if "${DC[@]}" port browser-1 "$port" 2>/dev/null | grep -q ':[1-9]'; then fail "port $port published on the host"; fi
done
pass "CDP and n.eko not published on the host"

echo "SMOKE OK"
```

Add `"smoke": "bash scripts/compose-smoke.sh"` to the root `package.json` scripts.

- [ ] **Step 2: Run the smoke test.**

Run: `pnpm smoke`
Expected: about 13 `ok - …` lines, then `SMOKE OK`. The first run builds the images, which takes several minutes.

- **If `garage-init` fails** with a Garage RPC error, check the garage logs, then `pnpm compose:test down -v` and retry.
- **If `browser-1` never becomes healthy:**
  1. Run `pnpm compose:test logs browser-1`.
  2. "No usable sandbox" or a namespace error means the host blocks user namespaces. Run `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`; this applies on Linux only, not Docker Desktop.
  3. Never add `--no-sandbox`.

- [ ] **Step 3: Reclaim disk.**

Run: `docker builder prune -f && docker image prune -f && df -h / | tail -1`
Expected: free space is at least about 12 GB.

- [ ] **Step 4: Commit.**

```bash
git add scripts/compose-smoke.sh package.json
git commit -m "test(infra): Phase 0 smoke test for stack health, auth, and slot CDP isolation"
```

---

### Task 17: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the scripts `format:check`, `lint`, `typecheck`, `test`, `test:int` and `smoke`, plus `apps/browser-slot/test/verify.sh`.
- Produces three CI jobs, `checks`, `integration` and `compose-smoke`, each named so branch protection can require it. Later phases append E2E, security and visual jobs.

- [ ] **Step 1: Write the workflow.**

`.github/workflows/ci.yml`:
```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    name: Lint, typecheck, unit tests, audit
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm audit --prod --audit-level high

  integration:
    name: Integration tests (Testcontainers)
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:int

  compose-smoke:
    name: Browser slot + Compose smoke
    runs-on: ubuntu-24.04
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4
      - name: Allow unprivileged user namespaces (Chromium sandbox inside the slot)
        run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
      - run: bash apps/browser-slot/test/verify.sh
      - run: bash scripts/compose-smoke.sh
```

- [ ] **Step 2: Validate locally.**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm audit --prod --audit-level high`
Expected: PASS.
- **If `pnpm audit` flags a high or critical advisory with no fixed version,** add it under `pnpm.auditConfig.ignoreGhsas` in the root `package.json` with a comment-style justification in the commit message, and report it to the orchestrator.
- **Do not disable the audit step.**

Run: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -color` (optional)
Expected: no findings. Skip this if pulling the image would push free disk below 12 GB.

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint, typecheck, unit, audit, Testcontainers integration, slot verify and compose smoke"
```

---

## Notes for later phases (decisions made here that they must follow)

1. **CDP by IP (B1).** Use `slotCdpBaseUrl(name)` from `apps/agent/src/slots/probe.ts` for `chromium.connectOverCDP`. Chrome rejects hostname `Host` headers.
2. **Fixtures egress (B1).** Slots reject all private-range egress. To let a slot reach `fixtures` in tests, set `SLOT_EGRESS_ALLOW_CIDRS` in `compose.test.yml` to the fixtures network's subnet. Pin that subnet in the overlay.
3. **PulseAudio (B4).** The slot already reserves 4713 for the agent IP. B4 adds `load-module module-native-protocol-tcp auth-ip-acl=<agent IP>`.
4. **Live view (B6).** It owns:
   - the per-slot Traefik routers, both in the test file provider and as production Dokploy labels;
   - ForwardAuth, the `live_slot` cookie and TURN.

   Traefik's `cdp` address is fixed at `.12`, and slots accept n.eko only from `.11` and `.12`. In production, Dokploy's Traefik must join `cdp` at `.12`, or B6 extends `NEKO_ALLOWED_IPS`.
5. **Presigned URLs.** Garage is internal-only, so a presigned URL points at `garage:3900`. B2/F2 must either proxy object reads through `web` or add an explicit public S3 endpoint. Decide this in B2.
6. **Search on block text (B2).** `notes.search` covers the title and lede only, per spec §4. If B2 needs full-text search over block text, add a generated `tsvector` on `note_blocks` in a new migration.
7. **Production hosts.** Ubuntu 24.04+ needs `kernel.apparmor_restrict_unprivileged_userns=0` for the slot sandbox. Phase 9 deploy must persist it, for example in `/etc/sysctl.d/99-mastertutor.conf`.
8. **New tables.** `grants.sql` grants every new table to both roles by default, except the listed exceptions. A table with sealed or auth data must be added to the exception lists in the same migration PR.
9. **Not in Phase 0.** `docling` (B5) and `coturn` (B6) are not in Compose yet. No animation, UI or React Bits dependencies are installed; those start in F1.

---

## Self-Review

**1. Spec coverage, Phase 0 row of §16 ("monorepo, contracts, db + roles, storage, Compose with networks and Traefik, `browser-slot` image, CI, Better Auth, `.env` loading"; done when "Stack boots; slot CDP is reachable only from `agent`"):**

| Requirement | Task(s) |
|---|---|
| pnpm monorepo, TypeScript, ESLint, Prettier, Vitest | 1 |
| Contracts, all of §6: 7 tools, `RunStatus`, `RunEvent` (+`slot`, `model_fallback`), `ApprovalRequest`, `AgentTurn`, `NoteBlock`, `Anchor`, oRPC router, env per service | 1–6 |
| Live-view contracts adapted to n.eko (`OpenLiveResult`, cookie name, members, paths) | 4 |
| Benchmark mode: `approvalMode`, the auto policy, `decided_by='policy'`, benchmark DTOs | 1, 3, 6 |
| DB: all §4 tables + `browser_slots`, `downloads`, `runs.slot_name`, `runs.controller`, `approval_mode`, `benchmarks`, `benchmark_runs`; drizzle-zod | 7 |
| Migrations: pgvector, generated `tsvector`, HNSW, `vault_audit` trigger, folder depth/cycle rules, grants for `web_role`/`agent_role` | 8 |
| Single-workspace bootstrap and the concurrency ≤ slots rule | 9, 12 |
| Storage: Garage wrapper, bucket and key init, read-only web key | 10, 11 |
| `browser-slot` image: n.eko, headed sandboxed Chromium, socat, policies, HMAC member passwords, iptables isolation, restart-to-fresh | 14 |
| Compose: networks, static `cdp` IPs, six slots via anchor, migrate and garage-init one-shots, healthchecks; test overlay with Traefik and one slot | 15 |
| Better Auth in Next.js 16 and `/healthz`; agent `/healthz` | 12, 13 |
| `.env` loading (`env:init`, `.env.example`, `.env.test`, Compose `.env`) | 15 |
| "Done when" check | 16 |
| CI | 17 |

Remaining items (§16 B/F phases, docling, coturn, motion lint) are explicitly out of scope and listed in the notes above.

**2. Placeholder scan.** No "TBD", "add validation" or "similar to Task N". Every code step has full code. The only non-literal content is drizzle-kit's generated `0001_init.sql`, which is produced by a command and checked with a `grep -c` of 27 `CREATE TABLE`s.

**3. Type and name consistency:**
- `runs.controller` is used consistently: schema, DTO `controller`, `CONTROLLERS`, and events `control.holder`.
- `ensureWorkspaceMember`, `hasAnyUser`, `getMaxConcurrency`, `listBrowserSlots` and `syncBrowserSlots` are defined in Tasks 8–9 and used in Tasks 12–13 with the same signatures.
- `deriveNekoPassword` matches the slot entrypoint (same test vector, checked in Tasks 5 and 14).
- `objectKeys` and `createStorage` are in Task 11; `startTestGarage` and `bootstrapGarage` are in Task 10 and consumed in Task 11.
- `TEST_ROLE_PASSWORDS` is in Task 8 and used in Task 8's tests.
- `.env.test` values satisfy `DbPassword`, `GarageKeyId`, `GarageSecret`, `Base64Key32` and `Secret` (≥ 32). Task 15's compose-config test asserts this through `parseEnv`.

**4. Review Focus mapping:**

| # | Concern | Test |
|---|---|---|
| 1 | Origins | Task 1, `primitives.test.ts` |
| 2 | Env errors never echo values | Task 5, `env.test.ts` |
| 3 | First sign-up race, closed sign-up | Task 9, `queries.int.test.ts`; Task 13, `auth.int.test.ts`; Task 16 smoke (403) |
| 4 | Slot profile reset | Task 14, `verify.sh` marker check |
| 5 | Untrusted filenames | Task 11, `keys.test.ts` |

Also covered:
- risky labels in full-width or zero-width text (Task 3);
- folder names with `/` (Tasks 1 and 8);
- NOTIFY size and extra keys (Task 4);
- deleting a vault item with audit history (Task 8).

**5. Recorded deviations from the spec:**
1. **DB row types.** These are exported from `@mastertutor/db`, not re-exported through contracts. Re-exporting would create a contracts↔db cycle (CLAUDE.md principle 5).
2. **`notes.run_id` and `vault_audit`** have no foreign keys, to avoid a module cycle and conflicts with the append-only trigger.
3. **Test slots.** `compose.test.yml` runs one slot in Phase 0, per orchestrator amendment 2. The spec's E2E layer re-enables `browser-2`.
4. **Chromium sandbox profile.** The sandbox needs a custom seccomp profile, generated from moby/profiles v0.2.4 plus the namespace syscalls. This satisfies spec §13 "Chromium sandbox on" without `CAP_SYS_ADMIN`.
