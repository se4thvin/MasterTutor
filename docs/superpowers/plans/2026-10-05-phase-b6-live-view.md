# Phase B6: Live View Implementation Plan

> **D36 (supersedes this plan):** OPENAI_EMBEDDINGS_KEY is removed; web uses OPENAI_API_KEY for query embeddings.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the n.eko live view and the takeover control lock. The work covers:
- server-side n.eko login in `runs.openLive`, which returns a signed `live_slot` cookie and TURN credentials;
- `/api/live/auth` ForwardAuth, with per-slot Traefik routers in both the test file provider and the production label form;
- the code-owned control lock: `takeControl`, `handBack`, `NOTIFY run_control`, abort, n.eko give/take, the clipboard toggle and the 15-minute idle hand-back;
- user uploads through n.eko `upload/dialog` and `upload/drop`;
- downloads that go through CDP into Garage and end in `download_ready`;
- the coturn profile;
- the §12 live-view auth, takeover-lock and SSRF tests.

**Architecture:**
- **`web` handles the browser-facing side.**
  - `openLive` logs into the slot's n.eko as the `user` member server-side. It returns HttpOnly cookies scoped to `/live/<runId>/`: the n.eko session token, plus `live_slot`, which is HMAC-signed and bound to slot, run, user and expiry.
  - Traefik picks the slot router from the `live_slot` cookie prefix.
  - ForwardAuth checks the session, the signature, the lease and workspace membership. It then rewrites the upstream `Cookie` header to carry only `NEKO_SESSION`.
- **`agent` handles control.** It LISTENs on `run_control` and serializes control transitions per run. On takeover it sets the B1 session guard, aborts the run's signal and drives n.eko's admin REST API. A per-slot X idle probe (`xprintidle`) drives the 15-minute auto hand-back.
- **`downloads`.** Downloads use CDP `Browser.setDownloadBehavior`, write to the shared `downloads` volume, then go into Garage.

**Tech Stack:**
- n.eko `ghcr.io/m1k1o/neko/chromium:3.1.6` (legacy embedded client), Traefik v3.7.13 (file provider in tests, Docker labels in production), coturn `coturn/coturn:4.18.0-alpine`.
- Node 24, Zod 4.6.5, postgres.js 3.4.9, Drizzle 0.45.3, `@orpc/server` 1.15.4, `playwright-core` 1.63.0 (CDP only), Vitest 5.0.3, and Testcontainers-style Docker CLI helpers.

**Spec:** `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` (§10, §12, §13, §16 row B6). Decisions D1–D35 in `orchestration/STATE.md` override the spec. `CLAUDE.md` is mandatory. `docs/superpowers/plans/2026-10-05-phase-0-foundations.md` is the source of truth for every name used here. Research: `orchestration/runs/2026-10-05-15-research-webrtc-live-view/report.md`. Executors read all of these.

---

## Planning-time verification (read from n.eko v3.1.6 sources and the pulled image on 2026-10-05; do not re-litigate)

1. **The embedded client is n.eko's legacy (v2-protocol) client.** `/var/www/js/app.*.js` opens `…/ws?password=…&username=…`.
   - The legacy `/ws` route exists only when `legacy` is set (`server/internal/http/legacy`, `cmd/root.go`). The Phase 0 image leaves it unset, so **the embedded client cannot connect today**. Task 3 sets `NEKO_LEGACY=true`.
2. **The legacy handler authenticates with the incoming `Cookie` header first.** `session.create()` calls `GET /api/whoami` with the request's `Cookie` and ignores the password if that succeeds.
   - With `NEKO_SESSION_COOKIE_ENABLED=true`, our relayed `NEKO_SESSION` cookie therefore authenticates the iframe. The browser never holds a password.
   - The client auto-connects only when `?usr=…&pwd=…` are present, so the embed URL carries the placeholders `usr=user&pwd=cookie`. These are not credentials.
   - With cookies enabled, the legacy password fallback cannot succeed (`token not found`), so `/ws` password logins are impossible.
3. **On WebSocket close, the legacy handler calls `POST /api/logout`.** Every iframe connect therefore needs a fresh `openLive`.
4. **Login conflicts.** `POST /api/login` returns **422** if that member's session is currently connected. Otherwise it deletes and recreates the session.
5. **Sessions are keyed by member.** With the `object` member provider, the session id equals the username (`agent`, `user`).
6. **Login responses.** With cookies enabled, `POST /api/login` returns the token **only** in `Set-Cookie: NEKO_SESSION=…`. Auth reads the cookie first, then `Authorization: Bearer`, then `?token=`.
7. **Admin routes.**
   - `POST /api/room/control/take` and `/reset` are admin-only.
   - `POST /api/room/control/give/{sessionId}` returns 404 if the target session is missing and 400 if the target lacks `can_host`.
   - All `/api/room/control/*` routes need `can_host` (otherwise 403).
   - `POST /api/members/{id}` merges a partial profile and also updates the live session.
   - Clipboard routes need `can_access_clipboard` and host status.
8. **Uploads.** `POST /api/room/upload/dialog` (multipart field `files`) answers 422 when no "Open File" dialog is open. It and `upload/drop` (with `x`, `y`) require the caller to be host. The legacy client has no upload UI, so our page posts directly.
9. **ICE servers.** These come only from static config (`webrtc.iceservers.frontend`). Per-session ICE from `web` is impossible with the embedded client, so the spec §15 fallback applies: the slot mints a TURN credential at boot.
10. **The image.** It is Debian 13. `xprintidle` (0.3.0) is installable. `xdotool` is present and uses XTest, which is the same path n.eko uses for user input.
11. **Hosting rules.** `session.implicit_hosting` defaults to false. A non-host's input never reaches X (the WebRTC input handler checks `IsHost()`).

---

## Global Constraints

Every task implicitly includes all of these.

**Toolchain** (Phase 0 Global Constraints apply unchanged)
- Node ≥ 24.4, pnpm 10.34.6, TypeScript 6.0.3, Zod 4.6.5, Vitest 5.0.3. Exact versions only.
- New pins: `@orpc/server` 1.15.4 (web), `playwright-core` 1.63.0 (agent; reuse it if B1 already added it), `coturn/coturn:4.18.0-alpine`, `curlimages/curl:8.22.0`.
- ESM. Relative imports carry `.ts`. No `enum`, `namespace` or parameter properties. Use `import type`.

**Names and contracts**
- Use Phase 0 names exactly: `runs.controller`, `browser_slots`, `RunEvent`, `encodeNotify`/`decodeNotify`, `deriveNekoPassword`, `objectKeys`, `createStorage`, `startTestDatabase`, `createDb`/`DbHandle`.
- Every new constant lives once in `@mastertutor/contracts`.

**Live-view values**

| Item | Value |
|---|---|
| Cookies | `live_slot` (`browser-N.<exp>.<hmac>`) and `NEKO_SESSION`. Both are `Path=/live/<runId>/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict` |
| TURN | Per-run TTL 600 s (from `openLive`). Slot boot credential TTL 86400 s. Username `<expiry>:<label>`, credential base64 HMAC-SHA1 |
| Takeover | Abort target ≤ 300 ms. Auto hand-back after 15 min of X idle |
| Slot ports | CDP 9223, idle probe **9224**, PulseAudio 4713 (agent IP only). n.eko 8080 (web `.11` and Traefik `.12` only). Media 5900N |
| Embed path | `/live/<runId>/?embed=1&usr=user&pwd=cookie` |
| Traefik rule | `Host(\`<host>\`) && PathRegexp(\`^/live/[0-9a-f-]{36}/\`) && HeaderRegexp(\`Cookie\`, \`(?:^\|;\s*)live_slot=browser-N\.\`)` |
| Traefik middlewares | `live-auth` (ForwardAuth, `authResponseHeaders: Cookie`), then `live-strip` (`^/live/[0-9a-f-]{36}`) |

**Security**
- Never log, print or put in an error message any n.eko password, n.eko token, TURN secret or `live_slot` value.
- Error messages name the HTTP status and path only, never the response body.
- The model never sees clipboard contents, and no model screenshots are taken while `controller='user'` (B1 guard).

**Process**
- Commit at the end of each task, on the current branch. Never push.
- End each commit message with the attribution lines your session's system reminder specifies.
- Disk is about 19 GB free. After any image build, run `docker builder prune -f && docker image prune -f`. Never `docker system prune -a`.
- Never `cat` or print the root `.env`. `.env.test` holds dummy values only.

## Review Focus

These are the five failure modes most likely to bite a real user that the spec does not spell out. Each has a test in the owning task.

1. **Duplicate `live_slot` cookies.** Example: one valid cookie for `browser-1` plus a forged `live_slot=browser-2.x`. Traefik could route to `browser-2` while ForwardAuth validated `browser-1`. Any request with more than one `live_slot` cookie must be rejected with 401. *Tests: Task 6 `authorize.test.ts`; Task 12 stack test.*
2. **Reloading the run view or opening a second tab.** `openLive` while the `user` n.eko session is still connected must give a clean `CONFLICT` (`in_use`), never a 500. After the old tab's socket closes, the next `openLive` must succeed. *Test: Task 5 `open-live.int.test.ts`.*
3. **A takeover click before the iframe's n.eko session exists.** Control must return to the agent within about 2 s, with an `error {code:"takeover_failed"}` and a `control {holder:"agent"}` event. The run must never be left `controller='user'` with the agent paused and no input path. *Test: Task 8 `control.int.test.ts`.*
4. **Downloads that finish before the approval lookup resolves**, such as tiny `data:` files. They must never be ingested without approval and never left on disk. *Test: Task 9 `downloads.int.test.ts`.*
5. **Rapid takeover → hand back → takeover double-clicks.** Transitions must be serialized per run. The final n.eko host, session guard, DB `controller` and last `control` event must all agree. *Test: Task 8 `control.int.test.ts`.*

---

## B1 seam (what B6 consumes from B1, and what B1 must do)

B6 code depends only on the interfaces in `apps/agent/src/live/ports.ts` (Task 8). One file, `apps/agent/src/live/b1-adapters.ts` (Task 13), binds them to B1. If B1's names differ, change only that file and the binding block in `main.ts`.

| B1 export (assumed path) | Assumed shape | B6 use |
|---|---|---|
| `BrowserSession` (`apps/agent/src/browser/session.ts`) | `readonly browser: Browser` (playwright-core), `readonly page: Page`, `setController(holder: Controller): void`, `computer(action: ComputerAction, signal: AbortSignal): Promise<void>`, `screenshotForModel(): Promise<Uint8Array>`, `close(): Promise<void>` | `LiveSessionPort` (`setController`, `newBrowserCdpSession`); Task 13 test |
| `ControlHeld` (same file) | `class ControlHeld extends Error` | Task 13 test |
| `openBrowserSession` (same file) | `(o: {runId: string; slotName: string; allowedOrigins: string[]; controller: Controller}) => Promise<BrowserSession>` | Task 13 test |
| `AbortRegistry` (`apps/agent/src/loop/aborts.ts`) | `signal(runId): AbortSignal`, `abort(runId, reason): void`, `renew(runId): AbortSignal` | `AbortPort` |
| `requestApproval` (`apps/agent/src/loop/approvals.ts`) | `(sql, runId, request: ApprovalRequest) => Promise<PolicyDecision>`. It inserts `approvals`, applies `decideByPolicy` and sets `waiting(approval)` when the decision is `ask` | `ApprovalPort` (downloads) |
| `SlotPool` (`apps/agent/src/slots/pool.ts`) | `lease(runId, priority)`, `release(slot)`, `Slot {name}` | Not called by B6 code. B1 owns the wake-priority lease test |
| Run host lifecycle | B1's run host accepts `hooks: { afterLease(lease), beforeRelease(lease) }` | Calls `LiveRuntime.afterLease` / `beforeRelease` |

**B1 behaviours B6 relies on** (listed again under Notes for later phases):
1. **`afterLease` timing.** Call it after the BrowserSession is open and **before** restore. Call `beforeRelease` before `Browser.close`.
2. **The session guard.** The BrowserSession initializes its guard from `runs.controller`. While it is `user`, `Input.*` and model screenshots throw `ControlHeld`. Navigation is not guarded. The loop parks on `ControlHeld` without calling the model.
3. **Waking a leased run.** `NOTIFY run_wake {runId, reason:"resume"}` for a run this agent holds and that is `running` must restart its loop with a re-observe.
4. **No sleep under user control.** A run never sleeps while `controller='user'`.
5. **`run_control` belongs to B6.** B6 owns the `run_control` LISTEN; B1 must not also act on it.

---

## File Structure

```
packages/contracts/src/
  live.ts                (modify) cookie/embed/regex/rule helpers, TTLs, takeover constants
  constants.ts           (modify) SLOT_IDLE_PORT
  events.ts              (modify) download_ready gains assetId
  env.ts                 (modify) TurnUrlList, WebEnv.TURN_URLS
  server/neko.ts         (modify) loginNeko, NekoLoginError, nekoTokenFromSetCookie
  server/turn.ts         (new)    mintTurnCredential, turnIceServers
  server/index.ts        (modify) export turn
packages/db/src/
  schema/runs.ts         (modify) runs.control_user_id + check
  queries/events.ts      (new)    appendRunEvent
  queries/live.ts        (new)    member/slot access, takeover/hand-back, agent control transitions
  queries/downloads.ts   (new)    approver lookup, asset dedupe, recordDownload
  index.ts               (modify) exports
packages/db/migrations/  (generated) NNNN_live_control_user.sql
apps/browser-slot/
  Dockerfile, bin/slot-entrypoint, supervisord/chromium.conf, test/verify.sh   (modify)
  bin/turn-ice, bin/slot-idle-http                                         (new)
  test/turn-ice.test.ts                                                    (new)
apps/agent/src/live/
  live-view.ts           LiveView + Slot (spec §10.1)
  neko-admin.ts          n.eko admin REST client (token cache, 401 re-login)
  neko-live-view.ts      NekoLiveView (the only LiveView)
  idle-probe.ts          slot X-idle probe client
  ports.ts               B1 seam interfaces
  control.ts             ControlCoordinator + run_control LISTEN
  downloads.ts           CDP download → Garage ingestor
  runtime.ts             composes the above for main.ts
  b1-adapters.ts         binds B1 exports to ports
apps/web/
  lib/server/live/{cookie,open-live,authorize,deps,procedures}.ts
  app/api/live/auth/route.ts
  lib/live/upload.ts     browser helper for n.eko uploads
infra/traefik/test-dynamic.yml (modify), infra/coturn/turnserver.conf (new)
compose.yml (modify), compose.live-test.yml (new), .env.example/.env.test (modify)
scripts/env-init.ts (modify), package.json (modify), .github/workflows/ci.yml (modify)
tests/support/{slot,live-seed,notify,wait,turn-probe}.ts (new)
tests/compose/compose-config.int.test.ts (modify), tests/compose/live-routes.int.test.ts (new)
tests/live/live-stack.int.test.ts (new)
```

---

### Task 1: Live-view contracts, TURN minting and the n.eko login helper

**Files:**
- Modify: `packages/contracts/src/live.ts`, `packages/contracts/src/constants.ts`, `packages/contracts/src/events.ts`, `packages/contracts/src/env.ts`, `packages/contracts/src/server/neko.ts`, `packages/contracts/src/server/index.ts`
- Create: `packages/contracts/src/server/turn.ts`
- Test: `packages/contracts/src/live.test.ts` (rewrite), `packages/contracts/src/events.test.ts` (one sample), `packages/contracts/src/env.test.ts` (append), `packages/contracts/src/server/turn.test.ts` (new), `packages/contracts/src/server/neko.test.ts` (append)

**Interfaces:**
- Consumes: Phase 0 `Uuid`, `SlotName`, `RunEvent`, `WebEnv`, `parseEnv`, `deriveNekoPassword`.
- Produces from `@mastertutor/contracts`:
  - **Constants:** `LIVE_SLOT_COOKIE`, `NEKO_SESSION_COOKIE = "NEKO_SESSION"`, `NEKO_MEMBERS`, `TURN_CREDENTIAL_TTL_SECONDS = 600`, `SLOT_TURN_CREDENTIAL_TTL_SECONDS = 86400`, `LIVE_COOKIE_TTL_SECONDS = 43200`, `AUTO_HAND_BACK_IDLE_MS = 900000`, `TAKEOVER_ABORT_TARGET_MS = 300`.
  - **Patterns:** `NEKO_EMBED_QUERY = "embed=1&usr=user&pwd=cookie"`, `LIVE_PATH_REGEX`, `LIVE_STRIP_REGEX`, `TURN_URL_PATTERN`.
  - **Functions:**
    - `livePath(runId)`;
    - `liveEmbedPath(runId)` (now with the query);
    - `runIdFromLivePath(uri): string | null`;
    - `liveSlotCookiePattern(slot): string`;
    - `liveRouterRule(slot, host): string`.
  - **Schemas:** `IceServer`, `OpenLiveResult` (the embed regex is updated), `TurnUrlList`, and `WebEnv.TURN_URLS: string[]`.
  - `SLOT_IDLE_PORT = 9224`.
  - `RunEvent` `download_ready` is now `{downloadId, assetId, filename, bytes}`.
- Produces from `@mastertutor/contracts/server`:
  - `mintTurnCredential(secret, label, nowSeconds, ttlSeconds): TurnCredential` (`{username, credential, expiresAt}`);
  - `turnIceServers(urls, secret, label, nowSeconds, ttlSeconds): IceServer[]`;
  - `loginNeko(o: {baseUrl, username, password, fetch?, timeoutMs?}): Promise<string>`;
  - `NekoLoginError` (`status`);
  - `nekoTokenFromSetCookie(headers: readonly string[]): string | null`.

- [ ] **Step 1: Write the failing tests.**

`packages/contracts/src/live.test.ts` (replace the whole file):
```ts
import { describe, expect, it } from "vitest";
import {
  LIVE_STRIP_REGEX,
  OpenLiveResult,
  liveEmbedPath,
  livePath,
  liveRouterRule,
  liveSlotCookiePattern,
  runIdFromLivePath,
} from "./live.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("live view contracts", () => {
  it("builds per-run paths with the legacy client's auto-connect placeholders", () => {
    expect(livePath(runId)).toBe(`/live/${runId}/`);
    expect(liveEmbedPath(runId)).toBe(`/live/${runId}/?embed=1&usr=user&pwd=cookie`);
    expect(() => livePath("../etc")).toThrow();
  });

  it("parses both openLive shapes and rejects other embed paths", () => {
    expect(OpenLiveResult.parse({ sleeping: true })).toEqual({ sleeping: true });
    const awake = OpenLiveResult.parse({
      sleeping: false,
      slotName: "browser-3",
      embedPath: liveEmbedPath(runId),
      iceServers: [{ urls: ["turn:turn.example.com:3478"], username: "1700000000:run", credential: "x" }],
    });
    expect(awake.sleeping).toBe(false);
    for (const embedPath of ["/admin", `/live/${runId}/?embed=1`, `/live/${runId}/?embed=1&usr=user&pwd=x`]) {
      expect(
        OpenLiveResult.safeParse({ sleeping: false, slotName: "browser-1", embedPath, iceServers: [] }).success,
        embedPath,
      ).toBe(false);
    }
  });

  it("extracts the run id from a forwarded URI", () => {
    expect(runIdFromLivePath(`/live/${runId}/`)).toBe(runId);
    expect(runIdFromLivePath(`/live/${runId}/api/ws?x=1`)).toBe(runId);
    expect(runIdFromLivePath(`/live/${runId}`)).toBeNull();
    expect(runIdFromLivePath("/live/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/")).toBeNull();
    expect(runIdFromLivePath("/api/auth/session")).toBeNull();
  });

  it("matches only an exact live_slot cookie for the given slot", () => {
    const pattern = new RegExp(liveSlotCookiePattern("browser-1"));
    expect(pattern.test("live_slot=browser-1.1700000000.sig")).toBe(true);
    expect(pattern.test("a=1; live_slot=browser-1.1700000000.sig")).toBe(true);
    expect(pattern.test("a=1;live_slot=browser-1.1.s")).toBe(true);
    expect(pattern.test("live_slot=browser-10.1700000000.sig")).toBe(false);
    expect(pattern.test("xlive_slot=browser-1.1700000000.sig")).toBe(false);
    expect(() => liveSlotCookiePattern("postgres")).toThrow();
  });

  it("renders the Traefik rule used by both the file provider and the labels", () => {
    expect(liveRouterRule("browser-2", "notes.example.com")).toBe(
      "Host(`notes.example.com`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\\s*)live_slot=browser-2\\.`)",
    );
    expect(LIVE_STRIP_REGEX).toBe("^/live/[0-9a-f-]{36}");
    expect(() => liveRouterRule("browser-1", "bad host`")).toThrow();
  });
});
```

In `packages/contracts/src/events.test.ts`, replace the `download_ready` sample line with:
```ts
      download_ready: {
        type: "download_ready",
        downloadId: id,
        assetId: id,
        filename: "a.pdf",
        bytes: 10,
      },
```

Append to `packages/contracts/src/env.test.ts`:
```ts
describe("WebEnv TURN_URLS", () => {
  const webSource = {
    DATABASE_URL: "postgres://web_role:pw@postgres:5432/mastertutor",
    BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:18080",
    VAULT_PUBLIC_KEY: "y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=",
    NEKO_MEMBER_SECRET: "neko-member-secret-for-tests-0123456789",
    LIVE_COOKIE_SECRET: "live-cookie-secret-for-tests-0123456789",
    TURN_SECRET: "turn-secret-for-tests-0123456789abcdef",
    OPENAI_EMBEDDINGS_KEY: "sk-test-not-a-real-key",
    S3_ENDPOINT: "http://garage:3900",
    S3_ACCESS_KEY_ID: "GK66316f1f1bd64a571eb1b439",
    S3_SECRET_ACCESS_KEY: "16b2df8b12b3996e4916bd7de64631b3aa2704355137354988fcc6ac4cb1ab82",
  };
  it("defaults to no TURN servers", () => {
    expect(parseEnv(WebEnv, webSource).TURN_URLS).toEqual([]);
    expect(parseEnv(WebEnv, { ...webSource, TURN_URLS: "" }).TURN_URLS).toEqual([]);
  });
  it("parses a comma-separated list of turn: and turns: URLs", () => {
    expect(
      parseEnv(WebEnv, {
        ...webSource,
        TURN_URLS: "turn:203.0.113.7:3478?transport=udp, turns:turn.example.com:5349",
      }).TURN_URLS,
    ).toEqual(["turn:203.0.113.7:3478?transport=udp", "turns:turn.example.com:5349"]);
  });
  it("rejects other schemes and quote characters", () => {
    expect(() => parseEnv(WebEnv, { ...webSource, TURN_URLS: "http://x" })).toThrow(EnvError);
    expect(() => parseEnv(WebEnv, { ...webSource, TURN_URLS: 'turn:x"y' })).toThrow(EnvError);
  });
});
```

`packages/contracts/src/server/turn.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mintTurnCredential, turnIceServers } from "./turn.ts";

const secret = "turn-secret-for-tests-0123456789abcdef";

describe("TURN REST credentials (coturn use-auth-secret)", () => {
  it("matches the openssl reference vector", () => {
    // printf '%s' '1700000600:browser-1' | openssl dgst -sha1 -hmac "$secret" -binary | openssl base64 -A
    expect(mintTurnCredential(secret, "browser-1", 1_700_000_000, 600)).toEqual({
      username: "1700000600:browser-1",
      credential: "LTokf8jxzfFBGkLVI9lEQmJEFIY=",
      expiresAt: 1_700_000_600,
    });
  });
  it("rejects weak secrets, odd labels and bad times", () => {
    expect(() => mintTurnCredential("short", "browser-1", 1, 600)).toThrow();
    expect(() => mintTurnCredential(secret, "a:b", 1, 600)).toThrow();
    expect(() => mintTurnCredential(secret, "browser-1", 1.5, 600)).toThrow();
    expect(() => mintTurnCredential(secret, "browser-1", 1, 0)).toThrow();
  });
  it("builds ICE servers only when URLs are configured", () => {
    expect(turnIceServers([], secret, "run", 1_700_000_000, 600)).toEqual([]);
    expect(turnIceServers(["turn:203.0.113.7:3478"], secret, "browser-1", 1_700_000_000, 600)).toEqual([
      { urls: ["turn:203.0.113.7:3478"], username: "1700000600:browser-1", credential: "LTokf8jxzfFBGkLVI9lEQmJEFIY=" },
    ]);
    expect(() => turnIceServers(["http://x"], secret, "run", 1, 600)).toThrow();
  });
});
```

Append to `packages/contracts/src/server/neko.test.ts`:
```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach } from "vitest";
import { NekoLoginError, loginNeko, nekoTokenFromSetCookie } from "./neko.ts";

describe("nekoTokenFromSetCookie", () => {
  it("finds the NEKO_SESSION value and ignores other cookies", () => {
    expect(nekoTokenFromSetCookie(["a=1; Path=/", "NEKO_SESSION=abcDEF123; Path=/; HttpOnly"])).toBe("abcDEF123");
    expect(nekoTokenFromSetCookie(["NEKO_SESSIONX=abc"])).toBeNull();
    expect(nekoTokenFromSetCookie(["NEKO_SESSION=bad value"])).toBeNull();
  });
});

describe("loginNeko", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function fakeNeko(handler: (body: string) => { status: number; headers?: Record<string, string>; body?: string }) {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const answer = req.url === "/api/login" && req.method === "POST" ? handler(body) : { status: 404 };
        res.writeHead(answer.status, answer.headers ?? {}).end(answer.body ?? "");
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it("returns the token from Set-Cookie", async () => {
    const baseUrl = await fakeNeko((body) => {
      expect(JSON.parse(body)).toEqual({ username: "user", password: "p4ss" });
      return { status: 200, headers: { "set-cookie": "NEKO_SESSION=tok123; Path=/; HttpOnly" }, body: '{"id":"user"}' };
    });
    expect(await loginNeko({ baseUrl, username: "user", password: "p4ss" })).toBe("tok123");
  });

  it("falls back to the body token when cookies are disabled", async () => {
    const baseUrl = await fakeNeko(() => ({ status: 200, body: '{"id":"agent","token":"body456"}' }));
    expect(await loginNeko({ baseUrl, username: "agent", password: "x" })).toBe("body456");
  });

  it("reports the status without echoing the password or the body", async () => {
    const baseUrl = await fakeNeko(() => ({ status: 422, body: "session already connected p4ss" }));
    const error = await loginNeko({ baseUrl, username: "user", password: "p4ss" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NekoLoginError);
    expect((error as NekoLoginError).status).toBe(422);
    expect((error as Error).message).not.toContain("p4ss");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- packages/contracts`
Expected: FAIL. `liveRouterRule`, `runIdFromLivePath`, `./turn.ts`, `loginNeko` and `TURN_URLS` are missing, and `download_ready` rejects `assetId`.

- [ ] **Step 3: Implement.**

`packages/contracts/src/live.ts` (replace the whole file):
```ts
import { z } from "zod";
import { SlotName, Uuid } from "./primitives.ts";

/** Signed cookie naming the slot for Traefik's per-slot routers (spec §10.2). */
export const LIVE_SLOT_COOKIE = "live_slot";
/** n.eko's session cookie name; web re-issues it scoped to /live/<runId>/. */
export const NEKO_SESSION_COOKIE = "NEKO_SESSION";
/** n.eko members in every slot; passwords are HMAC(secret, slotName). Session id = member id. */
export const NEKO_MEMBERS = { agent: "agent", user: "user" } as const;
/** Per-run TURN credentials returned by runs.openLive. */
export const TURN_CREDENTIAL_TTL_SECONDS = 600;
/** Boot-time TURN credential minted by the slot entrypoint (slots restart on every release). */
export const SLOT_TURN_CREDENTIAL_TTL_SECONDS = 86_400;
export const LIVE_COOKIE_TTL_SECONDS = 12 * 60 * 60;
/** Spec §5.1: takeover ends after 15 minutes with no user input. */
export const AUTO_HAND_BACK_IDLE_MS = 15 * 60 * 1000;
/** Spec §10.3: the in-flight action stops within this many ms of a takeover. */
export const TAKEOVER_ABORT_TARGET_MS = 300;
/**
 * n.eko 3.1.6 embeds its legacy client, which auto-connects only when usr/pwd are in the URL.
 * pwd is a placeholder: the legacy /ws handler authenticates with the NEKO_SESSION cookie first.
 */
export const NEKO_EMBED_QUERY = "embed=1&usr=user&pwd=cookie";
/** Traefik PathRegexp for live requests (Go RE2 and JS agree on this pattern). */
export const LIVE_PATH_REGEX = "^/live/[0-9a-f-]{36}/";
/** Traefik StripPrefixRegex: n.eko is served at / behind it. */
export const LIVE_STRIP_REGEX = "^/live/[0-9a-f-]{36}";
/** TURN URLs accepted from config; the slot's bash minting uses the same character class. */
export const TURN_URL_PATTERN = /^turns?:[A-Za-z0-9.:?=_-]+$/;

export function livePath(runId: string): string {
  return `/live/${Uuid.parse(runId)}/`;
}

export function liveEmbedPath(runId: string): string {
  return `${livePath(runId)}?${NEKO_EMBED_QUERY}`;
}

/** The run id from an X-Forwarded-Uri such as /live/<uuid>/api/ws, or null. */
export function runIdFromLivePath(uri: string): string | null {
  const match = /^\/live\/([0-9a-f-]{36})\//.exec(uri);
  if (!match) return null;
  const parsed = Uuid.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}

/** Cookie-header regex selecting one slot's router; the trailing "\." stops browser-1 matching browser-10. */
export function liveSlotCookiePattern(slotName: string): string {
  return `(?:^|;\\s*)${LIVE_SLOT_COOKIE}=${SlotName.parse(slotName)}\\.`;
}

/** The single source of the per-slot Traefik rule (test file provider and production labels). */
export function liveRouterRule(slotName: string, host: string): string {
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new TypeError("Invalid router host");
  return `Host(\`${host}\`) && PathRegexp(\`${LIVE_PATH_REGEX}\`) && HeaderRegexp(\`Cookie\`, \`${liveSlotCookiePattern(slotName)}\`)`;
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
    embedPath: z.string().regex(/^\/live\/[0-9a-f-]{36}\/\?embed=1&usr=user&pwd=cookie$/),
    iceServers: z.array(IceServer).max(4),
  }),
]);
export type OpenLiveResult = z.infer<typeof OpenLiveResult>;
```

`packages/contracts/src/constants.ts`: after `PULSE_TCP_PORT`, add:
```ts
/** Slot X-idle probe (xprintidle over socat); agent IP only. */
export const SLOT_IDLE_PORT = 9224;
```

`packages/contracts/src/events.ts`: replace the `download_ready` member with:
```ts
  z.object({
    type: z.literal("download_ready"),
    downloadId: Uuid,
    assetId: Uuid,
    filename: z.string().max(255),
    bytes: z.number().int().nonnegative(),
  }),
```

`packages/contracts/src/env.ts`:
- add `import { TURN_URL_PATTERN } from "./live.ts";` to the imports;
- add this after `SlotList`:
```ts
/** CSV of turn:/turns: URLs (spec §10.2 TURN profile); empty means no TURN. */
export const TurnUrlList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.string().regex(TURN_URL_PATTERN, "Expected turn: or turns: URLs")).max(4));
```
- in `WebEnv`, add `TURN_URLS: TurnUrlList,` directly after `TURN_SECRET: Secret,`.

`packages/contracts/src/server/turn.ts`:
```ts
import { createHmac } from "node:crypto";
import { TURN_URL_PATTERN, type IceServer } from "../live.ts";

const LABEL = /^[A-Za-z0-9-]{1,64}$/;

export interface TurnCredential {
  username: string;
  credential: string;
  expiresAt: number;
}

/**
 * coturn `use-auth-secret` credential: username "<expiry>:<label>", credential
 * base64(HMAC-SHA1(secret, username)). Same algorithm as apps/browser-slot/bin/turn-ice.
 */
export function mintTurnCredential(
  secret: string,
  label: string,
  nowSeconds: number,
  ttlSeconds: number,
): TurnCredential {
  if (secret.length < 32) throw new RangeError("TURN secrets must be at least 32 characters");
  if (!LABEL.test(label)) throw new TypeError("Invalid TURN credential label");
  if (!Number.isInteger(nowSeconds) || !Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new RangeError("TURN credential times must be integers and the TTL positive");
  }
  const expiresAt = nowSeconds + ttlSeconds;
  const username = `${expiresAt}:${label}`;
  return { username, credential: createHmac("sha1", secret).update(username).digest("base64"), expiresAt };
}

export function turnIceServers(
  urls: readonly string[],
  secret: string,
  label: string,
  nowSeconds: number,
  ttlSeconds: number,
): IceServer[] {
  if (urls.length === 0) return [];
  for (const url of urls) {
    if (!TURN_URL_PATTERN.test(url)) throw new TypeError("Invalid TURN URL");
  }
  const { username, credential } = mintTurnCredential(secret, label, nowSeconds, ttlSeconds);
  return [{ urls: [...urls], username, credential }];
}
```

Append to `packages/contracts/src/server/neko.ts`:
```ts
import { NEKO_SESSION_COOKIE } from "../live.ts";

const TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

export class NekoLoginError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`n.eko login failed (HTTP ${status})`);
    this.name = "NekoLoginError";
    this.status = status;
  }
}

export interface NekoLoginOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The NEKO_SESSION token from Set-Cookie headers, or null. */
export function nekoTokenFromSetCookie(headers: readonly string[]): string | null {
  for (const header of headers) {
    const pair = header.split(";")[0] ?? "";
    const index = pair.indexOf("=");
    if (index < 0 || pair.slice(0, index).trim() !== NEKO_SESSION_COOKIE) continue;
    const value = pair.slice(index + 1).trim();
    if (TOKEN.test(value)) return value;
  }
  return null;
}

/**
 * POST /api/login. With cookie auth on (the slot image's setting) the token arrives only in
 * Set-Cookie; otherwise in the body. Throws NekoLoginError; 422 means the session is connected.
 */
export async function loginNeko(options: NekoLoginOptions): Promise<string> {
  const response = await (options.fetch ?? fetch)(`${options.baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: options.username, password: options.password }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
  });
  const text = await response.text();
  if (!response.ok) throw new NekoLoginError(response.status);
  const fromCookie = nekoTokenFromSetCookie(response.headers.getSetCookie());
  if (fromCookie) return fromCookie;
  try {
    const body = JSON.parse(text) as { token?: unknown };
    if (typeof body.token === "string" && TOKEN.test(body.token)) return body.token;
  } catch {
    // fall through
  }
  throw new NekoLoginError(502);
}
```
Move the new `import` line to the top of `neko.ts` next to the existing imports.

`packages/contracts/src/server/index.ts`: append `export * from "./turn.ts";`.

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- packages/contracts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/contracts
git commit -m "feat(contracts): live-view routing helpers, TURN minting, n.eko login, download_ready assetId"
```

---

### Task 2: DB column, live/control queries, run-event append and download records

**Files:**
- Modify: `packages/db/src/schema/runs.ts`, `packages/db/src/index.ts`, root `package.json` (devDependencies)
- Create: `packages/db/src/queries/{events,live,downloads}.ts`, `packages/db/migrations/NNNN_live_control_user.sql` (generated)
- Create: `tests/support/{live-seed,notify,wait}.ts`
- Test: `packages/db/src/queries/live.int.test.ts`

**Interfaces:**
- Consumes: `RunEvent`, `encodeNotify`, `TERMINAL_RUN_STATUSES`, Phase 0 tables and `startTestDatabase`.
- Produces from `@mastertutor/db`:
  - **Events:** `appendRunEvent(sql: ISql, runId, event: RunEvent): Promise<string>`. It inserts the row and sends `NOTIFY run_event`. Inside a transaction, the NOTIFY fires at commit.
  - **Member access:**
    - `MemberRun` `{id, workspaceId, status, controller, slotName, slotLeased}`;
    - `getRunForMember(sql: ISql, runId, userId): Promise<MemberRun | null>`;
    - `canAccessLiveSlot(sql: ISql, q: {runId, slotName, userId}): Promise<boolean>`.
  - **Control requests:**
    - `ControlRequestResult` = `{ok: true; via: "control" | "wake" | "none"}` or `{ok: false; reason: "not_found" | "finished"}`;
    - `requestTakeover(sql: Sql, {runId, userId})`;
    - `requestHandBack(sql: Sql, {runId, userId, note})`.
  - **Agent control state:**
    - `RunControl` `{id, workspaceId, status, waitReason, controller, controlUserId, slotName}`;
    - `getRunControl(sql: ISql, runId)`;
    - `markTakeoverWaiting`, `markHandBackRunning` and `revertToAgent`, each `(sql: ISql, runId) => Promise<boolean>`.
  - **Downloads:**
    - `findDownloadApprover(sql: ISql, runId, url): Promise<string | null>`;
    - `findAssetBySha(sql: ISql, workspaceId, sha256): Promise<{id: string; key: string} | null>`;
    - `DownloadRecordInput`;
    - `recordDownload(sql: Sql, input): Promise<{downloadId: string; assetId: string}>`.
  - **Column:** `runs.controlUserId` (`control_user_id text`), with CHECK `runs_control_user_matches_controller`.
- Produces from `tests/support`:
  - `seedMember(sql, opts?) → {userId, workspaceId}`;
  - `seedRun(sql, opts) → runId`;
  - `leaseSlot(sql, slot, runId)`, `releaseSlot(sql, slot)`;
  - `nextNotification(sql, channel, action, timeoutMs?)`;
  - `waitFor(probe, options?)`.

- [ ] **Step 1: Add the schema column, generate the migration, and add root devDependencies.**

In `packages/db/src/schema/runs.ts`, inside `runs`, add after `controller`:
```ts
    /** Better Auth user id of the member holding control; set iff controller = 'user' (B6). */
    controlUserId: text("control_user_id"),
```
and append this to the `runs` table's constraint array:
```ts
    check(
      "runs_control_user_matches_controller",
      sql`(${t.controller} = 'user') = (${t.controlUserId} is not null)`,
    ),
```

Add to the root `package.json` `devDependencies`: `"@mastertutor/db": "workspace:*"` and `"@mastertutor/storage": "workspace:*"`. Then run:
```bash
pnpm install
pnpm --filter @mastertutor/db generate --name live_control_user
grep -c 'control_user_id' packages/db/migrations/*_live_control_user.sql
```
Expected: one new migration file. The grep count is at least 2 (the column and the CHECK).

- [ ] **Step 2: Write the test helpers.**

`tests/support/wait.ts`:
```ts
/** Polls until probe returns a truthy value (exceptions count as "not yet"). */
export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  options: { timeoutMs?: number; intervalMs?: number; what?: string } = {},
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  for (;;) {
    let value: T | undefined | null | false;
    try {
      value = await probe();
    } catch {
      value = undefined;
    }
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${options.what ?? "condition"}`);
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 100));
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
```

`tests/support/notify.ts`:
```ts
import type { DbHandle } from "@mastertutor/db";

/** Runs action while LISTENing on channel and returns the first payload. */
export async function nextNotification(
  sql: DbHandle["sql"],
  channel: string,
  action: () => Promise<unknown>,
  timeoutMs = 3_000,
): Promise<string> {
  let deliver!: (payload: string) => void;
  const received = new Promise<string>((resolve) => {
    deliver = resolve;
  });
  const { unlisten } = await sql.listen(channel, (payload) => deliver(payload));
  try {
    await action();
    return await Promise.race([
      received,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`No NOTIFY on ${channel}`)), timeoutMs),
      ),
    ]);
  } finally {
    await unlisten();
  }
}
```

`tests/support/live-seed.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { DbHandle } from "@mastertutor/db";

type Sql = DbHandle["sql"];

/** A Better Auth user plus (new or given) workspace membership. Use the owner connection. */
export async function seedMember(
  sql: Sql,
  options: { workspaceId?: string; role?: "owner" | "member" } = {},
): Promise<{ userId: string; workspaceId: string }> {
  const userId = `user_${randomUUID().replaceAll("-", "")}`;
  await sql`insert into "user" (id, name, email) values (${userId}, 'Test', ${`${userId}@example.test`})`;
  const workspaceId =
    options.workspaceId ??
    (await sql<{ id: string }[]>`insert into workspaces (name) values ('Test') returning id`)[0]!.id;
  await sql`insert into workspace_members (workspace_id, user_id, role)
            values (${workspaceId}, ${userId}, ${options.role ?? "owner"})`;
  return { userId, workspaceId };
}

export async function seedRun(
  sql: Sql,
  options: { workspaceId: string; status?: string; waitReason?: string | null },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into runs (workspace_id, goal, status, wait_reason, allowed_origins)
    values (${options.workspaceId}, 'live test', ${options.status ?? "running"},
            ${options.waitReason ?? null}, ${sql.array(["https://example.com"])})
    returning id`;
  return rows[0]!.id;
}

export async function leaseSlot(sql: Sql, slotName: string, runId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`update browser_slots set state = 'leased', run_id = ${runId}, lease_owner = 'test',
               lease_expires_at = now() + interval '1 hour' where name = ${slotName}`;
    await tx`update runs set slot_name = ${slotName} where id = ${runId}`;
  });
}

export async function releaseSlot(sql: Sql, slotName: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`update runs set slot_name = null where slot_name = ${slotName}`;
    await tx`update browser_slots set state = 'restarting', run_id = null, lease_owner = null,
               lease_expires_at = null where name = ${slotName}`;
  });
}
```

- [ ] **Step 3: Write the failing test.**

`packages/db/src/queries/live.int.test.ts`:
```ts
import { decodeNotify } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leaseSlot, releaseSlot, seedMember, seedRun } from "../../../../tests/support/live-seed.ts";
import { nextNotification } from "../../../../tests/support/notify.ts";
import { createDb, type DbHandle } from "../client.ts";
import { startTestDatabase, type TestDatabase } from "../testing.ts";
import { findAssetBySha, findDownloadApprover, recordDownload } from "./downloads.ts";
import { appendRunEvent } from "./events.ts";
import {
  canAccessLiveSlot,
  getRunControl,
  getRunForMember,
  markHandBackRunning,
  markTakeoverWaiting,
  requestHandBack,
  requestTakeover,
  revertToAgent,
} from "./live.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let agent: DbHandle;
let member: { userId: string; workspaceId: string };
let outsider: { userId: string; workspaceId: string };

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 2 });
  member = await seedMember(owner.sql);
  outsider = await seedMember(owner.sql);
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close(), agent?.close()]);
  await testDb?.stop();
});

describe("appendRunEvent", () => {
  it("inserts the event and notifies run_event with ids only", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    let eventId = "";
    const payload = await nextNotification(owner.sql, "run_event", async () => {
      eventId = await appendRunEvent(agent.sql, runId, { type: "control", holder: "agent" });
    });
    expect(decodeNotify("run_event", payload)).toEqual({ runId, eventId });
    const [row] = await owner.sql`select type, payload from run_events where id = ${eventId}`;
    expect(row).toEqual({ type: "control", payload: { type: "control", holder: "agent" } });
  });
});

describe("member and slot access", () => {
  it("shows a run only to members, with its lease state", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    expect(await getRunForMember(web.sql, runId, outsider.userId)).toBeNull();
    expect(await getRunForMember(web.sql, runId, member.userId)).toMatchObject({
      id: runId,
      status: "running",
      controller: "agent",
      slotName: null,
      slotLeased: false,
    });
    await leaseSlot(owner.sql, "browser-1", runId);
    expect(await getRunForMember(web.sql, runId, member.userId)).toMatchObject({
      slotName: "browser-1",
      slotLeased: true,
    });
    await releaseSlot(owner.sql, "browser-1");
  });

  it("grants a live slot only for the leased run, to its members", async () => {
    const runA = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    const runB = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await leaseSlot(owner.sql, "browser-1", runA);
    const ok = { runId: runA, slotName: "browser-1", userId: member.userId };
    expect(await canAccessLiveSlot(web.sql, ok)).toBe(true);
    expect(await canAccessLiveSlot(web.sql, { ...ok, userId: outsider.userId })).toBe(false);
    expect(await canAccessLiveSlot(web.sql, { ...ok, runId: runB })).toBe(false);
    expect(await canAccessLiveSlot(web.sql, { ...ok, slotName: "browser-2" })).toBe(false);
    await releaseSlot(owner.sql, "browser-1");
    expect(await canAccessLiveSlot(web.sql, ok)).toBe(false);
  });
});

describe("takeover and hand back (web role)", () => {
  it("takes control of a running run and notifies run_control", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    const payload = await nextNotification(owner.sql, "run_control", async () => {
      expect(await requestTakeover(web.sql, { runId, userId: member.userId })).toEqual({
        ok: true,
        via: "control",
      });
    });
    expect(decodeNotify("run_control", payload)).toEqual({ runId });
    expect(await getRunControl(agent.sql, runId)).toMatchObject({
      status: "waiting",
      waitReason: "takeover",
      controller: "user",
      controlUserId: member.userId,
    });
  });

  it("wakes a sleeping run with reason takeover", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId, status: "sleeping" });
    const payload = await nextNotification(owner.sql, "run_wake", async () => {
      expect(await requestTakeover(web.sql, { runId, userId: member.userId })).toEqual({ ok: true, via: "wake" });
    });
    expect(decodeNotify("run_wake", payload)).toEqual({ runId, reason: "takeover" });
    const [row] = await owner.sql`select status, controller, wake_requested_at is not null as woke from runs where id = ${runId}`;
    expect(row).toEqual({ status: "sleeping", controller: "user", woke: true });
  });

  it("refuses finished runs and non-members", async () => {
    const done = await seedRun(owner.sql, { workspaceId: member.workspaceId, status: "completed" });
    expect(await requestTakeover(web.sql, { runId: done, userId: member.userId })).toEqual({
      ok: false,
      reason: "finished",
    });
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    expect(await requestTakeover(web.sql, { runId, userId: outsider.userId })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("hands back with a note as a user_message and notifies run_control", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await requestTakeover(web.sql, { runId, userId: member.userId });
    const payload = await nextNotification(owner.sql, "run_control", async () => {
      expect(
        await requestHandBack(web.sql, { runId, userId: member.userId, note: "Logged in; continue" }),
      ).toEqual({ ok: true, via: "control" });
    });
    expect(decodeNotify("run_control", payload)).toEqual({ runId });
    expect(await getRunControl(agent.sql, runId)).toMatchObject({ controller: "agent", controlUserId: null });
    const events = await owner.sql`select payload from run_events where run_id = ${runId} order by id`;
    expect(events.map((e) => e.payload)).toContainEqual({ type: "user_message", text: "Logged in; continue" });
    expect(await requestHandBack(web.sql, { runId, userId: member.userId, note: null })).toEqual({
      ok: true,
      via: "none",
    });
  });

  it("enforces controller = 'user' iff control_user_id is set", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await expect(owner.sql`update runs set controller = 'user' where id = ${runId}`).rejects.toThrow(
      /runs_control_user_matches_controller/,
    );
  });
});

describe("agent control transitions (agent role)", () => {
  it("moves running → waiting(takeover) → running and reverts to the agent", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId, status: "sleeping" });
    await requestTakeover(web.sql, { runId, userId: member.userId });
    await owner.sql`update runs set status = 'running' where id = ${runId}`;
    expect(await markTakeoverWaiting(agent.sql, runId)).toBe(true);
    expect(await markTakeoverWaiting(agent.sql, runId)).toBe(false);
    expect(await markHandBackRunning(agent.sql, runId)).toBe(false);
    expect(await revertToAgent(agent.sql, runId)).toBe(true);
    expect(await revertToAgent(agent.sql, runId)).toBe(false);
    expect(await markHandBackRunning(agent.sql, runId)).toBe(true);
    expect(await getRunControl(agent.sql, runId)).toMatchObject({
      status: "running",
      waitReason: null,
      controller: "agent",
    });
  });
});

describe("downloads (agent role)", () => {
  it("finds an approver by URL and dedupes assets by sha256", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    const url = "https://example.com/a.pdf";
    expect(await findDownloadApprover(agent.sql, runId, url)).toBeNull();
    await owner.sql`insert into approvals (run_id, step_seq, kind, request, status, decided_by, decided_at)
      values (${runId}, 1, 'download', ${owner.sql.json({ kind: "download", url, filename: "a.pdf" })},
              'approved', ${member.userId}, now())`;
    expect(await findDownloadApprover(agent.sql, runId, url)).toBe(member.userId);
    expect(await findDownloadApprover(agent.sql, runId, `${url}?x`)).toBeNull();

    const sha256 = "a".repeat(64);
    const input = {
      runId,
      workspaceId: member.workspaceId,
      filename: "a.pdf",
      sha256,
      bucket: "mastertutor",
      key: `downloads/${runId}/aaaaaaaaaaaa-a.pdf`,
      mime: "application/pdf",
      bytes: 3,
      sourceUrl: url,
      approvedBy: member.userId,
    };
    const first = await recordDownload(agent.sql, input);
    const second = await recordDownload(agent.sql, input);
    expect(second.assetId).toBe(first.assetId);
    expect(second.downloadId).not.toBe(first.downloadId);
    expect(await findAssetBySha(agent.sql, member.workspaceId, sha256)).toEqual({
      id: first.assetId,
      key: input.key,
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails.**

Run: `pnpm test:int -- packages/db/src/queries/live.int.test.ts`
Expected: FAIL, because `./events.ts`, `./live.ts` and `./downloads.ts` are missing.

- [ ] **Step 5: Implement.**

`packages/db/src/queries/events.ts`:
```ts
import { RunEvent, encodeNotify } from "@mastertutor/contracts";
import type { ISql, JSONValue } from "postgres";

/**
 * Appends a run_events row and NOTIFYs run_event {runId, eventId} (spec §3.1, §6).
 * Inside a transaction the NOTIFY is delivered at commit.
 */
export async function appendRunEvent(sql: ISql, runId: string, event: RunEvent): Promise<string> {
  const parsed = RunEvent.parse(event);
  const rows = await sql<{ id: string }[]>`
    insert into run_events (run_id, type, payload)
    values (${runId}, ${parsed.type}, ${sql.json(parsed as unknown as JSONValue)})
    returning id::text as id`;
  const id = rows[0]?.id;
  if (!id) throw new Error("run_events insert returned no id");
  await sql`select pg_notify('run_event', ${encodeNotify("run_event", { runId, eventId: id })})`;
  return id;
}
```

`packages/db/src/queries/live.ts`:
```ts
import {
  TERMINAL_RUN_STATUSES,
  encodeNotify,
  type Controller,
  type RunStatus,
  type WaitReason,
} from "@mastertutor/contracts";
import type { ISql, Sql } from "postgres";
import { appendRunEvent } from "./events.ts";

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

export interface MemberRun {
  id: string;
  workspaceId: string;
  status: RunStatus;
  controller: Controller;
  slotName: string | null;
  slotLeased: boolean;
}

/** The run if userId is a member of its workspace; slotLeased means browser_slots agrees. */
export async function getRunForMember(sql: ISql, runId: string, userId: string): Promise<MemberRun | null> {
  const rows = await sql<MemberRun[]>`
    select r.id, r.workspace_id as "workspaceId", r.status, r.controller, r.slot_name as "slotName",
           coalesce(s.state = 'leased' and s.run_id = r.id, false) as "slotLeased"
    from runs r
    join workspace_members wm on wm.workspace_id = r.workspace_id and wm.user_id = ${userId}
    left join browser_slots s on s.name = r.slot_name
    where r.id = ${runId}`;
  return rows[0] ?? null;
}

/** ForwardAuth's DB check (spec §10.2): slot leased to exactly this run, and the user is a member. */
export async function canAccessLiveSlot(
  sql: ISql,
  query: { runId: string; slotName: string; userId: string },
): Promise<boolean> {
  const rows = await sql`
    select 1 from browser_slots s
    join runs r on r.id = s.run_id and r.slot_name = s.name
    join workspace_members wm on wm.workspace_id = r.workspace_id and wm.user_id = ${query.userId}
    where s.name = ${query.slotName} and s.run_id = ${query.runId} and s.state = 'leased'
    limit 1`;
  return rows.length === 1;
}

export type ControlRequestResult =
  | { ok: true; via: "control" | "wake" | "none" }
  | { ok: false; reason: "not_found" | "finished" };

async function lockMemberRun(
  tx: ISql,
  runId: string,
  userId: string,
): Promise<{ status: RunStatus; controller: Controller } | null> {
  const rows = await tx<{ status: RunStatus; controller: Controller }[]>`
    select r.status, r.controller from runs r
    join workspace_members wm on wm.workspace_id = r.workspace_id and wm.user_id = ${userId}
    where r.id = ${runId}
    for update of r`;
  return rows[0] ?? null;
}

/**
 * Spec §10.3 takeover, in one transaction. A run holding (or about to hold) a slot moves to
 * waiting(takeover) and NOTIFYs run_control; a sleeping or queued run is woken with reason takeover.
 */
export async function requestTakeover(
  sql: Sql,
  input: { runId: string; userId: string },
): Promise<ControlRequestResult> {
  return sql.begin(async (tx): Promise<ControlRequestResult> => {
    const run = await lockMemberRun(tx, input.runId, input.userId);
    if (!run) return { ok: false, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false, reason: "finished" };
    if (run.status === "sleeping" || run.status === "queued") {
      await tx`update runs set controller = 'user', control_user_id = ${input.userId},
                 wake_requested_at = case when status = 'sleeping' then now() else wake_requested_at end
               where id = ${input.runId}`;
      await tx`select pg_notify('run_wake', ${encodeNotify("run_wake", { runId: input.runId, reason: "takeover" })})`;
      return { ok: true, via: "wake" };
    }
    await tx`update runs set controller = 'user', control_user_id = ${input.userId},
               status = 'waiting', wait_reason = 'takeover', last_activity_at = now()
             where id = ${input.runId}`;
    await tx`select pg_notify('run_control', ${encodeNotify("run_control", { runId: input.runId })})`;
    return { ok: true, via: "control" };
  });
}

/** Spec §10.3 hand back: controller='agent', optional note as a user_message, NOTIFY run_control. */
export async function requestHandBack(
  sql: Sql,
  input: { runId: string; userId: string; note: string | null },
): Promise<ControlRequestResult> {
  return sql.begin(async (tx): Promise<ControlRequestResult> => {
    const run = await lockMemberRun(tx, input.runId, input.userId);
    if (!run) return { ok: false, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false, reason: "finished" };
    if (run.controller === "agent") return { ok: true, via: "none" };
    await tx`update runs set controller = 'agent', control_user_id = null where id = ${input.runId}`;
    if (input.note) await appendRunEvent(tx, input.runId, { type: "user_message", text: input.note });
    await tx`select pg_notify('run_control', ${encodeNotify("run_control", { runId: input.runId })})`;
    return { ok: true, via: "control" };
  });
}

export interface RunControl {
  id: string;
  workspaceId: string;
  status: RunStatus;
  waitReason: WaitReason | null;
  controller: Controller;
  controlUserId: string | null;
  slotName: string | null;
}

export async function getRunControl(sql: ISql, runId: string): Promise<RunControl | null> {
  const rows = await sql<RunControl[]>`
    select id, workspace_id as "workspaceId", status, wait_reason as "waitReason", controller,
           control_user_id as "controlUserId", slot_name as "slotName"
    from runs where id = ${runId}`;
  return rows[0] ?? null;
}

/** Applied after the agent hands n.eko to the user (also covers a run woken into takeover). */
export async function markTakeoverWaiting(sql: ISql, runId: string): Promise<boolean> {
  const rows = await sql`
    update runs set status = 'waiting', wait_reason = 'takeover', last_activity_at = now()
    where id = ${runId} and controller = 'user'
      and (status = 'running' or (status = 'waiting' and wait_reason <> 'takeover'))
    returning id`;
  return rows.length === 1;
}

/** Applied after the agent takes n.eko back: waiting(takeover) → running. */
export async function markHandBackRunning(sql: ISql, runId: string): Promise<boolean> {
  const rows = await sql`
    update runs set status = 'running', wait_reason = null, last_activity_at = now()
    where id = ${runId} and controller = 'agent' and status = 'waiting' and wait_reason = 'takeover'
    returning id`;
  return rows.length === 1;
}

/** Agent-side return of control (15-minute idle, or a takeover that could not be delivered). */
export async function revertToAgent(sql: ISql, runId: string): Promise<boolean> {
  const rows = await sql`
    update runs set controller = 'agent', control_user_id = null
    where id = ${runId} and controller = 'user'
    returning id`;
  return rows.length === 1;
}
```

`packages/db/src/queries/downloads.ts`:
```ts
import type { ISql, Sql } from "postgres";

/** decided_by of an approved download approval for exactly this URL, or null. */
export async function findDownloadApprover(sql: ISql, runId: string, url: string): Promise<string | null> {
  const rows = await sql<{ decidedBy: string }[]>`
    select decided_by as "decidedBy" from approvals
    where run_id = ${runId} and kind = 'download' and status = 'approved'
      and decided_by is not null and request ->> 'url' = ${url}
    order by decided_at desc nulls last
    limit 1`;
  return rows[0]?.decidedBy ?? null;
}

export async function findAssetBySha(
  sql: ISql,
  workspaceId: string,
  sha256: string,
): Promise<{ id: string; key: string } | null> {
  const rows = await sql<{ id: string; key: string }[]>`
    select id, key from assets where workspace_id = ${workspaceId} and sha256 = ${sha256}`;
  return rows[0] ?? null;
}

export interface DownloadRecordInput {
  runId: string;
  workspaceId: string;
  filename: string;
  sha256: string;
  bucket: string;
  key: string;
  mime: string;
  bytes: number;
  sourceUrl: string;
  approvedBy: string;
}

/** assets (deduped per workspace by sha256) + downloads, in one transaction (spec §10.2.9). */
export async function recordDownload(
  sql: Sql,
  input: DownloadRecordInput,
): Promise<{ downloadId: string; assetId: string }> {
  return sql.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      insert into assets (workspace_id, sha256, bucket, key, mime, bytes, source_url)
      values (${input.workspaceId}, ${input.sha256}, ${input.bucket}, ${input.key}, ${input.mime},
              ${input.bytes}, ${input.sourceUrl})
      on conflict (workspace_id, sha256) do nothing
      returning id`;
    const assetId =
      inserted[0]?.id ??
      (await tx<{ id: string }[]>`
        select id from assets where workspace_id = ${input.workspaceId} and sha256 = ${input.sha256}`)[0]?.id;
    if (!assetId) throw new Error("asset row missing after insert");
    const downloads = await tx<{ id: string }[]>`
      insert into downloads (run_id, filename, asset_id, bytes, approved_by)
      values (${input.runId}, ${input.filename}, ${assetId}, ${input.bytes}, ${input.approvedBy})
      returning id`;
    return { downloadId: downloads[0]!.id, assetId };
  });
}
```

Append to `packages/db/src/index.ts`:
```ts
export * from "./queries/events.ts";
export * from "./queries/live.ts";
export * from "./queries/downloads.ts";
```

If B1 already added an `appendRunEvent` with the same signature, keep a single copy in `queries/events.ts` and delete the other.

- [ ] **Step 6: Run the tests to verify they pass.**

Run: `pnpm test:int -- packages/db && pnpm typecheck && pnpm lint`
Expected: PASS, including the Phase 0 db tests.

- [ ] **Step 7: Commit.**
```bash
git add packages/db tests/support package.json pnpm-lock.yaml
git commit -m "feat(db): control_user_id, takeover/hand-back transactions, live access queries, download records"
```

---

### Task 3: Slot image: legacy n.eko client, cookie auth, user-starts-unhosted, X idle probe, boot TURN credential

**Files:**
- Modify: `apps/browser-slot/Dockerfile`, `apps/browser-slot/bin/slot-entrypoint`, `apps/browser-slot/supervisord/chromium.conf`, `apps/browser-slot/test/verify.sh`
- Create: `apps/browser-slot/bin/turn-ice`, `apps/browser-slot/bin/slot-idle-http`
- Test: `apps/browser-slot/test/turn-ice.test.ts`, `apps/browser-slot/test/verify.sh`

**Interfaces:**
- Consumes: `mintTurnCredential` and `SLOT_TURN_CREDENTIAL_TTL_SECONDS` (Task 1). The bash output must equal them.
- Produces the image `mastertutor/browser-slot:local`:
  - **New env it reads:** `TURN_URLS` (optional) and `TURN_SECRET` (required if `TURN_URLS` is set). Both are scrubbed before n.eko starts.
  - **New port:** 9224 returns `HTTP/1.0 200` with the X idle milliseconds, agent IP only.
  - **n.eko settings:**
    - `NEKO_LEGACY=true`;
    - cookie auth on (cookie not Secure);
    - implicit hosting off;
    - file-chooser dialog handling on;
    - the `user` member starts with `can_host=false` and `can_access_clipboard=false`.

- [ ] **Step 1: Write the failing tests.**

`apps/browser-slot/test/turn-ice.test.ts`:
```ts
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SLOT_TURN_CREDENTIAL_TTL_SECONDS } from "@mastertutor/contracts";
import { mintTurnCredential } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../bin/turn-ice", import.meta.url));
const secret = "turn-secret-for-tests-0123456789abcdef";
const env = (extra: Record<string, string>) => ({ PATH: process.env.PATH ?? "", ...extra });

describe("bin/turn-ice", () => {
  it("prints n.eko frontend ICE JSON identical to mintTurnCredential", () => {
    const out = execFileSync("bash", [script], {
      env: env({
        TURN_URLS: "turn:203.0.113.7:3478?transport=udp, turn:203.0.113.7:3478?transport=tcp",
        TURN_SECRET: secret,
        SLOT_NAME: "browser-1",
        TURN_NOW: "1700000000",
      }),
      encoding: "utf8",
    });
    const expected = mintTurnCredential(secret, "browser-1", 1_700_000_000, SLOT_TURN_CREDENTIAL_TTL_SECONDS);
    expect(JSON.parse(out)).toEqual([
      {
        urls: ["turn:203.0.113.7:3478?transport=udp", "turn:203.0.113.7:3478?transport=tcp"],
        username: expected.username,
        credential: expected.credential,
      },
    ]);
    expect(expected.credential).toBe("Tg+jmBPUGT/Z/csW7B6l5r0LXr0=");
  });

  it("refuses URLs that could break the JSON", () => {
    const result = spawnSync("bash", [script], {
      env: env({ TURN_URLS: 'turn:x"y', TURN_SECRET: secret, SLOT_NAME: "browser-1" }),
      encoding: "utf8",
    });
    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
  });
});
```

Replace `apps/browser-slot/test/verify.sh` with:
```bash
#!/usr/bin/env bash
# Verifies the browser-slot image in isolation:
#   - Chromium runs with its sandbox on;
#   - CDP and the idle probe are reachable only from the agent IP, and n.eko only from allowed IPs;
#   - private egress is blocked;
#   - the display is 1280x800;
#   - n.eko passwords are derived from the shared secrets; the user member starts without hosting;
#   - the legacy client endpoint and cookie auth are enabled;
#   - the X idle probe measures XTest (n.eko) input;
#   - the boot TURN credential is minted and its secret scrubbed;
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
TURN_SECRET_VALUE="turn-secret-for-tests-0123456789abcdef"

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
as_user() { # logs in as the user member, then requests $1 with the session cookie
  docker run --rm --network "$NET" --ip "$PREFIX.11" --entrypoint sh "$CURL" -c \
    "curl -s -m 4 -c /tmp/jar -o /dev/null -H 'Content-Type: application/json' -d '{\"username\":\"user\",\"password\":\"$(hmac "$MEMBER_SECRET")\"}' http://$PREFIX.20:8080/api/login && curl -s -m 4 -b /tmp/jar -o /dev/null -w '%{http_code}' http://$PREFIX.20:8080$1"
}
idle_ms() { from_ip "$PREFIX.10" "http://$PREFIX.20:9224/" | tr -d '\r\n'; }
neko_env() { docker exec "$SLOT" sh -c 'tr "\0" "\n" < /proc/$(pgrep -o -f "neko serve")/environ'; }

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
  -e TURN_URLS="turn:203.0.113.7:3478?transport=udp" -e TURN_SECRET="$TURN_SECRET_VALUE" \
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

[[ "$(as_user /api/room/control)" == "403" ]] || fail "user member can host before the agent gives control (or cookie auth is off)"
pass "user starts without hosting rights; session cookie auth enabled"

[[ "$(from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' "http://$PREFIX.20:8080/ws")" != "404" ]] || fail "legacy /ws endpoint missing (NEKO_LEGACY)"
pass "legacy client endpoint enabled"

if neko_env | grep -q -E '^(NEKO_ADMIN_SECRET|NEKO_MEMBER_SECRET|TURN_SECRET)='; then
  fail "raw secrets reached the n.eko process"
fi
pass "raw secrets scrubbed before supervisord"
neko_env | grep -q '^NEKO_WEBRTC_ICESERVERS_FRONTEND=\[{"urls":\["turn:203.0.113.7:3478?transport=udp"\],"username":"[0-9]*:browser-1","credential":"' \
  || fail "boot TURN credential not handed to n.eko"
pass "boot TURN credential minted"

first="$(idle_ms)"
[[ "$first" =~ ^[0-9]+$ ]] || fail "idle probe did not return milliseconds"
if from_ip "$PREFIX.11" "http://$PREFIX.20:9224/" >/dev/null; then fail "idle probe reachable from a non-agent IP"; fi
sleep 2
second="$(idle_ms)"
(( second >= first + 1500 )) || fail "X idle time does not grow without input ($first -> $second)"
docker exec -u neko "$SLOT" sh -c 'DISPLAY=:99.0 xdotool mousemove 37 41 && sleep 0.2 && DISPLAY=:99.0 xdotool mousemove 51 63'
third="$(idle_ms)"
(( third < 1000 )) || fail "XTest input did not reset the X idle time ($third)"
pass "idle probe measures XTest input and is agent-only"

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

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/browser-slot && bash apps/browser-slot/test/verify.sh`
Expected: the vitest run FAILs because `bin/turn-ice` is missing. `verify.sh` FAILs at "user starts without hosting rights" (user gets 200 or 401).

- [ ] **Step 3: Implement.**

`apps/browser-slot/bin/turn-ice`:
```bash
#!/bin/bash
# Prints n.eko's frontend ICE servers (JSON) with a TURN REST credential for coturn's
# use-auth-secret mode: username "<expiry>:<slot>", credential base64(HMAC-SHA1(secret, username)).
# Same algorithm as mintTurnCredential() in @mastertutor/contracts/server (tested against it).
set -euo pipefail
for name in TURN_URLS TURN_SECRET SLOT_NAME; do
  if [[ -z "${!name:-}" ]]; then echo "turn-ice: $name is required" >&2; exit 64; fi
done
now="${TURN_NOW:-$(date +%s)}"
ttl="${TURN_TTL_SECONDS:-86400}"
username="$((now + ttl)):${SLOT_NAME}"
credential="$(printf '%s' "$username" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | openssl base64 -A)"
urls=""
IFS=',' read -r -a list <<< "$TURN_URLS"
for url in "${list[@]}"; do
  url="${url// /}"
  [[ -z "$url" ]] && continue
  if [[ ! "$url" =~ ^turns?:[A-Za-z0-9.:?=_-]+$ ]]; then echo "turn-ice: invalid TURN url" >&2; exit 64; fi
  urls+="${urls:+,}\"${url}\""
done
if [[ -z "$urls" ]]; then echo "turn-ice: TURN_URLS has no URL" >&2; exit 64; fi
printf '[{"urls":[%s],"username":"%s","credential":"%s"}]\n' "$urls" "$username" "$credential"
```

`apps/browser-slot/bin/slot-idle-http`:
```bash
#!/bin/bash
# One HTTP/1.0 exchange on stdin/stdout (run by socat EXEC): replies with the X idle time in ms.
# n.eko injects the human's input through XTest, which resets this timer; the agent's CDP input
# bypasses X entirely, so this measures only the user's idle time (spec §5.1 15-minute hand-back).
while IFS= read -r -t 2 line; do
  [[ -z "${line%$'\r'}" ]] && break
done
idle="$(xprintidle 2>/dev/null)" || idle="-1"
printf 'HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n%s\n' "$idle"
```

`apps/browser-slot/bin/slot-entrypoint` (replace the whole file):
```bash
#!/bin/bash
# Browser-slot entrypoint. It:
#   1. derives the n.eko member passwords;
#   2. mints n.eko's frontend TURN credential when TURN_URLS is set (spec §15 fallback, B6);
#   3. installs the network filter;
#   4. wipes any previous browser state;
#   5. execs n.eko's supervisord.
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
# The user member starts WITHOUT hosting or clipboard rights; only the agent's
# LiveView.giveControl / setClipboardAccess grant them (spec §10.3 control lock).
NEKO_MEMBER_OBJECT_USERS="[{\"username\":\"agent\",\"password\":\"${admin_password}\",\"profile\":$(profile agent true true true true)},{\"username\":\"user\",\"password\":\"${user_password}\",\"profile\":$(profile user false false false false)}]"
export NEKO_MEMBER_OBJECT_USERS
unset admin_password user_password

# The embedded n.eko client takes ICE servers only from n.eko's config, so the slot mints a
# TURN REST credential at boot. Slots restart on every release, so it never outlives a lease by much.
if [[ -n "${TURN_URLS:-}" ]]; then
  if [[ -z "${TURN_SECRET:-}" ]]; then echo "slot-entrypoint: TURN_URLS needs TURN_SECRET" >&2; exit 64; fi
  NEKO_WEBRTC_ICESERVERS_FRONTEND="$(/usr/local/bin/turn-ice)"
  export NEKO_WEBRTC_ICESERVERS_FRONTEND
fi
unset TURN_SECRET TURN_URLS

# Ingress: CDP (9223), the idle probe (9224) and PulseAudio (4713) from the agent only;
# n.eko (8080) from web/Traefik only.
iptables -F INPUT
iptables -F OUTPUT
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for port in 9223 9224 4713; do
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

Append to `apps/browser-slot/supervisord/chromium.conf`:
```ini

[program:idle-probe]
environment=HOME="/home/%(ENV_USER)s",USER="%(ENV_USER)s",DISPLAY="%(ENV_DISPLAY)s"
command=/usr/bin/socat TCP-LISTEN:9224,fork,reuseaddr EXEC:/usr/local/bin/slot-idle-http
autorestart=true
priority=900
user=%(ENV_USER)s
stdout_logfile=/var/log/neko/idle-probe.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=1
redirect_stderr=true
```

`apps/browser-slot/Dockerfile` (replace the whole file):
```dockerfile
# Browser slot (spec §3.1, §10, run 15 §8): n.eko v3.1.6 (Apache-2.0, amd64+arm64) + headed
# Chromium with its sandbox + socat CDP proxy + X idle probe + an iptables ingress/egress filter.
FROM ghcr.io/m1k1o/neko/chromium:3.1.6

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends socat iptables xprintidle; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# n.eko's Xorg dummy config has no 1280x800 mode; add a GTF 30 Hz modeline and prefer it.
RUN set -eux; \
    sed -i 's/^\(\s*\)Modeline "1280x720_30.00".*/&\n\1Modeline "1280x800_30.00" 37.90 1280 1288 1416 1552 800 801 804 814 -HSync +Vsync/' /etc/neko/xorg.conf; \
    sed -i 's/Modes "1920x1080_60.00"/Modes "1280x800_30.00" "1920x1080_60.00"/' /etc/neko/xorg.conf; \
    grep -q 'Modeline "1280x800_30.00" 37.90' /etc/neko/xorg.conf

COPY supervisord/chromium.conf /etc/neko/supervisord/chromium.conf
COPY policies.json /etc/chromium/policies/managed/policies.json
COPY --chmod=0755 bin/slot-entrypoint bin/exit-on-chromium bin/slot-health bin/turn-ice bin/slot-idle-http /usr/local/bin/

# NEKO_LEGACY: the bundled client speaks the legacy /ws protocol.
# Cookie auth: web relays NEKO_SESSION scoped to /live/<runId>/; the legacy /ws handler
# authenticates with that cookie (whoami) before any password. n.eko's own Set-Cookie is
# never used by browsers, so it need not be Secure.
# Implicit hosting off and the user member unhosted: only the agent grants control.
ENV NEKO_DESKTOP_SCREEN=1280x800@30 \
    NEKO_LOG_LEVEL=warn \
    NEKO_FILETRANSFER_ENABLED=false \
    NEKO_LEGACY=true \
    NEKO_SESSION_COOKIE_ENABLED=true \
    NEKO_SESSION_COOKIE_SECURE=false \
    NEKO_SESSION_IMPLICIT_HOSTING=false \
    NEKO_DESKTOP_FILE_CHOOSER_DIALOG=true \
    NEKO_DESKTOP_UPLOAD_DROP=true

HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=6 CMD ["/usr/local/bin/slot-health"]
ENTRYPOINT ["/usr/local/bin/slot-entrypoint"]
CMD ["/usr/bin/supervisord", "-c", "/etc/neko/supervisord.conf"]
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run:
```bash
pnpm test -- apps/browser-slot
bash apps/browser-slot/test/verify.sh
docker build -t mastertutor/browser-slot:local apps/browser-slot
docker builder prune -f && docker image prune -f
```
Expected:
- vitest PASS;
- every `verify.sh` line is `ok - …`, ending with `browser-slot verify: all checks passed`;
- the image builds.

If the idle check reports "does not grow", Chromium is resetting the X screensaver timer. Inspect the slot with `docker exec … xprintidle` before changing code. Never remove the check.

- [ ] **Step 5: Commit.**
```bash
git add apps/browser-slot
git commit -m "feat(browser-slot): legacy n.eko client with cookie auth, unhosted user member, X idle probe, boot TURN credential"
```

---

### Task 4: Agent n.eko admin client, `NekoLiveView`, idle probe and the test-slot helper

**Files:**
- Create: `apps/agent/src/live/{live-view,neko-admin,neko-live-view,idle-probe}.ts`, `tests/support/slot.ts`
- Modify: `apps/agent/package.json`, adding `"playwright-core": "1.63.0"` (skip if B1 already added it)
- Test: `apps/agent/src/live/neko-admin.test.ts`, `apps/agent/src/live/neko-live-view.test.ts`, `apps/agent/src/live/neko-live-view.int.test.ts`

**Interfaces:**
- Consumes: `loginNeko`, `deriveNekoPassword`, `NEKO_MEMBERS`, `NEKO_PORT`, `SLOT_IDLE_PORT`, and the image from Task 3.
- Produces:
  - **`live-view.ts`:**
    - `interface Slot { readonly name: string }`;
    - `interface LiveView { giveControl(slot, userId): Promise<void>; takeControl(slot): Promise<void>; setClipboardAccess(slot, on): Promise<void> }` (spec §10.1).
  - **`neko-admin.ts`:**
    - `NekoApiError` (`status`, `path`);
    - `NekoAdmin` `{ request(slotName, method: "GET" | "POST" | "DELETE", path, body?): Promise<unknown>; forget(slotName): void }`;
    - `createNekoAdmin({adminSecret, baseUrl?, fetch?, timeoutMs?})`.
  - **`neko-live-view.ts`:**
    - `LiveViewError` (`code: "user_not_connected"`);
    - `createNekoLiveView({admin, giveTimeoutMs?, retryDelayMs?}): LiveView`.
  - **`idle-probe.ts`:** `SlotIdleProbe` `{ userIdleMs(slotName): Promise<number> }` and `createSlotIdleProbe({url?, fetch?, timeoutMs?})`.
  - **`tests/support/slot.ts`:**
    - `TEST_NEKO_ADMIN_SECRET`, `TEST_NEKO_MEMBER_SECRET`, `SLOT_IMAGE`;
    - `TestSlot` `{name, container, network, cdpUrl, nekoUrl, idleUrl, downloadsDir, exec(args, user?), xdotool(...args), stop()}`;
    - `startTestSlot({name?, env?, addHosts?})`.

- [ ] **Step 1: Write the test-slot helper.**

`tests/support/slot.ts`:
```ts
// Starts one browser-slot container reachable from this test process, which stands in for both
// `agent` (CDP, idle probe) and `web` (n.eko): the slot's allow-lists get the network gateway,
// the source address of host → published-port traffic (Docker Desktop and Linux docker-proxy).
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const SLOT_IMAGE = "mastertutor/browser-slot:local";
/** Same dummy values as .env.test. */
export const TEST_NEKO_ADMIN_SECRET = "neko-admin-secret-for-tests-0123456789";
export const TEST_NEKO_MEMBER_SECRET = "neko-member-secret-for-tests-0123456789";

export interface TestSlot {
  name: string;
  container: string;
  network: string;
  cdpUrl: string;
  nekoUrl: string;
  idleUrl: string;
  /** Host directory mounted at /downloads in the slot. */
  downloadsDir: string;
  exec(args: string[], user?: string): Promise<string>;
  xdotool(...args: string[]): Promise<string>;
  stop(): Promise<void>;
}

export interface TestSlotOptions {
  name?: string;
  env?: Record<string, string>;
  /** Extra /etc/hosts entries, e.g. { "intranet.test": "host-gateway" }. */
  addHosts?: Record<string, string>;
}

async function docker(args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function waitHealthy(container: string): Promise<void> {
  for (let i = 0; i < 90; i += 1) {
    const status = await docker(["inspect", "-f", "{{.State.Health.Status}}", container]).catch(() => "");
    if (status === "healthy") return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`slot ${container} did not become healthy`);
}

export async function startTestSlot(options: TestSlotOptions = {}): Promise<TestSlot> {
  const name = options.name ?? "browser-1";
  const id = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const network = `mt-live-${id}`;
  const container = `mt-live-slot-${id}`;
  await docker(["network", "create", network]);
  const allowedIp =
    process.env.TEST_SLOT_ALLOWED_IP ??
    (await docker(["network", "inspect", "-f", "{{(index .IPAM.Config 0).Gateway}}", network]));
  const downloadsDir = await mkdtemp(join(tmpdir(), "mt-downloads-"));
  await chmod(downloadsDir, 0o777);
  const env: Record<string, string> = {
    SLOT_NAME: name,
    NEKO_ADMIN_SECRET: TEST_NEKO_ADMIN_SECRET,
    NEKO_MEMBER_SECRET: TEST_NEKO_MEMBER_SECRET,
    CDP_ALLOWED_IP: allowedIp,
    NEKO_ALLOWED_IPS: allowedIp,
    NEKO_WEBRTC_NAT1TO1: "127.0.0.1",
    ...options.env,
  };
  const stop = async () => {
    await docker(["rm", "-f", container]).catch(() => "");
    await docker(["network", "rm", network]).catch(() => "");
    await rm(downloadsDir, { recursive: true, force: true });
  };
  try {
    await docker([
      "run", "-d", "--name", container, "--network", network,
      "--cap-add", "NET_ADMIN",
      "--security-opt", `seccomp=${join(ROOT, "apps/browser-slot/seccomp/chromium.json")}`,
      "--shm-size", "2g",
      "--tmpfs", "/tmp/chromium-profile:uid=1000,gid=1000,mode=0700",
      "-v", `${downloadsDir}:/downloads`,
      "-p", "127.0.0.1::9223", "-p", "127.0.0.1::8080", "-p", "127.0.0.1::9224",
      ...Object.entries(options.addHosts ?? {}).flatMap(([host, ip]) => ["--add-host", `${host}:${ip}`]),
      ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      SLOT_IMAGE,
    ]);
    await waitHealthy(container);
    const port = async (target: number) => {
      const line = (await docker(["port", container, `${target}/tcp`])).split("\n")[0] ?? "";
      return line.slice(line.lastIndexOf(":") + 1);
    };
    const cdpUrl = `http://127.0.0.1:${await port(9223)}`;
    const probe = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
    if (!probe?.ok) {
      throw new Error("CDP is not reachable from the test process; set TEST_SLOT_ALLOWED_IP to the source IP the slot sees");
    }
    const exec = (args: string[], user?: string) =>
      docker(["exec", ...(user ? ["-u", user] : []), "-e", "DISPLAY=:99.0", container, ...args]);
    return {
      name,
      container,
      network,
      cdpUrl,
      nekoUrl: `http://127.0.0.1:${await port(8080)}`,
      idleUrl: `http://127.0.0.1:${await port(9224)}/`,
      downloadsDir,
      exec,
      xdotool: (...args: string[]) => exec(["xdotool", ...args], "neko"),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
```

- [ ] **Step 2: Write the failing tests.**

`apps/agent/src/live/neko-admin.test.ts`:
```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { deriveNekoPassword } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { NekoApiError, createNekoAdmin } from "./neko-admin.ts";

const adminSecret = "neko-admin-secret-for-tests-0123456789";
let server: Server | undefined;
afterEach(() => server?.close());

async function fakeNeko() {
  const state = { logins: 0, token: "", calls: [] as string[] };
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      state.calls.push(`${req.method} ${req.url}`);
      if (req.url === "/api/login") {
        const { username, password } = JSON.parse(body) as { username: string; password: string };
        if (username !== "agent" || password !== deriveNekoPassword(adminSecret, "browser-1")) {
          res.writeHead(401).end('{"message":"invalid password"}');
          return;
        }
        state.logins += 1;
        state.token = `token${state.logins}`;
        res.writeHead(200, { "set-cookie": `NEKO_SESSION=${state.token}; Path=/; HttpOnly` }).end('{"id":"agent"}');
        return;
      }
      if (req.headers.authorization !== `Bearer ${state.token}`) {
        res.writeHead(401).end();
        return;
      }
      if (req.url === "/api/room/control") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"has_host":true,"host_id":"agent"}');
        return;
      }
      if (req.url === "/api/room/control/take") {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(500).end("stack trace with internal detail");
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { state, baseUrl: `http://127.0.0.1:${(server!.address() as AddressInfo).port}` };
}

describe("createNekoAdmin", () => {
  it("logs in once as the agent member and reuses the bearer token", async () => {
    const { state, baseUrl } = await fakeNeko();
    const admin = createNekoAdmin({ adminSecret, baseUrl: () => baseUrl });
    expect(await admin.request("browser-1", "GET", "/api/room/control")).toEqual({ has_host: true, host_id: "agent" });
    expect(await admin.request("browser-1", "POST", "/api/room/control/take")).toBeNull();
    expect(state.logins).toBe(1);
  });

  it("re-logs in once when the slot restarted and the token is stale", async () => {
    const { state, baseUrl } = await fakeNeko();
    const admin = createNekoAdmin({ adminSecret, baseUrl: () => baseUrl });
    await admin.request("browser-1", "GET", "/api/room/control");
    state.token = "rotated-by-restart";
    expect(await admin.request("browser-1", "GET", "/api/room/control")).toMatchObject({ host_id: "agent" });
    expect(state.logins).toBe(2);
  });

  it("raises status and path only, never the response body", async () => {
    const { baseUrl } = await fakeNeko();
    const admin = createNekoAdmin({ adminSecret, baseUrl: () => baseUrl });
    const error = await admin.request("browser-1", "GET", "/api/unknown").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NekoApiError);
    expect((error as NekoApiError).status).toBe(500);
    expect((error as Error).message).toBe("n.eko /api/unknown answered HTTP 500");
  });
});
```

`apps/agent/src/live/neko-live-view.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { NekoAdmin } from "./neko-admin.ts";
import { NekoApiError } from "./neko-admin.ts";
import { LiveViewError, createNekoLiveView } from "./neko-live-view.ts";

function fakeAdmin(giveFailures: number) {
  const calls: string[] = [];
  let remaining = giveFailures;
  const admin: NekoAdmin = {
    async request(slot, method, path, body) {
      calls.push(`${slot} ${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
      if (path === "/api/room/control/give/user" && remaining > 0) {
        remaining -= 1;
        throw new NekoApiError(404, path);
      }
      return null;
    },
    forget() {},
  };
  return { admin, calls };
}

const slot = { name: "browser-2" };

describe("NekoLiveView", () => {
  it("grants hosting, then retries give until the user session exists", async () => {
    const { admin, calls } = fakeAdmin(2);
    await createNekoLiveView({ admin, retryDelayMs: 1 }).giveControl(slot, "user_1");
    expect(calls).toEqual([
      'browser-2 POST /api/members/user {"can_host":true}',
      "browser-2 POST /api/room/control/give/user",
      "browser-2 POST /api/room/control/give/user",
      "browser-2 POST /api/room/control/give/user",
    ]);
  });

  it("gives up with user_not_connected and revokes hosting again", async () => {
    const { admin, calls } = fakeAdmin(1_000);
    const view = createNekoLiveView({ admin, giveTimeoutMs: 30, retryDelayMs: 5 });
    await expect(view.giveControl(slot, "user_1")).rejects.toMatchObject({ code: "user_not_connected" });
    await expect(view.giveControl(slot, "user_1")).rejects.toBeInstanceOf(LiveViewError);
    expect(calls.at(-1)).toBe('browser-2 POST /api/members/user {"can_host":false}');
  });

  it("takes control as the agent before revoking the user's hosting right", async () => {
    const { admin, calls } = fakeAdmin(0);
    const view = createNekoLiveView({ admin });
    await view.takeControl(slot);
    await view.setClipboardAccess(slot, true);
    expect(calls).toEqual([
      "browser-2 POST /api/room/control/take",
      'browser-2 POST /api/members/user {"can_host":false}',
      'browser-2 POST /api/members/user {"can_access_clipboard":true}',
    ]);
  });
});
```

`apps/agent/src/live/neko-live-view.int.test.ts`:
```ts
import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_NEKO_ADMIN_SECRET, TEST_NEKO_MEMBER_SECRET, startTestSlot, type TestSlot } from "../../../../tests/support/slot.ts";
import { sleep } from "../../../../tests/support/wait.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createNekoAdmin, type NekoAdmin } from "./neko-admin.ts";
import { createNekoLiveView } from "./neko-live-view.ts";

let slot: TestSlot;
let admin: NekoAdmin;
const name = "browser-1";

beforeAll(async () => {
  slot = await startTestSlot();
  admin = createNekoAdmin({ adminSecret: TEST_NEKO_ADMIN_SECRET, baseUrl: () => slot.nekoUrl });
});
afterAll(async () => slot?.stop());

const userToken = () =>
  loginNeko({ baseUrl: slot.nekoUrl, username: "user", password: deriveNekoPassword(TEST_NEKO_MEMBER_SECRET, name) });
const asUser = (token: string, path: string) =>
  fetch(`${slot.nekoUrl}${path}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);

describe("NekoLiveView against a real slot", () => {
  it("moves the n.eko host and the user's rights both ways", async () => {
    const view = createNekoLiveView({ admin });
    const token = await userToken();
    await view.takeControl({ name });
    expect(await admin.request(name, "GET", "/api/room/control")).toMatchObject({ has_host: true, host_id: "agent" });
    expect(await asUser(token, "/api/room/control")).toBe(403);

    await view.giveControl({ name }, "user_1");
    await view.setClipboardAccess({ name }, true);
    expect(await admin.request(name, "GET", "/api/room/control")).toMatchObject({ host_id: "user" });
    expect(await admin.request(name, "GET", "/api/members/user")).toMatchObject({ can_host: true, can_access_clipboard: true });
    expect(await asUser(token, "/api/room/clipboard")).toBe(200);

    await view.takeControl({ name });
    await view.setClipboardAccess({ name }, false);
    expect(await admin.request(name, "GET", "/api/room/control")).toMatchObject({ host_id: "agent" });
    expect(await admin.request(name, "GET", "/api/members/user")).toMatchObject({ can_host: false, can_access_clipboard: false });
    expect(await asUser(token, "/api/room/clipboard")).toBe(403);
  });

  it("reads the X idle time, which XTest input resets", async () => {
    const probe = createSlotIdleProbe({ url: () => slot.idleUrl });
    await sleep(1_200);
    expect(await probe.userIdleMs(name)).toBeGreaterThanOrEqual(1_000);
    await slot.xdotool("mousemove", "211", "157");
    expect(await probe.userIdleMs(name)).toBeLessThan(800);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm install && pnpm test -- apps/agent/src/live && pnpm test:int -- apps/agent/src/live/neko-live-view.int.test.ts`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement.**

`apps/agent/src/live/live-view.ts`:
```ts
/** A leased browser slot; B1's Slot is assignable to this. */
export interface Slot {
  readonly name: string;
}

/** Spec §10.1. One implementation: NekoLiveView. */
export interface LiveView {
  /** n.eko: host → that user's member session (one "user" member per slot; userId is audited by the caller). */
  giveControl(slot: Slot, userId: string): Promise<void>;
  /** n.eko: host → agent admin session; the user member loses hosting rights. */
  takeControl(slot: Slot): Promise<void>;
  /** Toggles can_access_clipboard on the user member. */
  setClipboardAccess(slot: Slot, on: boolean): Promise<void>;
}
```

`apps/agent/src/live/neko-admin.ts`:
```ts
import { NEKO_MEMBERS, NEKO_PORT } from "@mastertutor/contracts";
import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";

export class NekoApiError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string) {
    super(`n.eko ${path} answered HTTP ${status}`);
    this.name = "NekoApiError";
    this.status = status;
    this.path = path;
  }
}

export interface NekoAdminOptions {
  /** NEKO_ADMIN_SECRET (agent only). */
  adminSecret: string;
  baseUrl?: (slotName: string) => string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface NekoAdmin {
  request(slotName: string, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown>;
  /** Drops the cached token (e.g. when the slot is released and restarts). */
  forget(slotName: string): void;
}

/** n.eko REST as the per-slot "agent" admin member, with a cached bearer token. */
export function createNekoAdmin(options: NekoAdminOptions): NekoAdmin {
  const baseUrl = options.baseUrl ?? ((slot: string) => `http://${slot}:${NEKO_PORT}`);
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const tokens = new Map<string, Promise<string>>();

  function token(slotName: string): Promise<string> {
    let pending = tokens.get(slotName);
    if (!pending) {
      pending = loginNeko({
        baseUrl: baseUrl(slotName),
        username: NEKO_MEMBERS.agent,
        password: deriveNekoPassword(options.adminSecret, slotName),
        fetch: doFetch,
        timeoutMs,
      });
      tokens.set(slotName, pending);
      pending.catch(() => tokens.delete(slotName));
    }
    return pending;
  }

  async function send(
    slotName: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: unknown,
    retry: boolean,
  ): Promise<unknown> {
    const response = await doFetch(`${baseUrl(slotName)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await token(slotName)}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (response.status === 401 && retry) {
      tokens.delete(slotName);
      return send(slotName, method, path, body, false);
    }
    if (!response.ok) throw new NekoApiError(response.status, path);
    if (text === "") return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  return {
    request: (slotName, method, path, body) => send(slotName, method, path, body, true),
    forget: (slotName) => void tokens.delete(slotName),
  };
}
```

`apps/agent/src/live/neko-live-view.ts`:
```ts
import { NEKO_MEMBERS } from "@mastertutor/contracts";
import type { LiveView, Slot } from "./live-view.ts";
import { NekoApiError, type NekoAdmin } from "./neko-admin.ts";

export class LiveViewError extends Error {
  readonly code: "user_not_connected";
  constructor(code: "user_not_connected") {
    super("The user's live view session is not connected");
    this.name = "LiveViewError";
    this.code = code;
  }
}

export interface NekoLiveViewOptions {
  admin: NekoAdmin;
  /** How long giveControl waits for the user's n.eko session to exist (it is created by openLive). */
  giveTimeoutMs?: number;
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The only LiveView (spec §10.1), over n.eko's admin REST API. */
export function createNekoLiveView(options: NekoLiveViewOptions): LiveView {
  const { admin } = options;
  const user = NEKO_MEMBERS.user;
  const profile = (slot: Slot, patch: Record<string, boolean>) =>
    admin.request(slot.name, "POST", `/api/members/${user}`, patch);

  return {
    async giveControl(slot, _userId) {
      await profile(slot, { can_host: true });
      const deadline = Date.now() + (options.giveTimeoutMs ?? 2_000);
      for (;;) {
        try {
          await admin.request(slot.name, "POST", `/api/room/control/give/${user}`);
          return;
        } catch (error) {
          const missing = error instanceof NekoApiError && error.status === 404;
          if (!missing || Date.now() >= deadline) {
            await profile(slot, { can_host: false }).catch(() => undefined);
            throw missing ? new LiveViewError("user_not_connected") : error;
          }
        }
        await sleep(options.retryDelayMs ?? 100);
      }
    },
    async takeControl(slot) {
      await admin.request(slot.name, "POST", "/api/room/control/take");
      await profile(slot, { can_host: false });
    },
    async setClipboardAccess(slot, on) {
      await profile(slot, { can_access_clipboard: on });
    },
  };
}
```

`apps/agent/src/live/idle-probe.ts`:
```ts
import { SLOT_IDLE_PORT } from "@mastertutor/contracts";

export interface SlotIdleProbe {
  /** Milliseconds since the last X (n.eko/XTest) input in the slot; CDP input does not count. */
  userIdleMs(slotName: string): Promise<number>;
}

export function createSlotIdleProbe(
  options: { url?: (slotName: string) => string; fetch?: typeof fetch; timeoutMs?: number } = {},
): SlotIdleProbe {
  const url = options.url ?? ((slot: string) => `http://${slot}:${SLOT_IDLE_PORT}/`);
  return {
    async userIdleMs(slotName) {
      const response = await (options.fetch ?? fetch)(url(slotName), {
        signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
      });
      const text = (await response.text()).trim();
      if (!response.ok || !/^[0-9]{1,12}$/.test(text)) throw new Error(`slot ${slotName} idle probe gave no value`);
      return Number(text);
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run:
```bash
docker build -q -t mastertutor/browser-slot:local apps/browser-slot
pnpm test -- apps/agent/src/live && pnpm test:int -- apps/agent/src/live/neko-live-view.int.test.ts
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add apps/agent tests/support/slot.ts pnpm-lock.yaml
git commit -m "feat(agent): NekoLiveView over the n.eko admin API, slot idle probe, test-slot helper"
```

---

### Task 5: `openLive`: server-side n.eko login, signed `live_slot`, TURN credentials

**Files:**
- Create: `apps/web/lib/server/live/{cookie,open-live}.ts`
- Test: `apps/web/lib/server/live/cookie.test.ts`, `apps/web/lib/server/live/open-live.int.test.ts`

**Interfaces:**
- Consumes: `getRunForMember` (Task 2), `loginNeko`, `NekoLoginError`, `deriveNekoPassword`, `turnIceServers`, `OpenLiveResult`, `liveEmbedPath`, `livePath`, the cookie constants (Task 1), `startTestSlot` (Task 4) and the seed helpers.
- Produces:
  - **`cookie.ts`:**
    - `LiveSlotClaim` `{slotName, runId, userId, expiresAt}`;
    - `signLiveSlot(secret, claim): string`;
    - `verifyLiveSlot(secret, value, expected: {runId, userId, nowSeconds}): string | null` (returns the slot name);
    - `parseCookies(header: string | null): Map<string, string[]>`;
    - `liveSetCookies(runId, cookies: {name, value}[], maxAgeSeconds): string[]`.
  - **`open-live.ts`:**
    - `LiveDeps` `{sql, nekoMemberSecret, liveCookieSecret, turnSecret, turnUrls, nekoBaseUrl?, fetch?, nowSeconds?}`;
    - `LiveAccessError` (`code: "not_found" | "in_use" | "unavailable"`);
    - `OpenLiveOutcome` `{result: OpenLiveResult; setCookies: string[]}`;
    - `openLive(deps, {runId, userId}): Promise<OpenLiveOutcome>`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/server/live/cookie.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { liveSetCookies, parseCookies, signLiveSlot, verifyLiveSlot } from "./cookie.ts";

const secret = "live-cookie-secret-for-tests-0123456789";
const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const claim = { slotName: "browser-3", runId, userId: "user_a", expiresAt: 1_700_000_600 };

describe("live_slot signing", () => {
  it("round-trips and exposes the slot prefix Traefik routes on", () => {
    const value = signLiveSlot(secret, claim);
    expect(value).toMatch(/^browser-3\.1700000600\.[A-Za-z0-9_-]{43}$/);
    expect(verifyLiveSlot(secret, value, { runId, userId: "user_a", nowSeconds: 1_700_000_000 })).toBe("browser-3");
  });
  it("rejects other runs, other users, expiry, tampering and other secrets", () => {
    const value = signLiveSlot(secret, claim);
    const ok = { runId, userId: "user_a", nowSeconds: 1_700_000_000 };
    expect(verifyLiveSlot(secret, value, { ...ok, runId: "11111111-1111-4111-8111-111111111111" })).toBeNull();
    expect(verifyLiveSlot(secret, value, { ...ok, userId: "user_b" })).toBeNull();
    expect(verifyLiveSlot(secret, value, { ...ok, nowSeconds: 1_700_000_600 })).toBeNull();
    expect(verifyLiveSlot(secret, value.replace("browser-3", "browser-4"), ok)).toBeNull();
    expect(verifyLiveSlot(`${secret}x`, value, ok)).toBeNull();
    expect(verifyLiveSlot(secret, "browser-3.notanumber.x", ok)).toBeNull();
  });
});

describe("cookies", () => {
  it("parses repeated cookies in order", () => {
    const cookies = parseCookies("a=1; live_slot=x; b=2;live_slot=y");
    expect(cookies.get("live_slot")).toEqual(["x", "y"]);
    expect(cookies.get("a")).toEqual(["1"]);
    expect(parseCookies(null).size).toBe(0);
  });
  it("scopes Set-Cookie to the run's live path with strict attributes", () => {
    expect(liveSetCookies(runId, [{ name: "NEKO_SESSION", value: "tok" }], 60)).toEqual([
      `NEKO_SESSION=tok; Path=/live/${runId}/; Max-Age=60; HttpOnly; Secure; SameSite=Strict`,
    ]);
    expect(() => liveSetCookies(runId, [{ name: "NEKO_SESSION", value: "a;b" }], 60)).toThrow();
  });
});
```

`apps/web/lib/server/live/open-live.int.test.ts`:
```ts
import { LIVE_SLOT_COOKIE, NEKO_SESSION_COOKIE, liveEmbedPath } from "@mastertutor/contracts";
import { createDb, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { leaseSlot, releaseSlot, seedMember, seedRun } from "../../../../../tests/support/live-seed.ts";
import { TEST_NEKO_MEMBER_SECRET, startTestSlot, type TestSlot } from "../../../../../tests/support/slot.ts";
import { waitFor } from "../../../../../tests/support/wait.ts";
import { parseCookies, verifyLiveSlot } from "./cookie.ts";
import { LiveAccessError, openLive, type LiveDeps } from "./open-live.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let slot: TestSlot;
let deps: LiveDeps;
let member: { userId: string; workspaceId: string };
let outsider: { userId: string; workspaceId: string };
const now = 1_700_000_000;

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1"] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  slot = await startTestSlot();
  member = await seedMember(owner.sql);
  outsider = await seedMember(owner.sql);
  deps = {
    sql: web.sql,
    nekoMemberSecret: TEST_NEKO_MEMBER_SECRET,
    liveCookieSecret: "live-cookie-secret-for-tests-0123456789",
    turnSecret: "turn-secret-for-tests-0123456789abcdef",
    turnUrls: ["turn:203.0.113.7:3478?transport=udp"],
    nekoBaseUrl: () => slot.nekoUrl,
    nowSeconds: () => now,
  };
});
afterEach(async () => releaseSlot(owner.sql, "browser-1"));
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close(), slot?.stop()]);
  await testDb?.stop();
});

function cookieValue(setCookies: string[], name: string): string {
  const pair = setCookies.map((c) => c.split(";")[0]!).find((c) => c.startsWith(`${name}=`));
  return pair!.slice(name.length + 1);
}

describe("openLive", () => {
  it("says sleeping when the run holds no slot", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId, status: "sleeping" });
    expect(await openLive(deps, { runId, userId: member.userId })).toEqual({
      result: { sleeping: true },
      setCookies: [],
    });
  });

  it("logs into n.eko server-side and returns run-scoped cookies plus TURN servers", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await leaseSlot(owner.sql, "browser-1", runId);
    const { result, setCookies } = await openLive(deps, { runId, userId: member.userId });
    expect(result).toEqual({
      sleeping: false,
      slotName: "browser-1",
      embedPath: liveEmbedPath(runId),
      iceServers: [
        {
          urls: ["turn:203.0.113.7:3478?transport=udp"],
          username: `${now + 600}:${runId}`,
          credential: expect.any(String) as unknown as string,
        },
      ],
    });
    expect(setCookies).toHaveLength(2);
    for (const cookie of setCookies) {
      expect(cookie).toContain(`; Path=/live/${runId}/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`);
    }
    const slotValue = cookieValue(setCookies, LIVE_SLOT_COOKIE);
    expect(verifyLiveSlot(deps.liveCookieSecret, slotValue, { runId, userId: member.userId, nowSeconds: now })).toBe("browser-1");
    const whoami = await fetch(`${slot.nekoUrl}/api/whoami`, {
      headers: { cookie: `${NEKO_SESSION_COOKIE}=${cookieValue(setCookies, NEKO_SESSION_COOKIE)}` },
    });
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({ id: "user" });
    expect(JSON.stringify(setCookies)).not.toContain(TEST_NEKO_MEMBER_SECRET);
  });

  it("hides other workspaces' runs", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await expect(openLive(deps, { runId, userId: outsider.userId })).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports in_use while another tab is connected, then recovers when it closes (Review Focus 2)", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await leaseSlot(owner.sql, "browser-1", runId);
    const first = await openLive(deps, { runId, userId: member.userId });
    const token = parseCookies(first.setCookies.map((c) => c.split(";")[0]!).join("; ")).get(NEKO_SESSION_COOKIE)![0]!;
    const socket = new WebSocket(`${slot.nekoUrl.replace("http", "ws")}/api/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("ws failed")));
    });
    const error = await openLive(deps, { runId, userId: member.userId }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveAccessError);
    expect((error as LiveAccessError).code).toBe("in_use");
    socket.close();
    await waitFor(
      () => openLive(deps, { runId, userId: member.userId }).then((r) => !r.result.sleeping),
      { timeoutMs: 15_000, intervalMs: 500, what: "openLive after the other tab closed" },
    );
  });

  it("reports unavailable when the slot does not answer", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await leaseSlot(owner.sql, "browser-1", runId);
    await expect(
      openLive({ ...deps, nekoBaseUrl: () => "http://127.0.0.1:9" }, { runId, userId: member.userId }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/server/live && pnpm test:int -- apps/web/lib/server/live/open-live.int.test.ts`
Expected: FAIL, because `./cookie.ts` and `./open-live.ts` are missing.

- [ ] **Step 3: Implement.**

`apps/web/lib/server/live/cookie.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { SlotName, livePath } from "@mastertutor/contracts";

export interface LiveSlotClaim {
  slotName: string;
  runId: string;
  userId: string;
  expiresAt: number;
}

const VALUE = /^(browser-[1-9][0-9]?)\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/;
const COOKIE_VALUE = /^[A-Za-z0-9._-]{1,512}$/;

function mac(secret: string, claim: LiveSlotClaim): string {
  return createHmac("sha256", secret)
    .update(`v1|${claim.slotName}|${claim.runId}|${claim.userId}|${claim.expiresAt}`)
    .digest("base64url");
}

/** "browser-N.<expiry>.<hmac>": the prefix is what Traefik's per-slot HeaderRegexp matches. */
export function signLiveSlot(secret: string, claim: LiveSlotClaim): string {
  SlotName.parse(claim.slotName);
  return `${claim.slotName}.${claim.expiresAt}.${mac(secret, claim)}`;
}

/** The slot name if the cookie is genuine, unexpired and bound to this run and user; else null. */
export function verifyLiveSlot(
  secret: string,
  value: string,
  expected: { runId: string; userId: string; nowSeconds: number },
): string | null {
  const match = VALUE.exec(value);
  if (!match) return null;
  const [, slotName, expiry, signature] = match as unknown as [string, string, string, string];
  const expiresAt = Number(expiry);
  if (expiresAt <= expected.nowSeconds) return null;
  const want = Buffer.from(mac(secret, { slotName, runId: expected.runId, userId: expected.userId, expiresAt }));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got) ? slotName : null;
}

/** Every cookie occurrence by name, in header order (duplicates are kept on purpose). */
export function parseCookies(header: string | null): Map<string, string[]> {
  const cookies = new Map<string, string[]>();
  if (!header) return cookies;
  for (const part of header.split(/[;,]/)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    cookies.set(name, [...(cookies.get(name) ?? []), part.slice(index + 1).trim()]);
  }
  return cookies;
}

/** Set-Cookie values scoped to /live/<runId>/ (spec §10.2: HttpOnly; Secure; SameSite=Strict). */
export function liveSetCookies(
  runId: string,
  cookies: ReadonlyArray<{ name: string; value: string }>,
  maxAgeSeconds: number,
): string[] {
  const path = livePath(runId);
  return cookies.map(({ name, value }) => {
    if (!COOKIE_VALUE.test(value)) throw new TypeError(`Unsafe value for cookie ${name}`);
    return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
  });
}
```

`apps/web/lib/server/live/open-live.ts`:
```ts
import {
  LIVE_COOKIE_TTL_SECONDS,
  LIVE_SLOT_COOKIE,
  NEKO_MEMBERS,
  NEKO_PORT,
  NEKO_SESSION_COOKIE,
  OpenLiveResult,
  TURN_CREDENTIAL_TTL_SECONDS,
  liveEmbedPath,
} from "@mastertutor/contracts";
import { NekoLoginError, deriveNekoPassword, loginNeko, turnIceServers } from "@mastertutor/contracts/server";
import { getRunForMember, type DbHandle } from "@mastertutor/db";
import { liveSetCookies, signLiveSlot } from "./cookie.ts";

export interface LiveDeps {
  sql: DbHandle["sql"];
  nekoMemberSecret: string;
  liveCookieSecret: string;
  turnSecret: string;
  turnUrls: readonly string[];
  nekoBaseUrl?: (slotName: string) => string;
  fetch?: typeof fetch;
  nowSeconds?: () => number;
}

export class LiveAccessError extends Error {
  readonly code: "not_found" | "in_use" | "unavailable";
  constructor(code: "not_found" | "in_use" | "unavailable") {
    super(`live view ${code}`);
    this.name = "LiveAccessError";
    this.code = code;
  }
}

export interface OpenLiveOutcome {
  result: OpenLiveResult;
  setCookies: string[];
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const defaultNekoBaseUrl = (slot: string) => `http://${slot}:${NEKO_PORT}`;

/**
 * Spec §10.2.1. The caller has already authenticated the user. n.eko credentials never leave
 * the server; the browser gets the session token and the signed slot cookie, both scoped to
 * /live/<runId>/.
 */
export async function openLive(
  deps: LiveDeps,
  input: { runId: string; userId: string },
): Promise<OpenLiveOutcome> {
  const run = await getRunForMember(deps.sql, input.runId, input.userId);
  if (!run) throw new LiveAccessError("not_found");
  if (!run.slotLeased || run.slotName === null) return { result: { sleeping: true }, setCookies: [] };
  const slotName = run.slotName;
  const now = (deps.nowSeconds ?? nowSeconds)();

  let token: string;
  try {
    token = await loginNeko({
      baseUrl: (deps.nekoBaseUrl ?? defaultNekoBaseUrl)(slotName),
      username: NEKO_MEMBERS.user,
      password: deriveNekoPassword(deps.nekoMemberSecret, slotName),
      fetch: deps.fetch,
    });
  } catch (error) {
    if (error instanceof NekoLoginError && error.status === 422) throw new LiveAccessError("in_use");
    throw new LiveAccessError("unavailable");
  }

  const liveSlot = signLiveSlot(deps.liveCookieSecret, {
    slotName,
    runId: run.id,
    userId: input.userId,
    expiresAt: now + LIVE_COOKIE_TTL_SECONDS,
  });
  const setCookies = liveSetCookies(
    run.id,
    [
      { name: NEKO_SESSION_COOKIE, value: token },
      { name: LIVE_SLOT_COOKIE, value: liveSlot },
    ],
    LIVE_COOKIE_TTL_SECONDS,
  );
  const result = OpenLiveResult.parse({
    sleeping: false,
    slotName,
    embedPath: liveEmbedPath(run.id),
    iceServers: turnIceServers(deps.turnUrls, deps.turnSecret, run.id, now, TURN_CREDENTIAL_TTL_SECONDS),
  });
  return { result, setCookies };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/server/live && pnpm test:int -- apps/web/lib/server/live/open-live.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/lib/server/live
git commit -m "feat(web): openLive with server-side n.eko login, signed live_slot cookie and TURN credentials"
```

---

### Task 6: `/api/live/auth` ForwardAuth

**Files:**
- Create: `apps/web/lib/server/live/{authorize,deps}.ts`, `apps/web/app/api/live/auth/route.ts`
- Test: `apps/web/lib/server/live/authorize.test.ts`

**Interfaces:**
- Consumes: `parseCookies`, `verifyLiveSlot` (Task 5), `runIdFromLivePath`, `LIVE_SLOT_COOKIE`, `NEKO_SESSION_COOKIE`, `canAccessLiveSlot` (Task 2), `getAuth`, `getDb`, `getWebEnv` (Phase 0).
- Produces:
  - **`authorize.ts`:**
    - `AuthorizeDeps` `{liveCookieSecret, canAccess(q): Promise<boolean>, nowSeconds?}`;
    - `AuthorizeInput` `{forwardedUri, cookieHeader, userId}`;
    - `AuthorizeDecision` = `{allow: true; upstreamCookie: string | null}` or `{allow: false; status: 401 | 403}`;
    - `authorizeLive(deps, input)`.
  - **`deps.ts`:** `getLiveDeps(): LiveDeps`, `getAuthorizeDeps(): AuthorizeDeps`, `sessionUserId(headers?: Headers): Promise<string | null>`.
  - **Route:** `GET /api/live/auth` answers 200 with header `Cookie: NEKO_SESSION=…` (or no Cookie), or 401/403. It is never cacheable.

- [ ] **Step 1: Write the failing test.**

`apps/web/lib/server/live/authorize.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { authorizeLive, type AuthorizeDeps } from "./authorize.ts";
import { signLiveSlot } from "./cookie.ts";

const secret = "live-cookie-secret-for-tests-0123456789";
const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const userId = "user_a";
const now = 1_700_000_000;
const cookie = (slotName: string, forRun = runId, forUser = userId) =>
  `live_slot=${signLiveSlot(secret, { slotName, runId: forRun, userId: forUser, expiresAt: now + 600 })}`;

function deps(leased: Record<string, string>): AuthorizeDeps & { queries: unknown[] } {
  const queries: unknown[] = [];
  return {
    queries,
    liveCookieSecret: secret,
    nowSeconds: () => now,
    canAccess: async (q) => {
      queries.push(q);
      return leased[q.slotName] === q.runId && q.userId === userId;
    },
  };
}

const input = (cookieHeader: string | null, uri = `/live/${runId}/api/ws`, user: string | null = userId) => ({
  forwardedUri: uri,
  cookieHeader,
  userId: user,
});

describe("authorizeLive (spec §10.2.2, §12 live-view auth)", () => {
  it("allows a signed cookie for the leased slot and forwards only NEKO_SESSION upstream", async () => {
    const d = deps({ "browser-1": runId });
    expect(
      await authorizeLive(d, input(`better-auth.session_token=s3cr3t; ${cookie("browser-1")}; NEKO_SESSION=tok123`)),
    ).toEqual({ allow: true, upstreamCookie: "NEKO_SESSION=tok123" });
    expect(d.queries).toEqual([{ runId, slotName: "browser-1", userId }]);
  });

  it("allows without an n.eko cookie but forwards none", async () => {
    expect(await authorizeLive(deps({ "browser-1": runId }), input(cookie("browser-1")))).toEqual({
      allow: true,
      upstreamCookie: null,
    });
  });

  it("rejects no session, bad paths, missing or forged cookies", async () => {
    const d = deps({ "browser-1": runId });
    expect(await authorizeLive(d, input(cookie("browser-1"), undefined, null))).toEqual({ allow: false, status: 401 });
    expect(await authorizeLive(d, input(cookie("browser-1"), "/api/auth/session"))).toEqual({ allow: false, status: 403 });
    expect(await authorizeLive(d, input(null))).toEqual({ allow: false, status: 401 });
    const forged = cookie("browser-1").replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(await authorizeLive(d, input(forged))).toEqual({ allow: false, status: 401 });
    expect(await authorizeLive(d, input(cookie("browser-1", runId, "user_b")))).toEqual({ allow: false, status: 401 });
    expect(d.queries).toEqual([]);
  });

  it("rejects duplicate live_slot cookies so Traefik and auth can never disagree (Review Focus 1)", async () => {
    const d = deps({ "browser-1": runId });
    expect(await authorizeLive(d, input(`${cookie("browser-1")}; live_slot=browser-2.1700000600.x`))).toEqual({
      allow: false,
      status: 401,
    });
    expect(d.queries).toEqual([]);
  });

  it("rejects a slot leased to another run, an idle slot or a stale cookie", async () => {
    expect(await authorizeLive(deps({ "browser-1": "other-run" }), input(cookie("browser-1")))).toEqual({
      allow: false,
      status: 403,
    });
    expect(await authorizeLive(deps({}), input(cookie("browser-2")))).toEqual({ allow: false, status: 403 });
  });

  it("never forwards a malformed n.eko cookie value", async () => {
    expect(
      await authorizeLive(deps({ "browser-1": runId }), input(`${cookie("browser-1")}; NEKO_SESSION=a\r\nX: y`)),
    ).toEqual({ allow: true, upstreamCookie: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/lib/server/live/authorize.test.ts`
Expected: FAIL, because `./authorize.ts` is missing.

- [ ] **Step 3: Implement.**

`apps/web/lib/server/live/authorize.ts`:
```ts
import { LIVE_SLOT_COOKIE, NEKO_SESSION_COOKIE, runIdFromLivePath } from "@mastertutor/contracts";
import { parseCookies, verifyLiveSlot } from "./cookie.ts";

export interface AuthorizeDeps {
  liveCookieSecret: string;
  canAccess(query: { runId: string; slotName: string; userId: string }): Promise<boolean>;
  nowSeconds?: () => number;
}

export interface AuthorizeInput {
  /** Traefik's X-Forwarded-Uri (ForwardAuth runs before StripPrefixRegex). */
  forwardedUri: string | null;
  cookieHeader: string | null;
  /** Better Auth session user, or null. */
  userId: string | null;
}

export type AuthorizeDecision =
  | { allow: true; upstreamCookie: string | null }
  | { allow: false; status: 401 | 403 };

const NEKO_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Spec §10.2.2: 200 only if the live_slot signature is valid, browser_slots[N].run_id equals the
 * path's run, and the session user belongs to that run's workspace. Exactly one live_slot cookie
 * is accepted, so the cookie Traefik routed on is the one verified here.
 */
export async function authorizeLive(deps: AuthorizeDeps, input: AuthorizeInput): Promise<AuthorizeDecision> {
  if (!input.userId) return { allow: false, status: 401 };
  const runId = input.forwardedUri ? runIdFromLivePath(input.forwardedUri) : null;
  if (!runId) return { allow: false, status: 403 };
  const cookies = parseCookies(input.cookieHeader);
  const slotCookies = cookies.get(LIVE_SLOT_COOKIE) ?? [];
  if (slotCookies.length !== 1) return { allow: false, status: 401 };
  const slotName = verifyLiveSlot(deps.liveCookieSecret, slotCookies[0]!, {
    runId,
    userId: input.userId,
    nowSeconds: (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))(),
  });
  if (!slotName) return { allow: false, status: 401 };
  if (!(await deps.canAccess({ runId, slotName, userId: input.userId }))) return { allow: false, status: 403 };
  const neko = cookies.get(NEKO_SESSION_COOKIE)?.[0];
  return {
    allow: true,
    upstreamCookie: neko && NEKO_TOKEN.test(neko) ? `${NEKO_SESSION_COOKIE}=${neko}` : null,
  };
}
```

`apps/web/lib/server/live/deps.ts`:
```ts
import { canAccessLiveSlot } from "@mastertutor/db";
import { getAuth } from "../auth.ts";
import { getDb } from "../db.ts";
import { getWebEnv } from "../env.ts";
import type { AuthorizeDeps } from "./authorize.ts";
import type { LiveDeps } from "./open-live.ts";

let liveDeps: LiveDeps | undefined;
let authorizeDeps: AuthorizeDeps | undefined;

export function getLiveDeps(): LiveDeps {
  if (!liveDeps) {
    const env = getWebEnv();
    liveDeps = {
      sql: getDb().sql,
      nekoMemberSecret: env.NEKO_MEMBER_SECRET,
      liveCookieSecret: env.LIVE_COOKIE_SECRET,
      turnSecret: env.TURN_SECRET,
      turnUrls: env.TURN_URLS,
    };
  }
  return liveDeps;
}

export function getAuthorizeDeps(): AuthorizeDeps {
  authorizeDeps ??= {
    liveCookieSecret: getWebEnv().LIVE_COOKIE_SECRET,
    canAccess: (query) => canAccessLiveSlot(getDb().sql, query),
  };
  return authorizeDeps;
}

export async function sessionUserId(headers?: Headers): Promise<string | null> {
  if (!headers) return null;
  const session = await getAuth()
    .api.getSession({ headers })
    .catch(() => null);
  return session?.user.id ?? null;
}
```

`apps/web/app/api/live/auth/route.ts`:
```ts
import { authorizeLive } from "../../../../lib/server/live/authorize.ts";
import { getAuthorizeDeps, sessionUserId } from "../../../../lib/server/live/deps.ts";

export const dynamic = "force-dynamic";

/**
 * Traefik ForwardAuth for /live/<runId>/ (spec §10.2.2). Traefik copies this response's Cookie
 * header onto the upstream request (authResponseHeaders: Cookie), so n.eko only ever receives
 * NEKO_SESSION, never the Better Auth or live_slot cookies.
 */
export async function GET(request: Request): Promise<Response> {
  const decision = await authorizeLive(getAuthorizeDeps(), {
    forwardedUri: request.headers.get("x-forwarded-uri"),
    cookieHeader: request.headers.get("cookie"),
    userId: await sessionUserId(request.headers),
  });
  const headers = new Headers({ "cache-control": "no-store" });
  if (!decision.allow) return new Response(null, { status: decision.status, headers });
  if (decision.upstreamCookie) headers.set("cookie", decision.upstreamCookie);
  return new Response(null, { status: 200, headers });
}
```

- [ ] **Step 4: Run the tests and the build to verify they pass.**

Run: `pnpm test -- apps/web && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web build`
Expected: PASS. `/api/live/auth` is listed as dynamic (ƒ).

- [ ] **Step 5: Commit.**
```bash
git add apps/web
git commit -m "feat(web): /api/live/auth ForwardAuth with single-cookie rule and upstream cookie rewrite"
```

---

### Task 7: oRPC procedures `runs.openLive`, `runs.takeControl`, `runs.handBack`

**Files:**
- Create: `apps/web/lib/server/live/procedures.ts`
- Modify: `apps/web/package.json`, adding `"@orpc/server": "1.15.4"`
- Test: `apps/web/lib/server/live/procedures.int.test.ts`

**Interfaces:**
- Consumes: `apiContract`, `openLive`/`LiveAccessError`/`LiveDeps` (Task 5), `requestTakeover`/`requestHandBack` (Task 2), `getLiveDeps`/`sessionUserId` (Task 6).
- Produces:
  - `LiveRpcContext` `{reqHeaders?: Headers; resHeaders?: Headers}`;
  - `LiveProcedureDeps` `{live: LiveDeps; resolveUserId(headers?): Promise<string | null>}`;
  - `createLiveProcedures(deps)` returning `{openLive, takeControl, handBack}` (implementations of `apiContract.runs.*`);
  - `getLiveProcedures()` (memoized for production).

  Phase 7 mounts these in the router, with `RequestHeadersPlugin` and `ResponseHeadersPlugin`.

- [ ] **Step 1: Write the failing test.**

`apps/web/lib/server/live/procedures.int.test.ts`:
```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeNotify } from "@mastertutor/contracts";
import { createDb, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { call } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leaseSlot, seedMember, seedRun } from "../../../../../tests/support/live-seed.ts";
import { nextNotification } from "../../../../../tests/support/notify.ts";
import { createLiveProcedures } from "./procedures.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let fakeNeko: Server;
let nekoStatus = 200;
let member: { userId: string; workspaceId: string };
let procedures: ReturnType<typeof createLiveProcedures>;

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1"] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  member = await seedMember(owner.sql);
  fakeNeko = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (nekoStatus !== 200) return void res.writeHead(nekoStatus).end();
      res.writeHead(200, { "set-cookie": "NEKO_SESSION=faketoken; Path=/" }).end('{"id":"user"}');
    });
  });
  await new Promise<void>((resolve) => fakeNeko.listen(0, "127.0.0.1", resolve));
  const port = (fakeNeko.address() as AddressInfo).port;
  procedures = createLiveProcedures({
    live: {
      sql: web.sql,
      nekoMemberSecret: "neko-member-secret-for-tests-0123456789",
      liveCookieSecret: "live-cookie-secret-for-tests-0123456789",
      turnSecret: "turn-secret-for-tests-0123456789abcdef",
      turnUrls: [],
      nekoBaseUrl: () => `http://127.0.0.1:${port}`,
    },
    resolveUserId: async (headers) => headers?.get("x-test-user") ?? null,
  });
});
afterAll(async () => {
  fakeNeko?.close();
  await Promise.all([owner?.close(), web?.close()]);
  await testDb?.stop();
});

const as = (userId: string | null) => {
  const reqHeaders = new Headers(userId ? { "x-test-user": userId } : {});
  return { context: { reqHeaders, resHeaders: new Headers() } };
};

describe("live procedures", () => {
  it("requires a session", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await expect(call(procedures.openLive, { runId }, as(null))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(call(procedures.takeControl, { runId }, as(null))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("openLive sets both cookies through resHeaders", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await leaseSlot(owner.sql, "browser-1", runId);
    const options = as(member.userId);
    const result = await call(procedures.openLive, { runId }, options);
    expect(result).toMatchObject({ sleeping: false, slotName: "browser-1", iceServers: [] });
    expect(options.context.resHeaders.getSetCookie()).toHaveLength(2);
  });

  it("maps n.eko conflicts and outages to CONFLICT and SERVICE_UNAVAILABLE", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    await owner.sql`update browser_slots set state = 'idle', run_id = null where name = 'browser-1'`;
    await owner.sql`update runs set slot_name = null where slot_name = 'browser-1'`;
    await leaseSlot(owner.sql, "browser-1", runId);
    nekoStatus = 422;
    await expect(call(procedures.openLive, { runId }, as(member.userId))).rejects.toMatchObject({ code: "CONFLICT" });
    nekoStatus = 500;
    await expect(call(procedures.openLive, { runId }, as(member.userId))).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    nekoStatus = 200;
  });

  it("takeControl and handBack drive the DB and NOTIFY, with NOT_FOUND and CONFLICT errors", async () => {
    const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
    const takeover = await nextNotification(owner.sql, "run_control", () =>
      call(procedures.takeControl, { runId }, as(member.userId)),
    );
    expect(decodeNotify("run_control", takeover)).toEqual({ runId });
    const back = await nextNotification(owner.sql, "run_control", () =>
      call(procedures.handBack, { runId, note: "All yours" }, as(member.userId)),
    );
    expect(decodeNotify("run_control", back)).toEqual({ runId });
    const outsider = await seedMember(owner.sql);
    await expect(call(procedures.takeControl, { runId }, as(outsider.userId))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const done = await seedRun(owner.sql, { workspaceId: member.workspaceId, status: "cancelled" });
    await expect(call(procedures.handBack, { runId: done, note: null }, as(member.userId))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm install && pnpm test:int -- apps/web/lib/server/live/procedures.int.test.ts`
Expected: FAIL, because `./procedures.ts` is missing.

- [ ] **Step 3: Implement.**

`apps/web/lib/server/live/procedures.ts`:
```ts
import { apiContract } from "@mastertutor/contracts";
import { requestHandBack, requestTakeover, type ControlRequestResult } from "@mastertutor/db";
import { ORPCError, implement } from "@orpc/server";
import { getLiveDeps, sessionUserId } from "./deps.ts";
import { LiveAccessError, openLive, type LiveDeps } from "./open-live.ts";

/** Phase 7's handler must install RequestHeadersPlugin and ResponseHeadersPlugin. */
export interface LiveRpcContext {
  reqHeaders?: Headers;
  resHeaders?: Headers;
}

export interface LiveProcedureDeps {
  live: LiveDeps;
  resolveUserId(headers?: Headers): Promise<string | null>;
}

function accessError(error: LiveAccessError): Error {
  switch (error.code) {
    case "not_found":
      return new ORPCError("NOT_FOUND", { message: "Run not found" });
    case "in_use":
      return new ORPCError("CONFLICT", { message: "The live view is open in another tab" });
    case "unavailable":
      return new ORPCError("SERVICE_UNAVAILABLE", { message: "The browser is not answering; retry shortly" });
  }
}

function controlError(result: Extract<ControlRequestResult, { ok: false }>): Error {
  return result.reason === "not_found"
    ? new ORPCError("NOT_FOUND", { message: "Run not found" })
    : new ORPCError("CONFLICT", { message: "The run has finished" });
}

export function createLiveProcedures(deps: LiveProcedureDeps) {
  const os = implement(apiContract).$context<LiveRpcContext>();
  const requireUser = async (context: LiveRpcContext) => {
    const userId = await deps.resolveUserId(context.reqHeaders);
    if (!userId) throw new ORPCError("UNAUTHORIZED");
    return userId;
  };

  return {
    openLive: os.runs.openLive.handler(async ({ input, context }) => {
      const userId = await requireUser(context);
      const resHeaders = context.resHeaders;
      if (!resHeaders) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "runs.openLive needs ResponseHeadersPlugin" });
      }
      try {
        const outcome = await openLive(deps.live, { runId: input.runId, userId });
        for (const cookie of outcome.setCookies) resHeaders.append("set-cookie", cookie);
        return outcome.result;
      } catch (error) {
        if (error instanceof LiveAccessError) throw accessError(error);
        throw error;
      }
    }),
    takeControl: os.runs.takeControl.handler(async ({ input, context }) => {
      const result = await requestTakeover(deps.live.sql, { runId: input.runId, userId: await requireUser(context) });
      if (!result.ok) throw controlError(result);
      return { ok: true as const };
    }),
    handBack: os.runs.handBack.handler(async ({ input, context }) => {
      const result = await requestHandBack(deps.live.sql, {
        runId: input.runId,
        userId: await requireUser(context),
        note: input.note,
      });
      if (!result.ok) throw controlError(result);
      return { ok: true as const };
    }),
  };
}

let cached: ReturnType<typeof createLiveProcedures> | undefined;

export function getLiveProcedures(): ReturnType<typeof createLiveProcedures> {
  cached ??= createLiveProcedures({ live: getLiveDeps(), resolveUserId: sessionUserId });
  return cached;
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test:int -- apps/web/lib/server/live/procedures.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): runs.openLive/takeControl/handBack oRPC procedures"
```

---

### Task 8: Agent control lock: `ControlCoordinator` and the `run_control` listener

**Files:**
- Create: `apps/agent/src/live/{ports,control}.ts`
- Test: `apps/agent/src/live/control.int.test.ts`

**Interfaces:**
- Consumes:
  - `LiveView`, `Slot`, `SlotIdleProbe`, `NekoAdmin` (Task 4);
  - `getRunControl`, `markTakeoverWaiting`, `markHandBackRunning`, `revertToAgent`, `appendRunEvent` (Task 2);
  - `requestTakeover` / `requestHandBack` (tests);
  - `AUTO_HAND_BACK_IDLE_MS`, `TAKEOVER_ABORT_TARGET_MS`, `encodeNotify`, `decodeNotify`.
- Produces:
  - **`ports.ts`:**
    - `LiveSessionPort` `{setController(holder: Controller): void; newBrowserCdpSession(): Promise<CDPSession>}`;
    - `AbortPort` `{abort(runId, reason): void; renew(runId): void}`;
    - `ApprovalPort` `{request(runId, request: ApprovalRequest): Promise<PolicyDecision>}`;
    - `LeasedRun` `{runId, workspaceId, slot: Slot, session: LiveSessionPort}`.
  - **`control.ts`:**
    - `ControlCoordinatorDeps` `{sql, liveView, idleProbe, aborts, log, idleLimitMs?, idleRecheckFloorMs?}`;
    - `ControlCoordinator` `{attach(run): Promise<void>; detach(runId): void; onRunControl(runId): Promise<void>; holder(runId): Controller | null}`;
    - `createControlCoordinator(deps)`;
    - `listenRunControl(sql, coordinator, log): Promise<() => Promise<void>>`.
  - **Events emitted:**
    - `control {holder}`;
    - `status {waiting, takeover}` and `status {running}`;
    - `error {code:"takeover_failed"}`;
    - `NOTIFY run_wake {reason:"resume"}` on hand-back.

- [ ] **Step 1: Write the failing test.**

`apps/agent/src/live/control.int.test.ts`:
```ts
import {
  TAKEOVER_ABORT_TARGET_MS,
  decodeNotify,
  type Controller,
  type RunEvent,
} from "@mastertutor/contracts";
import { createLogger, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { createDb, getRunControl, requestHandBack, requestTakeover, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { leaseSlot, releaseSlot, seedMember, seedRun } from "../../../../tests/support/live-seed.ts";
import { nextNotification } from "../../../../tests/support/notify.ts";
import { TEST_NEKO_ADMIN_SECRET, TEST_NEKO_MEMBER_SECRET, startTestSlot, type TestSlot } from "../../../../tests/support/slot.ts";
import { sleep, waitFor } from "../../../../tests/support/wait.ts";
import { createControlCoordinator, listenRunControl } from "./control.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createNekoAdmin, type NekoAdmin } from "./neko-admin.ts";
import { createNekoLiveView } from "./neko-live-view.ts";
import type { LeasedRun } from "./ports.ts";

const SLOT = "browser-1";
const log = createLogger({ service: "test", level: "silent" });
let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let agent: DbHandle;
let slot: TestSlot;
let admin: NekoAdmin;
let member: { userId: string; workspaceId: string };
const cleanups: Array<() => Promise<void> | void> = [];

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: [SLOT] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 4 });
  slot = await startTestSlot();
  admin = createNekoAdmin({ adminSecret: TEST_NEKO_ADMIN_SECRET, baseUrl: () => slot.nekoUrl });
  member = await seedMember(owner.sql);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await releaseSlot(owner.sql, SLOT);
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close(), agent?.close(), slot?.stop()]);
  await testDb?.stop();
});

async function harness(options: { idleLimitMs?: number; giveTimeoutMs?: number } = {}) {
  const aborts = {
    events: [] as Array<{ kind: "abort" | "renew"; at: number }>,
    abort: () => void aborts.events.push({ kind: "abort", at: performance.now() }),
    renew: () => void aborts.events.push({ kind: "renew", at: performance.now() }),
  };
  const session = {
    controller: "agent" as Controller,
    setController(holder: Controller) {
      session.controller = holder;
    },
    newBrowserCdpSession: () => Promise.reject(new Error("not used")),
  };
  const coordinator = createControlCoordinator({
    sql: agent.sql,
    liveView: createNekoLiveView({ admin, giveTimeoutMs: options.giveTimeoutMs ?? 2_000 }),
    idleProbe: createSlotIdleProbe({ url: () => slot.idleUrl }),
    aborts,
    log,
    idleLimitMs: options.idleLimitMs,
    idleRecheckFloorMs: 200,
  });
  const unlisten = await listenRunControl(agent.sql, coordinator, log);
  const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
  await leaseSlot(owner.sql, SLOT, runId);
  const leased: LeasedRun = { runId, workspaceId: member.workspaceId, slot: { name: SLOT }, session };
  cleanups.push(async () => {
    coordinator.detach(runId);
    await unlisten();
  });
  return { aborts, session, coordinator, runId, leased };
}

const loginUser = () =>
  loginNeko({ baseUrl: slot.nekoUrl, username: "user", password: deriveNekoPassword(TEST_NEKO_MEMBER_SECRET, SLOT) });
const nekoHost = async () => ((await admin.request(SLOT, "GET", "/api/room/control")) as { host_id?: string }).host_id;
const userProfile = async () =>
  (await admin.request(SLOT, "GET", "/api/members/user")) as { can_host: boolean; can_access_clipboard: boolean };
const events = async (runId: string) =>
  (await owner.sql`select payload from run_events where run_id = ${runId} order by id`).map((r) => r.payload as RunEvent);
const controlEvents = async (runId: string) => (await events(runId)).filter((e) => e.type === "control");

describe("ControlCoordinator (spec §10.3, §12 takeover lock)", () => {
  it("aborts within the target, guards the session and hands n.eko and the clipboard to the user", async () => {
    await loginUser();
    const h = await harness();
    await h.coordinator.attach(h.leased);
    expect(await nekoHost()).toBe("agent");
    expect(h.aborts.events).toEqual([]);

    const t0 = performance.now();
    expect(await requestTakeover(web.sql, { runId: h.runId, userId: member.userId })).toEqual({ ok: true, via: "control" });
    const abort = await waitFor(() => h.aborts.events.find((e) => e.kind === "abort"));
    expect(abort.at - t0).toBeLessThan(TAKEOVER_ABORT_TARGET_MS);
    expect(h.session.controller).toBe("user");
    await waitFor(async () => (await nekoHost()) === "user", { what: "n.eko host = user" });
    await waitFor(async () => (await userProfile()).can_access_clipboard, { what: "clipboard on" });
    await waitFor(async () => (await controlEvents(h.runId)).at(-1)?.holder === "user");
    expect(h.coordinator.holder(h.runId)).toBe("user");
  });

  it("hands back: n.eko to the agent, clipboard off, signal renewed, status running, loop woken", async () => {
    await loginUser();
    const h = await harness();
    await h.coordinator.attach(h.leased);
    await requestTakeover(web.sql, { runId: h.runId, userId: member.userId });
    await waitFor(() => h.coordinator.holder(h.runId) === "user");

    const wake = await nextNotification(owner.sql, "run_wake", () =>
      requestHandBack(web.sql, { runId: h.runId, userId: member.userId, note: "Done, continue" }),
    );
    expect(decodeNotify("run_wake", wake)).toEqual({ runId: h.runId, reason: "resume" });
    expect(await nekoHost()).toBe("agent");
    expect(await userProfile()).toMatchObject({ can_host: false, can_access_clipboard: false });
    expect(h.session.controller).toBe("agent");
    expect(h.aborts.events.at(-1)?.kind).toBe("renew");
    expect(await getRunControl(agent.sql, h.runId)).toMatchObject({ status: "running", waitReason: null });
    expect((await events(h.runId)).map((e) => e.type)).toEqual(
      expect.arrayContaining(["control", "user_message", "status"]),
    );
    expect((await controlEvents(h.runId)).at(-1)).toEqual({ type: "control", holder: "agent" });
  });

  it("while the agent controls, the user member cannot host or read the clipboard", async () => {
    const token = await loginUser();
    const h = await harness();
    await h.coordinator.attach(h.leased);
    const status = (path: string) =>
      fetch(`${slot.nekoUrl}${path}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);
    expect(await status("/api/room/control")).toBe(403);
    expect(await status("/api/room/clipboard")).toBe(403);
    expect(
      await fetch(`${slot.nekoUrl}/api/room/control/request`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }).then((r) => r.status),
    ).toBe(403);
  });

  it("returns control to the agent when the user's live view is not connected (Review Focus 3)", async () => {
    await admin.request(SLOT, "DELETE", "/api/sessions/user").catch(() => null);
    const h = await harness({ giveTimeoutMs: 300 });
    await h.coordinator.attach(h.leased);
    await requestTakeover(web.sql, { runId: h.runId, userId: member.userId });
    await waitFor(async () => (await getRunControl(agent.sql, h.runId))?.controller === "agent", {
      timeoutMs: 3_000,
      what: "control reverted",
    });
    await waitFor(async () => (await controlEvents(h.runId)).at(-1)?.holder === "agent");
    expect((await events(h.runId)).find((e) => e.type === "error")).toMatchObject({ code: "takeover_failed" });
    expect(h.session.controller).toBe("agent");
    expect(await getRunControl(agent.sql, h.runId)).toMatchObject({ status: "running" });
    expect(await nekoHost()).toBe("agent");
  });

  it("serializes rapid takeover → hand back → takeover (Review Focus 5)", async () => {
    await loginUser();
    const h = await harness();
    await h.coordinator.attach(h.leased);
    await requestTakeover(web.sql, { runId: h.runId, userId: member.userId });
    await requestHandBack(web.sql, { runId: h.runId, userId: member.userId, note: null });
    await requestTakeover(web.sql, { runId: h.runId, userId: member.userId });
    await waitFor(async () => (await nekoHost()) === "user" && h.coordinator.holder(h.runId) === "user", {
      what: "settled on user",
    });
    await sleep(500);
    expect(await getRunControl(agent.sql, h.runId)).toMatchObject({ controller: "user", status: "waiting" });
    expect(h.session.controller).toBe("user");
    expect((await controlEvents(h.runId)).at(-1)).toEqual({ type: "control", holder: "user" });
  });

  it("applies a takeover requested while the run slept, without aborting the restore", async () => {
    await loginUser();
    const h = await harness();
    await owner.sql`update runs set status = 'sleeping', slot_name = null where id = ${h.runId}`;
    await owner.sql`update browser_slots set state = 'idle', run_id = null where name = ${SLOT}`;
    expect(await requestTakeover(web.sql, { runId: h.runId, userId: member.userId })).toEqual({ ok: true, via: "wake" });
    await owner.sql`update runs set status = 'running', wake_requested_at = null where id = ${h.runId}`;
    await leaseSlot(owner.sql, SLOT, h.runId);
    await h.coordinator.attach(h.leased);
    expect(await nekoHost()).toBe("user");
    expect(h.aborts.events).toEqual([]);
    expect(h.session.controller).toBe("user");
    expect(await getRunControl(agent.sql, h.runId)).toMatchObject({ status: "waiting", waitReason: "takeover" });
  });

  it("hands back automatically after the idle limit, but not while the user keeps moving", async () => {
    await loginUser();
    const h = await harness({ idleLimitMs: 2_500 });
    await h.coordinator.attach(h.leased);
    await requestTakeover(web.sql, { runId: h.runId, userId: member.userId });
    await waitFor(() => h.coordinator.holder(h.runId) === "user");
    const until = Date.now() + 4_000;
    for (let i = 0; Date.now() < until; i += 1) {
      await slot.xdotool("mousemove", String(100 + (i % 50) * 3), String(120 + (i % 7)));
      await sleep(400);
    }
    expect((await getRunControl(agent.sql, h.runId))?.controller).toBe("user");
    await waitFor(async () => (await getRunControl(agent.sql, h.runId))?.controller === "agent", {
      timeoutMs: 8_000,
      what: "auto hand-back",
    });
    await waitFor(async () => (await nekoHost()) === "agent");
    expect(h.session.controller).toBe("agent");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test:int -- apps/agent/src/live/control.int.test.ts`
Expected: FAIL, because `./control.ts` and `./ports.ts` are missing.

- [ ] **Step 3: Implement.**

`apps/agent/src/live/ports.ts`:
```ts
import type { ApprovalRequest, Controller, PolicyDecision } from "@mastertutor/contracts";
import type { CDPSession } from "playwright-core";
import type { Slot } from "./live-view.ts";

/** The slice of B1's BrowserSession that B6 needs (bound in b1-adapters.ts). */
export interface LiveSessionPort {
  /** B1 guard: "user" ⇒ CDP Input.* and model screenshots throw ControlHeld. */
  setController(holder: Controller): void;
  /** A browser-level CDP session (Browser.* domain) on the slot's Chromium. */
  newBrowserCdpSession(): Promise<CDPSession>;
}

/** B1's per-run AbortController registry. */
export interface AbortPort {
  abort(runId: string, reason: string): void;
  renew(runId: string): void;
}

/** B1's out-of-band approval request (writes approvals, applies the policy, may set waiting(approval)). */
export interface ApprovalPort {
  request(runId: string, request: ApprovalRequest): Promise<PolicyDecision>;
}

/** A run that this agent holds on a slot. */
export interface LeasedRun {
  runId: string;
  workspaceId: string;
  slot: Slot;
  session: LiveSessionPort;
}
```

`apps/agent/src/live/control.ts`:
```ts
import { AUTO_HAND_BACK_IDLE_MS, decodeNotify, encodeNotify, type Controller } from "@mastertutor/contracts";
import type { createLogger } from "@mastertutor/contracts/server";
import {
  appendRunEvent,
  getRunControl,
  markHandBackRunning,
  markTakeoverWaiting,
  revertToAgent,
  type DbHandle,
} from "@mastertutor/db";
import type { SlotIdleProbe } from "./idle-probe.ts";
import type { LiveView } from "./live-view.ts";
import type { AbortPort, LeasedRun } from "./ports.ts";

type Logger = ReturnType<typeof createLogger>;
type Sql = DbHandle["sql"];

export interface ControlCoordinatorDeps {
  sql: Sql;
  liveView: LiveView;
  idleProbe: SlotIdleProbe;
  aborts: AbortPort;
  log: Logger;
  idleLimitMs?: number;
  idleRecheckFloorMs?: number;
}

export interface ControlCoordinator {
  /** Call right after the slot is leased and the BrowserSession is open, before restore. */
  attach(run: LeasedRun): Promise<void>;
  /** Call before the slot is released. */
  detach(runId: string): void;
  /** NOTIFY run_control handler. */
  onRunControl(runId: string): Promise<void>;
  holder(runId: string): Controller | null;
}

interface Entry {
  run: LeasedRun;
  holder: Controller | null;
  chain: Promise<void>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Spec §10.3. CDP input bypasses X, so the lock is code-owned: runs.controller (DB, set by web)
 * plus the session guard and the run's AbortController (here). Transitions are serialized per run
 * and always re-read the DB, so rapid clicks settle on the latest state.
 */
export function createControlCoordinator(deps: ControlCoordinatorDeps): ControlCoordinator {
  const entries = new Map<string, Entry>();
  const idleLimitMs = deps.idleLimitMs ?? AUTO_HAND_BACK_IDLE_MS;
  const floorMs = deps.idleRecheckFloorMs ?? 1_000;

  function enqueue(runId: string, work: (entry: Entry) => Promise<void>): Promise<void> {
    const entry = entries.get(runId);
    if (!entry) return Promise.resolve();
    const next = entry.chain
      .then(() => (entries.get(runId) === entry ? work(entry) : undefined))
      .catch((error: unknown) => deps.log.error({ err: error, runId }, "control transition failed"));
    entry.chain = next;
    return next;
  }

  function clearIdle(entry: Entry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  function scheduleIdleCheck(entry: Entry, delayMs: number): void {
    clearIdle(entry);
    entry.idleTimer = setTimeout(() => void enqueue(entry.run.runId, checkIdle), Math.max(delayMs, floorMs));
    entry.idleTimer.unref?.();
  }

  async function checkIdle(entry: Entry): Promise<void> {
    if (entry.holder !== "user") return;
    let idleMs: number;
    try {
      idleMs = await deps.idleProbe.userIdleMs(entry.run.slot.name);
    } catch (error) {
      deps.log.warn({ err: error, runId: entry.run.runId }, "idle probe failed; retrying in 60s");
      scheduleIdleCheck(entry, 60_000);
      return;
    }
    if (idleMs < idleLimitMs) {
      scheduleIdleCheck(entry, idleLimitMs - idleMs);
      return;
    }
    if (await revertToAgent(deps.sql, entry.run.runId)) {
      deps.log.info({ runId: entry.run.runId, idleMs }, "user idle; handing control back to the agent");
      await toAgent(entry);
    }
  }

  async function toUser(entry: Entry, userId: string): Promise<void> {
    const { runId, slot, session } = entry.run;
    const startedAt = performance.now();
    const wasAgent = entry.holder === "agent";
    session.setController("user");
    if (wasAgent) deps.aborts.abort(runId, "takeover");
    try {
      await deps.liveView.giveControl(slot, userId);
      await deps.liveView.setClipboardAccess(slot, true);
    } catch (error) {
      deps.log.warn({ err: error, runId }, "takeover could not be delivered; control stays with the agent");
      await revertToAgent(deps.sql, runId);
      await appendRunEvent(deps.sql, runId, {
        type: "error",
        code: "takeover_failed",
        message: "The live view was not connected, so control stayed with the agent.",
      });
      entry.holder = "user";
      await toAgent(entry);
      return;
    }
    entry.holder = "user";
    if (await markTakeoverWaiting(deps.sql, runId)) {
      await appendRunEvent(deps.sql, runId, { type: "status", status: "waiting", waitReason: "takeover", reason: null });
    }
    await appendRunEvent(deps.sql, runId, { type: "control", holder: "user" });
    deps.log.info({ runId, takeoverMs: Math.round(performance.now() - startedAt) }, "user holds control");
    scheduleIdleCheck(entry, idleLimitMs);
  }

  async function toAgent(entry: Entry): Promise<void> {
    const { runId, slot, session } = entry.run;
    const wasUser = entry.holder === "user";
    clearIdle(entry);
    await deps.liveView.takeControl(slot);
    await deps.liveView.setClipboardAccess(slot, false);
    session.setController("agent");
    entry.holder = "agent";
    if (!wasUser) return;
    deps.aborts.renew(runId);
    if (await markHandBackRunning(deps.sql, runId)) {
      await appendRunEvent(deps.sql, runId, { type: "status", status: "running", waitReason: null, reason: null });
    }
    await appendRunEvent(deps.sql, runId, { type: "control", holder: "agent" });
    await deps.sql`select pg_notify('run_wake', ${encodeNotify("run_wake", { runId, reason: "resume" })})`;
  }

  async function apply(entry: Entry): Promise<void> {
    const row = await getRunControl(deps.sql, entry.run.runId);
    if (!row || row.slotName !== entry.run.slot.name) return;
    if (row.controller === "user" && entry.holder !== "user") {
      await toUser(entry, row.controlUserId ?? "");
    } else if (row.controller === "agent" && entry.holder !== "agent") {
      await toAgent(entry);
    }
  }

  return {
    async attach(run) {
      const previous = entries.get(run.runId);
      if (previous) clearIdle(previous);
      entries.set(run.runId, { run, holder: null, chain: Promise.resolve(), idleTimer: null });
      await enqueue(run.runId, apply);
    },
    detach(runId) {
      const entry = entries.get(runId);
      if (entry) clearIdle(entry);
      entries.delete(runId);
    },
    onRunControl: (runId) => enqueue(runId, apply),
    holder: (runId) => entries.get(runId)?.holder ?? null,
  };
}

/** B6 owns the run_control LISTEN (spec §3.1 channel web → agent). Returns unlisten. */
export async function listenRunControl(
  sql: Sql,
  coordinator: ControlCoordinator,
  log: Logger,
): Promise<() => Promise<void>> {
  const { unlisten } = await sql.listen("run_control", (payload) => {
    let runId: string;
    try {
      runId = decodeNotify("run_control", payload).runId;
    } catch {
      log.warn("ignoring a malformed run_control payload");
      return;
    }
    void coordinator.onRunControl(runId);
  });
  return unlisten;
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test:int -- apps/agent/src/live/control.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS. The abort lands well under 300 ms (typically under 30 ms).

- [ ] **Step 5: Commit.**
```bash
git add apps/agent/src/live
git commit -m "feat(agent): code-owned control lock with serialized transitions, failed-takeover revert and idle hand-back"
```

---

### Task 9: Downloads: CDP → `downloads` volume → Garage → `download_ready`

**Files:**
- Create: `apps/agent/src/live/downloads.ts`
- Test: `apps/agent/src/live/downloads.test.ts`, `apps/agent/src/live/downloads.int.test.ts`

**Interfaces:**
- Consumes:
  - `LeasedRun`, `ApprovalPort` (Task 8);
  - `getRunControl`, `findDownloadApprover`, `findAssetBySha`, `recordDownload`, `appendRunEvent` (Task 2);
  - `objectKeys`, `safeFilename`, `Storage`, `startTestGarage`, `bootstrapGarage` (Phase 0).
- Produces:
  - `MAX_DOWNLOAD_BYTES = 200 MiB`;
  - `downloadMime(filename): string`, an allowlist where anything active is `application/octet-stream`;
  - `DownloadIngestorDeps` `{sql, storage, approvals, log, slotRoot?, localRoot?, dirMode?, maxBytes?}`;
  - `DownloadIngestor` `{attach(run): Promise<void>; detach(runId): Promise<void>}`;
  - `createDownloadIngestor(deps)`.
- Download rules:
  - **User holds control:** the download is approved by `control_user_id`.
  - **Agent holds control:** the download needs an approved `download` approval for the exact URL. Otherwise it is cancelled, its file removed, and an approval requested.

- [ ] **Step 1: Write the failing tests.**

`apps/agent/src/live/downloads.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { downloadMime } from "./downloads.ts";

describe("downloadMime", () => {
  it("serves only inert types under their real MIME type", () => {
    expect(downloadMime("Report.PDF")).toBe("application/pdf");
    expect(downloadMime("chart.png")).toBe("image/png");
    expect(downloadMime("data.csv")).toBe("text/csv");
  });
  it("never lets active content render from storage", () => {
    for (const name of ["page.html", "x.htm", "img.svg", "feed.xml", "app.js", "noext"]) {
      expect(downloadMime(name), name).toBe("application/octet-stream");
    }
  });
});
```

`apps/agent/src/live/downloads.int.test.ts`:
```ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ApprovalRequest, RunEvent } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { createDb, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { bootstrapGarage, createStorage, type Storage } from "@mastertutor/storage";
import { startTestGarage, type TestGarage } from "@mastertutor/storage/testing";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { leaseSlot, releaseSlot, seedMember, seedRun } from "../../../../tests/support/live-seed.ts";
import { startTestSlot, type TestSlot } from "../../../../tests/support/slot.ts";
import { sleep, waitFor } from "../../../../tests/support/wait.ts";
import { createDownloadIngestor, type DownloadIngestor } from "./downloads.ts";
import type { LeasedRun } from "./ports.ts";

const KEY = { id: "GK5aa6eb9e4f040236e79864f3", secret: "0974bfbf76eb6fb9faf77bf05f5b21d703c85dbd797421167285185ae7ff3568" };
let testDb: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let garage: TestGarage;
let storage: Storage;
let slot: TestSlot;
let browser: Browser;
let page: Page;
let member: { userId: string; workspaceId: string };
const requests: Array<{ runId: string; request: ApprovalRequest }> = [];
let ingestor: DownloadIngestor;
let current: LeasedRun | null = null;

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1"] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 4 });
  garage = await startTestGarage();
  await bootstrapGarage({
    adminUrl: garage.adminUrl,
    adminToken: garage.adminToken,
    bucket: "mastertutor",
    capacityBytes: 1024 ** 3,
    keys: [{ name: "agent", accessKeyId: KEY.id, secretAccessKey: KEY.secret, read: true, write: true }],
  });
  storage = createStorage({
    endpoint: garage.s3Endpoint,
    region: "garage",
    bucket: "mastertutor",
    accessKeyId: KEY.id,
    secretAccessKey: KEY.secret,
  });
  slot = await startTestSlot();
  browser = await chromium.connectOverCDP(slot.cdpUrl);
  const context = browser.contexts()[0]!;
  page = context.pages()[0] ?? (await context.newPage());
  member = await seedMember(owner.sql);
  ingestor = createDownloadIngestor({
    sql: agent.sql,
    storage,
    approvals: { request: async (runId, request) => (requests.push({ runId, request }), "ask") },
    log: createLogger({ service: "test", level: "silent" }),
    localRoot: slot.downloadsDir,
    dirMode: 0o777,
  });
});
afterEach(async () => {
  if (current) await ingestor.detach(current.runId);
  current = null;
  await releaseSlot(owner.sql, "browser-1");
});
afterAll(async () => {
  await browser?.close();
  await Promise.all([owner?.close(), agent?.close(), slot?.stop(), garage?.stop()]);
  await testDb?.stop();
});

async function attachRun(controller: "agent" | "user"): Promise<LeasedRun> {
  const runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
  if (controller === "user") {
    await owner.sql`update runs set controller = 'user', control_user_id = ${member.userId},
                      status = 'waiting', wait_reason = 'takeover' where id = ${runId}`;
  }
  await leaseSlot(owner.sql, "browser-1", runId);
  current = {
    runId,
    workspaceId: member.workspaceId,
    slot: { name: "browser-1" },
    session: { setController() {}, newBrowserCdpSession: () => browser.newBrowserCDPSession() },
  };
  await ingestor.attach(current);
  return current;
}

function dataUrl(text: string) {
  return `data:text/plain;base64,${Buffer.from(text).toString("base64")}`;
}
async function clickDownload(url: string, filename: string) {
  await page.setContent(`<a id="d" href="${url}" download="${filename}">get</a>`);
  await page.click("#d");
}
const downloads = (runId: string) =>
  owner.sql`select filename, asset_id as "assetId", bytes, approved_by as "approvedBy" from downloads where run_id = ${runId}`;
const localFiles = (runId: string) => readdir(join(slot.downloadsDir, runId)).catch(() => []);

describe("download ingestor (spec §10.2.9)", () => {
  it("ingests a download made while the user holds control", async () => {
    const run = await attachRun("user");
    await clickDownload(dataUrl("Hello"), "notes.txt");
    const [row] = await waitFor(async () => {
      const rows = await downloads(run.runId);
      return rows.length === 1 ? rows : null;
    });
    expect(row).toMatchObject({ filename: "notes.txt", bytes: 5, approvedBy: member.userId });
    const [asset] = await owner.sql`select key, mime, sha256 from assets where id = ${row!.assetId}`;
    expect(asset!.key).toMatch(new RegExp(`^downloads/${run.runId}/[0-9a-f]{12}-notes\\.txt$`));
    expect(asset!.mime).toBe("text/plain");
    expect(new TextDecoder().decode(await storage.getBytes(asset!.key as string))).toBe("Hello");
    const events = await owner.sql`select payload from run_events where run_id = ${run.runId}`;
    expect(events.map((e) => e.payload as RunEvent)).toContainEqual({
      type: "download_ready",
      downloadId: expect.any(String) as unknown as string,
      assetId: row!.assetId as string,
      filename: "notes.txt",
      bytes: 5,
    });
    await waitFor(async () => (await localFiles(run.runId)).length === 0, { what: "local copy deleted" });
  });

  it("cancels and asks for approval when the agent downloads without one, leaving nothing on disk (Review Focus 4)", async () => {
    const run = await attachRun("agent");
    const url = dataUrl("<script>alert(1)</script>");
    await clickDownload(url, "report.html");
    const asked = await waitFor(() => requests.find((r) => r.runId === run.runId));
    expect(asked.request).toEqual({ kind: "download", url, filename: "report.html" });
    await sleep(1_000);
    expect(await downloads(run.runId)).toHaveLength(0);
    await waitFor(async () => (await localFiles(run.runId)).length === 0, { what: "partial file removed" });
  });

  it("ingests an agent download whose exact URL was approved", async () => {
    const run = await attachRun("agent");
    const url = dataUrl("approved bytes");
    await owner.sql`insert into approvals (run_id, step_seq, kind, request, status, decided_by, decided_at)
      values (${run.runId}, 1, 'download', ${owner.sql.json({ kind: "download", url, filename: "a.txt" })},
              'approved', 'approver_1', now())`;
    await clickDownload(url, "a.txt");
    const [row] = await waitFor(async () => {
      const rows = await downloads(run.runId);
      return rows.length === 1 ? rows : null;
    });
    expect(row).toMatchObject({ approvedBy: "approver_1" });
  });

  it("dedupes identical content into one asset and removes the run folder on detach", async () => {
    const run = await attachRun("user");
    await clickDownload(dataUrl("same"), "one.txt");
    await waitFor(async () => (await downloads(run.runId)).length === 1);
    await clickDownload(dataUrl("same"), "two.txt");
    const rows = await waitFor(async () => {
      const all = await downloads(run.runId);
      return all.length === 2 ? all : null;
    });
    expect(rows[0]!.assetId).toBe(rows[1]!.assetId);
    await ingestor.detach(run.runId);
    current = null;
    expect(await readdir(slot.downloadsDir)).not.toContain(run.runId);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/agent/src/live/downloads.test.ts && pnpm test:int -- apps/agent/src/live/downloads.int.test.ts`
Expected: FAIL, because `./downloads.ts` is missing.

- [ ] **Step 3: Implement.**

`apps/agent/src/live/downloads.ts`:
```ts
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { createLogger } from "@mastertutor/contracts/server";
import {
  appendRunEvent,
  findAssetBySha,
  findDownloadApprover,
  getRunControl,
  recordDownload,
  type DbHandle,
} from "@mastertutor/db";
import { objectKeys, safeFilename, type Storage } from "@mastertutor/storage";
import type { CDPSession } from "playwright-core";
import type { ApprovalPort, LeasedRun } from "./ports.ts";

type Logger = ReturnType<typeof createLogger>;

export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/** Inert types only; anything that could render as active content is served as a plain download. */
const SAFE_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function downloadMime(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return (dot > 0 && SAFE_MIME[filename.slice(dot + 1).toLowerCase()]) || "application/octet-stream";
}

export interface DownloadIngestorDeps {
  sql: DbHandle["sql"];
  storage: Storage;
  approvals: ApprovalPort;
  log: Logger;
  /** Download folder root as the slot's Chromium sees it. */
  slotRoot?: string;
  /** The same volume as mounted in this process. */
  localRoot?: string;
  dirMode?: number;
  maxBytes?: number;
}

export interface DownloadIngestor {
  attach(run: LeasedRun): Promise<void>;
  detach(runId: string): Promise<void>;
}

interface Approved {
  filename: string;
  url: string;
  approvedBy: string;
}
interface Attached {
  cdp: CDPSession;
  decisions: Map<string, Promise<Approved | null>>;
  off(): void;
}

/**
 * Spec §10.2.9. Browser.setDownloadBehavior("allowAndName") writes <root>/<runId>/<guid>
 * (never an untrusted name). Each download is decided once (user control, or an approved
 * download approval for the exact URL); progress events wait for that decision, so files that
 * finish instantly are still never ingested without approval and never left on disk.
 */
export function createDownloadIngestor(deps: DownloadIngestorDeps): DownloadIngestor {
  const slotRoot = deps.slotRoot ?? "/downloads";
  const localRoot = deps.localRoot ?? "/downloads";
  const maxBytes = deps.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const attached = new Map<string, Attached>();
  const localFile = (runId: string, guid: string) => path.join(localRoot, runId, guid);

  async function removeFile(runId: string, guid: string): Promise<void> {
    await rm(localFile(runId, guid), { force: true });
    await rm(`${localFile(runId, guid)}.crdownload`, { force: true });
  }

  async function decide(run: LeasedRun, cdp: CDPSession, guid: string, rawUrl: string, suggested: string) {
    const filename = safeFilename(suggested || "download");
    const url = rawUrl.slice(0, 4_096);
    const control = await getRunControl(deps.sql, run.runId);
    const approvedBy =
      control?.controller === "user" && control.controlUserId
        ? control.controlUserId
        : await findDownloadApprover(deps.sql, run.runId, url);
    if (approvedBy) return { filename, url, approvedBy };
    await cdp.send("Browser.cancelDownload", { guid }).catch(() => undefined);
    await removeFile(run.runId, guid);
    const decision = await deps.approvals.request(run.runId, { kind: "download", url, filename });
    deps.log.info({ runId: run.runId, decision }, "download held for approval");
    return null;
  }

  async function ingest(run: LeasedRun, guid: string, approved: Approved): Promise<void> {
    const file = localFile(run.runId, guid);
    try {
      const info = await stat(file);
      if (info.size > maxBytes) {
        await appendRunEvent(deps.sql, run.runId, {
          type: "error",
          code: "download_too_large",
          message: `${approved.filename} is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB`,
        });
        return;
      }
      const bytes = await readFile(file);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const mime = downloadMime(approved.filename);
      const existing = await findAssetBySha(deps.sql, run.workspaceId, sha256);
      const key = existing?.key ?? objectKeys.download(run.runId, `${sha256.slice(0, 12)}-${approved.filename}`);
      if (!existing) await deps.storage.put(key, bytes, { contentType: mime, sha256 });
      const record = await recordDownload(deps.sql, {
        runId: run.runId,
        workspaceId: run.workspaceId,
        filename: approved.filename,
        sha256,
        bucket: deps.storage.bucket,
        key,
        mime,
        bytes: bytes.length,
        sourceUrl: approved.url,
        approvedBy: approved.approvedBy,
      });
      await appendRunEvent(deps.sql, run.runId, {
        type: "download_ready",
        downloadId: record.downloadId,
        assetId: record.assetId,
        filename: approved.filename,
        bytes: bytes.length,
      });
    } finally {
      await rm(file, { force: true });
    }
  }

  return {
    async attach(run) {
      const dir = path.join(localRoot, run.runId);
      await mkdir(dir, { recursive: true, mode: deps.dirMode ?? 0o700 });
      if (deps.dirMode !== undefined) await chmod(dir, deps.dirMode);
      const cdp = await run.session.newBrowserCdpSession();
      const decisions = new Map<string, Promise<Approved | null>>();
      const onBegin = (event: { guid: string; url: string; suggestedFilename: string }) => {
        const decision = decide(run, cdp, event.guid, event.url, event.suggestedFilename).catch((error: unknown) => {
          deps.log.error({ err: error, runId: run.runId }, "download decision failed");
          return null;
        });
        decisions.set(event.guid, decision);
      };
      const onProgress = (event: { guid: string; state: "inProgress" | "completed" | "canceled" }) => {
        if (event.state === "inProgress") return;
        const decision = decisions.get(event.guid) ?? Promise.resolve(null);
        decisions.delete(event.guid);
        void decision
          .then((approved) =>
            event.state === "completed" && approved ? ingest(run, event.guid, approved) : removeFile(run.runId, event.guid),
          )
          .catch((error: unknown) => deps.log.error({ err: error, runId: run.runId }, "download ingest failed"));
      };
      cdp.on("Browser.downloadWillBegin", onBegin);
      cdp.on("Browser.downloadProgress", onProgress);
      await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allowAndName",
        downloadPath: path.posix.join(slotRoot, run.runId),
        eventsEnabled: true,
      });
      attached.set(run.runId, {
        cdp,
        decisions,
        off: () => {
          cdp.off("Browser.downloadWillBegin", onBegin);
          cdp.off("Browser.downloadProgress", onProgress);
        },
      });
    },
    async detach(runId) {
      const entry = attached.get(runId);
      attached.delete(runId);
      if (entry) {
        entry.off();
        await entry.cdp.detach().catch(() => undefined);
      }
      await rm(path.join(localRoot, runId), { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/agent/src/live/downloads.test.ts && pnpm test:int -- apps/agent/src/live/downloads.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/agent/src/live
git commit -m "feat(agent): approved downloads via CDP into Garage with download_ready events"
```

---

### Task 10: Uploads through n.eko `upload/dialog` and `upload/drop`

**Files:**
- Create: `apps/web/lib/live/upload.ts`
- Test: `apps/web/lib/live/upload.test.ts`, `apps/web/lib/live/upload.int.test.ts`

**Interfaces:**
- Consumes: `livePath`, `VIEWPORT` (contracts), `startTestSlot`, `createNekoAdmin`/`createNekoLiveView` (tests), `loginNeko`.
- Produces a browser-safe module for F3:
  - `UploadOutcome` = `"uploaded" | "no_file_dialog" | "not_in_control" | "failed"`;
  - `UploadOptions` `{base?, fetch?, headers?}`;
  - `MAX_UPLOAD_FILES = 10`;
  - `uploadToFileDialog(runId, files, options?)` and `dropFiles(runId, files, point, options?)`.

  Requests go to `/live/<runId>/api/room/upload/{dialog|drop}`. n.eko accepts them only from the host session, so only the user, and only while in control.

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/live/upload.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_FILES, dropFiles, uploadToFileDialog } from "./upload.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const file = new File(["hi"], "notes.txt", { type: "text/plain" });

function fakeFetch(status: number) {
  const calls: Array<{ url: string; body: FormData }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as FormData });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("uploads", () => {
  it("posts files to the run's n.eko dialog endpoint", async () => {
    const { calls, fetchImpl } = fakeFetch(204);
    expect(await uploadToFileDialog(runId, [file], { fetch: fetchImpl })).toBe("uploaded");
    expect(calls[0]!.url).toBe(`/live/${runId}/api/room/upload/dialog`);
    expect((calls[0]!.body.get("files") as File).name).toBe("notes.txt");
  });

  it("maps n.eko statuses to outcomes", async () => {
    for (const [status, outcome] of [
      [422, "no_file_dialog"],
      [403, "not_in_control"],
      [401, "not_in_control"],
      [500, "failed"],
    ] as const) {
      expect(await uploadToFileDialog(runId, [file], { fetch: fakeFetch(status).fetchImpl })).toBe(outcome);
    }
  });

  it("drops at a clamped viewport point", async () => {
    const { calls, fetchImpl } = fakeFetch(204);
    expect(await dropFiles(runId, [file], { x: 5000.7, y: -3 }, { fetch: fetchImpl })).toBe("uploaded");
    expect(calls[0]!.url).toBe(`/live/${runId}/api/room/upload/drop`);
    expect([calls[0]!.body.get("x"), calls[0]!.body.get("y")]).toEqual(["1279", "0"]);
  });

  it("refuses empty or oversized batches", () => {
    expect(() => uploadToFileDialog(runId, [])).toThrow();
    expect(() => uploadToFileDialog(runId, Array.from({ length: MAX_UPLOAD_FILES + 1 }, () => file))).toThrow();
  });
});
```

`apps/web/lib/live/upload.int.test.ts`:
```ts
import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNekoAdmin } from "../../../agent/src/live/neko-admin.ts";
import { createNekoLiveView } from "../../../agent/src/live/neko-live-view.ts";
import { TEST_NEKO_ADMIN_SECRET, TEST_NEKO_MEMBER_SECRET, startTestSlot, type TestSlot } from "../../../../tests/support/slot.ts";
import { waitFor } from "../../../../tests/support/wait.ts";
import { uploadToFileDialog } from "./upload.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
let slot: TestSlot;
let browser: Browser;

beforeAll(async () => {
  slot = await startTestSlot();
  browser = await chromium.connectOverCDP(slot.cdpUrl);
});
afterAll(async () => {
  await browser?.close();
  await slot?.stop();
});

describe("user uploads through n.eko (spec §10.2.8)", () => {
  it("fills an open file chooser only while the user holds control", async () => {
    const token = await loginNeko({
      baseUrl: slot.nekoUrl,
      username: "user",
      password: deriveNekoPassword(TEST_NEKO_MEMBER_SECRET, "browser-1"),
    });
    const options = { base: `${slot.nekoUrl}/`, headers: { authorization: `Bearer ${token}` } };
    const file = () => new File(["hello"], "notes.txt", { type: "text/plain" });
    const view = createNekoLiveView({
      admin: createNekoAdmin({ adminSecret: TEST_NEKO_ADMIN_SECRET, baseUrl: () => slot.nekoUrl }),
    });
    await view.takeControl({ name: "browser-1" });
    expect(await uploadToFileDialog(runId, [file()], options)).toBe("not_in_control");

    await view.giveControl({ name: "browser-1" }, "user_1");
    expect(await uploadToFileDialog(runId, [file()], options)).toBe("no_file_dialog");

    const context = browser.contexts()[0]!;
    const page = context.pages()[0] ?? (await context.newPage());
    await page.bringToFront();
    await page.setContent('<input id="f" type="file" autofocus>');
    await page.focus("#f");
    await slot.xdotool("key", "space");
    await waitFor(() => slot.xdotool("search", "--name", "Open File").then(() => true), {
      timeoutMs: 10_000,
      what: "the GTK file chooser",
    });
    expect(await uploadToFileDialog(runId, [file()], options)).toBe("uploaded");
    expect(
      await waitFor(() => page.evaluate(() => (document.querySelector("#f") as HTMLInputElement).files?.[0]?.name)),
    ).toBe("notes.txt");
    await view.takeControl({ name: "browser-1" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/live && pnpm test:int -- apps/web/lib/live/upload.int.test.ts`
Expected: FAIL, because `./upload.ts` is missing.

- [ ] **Step 3: Implement.**

`apps/web/lib/live/upload.ts`:
```ts
import { VIEWPORT, livePath } from "@mastertutor/contracts";

/** Browser-side helper for the run view (F3). Only the user uploads, and only while in control. */
export type UploadOutcome = "uploaded" | "no_file_dialog" | "not_in_control" | "failed";

export interface UploadOptions {
  /** Defaults to /live/<runId>/ (through Traefik and ForwardAuth); tests point at n.eko directly. */
  base?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

export const MAX_UPLOAD_FILES = 10;

function filesForm(files: readonly File[]): FormData {
  if (files.length === 0 || files.length > MAX_UPLOAD_FILES) {
    throw new RangeError(`Upload between 1 and ${MAX_UPLOAD_FILES} files`);
  }
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return form;
}

function outcome(status: number): UploadOutcome {
  if (status >= 200 && status < 300) return "uploaded";
  if (status === 422) return "no_file_dialog";
  if (status === 401 || status === 403) return "not_in_control";
  return "failed";
}

async function post(runId: string, endpoint: string, form: FormData, options: UploadOptions): Promise<UploadOutcome> {
  const base = options.base ?? livePath(runId);
  try {
    const response = await (options.fetch ?? fetch)(`${base}${endpoint}`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: options.headers,
    });
    await response.body?.cancel();
    return outcome(response.status);
  } catch {
    return "failed";
  }
}

const clamp = (value: number, size: number) => Math.min(size - 1, Math.max(0, Math.round(value)));

/** Fills the site's open native file chooser (n.eko upload/dialog). */
export function uploadToFileDialog(runId: string, files: readonly File[], options: UploadOptions = {}): Promise<UploadOutcome> {
  return post(runId, "api/room/upload/dialog", filesForm(files), options);
}

/** Drops files at a point of the 1280×800 remote screen (n.eko upload/drop). */
export function dropFiles(
  runId: string,
  files: readonly File[],
  point: { x: number; y: number },
  options: UploadOptions = {},
): Promise<UploadOutcome> {
  const form = filesForm(files);
  form.append("x", String(clamp(point.x, VIEWPORT.width)));
  form.append("y", String(clamp(point.y, VIEWPORT.height)));
  return post(runId, "api/room/upload/drop", form, options);
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/live && pnpm test:int -- apps/web/lib/live/upload.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/lib/live
git commit -m "feat(web): user uploads through n.eko upload/dialog and upload/drop"
```

---

### Task 11: Compose: per-slot Traefik routers (file provider and labels), coturn profile, live test overlay

**Files:**
- Modify: `compose.yml`, `infra/traefik/test-dynamic.yml`, `.env.example`, `.env.test`, `scripts/env-init.ts`, `package.json`, `tests/compose/compose-config.int.test.ts`
- Create: `compose.live-test.yml`, `infra/coturn/turnserver.conf`
- Test: `tests/compose/live-routes.int.test.ts`

**Interfaces:**
- Consumes: `liveRouterRule`, `LIVE_STRIP_REGEX` (Task 1), the slot env from Task 3, and `/api/live/auth` (Task 6).
- Produces:
  - **Routers:** `live-browser-N` (priority 1000) using middlewares `live-auth` (ForwardAuth to `http://web:3000/api/live/auth`, `authResponseHeaders: Cookie`) and `live-strip`, with service `live-browser-N` → `browser-N:8080`.
  - **Network:** the `cdp` network is named `mastertutor_cdp`.
  - **coturn:** service `coturn` (profile `turn`) on `egress`, publishing 3478/udp+tcp and relay 49160–49169/udp.
  - **Scripts:** `pnpm compose:live <args>` and `pnpm test:live-stack`.
  - **Env:** `PUBLIC_HOST` and `TURN_URLS`.

- [ ] **Step 1: Write the failing test.**

`tests/compose/live-routes.int.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIVE_STRIP_REGEX, liveRouterRule } from "@mastertutor/contracts";
import { beforeAll, describe, expect, it } from "vitest";

interface Service {
  labels?: Record<string, string>;
  environment?: Record<string, string | null>;
  networks?: Record<string, unknown>;
  ports?: Array<{ target: number; published?: string; protocol?: string }>;
  command?: string[];
}
interface Config {
  services: Record<string, Service>;
  networks: Record<string, { name?: string }>;
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const load = (extra: string[]): Config =>
  JSON.parse(
    execFileSync("docker", ["compose", "--env-file", ".env.test", ...extra, "config", "--format", "json"], {
      cwd: root,
      encoding: "utf8",
    }),
  ) as Config;
const slots = ["browser-1", "browser-2", "browser-3", "browser-4", "browser-5", "browser-6"];
let base: Config;
let live: Config;

beforeAll(() => {
  base = load(["-f", "compose.yml"]);
  live = load(["-f", "compose.yml", "-f", "compose.test.yml", "-f", "compose.live-test.yml", "--profile", "turn"]);
});

describe("production label routers (spec §10.2.2, §13)", () => {
  it("gives every slot a router whose rule comes from liveRouterRule", () => {
    for (const slot of slots) {
      const labels = base.services[slot]!.labels!;
      const router = `traefik.http.routers.live-${slot}`;
      expect(labels["traefik.enable"]).toBe("true");
      expect(labels["traefik.docker.network"]).toBe("mastertutor_cdp");
      expect(labels[`${router}.rule`]).toBe(liveRouterRule(slot, "localhost"));
      expect(labels[`${router}.priority`]).toBe("1000");
      expect(labels[`${router}.middlewares`]).toBe("live-auth,live-strip");
      expect(labels[`${router}.service`]).toBe(`live-${slot}`);
      expect(labels[`traefik.http.services.live-${slot}.loadbalancer.server.port`]).toBe("8080");
      expect(labels["traefik.http.middlewares.live-auth.forwardauth.address"]).toBe("http://web:3000/api/live/auth");
      expect(labels["traefik.http.middlewares.live-auth.forwardauth.authResponseHeaders"]).toBe("Cookie");
      expect(labels["traefik.http.middlewares.live-strip.stripprefixregex.regex"]).toBe(LIVE_STRIP_REGEX);
    }
    expect(base.networks.cdp?.name).toBe("mastertutor_cdp");
  });

  it("hands slots TURN minting inputs and web its TURN URLs", () => {
    for (const slot of slots) {
      expect(Object.keys(base.services[slot]!.environment ?? {})).toEqual(expect.arrayContaining(["TURN_URLS", "TURN_SECRET"]));
    }
    expect(Object.keys(base.services.web!.environment ?? {})).toContain("TURN_URLS");
  });
});

describe("test file-provider routers", () => {
  it("uses the same rules and middlewares as the labels", () => {
    const text = readFileSync(new URL("../../infra/traefik/test-dynamic.yml", import.meta.url), "utf8");
    for (const slot of ["browser-1", "browser-2"]) {
      expect(text).toContain(`rule: '${liveRouterRule(slot, "localhost")}'`);
      expect(text).toContain(`url: http://${slot}:8080`);
    }
    expect(text).toContain(`- '${LIVE_STRIP_REGEX}'`);
    expect(text).toContain("address: http://web:3000/api/live/auth");
  });
});

describe("live test overlay and coturn profile", () => {
  it("runs two slots and coturn only on egress", () => {
    expect(Object.keys(live.services).filter((name) => name.startsWith("browser-")).sort()).toEqual(["browser-1", "browser-2"]);
    const coturn = live.services.coturn!;
    expect(Object.keys(coturn.networks ?? {})).toEqual(["egress"]);
    expect((coturn.ports ?? []).map((p) => `${p.published}:${p.target}/${p.protocol}`)).toEqual(
      expect.arrayContaining(["3478:3478/udp", "3478:3478/tcp"]),
    );
    expect(coturn.command).toEqual(expect.arrayContaining(["-c", "/etc/coturn/turnserver.conf"]));
    expect(coturn.command!.some((arg) => arg.startsWith("--static-auth-secret="))).toBe(true);
    expect(live.services.agent!.environment!.BROWSER_SLOTS).toBe("browser-1,browser-2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test:int -- tests/compose/live-routes.int.test.ts`
Expected: FAIL, because there are no labels, no `compose.live-test.yml` and no coturn.

- [ ] **Step 3: Implement.**

**`compose.yml` edits**

1. In `x-slot-env`, add:
```yaml
  TURN_URLS: ${TURN_URLS:-}
  TURN_SECRET: ${TURN_SECRET:?set TURN_SECRET}
```

2. Add this anchor after `x-slot-env`:
```yaml
# Shared Traefik labels for every slot (production, Dokploy's Traefik). Dokploy's Traefik must join
# mastertutor_cdp at .12 (Phase 9); ForwardAuth runs before StripPrefixRegex so it sees /live/<runId>/.
x-slot-labels: &slot-labels
  traefik.enable: "true"
  traefik.docker.network: mastertutor_cdp
  traefik.http.middlewares.live-auth.forwardauth.address: http://web:3000/api/live/auth
  traefik.http.middlewares.live-auth.forwardauth.authResponseHeaders: Cookie
  traefik.http.middlewares.live-strip.stripprefixregex.regex: ^/live/[0-9a-f-]{36}
```

3. Replace each slot service. For `browser-1`:
```yaml
  browser-1:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-1
      NEKO_WEBRTC_UDPMUX: "59001"
      NEKO_WEBRTC_TCPMUX: "59001"
    ports: ["59001:59001/udp", "59001:59001/tcp"]
    labels:
      <<: *slot-labels
      traefik.http.routers.live-browser-1.rule: 'Host(`${PUBLIC_HOST:?set PUBLIC_HOST}`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-1\.`)'
      traefik.http.routers.live-browser-1.priority: "1000"
      traefik.http.routers.live-browser-1.entrypoints: websecure
      traefik.http.routers.live-browser-1.tls.certresolver: letsencrypt
      traefik.http.routers.live-browser-1.middlewares: live-auth,live-strip
      traefik.http.routers.live-browser-1.service: live-browser-1
      traefik.http.services.live-browser-1.loadbalancer.server.port: "8080"
```
Write the same block for `browser-2` … `browser-6`. In each, replace every `browser-1` with `browser-N` and `59001` with `5900N`. Spelled out:
```yaml
  browser-2:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-2
      NEKO_WEBRTC_UDPMUX: "59002"
      NEKO_WEBRTC_TCPMUX: "59002"
    ports: ["59002:59002/udp", "59002:59002/tcp"]
    labels:
      <<: *slot-labels
      traefik.http.routers.live-browser-2.rule: 'Host(`${PUBLIC_HOST:?set PUBLIC_HOST}`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-2\.`)'
      traefik.http.routers.live-browser-2.priority: "1000"
      traefik.http.routers.live-browser-2.entrypoints: websecure
      traefik.http.routers.live-browser-2.tls.certresolver: letsencrypt
      traefik.http.routers.live-browser-2.middlewares: live-auth,live-strip
      traefik.http.routers.live-browser-2.service: live-browser-2
      traefik.http.services.live-browser-2.loadbalancer.server.port: "8080"

  browser-3:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-3
      NEKO_WEBRTC_UDPMUX: "59003"
      NEKO_WEBRTC_TCPMUX: "59003"
    ports: ["59003:59003/udp", "59003:59003/tcp"]
    labels:
      <<: *slot-labels
      traefik.http.routers.live-browser-3.rule: 'Host(`${PUBLIC_HOST:?set PUBLIC_HOST}`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-3\.`)'
      traefik.http.routers.live-browser-3.priority: "1000"
      traefik.http.routers.live-browser-3.entrypoints: websecure
      traefik.http.routers.live-browser-3.tls.certresolver: letsencrypt
      traefik.http.routers.live-browser-3.middlewares: live-auth,live-strip
      traefik.http.routers.live-browser-3.service: live-browser-3
      traefik.http.services.live-browser-3.loadbalancer.server.port: "8080"

  browser-4:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-4
      NEKO_WEBRTC_UDPMUX: "59004"
      NEKO_WEBRTC_TCPMUX: "59004"
    ports: ["59004:59004/udp", "59004:59004/tcp"]
    labels:
      <<: *slot-labels
      traefik.http.routers.live-browser-4.rule: 'Host(`${PUBLIC_HOST:?set PUBLIC_HOST}`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-4\.`)'
      traefik.http.routers.live-browser-4.priority: "1000"
      traefik.http.routers.live-browser-4.entrypoints: websecure
      traefik.http.routers.live-browser-4.tls.certresolver: letsencrypt
      traefik.http.routers.live-browser-4.middlewares: live-auth,live-strip
      traefik.http.routers.live-browser-4.service: live-browser-4
      traefik.http.services.live-browser-4.loadbalancer.server.port: "8080"

  browser-5:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-5
      NEKO_WEBRTC_UDPMUX: "59005"
      NEKO_WEBRTC_TCPMUX: "59005"
    ports: ["59005:59005/udp", "59005:59005/tcp"]
    labels:
      <<: *slot-labels
      traefik.http.routers.live-browser-5.rule: 'Host(`${PUBLIC_HOST:?set PUBLIC_HOST}`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-5\.`)'
      traefik.http.routers.live-browser-5.priority: "1000"
      traefik.http.routers.live-browser-5.entrypoints: websecure
      traefik.http.routers.live-browser-5.tls.certresolver: letsencrypt
      traefik.http.routers.live-browser-5.middlewares: live-auth,live-strip
      traefik.http.routers.live-browser-5.service: live-browser-5
      traefik.http.services.live-browser-5.loadbalancer.server.port: "8080"

  browser-6:
    <<: *browser-slot
    environment:
      <<: *slot-env
      SLOT_NAME: browser-6
      NEKO_WEBRTC_UDPMUX: "59006"
      NEKO_WEBRTC_TCPMUX: "59006"
    ports: ["59006:59006/udp", "59006:59006/tcp"]
    labels:
      <<: *slot-labels
      traefik.http.routers.live-browser-6.rule: 'Host(`${PUBLIC_HOST:?set PUBLIC_HOST}`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-6\.`)'
      traefik.http.routers.live-browser-6.priority: "1000"
      traefik.http.routers.live-browser-6.entrypoints: websecure
      traefik.http.routers.live-browser-6.tls.certresolver: letsencrypt
      traefik.http.routers.live-browser-6.middlewares: live-auth,live-strip
      traefik.http.routers.live-browser-6.service: live-browser-6
      traefik.http.services.live-browser-6.loadbalancer.server.port: "8080"
```

4. In the `web` service's `environment`, add `TURN_URLS: ${TURN_URLS:-}` after `TURN_SECRET`.

5. Add the `coturn` service (after `garage-init`):
```yaml
  # TURN relay for UDP-hostile networks (spec §10.2.5, profile `turn`). Only on `egress`, and
  # allowed to relay to the public media address only, so it cannot be used to reach internals.
  coturn:
    image: coturn/coturn:4.18.0-alpine
    profiles: ["turn"]
    restart: unless-stopped
    command:
      - -c
      - /etc/coturn/turnserver.conf
      - --static-auth-secret=${TURN_SECRET:?set TURN_SECRET}
      - --external-ip=${PUBLIC_IP:?set PUBLIC_IP}
      - --allowed-peer-ip=${PUBLIC_IP:?set PUBLIC_IP}
    volumes:
      - ./infra/coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro
    ports:
      - "3478:3478/udp"
      - "3478:3478/tcp"
      - "49160-49169:49160-49169/udp"
    networks:
      - egress
```

6. In `networks.cdp`, add `name: mastertutor_cdp` (keep `internal: true` and the `ipam` block).

**`infra/coturn/turnserver.conf`**:
```ini
# coturn for MasterTutor (spec §10.2.5). Short-lived TURN REST credentials only (use-auth-secret);
# the secret, external IP and the single allowed peer (PUBLIC_IP, the WebRTC mux) come from the
# Compose command. TLS on 5349 needs certificates and is added at deploy (Phase 9).
listening-port=3478
realm=mastertutor
use-auth-secret
fingerprint
no-tls
no-dtls
no-cli
no-multicast-peers
min-port=49160
max-port=49169
denied-peer-ip=0.0.0.0-255.255.255.255
denied-peer-ip=::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=stdout
simple-log
```

**`infra/traefik/test-dynamic.yml`** (replace the whole file):
```yaml
# Test overlay routes. The live routers are the file-provider twin of the slot labels in
# compose.yml; tests/compose/live-routes.int.test.ts asserts both against liveRouterRule().
http:
  routers:
    web:
      rule: PathPrefix(`/`)
      entryPoints: [web]
      service: web
    live-browser-1:
      rule: 'Host(`localhost`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-1\.`)'
      priority: 1000
      entryPoints: [web]
      middlewares: [live-auth, live-strip]
      service: live-browser-1
    live-browser-2:
      rule: 'Host(`localhost`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-2\.`)'
      priority: 1000
      entryPoints: [web]
      middlewares: [live-auth, live-strip]
      service: live-browser-2
  middlewares:
    live-auth:
      forwardAuth:
        address: http://web:3000/api/live/auth
        authResponseHeaders:
          - Cookie
    live-strip:
      stripPrefixRegex:
        regex:
          - '^/live/[0-9a-f-]{36}'
  services:
    web:
      loadBalancer:
        servers:
          - url: http://web:3000
    live-browser-1:
      loadBalancer:
        servers:
          - url: http://browser-1:8080
    live-browser-2:
      loadBalancer:
        servers:
          - url: http://browser-2:8080
```

**`compose.live-test.yml`**:
```yaml
# Live-view test overlay (B6) on top of compose.test.yml: two slots (cross-slot auth cases)
# and coturn via --profile turn. Run: pnpm compose:live up -d --wait traefik browser-1 browser-2 coturn
services:
  browser-2:
    profiles: !reset []
  agent:
    environment:
      BROWSER_SLOTS: browser-1,browser-2
  migrate:
    environment:
      BROWSER_SLOTS: browser-1,browser-2
```

**`.env.example`**: add `PUBLIC_HOST=localhost` under "Local defaults", and `TURN_URLS=` below it with the comment `# e.g. turn:<PUBLIC_IP>:3478?transport=udp,turn:<PUBLIC_IP>:3478?transport=tcp (profile turn)`.

**`.env.test`**: add the lines `PUBLIC_HOST=localhost` and `TURN_URLS=turn:127.0.0.1:3478?transport=udp`.

**`scripts/env-init.ts`**: add `PUBLIC_HOST: "localhost",` to `ENV_DEFAULTS`.

**Root `package.json` scripts**: add
```json
"compose:live": "docker compose --env-file .env.test -f compose.yml -f compose.test.yml -f compose.live-test.yml --profile turn",
"test:live-stack": "RUN_LIVE_STACK=1 vitest run --project integration tests/live"
```

**`tests/compose/compose-config.int.test.ts`** (Phase 0 key-placement test): slots now legitimately receive `TURN_SECRET`, which the entrypoint scrubs (recorded deviation). Change the slot regex to:
```ts
        expect(key, slot).not.toMatch(/^(VAULT_|OPENAI_|S3_|DATABASE_URL|BETTER_AUTH|LIVE_COOKIE)/);
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run:
```bash
pnpm test:int -- tests/compose && pnpm test -- scripts
pnpm compose:live config --quiet
```
Expected: PASS. `config` prints nothing and exits 0.

- [ ] **Step 5: Commit.**
```bash
git add compose.yml compose.live-test.yml infra .env.example .env.test scripts/env-init.ts package.json tests/compose
git commit -m "feat(infra): per-slot live routers (labels + file provider), ForwardAuth middlewares, coturn profile, live test overlay"
```

---

### Task 12: Stack-level §12 tests: live-view auth through Traefik, TURN, SSRF and topology

**Files:**
- Create: `tests/support/turn-probe.ts`, `tests/live/live-stack.int.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the Task 11 stack, `signLiveSlot` (Task 5), `mintTurnCredential`/`deriveNekoPassword`, `livePath`.
- Produces: `probeTurnAllocate({host, port, username, password, timeoutMs?}): Promise<{ok: true} | {ok: false; errorCode: number | null}>` (test-only). The suite is gated by `RUN_LIVE_STACK=1` (`pnpm test:live-stack`).

- [ ] **Step 1: Write the TURN probe and the failing suite.**

`tests/support/turn-probe.ts`:
```ts
// Minimal TURN Allocate over UDP with long-term credentials (RFC 5766 / RFC 5389). Test-only:
// proves coturn accepts our minted credentials and rejects expired or forged ones.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";

const MAGIC = 0x2112a442;
const ALLOCATE_REQUEST = 0x0003;
const ALLOCATE_SUCCESS = 0x0103;
const ATTR = { USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, REALM: 0x0014, NONCE: 0x0015, REQUESTED_TRANSPORT: 0x0019 };

interface Attr {
  type: number;
  value: Buffer;
}

function encodeAttrs(attrs: Attr[]): Buffer {
  return Buffer.concat(
    attrs.map(({ type, value }) => {
      const header = Buffer.alloc(4);
      header.writeUInt16BE(type, 0);
      header.writeUInt16BE(value.length, 2);
      return Buffer.concat([header, value, Buffer.alloc((4 - (value.length % 4)) % 4)]);
    }),
  );
}

function header(type: number, length: number, transactionId: Buffer): Buffer {
  const out = Buffer.alloc(20);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(length, 2);
  out.writeUInt32BE(MAGIC, 4);
  transactionId.copy(out, 8);
  return out;
}

function request(attrs: Attr[], key?: Buffer): Buffer {
  const transactionId = randomBytes(12);
  const body = encodeAttrs(attrs);
  if (!key) return Buffer.concat([header(ALLOCATE_REQUEST, body.length, transactionId), body]);
  // The length must already count the 24-byte MESSAGE-INTEGRITY attribute (RFC 5389 §15.4).
  const head = header(ALLOCATE_REQUEST, body.length + 24, transactionId);
  const integrity = createHmac("sha1", key).update(Buffer.concat([head, body])).digest();
  return Buffer.concat([head, body, encodeAttrs([{ type: ATTR.MESSAGE_INTEGRITY, value: integrity }])]);
}

function parse(message: Buffer): { type: number; attrs: Map<number, Buffer> } {
  const attrs = new Map<number, Buffer>();
  const end = 20 + message.readUInt16BE(2);
  for (let offset = 20; offset + 4 <= end; ) {
    const type = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    attrs.set(type, message.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  return { type: message.readUInt16BE(0), attrs };
}

function errorCode(attrs: Map<number, Buffer>): number | null {
  const value = attrs.get(ATTR.ERROR_CODE);
  return value ? (value[2]! & 0x7) * 100 + value[3]! : null;
}

async function exchange(host: string, port: number, message: Buffer, timeoutMs: number): Promise<Buffer> {
  const socket = createSocket("udp4");
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TURN server did notanswer")), timeoutMs);
      socket.once("message", (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.send(message, port, host);
    });
  } finally {
    socket.close();
  }
}

export type AllocateOutcome = { ok: true } | { ok: false; errorCode: number | null };

export async function probeTurnAllocate(options: {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
}): Promise<AllocateOutcome> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const transport = { type: ATTR.REQUESTED_TRANSPORT, value: Buffer.from([17, 0, 0, 0]) };
  const first = parse(await exchange(options.host, options.port, request([transport]), timeoutMs));
  if (first.type === ALLOCATE_SUCCESS) return { ok: true };
  const realm = first.attrs.get(ATTR.REALM);
  const nonce = first.attrs.get(ATTR.NONCE);
  if (errorCode(first.attrs) !== 401 || !realm || !nonce) return { ok: false, errorCode: errorCode(first.attrs) };
  const key = createHash("md5").update(`${options.username}:${realm.toString()}:${options.password}`).digest();
  const second = parse(
    await exchange(
      options.host,
      options.port,
      request(
        [
          transport,
          { type: ATTR.USERNAME, value: Buffer.from(options.username) },
          { type: ATTR.REALM, value: realm },
          { type: ATTR.NONCE, value: nonce },
        ],
        key,
      ),
      timeoutMs,
    ),
  );
  return second.type === ALLOCATE_SUCCESS ? { ok: true } : { ok: false, errorCode: errorCode(second.attrs) };
}
```

`tests/live/live-stack.int.test.ts`:
```ts
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LIVE_SLOT_COOKIE, NEKO_SESSION_COOKIE, livePath } from "@mastertutor/contracts";
import { deriveNekoPassword, mintTurnCredential } from "@mastertutor/contracts/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signLiveSlot } from "../../apps/web/lib/server/live/cookie.ts";
import { probeTurnAllocate } from "../support/turn-probe.ts";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const BASE = "http://localhost:18080";
const COMPOSE = ["compose", "--env-file", ".env.test", "-f", "compose.yml", "-f", "compose.test.yml",
  "-f", "compose.live-test.yml", "--profile", "turn"];
const compose = async (args: string[]) =>
  (await run("docker", [...COMPOSE, ...args], { cwd: root, maxBuffer: 50 * 1024 * 1024 })).stdout.trim();
const docker = async (args: string[]) => (await run("docker", args, { cwd: root })).stdout.trim();
const psql = (query: string) =>
  compose(["exec", "-T", "postgres", "psql", "-U", "owner", "-d", "mastertutor", "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", query]);

let env: Record<string, string>;
let session = "";
let userId = "";
let ws1 = "";
let ws2 = "";
const now = () => Math.floor(Date.now() / 1000);

async function newRun(workspaceId: string): Promise<string> {
  return psql(`with r as (insert into runs (workspace_id, goal, status, allowed_origins)
    values ('${workspaceId}', 'live stack', 'running', '{https://example.com}') returning id) select id from r`);
}
async function release(slot: string) {
  await psql(`update runs set slot_name = null where slot_name = '${slot}';
    update browser_slots set state = 'restarting', run_id = null where name = '${slot}'`);
}
async function lease(slot: string, runId: string) {
  await release(slot);
  await psql(`update browser_slots set state = 'leased', run_id = '${runId}', lease_owner = 'test',
      lease_expires_at = now() + interval '1 hour' where name = '${slot}';
    update runs set slot_name = '${slot}' where id = '${runId}'`);
}
const slotCookie = (slot: string, runId: string, forUser = userId) =>
  `${LIVE_SLOT_COOKIE}=${signLiveSlot(env.LIVE_COOKIE_SECRET!, { slotName: slot, runId, userId: forUser, expiresAt: now() + 600 })}`;
const live = (path: string, cookies: string[], init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookies.join("; ") },
  });

describe.skipIf(process.env.RUN_LIVE_STACK !== "1")("live view through the real stack (spec §12)", () => {
  beforeAll(async () => {
    env = Object.fromEntries(
      (await readFile(new URL("../../.env.test", import.meta.url), "utf8"))
        .split("\n")
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    await compose(["down", "-v", "--remove-orphans"]);
    await compose(["up", "-d", "--wait", "traefik", "browser-1", "browser-2", "coturn"]);
    const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email: "owner@example.test", password: "correct-horse-battery-staple", name: "Owner" }),
    });
    expect(signUp.ok).toBe(true);
    session = signUp.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => c.startsWith("better-auth.session_token="))!;
    userId = await psql(`select id from "user" where email = 'owner@example.test'`);
    ws1 = await psql(`select workspace_id from workspace_members where user_id = '${userId}'`);
    ws2 = await psql(`with w as (insert into workspaces (name) values ('Other') returning id) select id from w`);
  });
  afterAll(async () => {
    if (process.env.RUN_LIVE_STACK === "1") await compose(["down", "-v", "--remove-orphans"]);
  });

  it("serves n.eko for a valid cookie and forwards only NEKO_SESSION upstream", async () => {
    const run1 = await newRun(ws1);
    await lease("browser-1", run1);
    const cookies = [session, slotCookie("browser-1", run1)];
    const index = await live(livePath(run1), cookies);
    expect(index.status).toBe(200);
    expect(await index.text()).toMatch(/n\.eko|neko/i);
    const login = await live(`${livePath(run1)}api/login`, cookies, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "user", password: deriveNekoPassword(env.NEKO_MEMBER_SECRET!, "browser-1") }),
    });
    expect(login.status).toBe(200);
    const neko = login.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => c.startsWith(`${NEKO_SESSION_COOKIE}=`))!;
    const whoami = await live(`${livePath(run1)}api/whoami`, [...cookies, neko]);
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({ id: "user" });
    expect((await live(`${livePath(run1)}api/whoami`, cookies)).status).toBe(401);
  });

  it("rejects every §12 live-view auth case", async () => {
    const run1 = await newRun(ws1);
    const run2 = await newRun(ws1);
    const run3 = await newRun(ws2);
    await lease("browser-1", run1);
    await lease("browser-2", run2);
    const valid = slotCookie("browser-1", run1);
    // no session
    expect((await live(livePath(run1), [valid])).status).toBe(401);
    // a cookie pointing at a slot leased to a different run
    expect((await live(livePath(run1), [session, slotCookie("browser-2", run1)])).status).toBe(403);
    // forged signature
    expect((await live(livePath(run1), [session, `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`])).status).toBe(401);
    // duplicate live_slot cookies (Review Focus 1)
    expect((await live(livePath(run1), [session, valid, `${LIVE_SLOT_COOKIE}=browser-2.${now() + 600}.x`])).status).toBe(401);
    // another workspace's run
    await lease("browser-2", run3);
    expect((await live(livePath(run3), [session, slotCookie("browser-2", run3)])).status).toBe(403);
    // an idle slot
    await release("browser-2");
    await psql(`update browser_slots set state = 'idle' where name = 'browser-2'`);
    expect((await live(livePath(run2), [session, slotCookie("browser-2", run2)])).status).toBe(403);
    // a stale cookie after release
    await release("browser-1");
    expect((await live(livePath(run1), [session, valid])).status).toBe(403);
    // no live_slot at all never reaches n.eko
    const plain = await live(livePath(run1), [session]);
    expect(await plain.text()).not.toMatch(/n\.eko/i);
  });

  it("coturn accepts a fresh credential and rejects expired or forged ones", async () => {
    const secret = env.TURN_SECRET!;
    const probe = (c: { username: string; credential: string }) =>
      probeTurnAllocate({ host: "127.0.0.1", port: 3478, username: c.username, password: c.credential });
    expect(await probe(mintTurnCredential(secret, "stack-test", now(), 600))).toEqual({ ok: true });
    expect(await probe(mintTurnCredential(secret, "stack-test", now() - 1_200, 600))).toEqual({ ok: false, errorCode: 401 });
    expect(await probe(mintTurnCredential("wrong-turn-secret-0123456789abcdefgh", "stack-test", now(), 600))).toEqual({
      ok: false,
      errorCode: 401,
    });
  });

  it("blocks SSRF from inside a slot (spec §12 security 5)", async () => {
    const browser2 = await compose(["ps", "-q", "browser-2"]);
    const ip2 = await docker(["inspect", "-f", '{{(index .NetworkSettings.Networks "mastertutor_cdp").IPAddress}}', browser2]);
    const prefix = env.CDP_SUBNET_PREFIX ?? "172.30.231";
    const targets = [
      "http://postgres:5432/", "http://garage:3900/", "http://web:3000/healthz",
      `http://${prefix}.10:8787/healthz`, `http://${prefix}.11:3000/healthz`,
      "http://169.254.169.254/latest/meta-data/",
      `http://${ip2}:9223/json/version`, `http://${ip2}:4713/`, `http://${ip2}:9224/`, `http://${ip2}:8080/health`,
    ];
    for (const target of targets) {
      const reached = await compose(["exec", "-T", "browser-1", "curl", "-s", "-m", "3", "-o", "/dev/null", target])
        .then(() => true, () => false);
      expect(reached, target).toBe(false);
    }
  });

  it("keeps n.eko and CDP off the host and the edge network", async () => {
    const browser1 = await compose(["ps", "-q", "browser-1"]);
    for (const line of (await docker(["port", browser1])).split("\n")) expect(line).toContain("59001");
    const ip1 = await docker(["inspect", "-f", '{{(index .NetworkSettings.Networks "mastertutor_cdp").IPAddress}}', browser1]);
    for (const url of ["http://browser-1:8080/health", `http://${ip1}:8080/health`, `http://${ip1}:9223/json/version`]) {
      const reached = await docker(["run", "--rm", "--network", "mastertutor_edge", "curlimages/curl:8.22.0", "-s", "-m", "3", "-o", "/dev/null", url])
        .then(() => true, () => false);
      expect(reached, url).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Build and run it, expecting it to pass now (Tasks 1–11 provide everything).** If it fails, fix the owning task's code, not the test.

Run:
```bash
pnpm compose:live build
pnpm test:live-stack
pnpm compose:live down -v
docker builder prune -f && docker image prune -f
```
Expected: 5 tests PASS. Without `RUN_LIVE_STACK=1` (plain `pnpm test:int`), the suite is skipped.

- [ ] **Step 3: Add CI.** In `.github/workflows/ci.yml`, in the job that runs the Phase 0 compose smoke test, add after that step:
```yaml
      - name: Live view stack tests (B6)
        run: |
          pnpm compose:live build
          pnpm test:live-stack
      - name: Live view stack teardown
        if: always()
        run: pnpm compose:live down -v
```

- [ ] **Step 4: Commit.**
```bash
git add tests/support/turn-probe.ts tests/live .github/workflows/ci.yml
git commit -m "test(live): stack-level live-view auth, TURN, SSRF and topology tests"
```

---

### Task 13: Wire into B1 and run the takeover-lock acceptance tests

**Files:**
- Create: `apps/agent/src/live/runtime.ts`, `apps/agent/src/live/b1-adapters.ts`
- Modify: `apps/agent/src/main.ts` (B1's composition root), B1's run host (only the two hook call sites)
- Test: `apps/agent/src/live/takeover-lock.int.test.ts`

**Interfaces:**
- Consumes: the B1 exports in the *B1 seam* table. If B1's names differ, adapt only `b1-adapters.ts` and the binding block.
- Produces:
  - `LiveRuntimeDeps` `{sql, storage, adminSecret, aborts: AbortPort, approvals: ApprovalPort, log}`;
  - `LiveRuntime` `{start(); stop(); afterLease(run: LeasedRun); beforeRelease(run: LeasedRun)}`;
  - `createLiveRuntime(deps)`;
  - adapters `sessionPort(session)`, `abortPort(registry)`, `approvalPort(sql)`.

- [ ] **Step 1: Write the runtime and the adapters.**

`apps/agent/src/live/runtime.ts`:
```ts
import type { createLogger } from "@mastertutor/contracts/server";
import type { DbHandle } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { createControlCoordinator, listenRunControl } from "./control.ts";
import { createDownloadIngestor } from "./downloads.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createNekoAdmin } from "./neko-admin.ts";
import { createNekoLiveView } from "./neko-live-view.ts";
import type { AbortPort, ApprovalPort, LeasedRun } from "./ports.ts";

export interface LiveRuntimeDeps {
  sql: DbHandle["sql"];
  storage: Storage;
  adminSecret: string;
  aborts: AbortPort;
  approvals: ApprovalPort;
  log: ReturnType<typeof createLogger>;
}

export interface LiveRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** B1 calls this after the BrowserSession opens and before restore. */
  afterLease(run: LeasedRun): Promise<void>;
  /** B1 calls this before Browser.close on release. */
  beforeRelease(run: LeasedRun): Promise<void>;
}

export function createLiveRuntime(deps: LiveRuntimeDeps): LiveRuntime {
  const admin = createNekoAdmin({ adminSecret: deps.adminSecret });
  const control = createControlCoordinator({
    sql: deps.sql,
    liveView: createNekoLiveView({ admin }),
    idleProbe: createSlotIdleProbe(),
    aborts: deps.aborts,
    log: deps.log,
  });
  const downloads = createDownloadIngestor({ sql: deps.sql, storage: deps.storage, approvals: deps.approvals, log: deps.log });
  let unlisten: (() => Promise<void>) | undefined;
  return {
    async start() {
      unlisten = await listenRunControl(deps.sql, control, deps.log);
    },
    async stop() {
      await unlisten?.();
    },
    async afterLease(run) {
      await control.attach(run);
      await downloads.attach(run).catch((error: unknown) =>
        deps.log.error({ err: error, runId: run.runId }, "download capture unavailable for this lease"),
      );
    },
    async beforeRelease(run) {
      control.detach(run.runId);
      await downloads.detach(run.runId);
      admin.forget(run.slot.name);
    },
  };
}
```

`apps/agent/src/live/b1-adapters.ts`:
```ts
// The only file that names B1 internals. If B1's exports differ, change them here.
import type { DbHandle } from "@mastertutor/db";
import type { BrowserSession } from "../browser/session.ts";
import type { AbortRegistry } from "../loop/aborts.ts";
import { requestApproval } from "../loop/approvals.ts";
import type { AbortPort, ApprovalPort, LiveSessionPort } from "./ports.ts";

export function sessionPort(session: BrowserSession): LiveSessionPort {
  return {
    setController: (holder) => session.setController(holder),
    newBrowserCdpSession: () => session.browser.newBrowserCDPSession(),
  };
}

export function abortPort(registry: AbortRegistry): AbortPort {
  return {
    abort: (runId, reason) => registry.abort(runId, reason),
    renew: (runId) => void registry.renew(runId),
  };
}

export function approvalPort(sql: DbHandle["sql"]): ApprovalPort {
  return { request: (runId, request) => requestApproval(sql, runId, request) };
}
```

- [ ] **Step 2: Bind into `main.ts` and B1's run host.**

In `apps/agent/src/main.ts`, after B1 constructs its `AbortRegistry` (called `aborts` below) and before it starts the run scheduler, add this binding block:
```ts
// --- B6 live view binding ---------------------------------------------------
const live = createLiveRuntime({
  sql: database.sql,
  storage,
  adminSecret: env.NEKO_ADMIN_SECRET,
  aborts: abortPort(aborts),
  approvals: approvalPort(database.sql),
  log,
});
await live.start();
const liveHooks = {
  afterLease: (lease: { runId: string; workspaceId: string; slot: { name: string }; session: BrowserSession }) =>
    live.afterLease({ ...lease, session: sessionPort(lease.session) }),
  beforeRelease: (lease: { runId: string; workspaceId: string; slot: { name: string }; session: BrowserSession }) =>
    live.beforeRelease({ ...lease, session: sessionPort(lease.session) }),
};
// -----------------------------------------------------------------------------
```
Then:
- pass `hooks: liveHooks` to B1's run host;
- add `await live.stop();` to `shutdown` before `database.close()`;
- add these imports: `createLiveRuntime` from `./live/runtime.ts`; `abortPort`, `approvalPort`, `sessionPort` from `./live/b1-adapters.ts`; `type BrowserSession` from `./browser/session.ts`.

If B1's run host has no `hooks` option, add exactly two calls there:
- `await hooks.afterLease(lease)` right after the BrowserSession opens (before restore);
- `await hooks.beforeRelease(lease)` before `Browser.close`.

Remove any `run_control` LISTEN handler from B1; B6 owns that channel.

- [ ] **Step 3: Write the acceptance test.**

`apps/agent/src/live/takeover-lock.int.test.ts`:
```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TAKEOVER_ABORT_TARGET_MS } from "@mastertutor/contracts";
import { createLogger, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { createDb, requestHandBack, requestTakeover, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leaseSlot, seedMember, seedRun } from "../../../../tests/support/live-seed.ts";
import { TEST_NEKO_ADMIN_SECRET, TEST_NEKO_MEMBER_SECRET, startTestSlot, type TestSlot } from "../../../../tests/support/slot.ts";
import { waitFor } from "../../../../tests/support/wait.ts";
import { ControlHeld, openBrowserSession, type BrowserSession } from "../browser/session.ts";
import { AbortRegistry } from "../loop/aborts.ts";
import { abortPort, sessionPort } from "./b1-adapters.ts";
import { createControlCoordinator, listenRunControl } from "./control.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createNekoAdmin } from "./neko-admin.ts";
import { createNekoLiveView } from "./neko-live-view.ts";

const log = createLogger({ service: "test", level: "silent" });
let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let agent: DbHandle;
let slot: TestSlot;
let session: BrowserSession;
let registry: AbortRegistry;
let runId: string;
let member: { userId: string; workspaceId: string };
let unlisten: () => Promise<void>;
let intranet: Server;

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1"] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 4 });
  intranet = createServer((_req, res) => res.end("intranet-secret"));
  await new Promise<void>((resolve) => intranet.listen(0, "0.0.0.0", resolve));
  // Misconfigured topology on purpose: private egress allowed and a host name for the host.
  slot = await startTestSlot({
    env: { SLOT_EGRESS_ALLOW_CIDRS: "192.168.0.0/16,172.16.0.0/12" },
    addHosts: { "intranet.test": "host-gateway" },
  });
  member = await seedMember(owner.sql);
  runId = await seedRun(owner.sql, { workspaceId: member.workspaceId });
  await leaseSlot(owner.sql, "browser-1", runId);
  await loginNeko({ baseUrl: slot.nekoUrl, username: "user", password: deriveNekoPassword(TEST_NEKO_MEMBER_SECRET, "browser-1") });
  registry = new AbortRegistry();
  session = await openBrowserSession({
    runId,
    slotName: "browser-1",
    allowedOrigins: ["https://example.com", `http://intranet.test:${(intranet.address() as AddressInfo).port}`],
    controller: "agent",
  });
  const coordinator = createControlCoordinator({
    sql: agent.sql,
    liveView: createNekoLiveView({ admin: createNekoAdmin({ adminSecret: TEST_NEKO_ADMIN_SECRET, baseUrl: () => slot.nekoUrl }) }),
    idleProbe: createSlotIdleProbe({ url: () => slot.idleUrl }),
    aborts: abortPort(registry),
    log,
  });
  unlisten = await listenRunControl(agent.sql, coordinator, log);
  await coordinator.attach({ runId, workspaceId: member.workspaceId, slot: { name: "browser-1" }, session: sessionPort(session) });
});
afterAll(async () => {
  await unlisten?.();
  await session?.close();
  intranet?.close();
  await Promise.all([owner?.close(), web?.close(), agent?.close(), slot?.stop()]);
  await testDb?.stop();
});

const longDrag = () => ({
  type: "drag" as const,
  path: Array.from({ length: 100 }, (_, i) => ({ x: 100 + i * 5, y: 200 + (i % 10) })),
});

describe("takeover lock with B1's real session (spec §12)", () => {
  it("aborts an in-flight action within the target", async () => {
    const inFlight = session.computer(longDrag(), registry.signal(runId));
    const t0 = performance.now();
    await requestTakeover(web.sql, { runId, userId: member.userId });
    await expect(inFlight).rejects.toThrow();
    expect(performance.now() - t0).toBeLessThan(TAKEOVER_ABORT_TARGET_MS + 100);
  });

  it("throws ControlHeld for input and model screenshots while the user holds control", async () => {
    await expect(session.computer({ type: "click", x: 10, y: 10, button: "left" }, registry.signal(runId))).rejects.toBeInstanceOf(ControlHeld);
    await expect(session.screenshotForModel()).rejects.toBeInstanceOf(ControlHeld);
  });

  it("restores agent input after hand back with a fresh signal", async () => {
    await requestHandBack(web.sql, { runId, userId: member.userId, note: null });
    await waitFor(async () => {
      try {
        await session.computer({ type: "move", x: 20, y: 20 }, registry.signal(runId));
        return true;
      } catch {
        return false;
      }
    }, { what: "agent input re-enabled" });
    expect(registry.signal(runId).aborted).toBe(false);
  });

  it("blocks private addresses at page level even when the topology allows them", async () => {
    const url = `http://intranet.test:${(intranet.address() as AddressInfo).port}/`;
    expect(await slot.exec(["curl", "-s", "-m", "3", url])).toBe("intranet-secret");
    await session.page.goto(url).catch(() => null);
    expect(await session.page.content()).not.toContain("intranet-secret");
  });
});
```

- [ ] **Step 4: Run all of B6's tests.**

Run:
```bash
pnpm test && pnpm test:int -- apps/agent apps/web packages tests/compose
pnpm test:live-stack
pnpm typecheck && pnpm lint && pnpm format:check
docker builder prune -f && docker image prune -f
```
Expected: all PASS. If B1's API differs from the seam table, the only edits allowed are in `b1-adapters.ts`, the `main.ts` binding block, and the import and method names in `takeover-lock.int.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add apps/agent
git commit -m "feat(agent): wire live runtime into B1 lifecycle; takeover-lock acceptance tests"
```

---

## Recorded deviations from the spec

1. **Embedded client auth.** n.eko 3.1.6 embeds a legacy client that needs `usr`/`pwd` in the URL. The embed path carries the placeholders `usr=user&pwd=cookie`. Authentication is by the relayed `NEKO_SESSION` cookie through the legacy handler's `whoami`-first path. Password logins over `/ws` are impossible with cookie auth on. `liveEmbedPath` and `OpenLiveResult` were changed accordingly.
2. **TURN credentials for the embedded client.** The embedded client cannot take per-session ICE servers, so the §15 fallback applies.
   - The slot mints a TURN credential at boot (24 h TTL, re-minted on every release-restart). Slots therefore receive `TURN_SECRET`, which is scrubbed before n.eko starts. This deviates from the §13 secret table, and the Phase 0 key-placement test was adjusted.
   - `openLive` still returns 10-minute per-run credentials, as the contract requires, for a future custom client.
3. **Middleware order.** ForwardAuth runs **before** StripPrefixRegex, so auth sees the original URI.
4. **Cookie rewrite.** ForwardAuth rewrites the upstream `Cookie` header to `NEKO_SESSION` only (`authResponseHeaders: Cookie`).
5. **User idle.** It is measured by the X server's idle timer, via a slot probe on port 9224 that only the agent can reach. CDP input does not reset it.
6. **New column and event field.** `runs.control_user_id` was added. `download_ready` gained `assetId`.
7. **coturn networking.** coturn runs on the bridge network `egress`, relaying only to `PUBLIC_IP`, with relay ports 49160–49169/udp. 5349 TLS is deferred to Phase 9 because it needs certificates.
8. **Unhosted user member.** The `user` member starts with `can_host=false`. n.eko runs with legacy mode, cookie auth (not Secure), implicit hosting off and file-chooser handling on.
9. **`run_control`.** B6 owns the `run_control` LISTEN.

## Notes for later phases

- **B1:**
  - Call `afterLease`/`beforeRelease` as described in the B1 seam section.
  - Initialize the guard from `runs.controller`; never sleep while `controller='user'`.
  - Treat `run_wake {reason:"resume"}` for a held running run as "re-observe and continue".
  - `requestApproval` handles out-of-band `download` requests.
- **B2:** `assets.url` must use a 300 s TTL for downloads (spec §10.2.9) and must not serve active content inline. Downloads are stored as `application/octet-stream` unless their type is inert.
- **F3:**
  - Set the iframe `src` to `embedPath` only **after** `openLive` resolves.
  - Call `openLive` on every `slot` event and on Reconnecting.
  - On `CONFLICT` (`in_use`), show "Open in another tab".
  - Revert the takeover if no `control {holder:"user"}` arrives within 2 s, or an `error takeover_failed` arrives.
  - Show Upload in the browser chrome only while in control, using `uploadToFileDialog`/`dropFiles`. Map `no_file_dialog` to "Click the site's upload button first".
- **Phase 7:**
  - Mount `getLiveProcedures()` into the oRPC router with `RequestHeadersPlugin` and `ResponseHeadersPlugin`.
  - The SSE route forwards `control`, `status`, `error` and `download_ready`.
- **Phase 9:**
  - Connect Dokploy's Traefik to `mastertutor_cdp` at `.12`, for example with `docker network connect --ip 172.30.231.12 mastertutor_cdp dokploy-traefik`.
  - Confirm the `websecure` entrypoint and the `letsencrypt` resolver names.
  - Set `PUBLIC_HOST`, and set `TURN_URLS` with the public IP.
  - Open firewall ports 59001–59006 (UDP and TCP), 3478 (UDP and TCP) and 49160–49169/udp.
  - Add 5349 TLS with certificates.

## Self-Review

**1. Spec coverage (§10, §12, §16 B6):**

| Requirement | Task |
|---|---|
| `NekoLiveView`, n.eko admin API | 4 |
| `openLive`, server-side login, signed `live_slot`, TURN credentials | 1, 5, 7 |
| `/api/live/auth` ForwardAuth | 6 |
| Per-slot Traefik routers (file provider and labels), mux ports | 11 |
| Control lock: `takeControl`/`handBack`, `NOTIFY run_control`, abort, give/take, clipboard, 15-min hand-back | 2, 7, 8, 13 |
| Uploads (dialog/drop) | 10 |
| Downloads → Garage → `download_ready` | 9 |
| coturn profile | 11, 12 |
| §12 live-view auth (all 7 cases plus 8080/9223 isolation) | 6, 12 |
| §12 takeover lock (abort ≤ 300 ms, ControlHeld, user input blocked, re-observe after hand back, clipboard, sleeping wake) | 8, 13 |
| §12 SSRF (topology and page-level) | 12, 13 |
| §12 slot reset of downloads | 9 (detach) |

The sleeping-takeover wake-priority lease itself is B1's `SlotPool` test. B6 covers the `run_wake {takeover}` NOTIFY (Task 2) and the attach-in-takeover path (Task 8).

**2. Placeholders:** none. The only conditional instructions are the explicit B1 binding (Task 13) and reusing `playwright-core`/`appendRunEvent` if B1 already added them.

**3. Name consistency:** the same names are used everywhere they appear:
- `requestTakeover`/`requestHandBack`/`ControlRequestResult` (Tasks 2, 7, 8, 13);
- `LeasedRun`/`LiveSessionPort`/`AbortPort`/`ApprovalPort` (Tasks 8, 9, 13);
- `signLiveSlot`/`verifyLiveSlot` (Tasks 5, 6, 12);
- `liveRouterRule`/`LIVE_STRIP_REGEX` (Tasks 1, 11);
- `startTestSlot` fields (`nekoUrl`, `idleUrl`, `cdpUrl`, `downloadsDir`, `xdotool`, `exec`) in Tasks 4, 5, 8, 9, 10, 13.

**4. Review Focus:** all five items have tests:
1. duplicate cookies: Tasks 6 and 12;
2. second tab: Task 5;
3. takeover before connect: Task 8;
4. download race: Task 9;
5. rapid toggling: Task 8.
