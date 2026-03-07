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


---

# Amendment — reconciliation with the built B1/FE code and B3 Amendment E (2026-10-06)

# Phase B6 Live View: Amendment — reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Changes from the B3/B6 interface diff (2026-10-06).** B3 Amendment E (`docs/superpowers/plans/2026-10-05-phase-b3-vault.md`) is the source of truth; this plan was aligned to it per `.superpowers/plan-drafts/b3-b6-interface-diff.md` E1–E12:
> - **E1/E5:** B6's release-side hook is `onLeaseEnding(slot: ReleasedSlot)`. B3's `onReleased(runId)` is untouched and single-owner; `composeRunHooks` merges `functionTools` (with a duplicate-name guard), `promptContext`, `onLeased` and `onLeaseEnding` only.
> - **E2:** A2 inserts the unreleased `onLeaseEnding` call into B3's `finally` and keeps B3's `onReleased(this.runId)` after `close()`.
> - **E3/E4/E6/E11:** A2 owns `onLeased`, `onLeaseEnding`, `browserCdp` and `composeRunHooks` unconditionally; a B3 name mismatch changes B6, never B3; §1 describes the post-B3 code; A9, A13 and A15 apply on top of B3's edits to the same files.
> - **E7:** a failed takeover while an approval is pending returns straight to `waiting(approval)` (never `running`); new A2 test.
> - **E8:** A2 Step 8 also fixes B3 E 0.5's A5 fixture in `run-loop.int.test.ts` (`controlUserId: "test-user"`).
> - **E9:** `LeasedSlot`/`AttachedBrowser` carry the `BrowserSession`; A12 calls `vault.enrolment.begin` after a successful give and `finish` on hand-back or lease end; A13 passes `vault.enrolment`.
> - **E10:** `requestTakeover` is idempotent for the holder and refuses other members; `requestHandBack` is accepted only from the controller or a workspace `owner` (`not_controller` → `FORBIDDEN`).
> - **E12:** deviation 9 states that agent-side fetches (B5 PDF capture) are not downloads; new A11 inline-PDF test; §8 B5 note.

**Goal:** Make the B6 plan (`docs/superpowers/plans/2026-10-05-phase-b6-live-view.md`, the "base plan") executable against the code that is actually built. The amendment closes the live security gap first, then ships the n.eko live view, ForwardAuth, takeover and hand-back through B1's existing control lock, user-only downloads and user uploads.

**Architecture:**
- **One control lock, B1's.** B1 already LISTENs on `run_control`, holds the `ControlGuard`, aborts the in-flight action and calls `hooks.control.onUserControl` / `onAgentControl` in the right order (pre-flight §0). B6 implements **only** those hooks (with `NekoLiveView`) plus the lease lifecycle hooks `onLeased` / `onLeaseEnding` (B3's `onReleased(runId)` stays the vault's). There is no second coordinator, no second `run_control` listener and no B6 write to `runs.status`.
- **One RPC router, the frontend's.** `runs.openLive`, `runs.takeControl` and `runs.handBack` replace the `notWired` handlers in `apps/web/lib/server/rpc/live-router.ts`. `/api/rpc` gains `ResponseHeadersPlugin` so `openLive` can set cookies.
- **Fail closed at the edges.** The n.eko `user` member boots unable to host. ForwardAuth answers 401 unless the request carries exactly one valid `live_slot` and exactly one well-formed `NEKO_SESSION`, and its 200 rewrites the upstream `Cookie` to `NEKO_SESSION` only. A takeover with no connected live view fails and the agent keeps control.
- **v1 scope (D42).** No coturn, no TURN credentials (`openLive` returns `iceServers: []`). Production Traefik labels belong to Phase 9's `compose.prod.yml` (D41); B6 ships the test file-provider routers and the single rule source `liveRouterRule()`.

**Tech Stack:** n.eko `ghcr.io/m1k1o/neko/chromium:3.1.6` (legacy client), Traefik v3.7.13 (file provider in tests), Node 24, Zod 4.6.5, Drizzle 0.45.3, postgres.js 3.4.9, `@orpc/server` 1.15.4 (already in `apps/web`), `playwright-core` 1.63.0 (already in `apps/agent`), Vitest 5.0.3.

**Spec:** `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` §1, §3.1, §5, §6, §10, §12. Decisions in `orchestration/STATE.md` override the spec, especially D19, D26, D27, D36–D43 (D41: ForwardAuth targets the static `.11` address, external `mastertutor-cdp`; D42: coturn is not in v1). Pre-flight: `.superpowers/sdd/2026-10-05-phase-b6-live-view/preflight.md` (finding IDs F*, E*, S*, G*, W* below refer to it). `CLAUDE.md` is mandatory.

---

## 0. How to use this amendment

1. **This amendment supersedes the base plan's tasks.** Execute the tasks **in this document**, in this order: A1 → A15. Read the base plan only where a step here says "copy verbatim from base plan Task N, Step M"; that text is unchanged and binding.
2. **B3 runs before B6.** B6 assumes the B3 seam commit (B3 "Amendment E", drafted in parallel in `.superpowers/plan-drafts/b3-amendment-e.md`) has landed. §3 lists exactly what B6 needs. From B3 E it consumes only the post-Task-0 `hooks.ts`, `worker.ts` and `run-loop.ts` (including `onReleased(runId)`, `onClick`, and `markTakeover` superseding a pending approval), plus `vault.enrolment` in `main.ts`; A2 adds `onLeased`, `onLeaseEnding`, `browserCdp` and `composeRunHooks`.
3. **Before dispatching A2**, the orchestrator diffs §3 of this amendment against B3 Amendment E's seam section. B3 Amendment E is the source of truth for every name it defines. If B3 landed a hook under a different name or shape than §3 expects, change B6 (this plan) to match, never B3's call sites, and record it in the ledger.
4. Never read `.env`. `.env.test` holds dummy values only; tests may read it, plan executors never print it.

### Old task → new task

| Base plan task | Fate | Amendment task |
|---|---|---|
| 3 (security part: `user` starts with `can_host=false`) | **Moved first**, delivered as an edit | **A1** |
| — | New: B1 seams B6 needs (F3, F4, F5, F7, F8) | **A2** |
| 1 Contracts, TURN, n.eko login | Changed: TURN removed (S7, G1); `liveForwardAuthAddress` added (D41) | **A3** |
| 2 DB column + queries | Changed: drizzle, B1's `emitRunEvent`, no agent status writes (F2, F4, F7, F8, F9); the column and CHECK moved to A2 | **A4** |
| 3 Slot image (rest) | Changed: edit, never replace (S1, S5, G2); no `turn-ice` (S7) | **A5** |
| 4 NekoAdmin, NekoLiveView, idle probe, test slot | Changed: give waits for a *connected* session; tests run on the B1 behaviour stack (F9, F12, W5); `startTestSlot` dropped | **A6** |
| 5 `openLive` | Changed: no TURN; drizzle; real-slot test on the behaviour stack | **A7** |
| 6 ForwardAuth | Changed: 401 without `NEKO_SESSION` (S3, W4); `getViewer()`; fixture mode 403 (E3) | **A8** |
| 7 oRPC procedures | **Replaced**: handlers wired into the FE `liveRouter` (E1, E2) | **A9** |
| 10 Uploads | Changed: 401 → `signed_out` (E7); real-slot test on the behaviour stack without agent imports or locale-dependent window search (W5) | **A10** |
| 9 Downloads | **Replaced**: user-only downloads (F6), streamed hash and upload (S10), attached through `onLeased` (F5) | **A11** |
| 8 ControlCoordinator | **Replaced**: B6 implements `hooks.control`, `onLeased`, `onLeaseEnding` (F2, F3, F4, S2, S12) and drives B3's passkey enrolment | **A12** |
| 13 Wire into B1 | **Replaced**: `main.ts` wiring and the takeover acceptance behaviour test (F1, F10, G3, W3, W6) | **A13** |
| 11 Compose | **Replaced**: test file-provider routers only, `.11` ForwardAuth, security headers; no coturn, no production labels (S4, S6, S7, G7) | **A14** |
| 12 Stack tests | Changed: no TURN; adds W1 (client through the prefix) and the openLive RPC path | **A15** |

Base plan sections that are **superseded wholesale**: "B1 seam", "File Structure", "Recorded deviations", "Notes for later phases", "Self-Review". Their replacements are §3, §4, §7, §8 and §10 here; §9 maps every pre-flight finding to the task that handles it. "Planning-time verification" items 1–8, 10 and 11 still hold. Item 9 (ICE from static config) is moot in v1 (no TURN).

---

## 1. Ground truth this amendment was written against

Branch `agentic-notes-browser-agent` at `546aedd` (frontend core merged). Read on 2026-10-06.

| Area | What exists (and what the base plan got wrong) |
|---|---|
| Slot entrypoint | `apps/browser-slot/bin/slot-entrypoint`: default-DROP INPUT, IPv6 off with ip6tables fallback (exit 70), validated `SLOT_EGRESS_ALLOW_CIDRS` (private, prefix ≥ /16), validated mux ports, special-use egress REJECTs, `/home/neko` and `/tmp` wipe. **`user` profile is `can_host=true`** (`profile user false true false false`). |
| `verify.sh` | Runs the slot with `--cap-add SYS_PTRACE`, reads `/proc/<neko>/environ` as root with non-empty guards, checks metadata/10-8 REJECT and IPv6. No n.eko hosting check. |
| B1 hooks | `apps/agent/src/loop/hooks.ts` after B3 E Task 0: `RunHooks {onComplete, sessionStore, maskSources(runId), control, functionTools, functionApproval(call, run, url), promptContext(run), onClick(run, {label, url}), onReleased(runId)}`, `ControlTransitions {onUserControl(slot, runId): Promise<void>; onAgentControl(slot, runId): Promise<void>}`, `withHooks()`. Injected by `new Supervisor({hooks})`; `main.ts` passes `hooks: vaultHooks(vault)`. |
| B1 control | `Supervisor.start` LISTENs `run_control` → `RunWorker.control()` (hold guard, abort). `#holdForUser`: hold → abort → `onUserControl` (**no catch**: a throw fails the run with `agent_error`, F3) → `markTakeover` (emits `control{user}`, `waiting(takeover)`; B3 E: also moves `waiting(approval)` to `waiting(takeover)` and supersedes the pending approval). Hand back: `onAgentControl` → `guard.release()` → new AbortController → `markHandBack` (`control{agent}`, running, re-observe). |
| B1 lifecycle | No `onLeased`; B3's `onReleased(runId)` runs in `#main`'s `finally` after `close()` (too late for n.eko, S12); no browser-level CDP accessor (`BrowserSession.#browser` is private). `#release` seals storage, commits, closes Playwright, `pool.reset` (Browser.close), then `clearRunDownloads`. |
| B3 vault (E) | `createVault(…)` in `main.ts` exposes `vault.enrolment: PasskeyEnrolment {begin(session: BrowserSession): Promise<EnrolmentHandle>; finish(handle, {workspaceId, runId}): Promise<number>}`; E.8 note 1 requires B6 to call `begin` on give and `finish` on hand-back. E.8 note 3: `takeControl` idempotent, `handBack` only from the current controller. |
| B1 events | `emitRunEvent(tx, runId, event)` / `emitRunEvents` in `apps/agent/src/events/emit.ts` (drizzle `Tx`). Imported by `step-store.ts`, `claim.ts`, `worker.int.test.ts`, `run-loop.int.test.ts`, `events.int.test.ts`. |
| Fixtures setting `controller` | `worker.int.test.ts` lines ~167, ~172, ~294, ~313, ~687; `run-loop.int.test.ts` ~924, ~927, ~949; `tests/behaviour/harness.ts` ~174, ~182; `testing/db.ts insertRun({controller})`; + B3 E 0.5's A5 test in `run-loop.int.test.ts` (`.set({ controller: "user" })` before `markTakeover`). |
| Behaviour stack | `tests/behaviour/compose.yml`: two real slots, CDP published on `127.0.0.1:19223/19224`, `CDP_ALLOWED_IP: 0.0.0.0/0`, `NEKO_ALLOWED_IPS: 127.0.0.1`, n.eko not published. `startBehaviourAgent({scenarios, config, clock})` (no `hooks`). One `waitFor` in `apps/agent/src/testing/wait.ts`. |
| Web RPC | `app/api/rpc/[[...rest]]/route.ts` serves `liveRouter` (`implement(apiContract).$context<LiveContext>().use(requireViewer)`, every handler `notWired`) with `context: { viewer }`; no plugins. `LiveContext = SessionContext = { viewer: Viewer \| null }`. After B3 E Task 4: `liveOs`/`LiveContext` live in `apps/web/lib/server/rpc/live-os.ts`, `live-router.ts` imports `liveOs as os`, `route.ts` imports `LiveContext` from `live-os.ts` and refuses cross-site writes (`isCrossSiteWrite`); `liveRouter.vault.*` and `runs.submitOtp` are wired. `getViewer()` handles fixture mode. `@orpc/server` 1.15.4 is installed. |
| Web env | `WebEnv` has `NEKO_MEMBER_SECRET`, `LIVE_COOKIE_SECRET`, `TURN_SECRET`, `OPENAI_API_KEY` (D36). No `TURN_URLS`. |
| Contracts | `live.ts`: `LIVE_SLOT_COOKIE`, `NEKO_MEMBERS`, `TURN_CREDENTIAL_TTL_SECONDS`, `livePath`, `liveEmbedPath` (`?embed=1`), `IceServer`, `OpenLiveResult`. `server/neko.ts`: `deriveNekoPassword`. `download_ready` has no `assetId`. |
| Storage | `Storage {bucket, put(Uint8Array\|string), getBytes, head, delete, presignGet, ping}`; implementations: `packages/storage/src/s3.ts`, `apps/agent/src/testing/memory-storage.ts`. |
| Compose | Slots: no labels; `NEKO_ALLOWED_IPS` = `.10,.11,.12`. `web` on `cdp` at `.11`; test Traefik on `cdp` at `.12`. `infra/traefik/test-dynamic.yml`: one `web` router. No `compose.prod.yml` yet (Phase 9 owns it). |
| Agent runs as | `node` (uid 1000) in `mastertutor/node-runtime`; n.eko's `neko` user is uid 1000 too, so the agent can read and delete what Chromium writes in `/downloads`. |

---

## 2. Global Constraints (amended)

The base plan's Global Constraints apply, with these changes. Every task implicitly includes this section.

- **Dropped (S7, D42):** coturn, `TURN_URLS`, `TURN_SECRET` on slots, `turn.ts`, `turn-ice`, `turn-probe.ts`, `SLOT_TURN_CREDENTIAL_TTL_SECONDS`, `TURN_URL_PATTERN`, `PUBLIC_HOST`, `mastertutor_cdp` naming, the `coturn/coturn` and `curlimages/curl` pins for coturn. `openLive` returns `iceServers: []`. The compose-config ban on `TURN_SECRET` in slots **stays**.
- **Live-view values (replaces the base table):**

| Item | Value |
|---|---|
| Cookies | `live_slot` (`browser-N.<exp>.<hmac>`) and `NEKO_SESSION`, both `Path=/live/<runId>/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict` |
| Takeover | Abort target ≤ 300 ms (B1). Give waits ≤ **1 000 ms** for a connected live view (`TAKEOVER_GIVE_WAIT_MS`), ≤ **15 000 ms** when the takeover arrives with a fresh lease (`TAKEOVER_RESTORE_WAIT_MS`). Auto hand-back after **15 min** of user idle counted from the takeover (`AUTO_HAND_BACK_IDLE_MS`) |
| Slot ports | CDP 9223, idle probe **9224**, PulseAudio 4713: agent IP only. n.eko 8080: agent `.10`, web `.11`, Traefik `.12`. Media 5900N |
| Embed path | `/live/<runId>/?embed=1&usr=user&pwd=cookie` |
| Traefik rule | `Host(\`<host>\`) && PathRegexp(\`^/live/[0-9a-f-]{36}/\`) && HeaderRegexp(\`Cookie\`, \`(?:^\|;\s*)live_slot=browser-N\.\`)` from `liveRouterRule()` only |
| Middlewares, in order | `live-auth` (ForwardAuth to `http://<CDP prefix>.11:3000/api/live/auth`, `authResponseHeaders: [Cookie]`), `live-strip` (`^/live/[0-9a-f-]{36}`), `live-headers` (`frame-ancestors 'self'`, `nosniff`) |

- **Commands (G5, G6):** never put `--` before a test path: `pnpm test <path>`, `pnpm test:int <path>`, `pnpm test:behaviour <path>`. Run `pnpm exec prettier --write <files you touched>` before every commit; `pnpm format:check` must pass.
- **Real-slot tests (F9, F12):** only on the B1 behaviour stack (`tests/behaviour/compose.yml`, `pnpm test:behaviour`). No new container helper. Use `waitFor` from `apps/agent/src/testing/wait.ts`; never a bare `sleep` as an assertion (W5).
- **Cross-app imports:** `apps/web` never imports `apps/agent` and vice versa. Cross-app tests live under `tests/`.
- **Disk:** after any image build run `docker builder prune -f && docker image prune -f`. Never `docker system prune -a`.

---

## 3. The seam B6 consumes (B1 as built + B3 Amendment E)

B6 code plugs in only through `new Supervisor({ hooks })`. The table is the contract; Task A2 makes it true.

| Seam | Exact shape | Owner | Status before A2 |
|---|---|---|---|
| `ControlTransitions.onUserControl` | `(slotName: string, runId: string, context: { afterRestore: boolean }) => Promise<UserControlResult>`; `UserControlResult = { ok: true } \| { ok: false; code: "takeover_failed" }` | A2 (F3) | Returns `void`; a throw fails the run |
| Worker on failure | One StepStore commit: `controller='agent'`, `control_user_id=null`, events `error{takeover_failed}` + `control{agent}`, `waiting(takeover)`→`running`, or back to `waiting(approval)` when an approval is pending (its row stays `pending`); then `guard.release()`, new AbortController, re-observe (or resume the pending approval). A run that was `waiting(otp)` resumes `running` and the model asks for the code again, as on B3 E's hand-back | A2 (F3, B3 A5) | Missing |
| `ControlTransitions.onAgentControl` | `(slotName: string, runId: string) => Promise<void>` | B1 | Exists |
| `RunHooks.onLeased` | `(slot: LeasedSlot) => Promise<void>`; `LeasedSlot = { runId; workspaceId; slotName; session: BrowserSession \| null; browserCdp(): Promise<CDPSession> }`; called once after `connect`, before restore | A2 (F5) | Missing (B3 E does not add it) |
| `RunHooks.onLeaseEnding` | `(slot: ReleasedSlot) => Promise<void>`; `ReleasedSlot = { runId; slotName; slotReleased: boolean }`; `slotReleased: true` from `#release` **before** `Browser.close`/`pool.reset`; `false` once from the worker's `finally` (before `close()`) when `#release` never ran | A2 (F5, S12) | Missing |
| `RunHooks.onReleased` (B3) | `(runId: string) => Promise<void>`, called once from `#main`'s `finally` **after** `close()`; vault `forgetRun`. B6 does not implement it | B3 Amendment E | Exists after B3 |
| `AttachedBrowser.browserCdp` / `.session` | `browserCdp(): Promise<CDPSession>`, backed by `BrowserSession.browserCdp()` (cached `#browser.newBrowserCDPSession()`); `session: BrowserSession \| null` (null for fakes) | A2 (F5, B3 E.8 note 1) | Missing (B3 E does not add it) |
| `composeRunHooks` | `(...parts: Partial<RunHooks>[]) => Partial<RunHooks>`: concatenates `functionTools` (throws on a duplicate tool name), flattens `promptContext`, sequences `onLeased`, settles every `onLeaseEnding`; every other key (B3's `onReleased`, `onClick`, `sessionStore`, `maskSources`, `functionApproval`, B6's `control`, …) may have one owner (throws otherwise) | A2 | Missing (B3 E does not add it) |
| Passkey enrolment (B3 E.4, E.8 note 1) | `LiveHooksDeps.enrolment?: PasskeyEnrolmentPort = { begin(session: BrowserSession): Promise<unknown>; finish(handle: unknown, run: { workspaceId: string; runId: string }): Promise<number> }`, structurally matching B3's `PasskeyEnrolment`; `main.ts` passes `vault.enrolment` | A12, A13 | Missing |
| `emitRunEvent` / `emitRunEvents` | `(tx: DbTx, runId, event)` in `@mastertutor/db` | A2 (F7) | In `apps/agent/src/events/emit.ts` |
| `returnControlToAgent` / `notifyRunControl` / `readControlUser` | `(tx: DbTx, runId) => Promise<boolean>`, `(tx: DbTx, runId) => Promise<void>`, `(db: Database, runId) => Promise<string \| null>` in `@mastertutor/db` | A2 (F4) | Missing |
| `runs.control_user_id` | `text`, CHECK `runs_control_user_matches_controller`: `(controller = 'user') = (control_user_id is not null)` | A2 (F8) | Missing |

**Behaviours B6 relies on, already in B1 (pre-flight §0, do not re-test here):** exclusive ordering (no agent primitive runs after `onUserControl` starts; `onAgentControl` runs before `guard.release()`), takeover latency ≤ 2 s on DB timestamps, `run_control` sweep fallback, no sleep while `controller='user'`.

---

## 4. File Structure

```
apps/browser-slot/
  bin/slot-entrypoint            (edit) A1: user can_host=false · A5: 9224 in the agent-only loop
  bin/slot-idle-http             (new)  A5: X idle probe, one HTTP/1.0 exchange
  Dockerfile                     (edit) A5: xprintidle, NEKO_* env, COPY slot-idle-http
  supervisord/chromium.conf      (edit) A5: [program:idle-probe]
  test/verify.sh                 (append) A1, A5
packages/db/src/
  client.ts                      (edit) A2: DbTx
  schema/runs.ts                 (edit) A2: control_user_id + CHECK
  queries/events.ts              (new)  A2: emitRunEvent(s) moved from the agent (F7)
  queries/control.ts             (new)  A2: returnControlToAgent, notifyRunControl, readControlUser
  queries/live.ts                (new)  A4: getRunForMember, canAccessLiveSlot, requestTakeover, requestHandBack
  queries/downloads.ts           (new)  A4: findAssetBySha, recordDownload
  testing.ts                     (edit) A4: seedMember, nextNotification
packages/db/migrations/          (generated) A2: NNNN_live_control_user.sql
packages/contracts/src/
  live.ts, live.test.ts          (replace) A3
  constants.ts                   (edit) A3: SLOT_IDLE_PORT
  events.ts, events.test.ts      (edit) A3: download_ready.assetId
  server/neko.ts, neko.test.ts   (append) A3: loginNeko, NekoLoginError, nekoTokenFromSetCookie
packages/storage/src/
  s3.ts, s3.int.test.ts          (edit) A11: Storage.putFile (streamed)
apps/agent/src/
  loop/hooks.ts                  (edit) A2: UserControlResult, afterRestore, lifecycle hooks onLeased/onLeaseEnding, composeRunHooks
  loop/worker.ts                 (edit) A2: failed takeover, onLeased/onLeaseEnding calls (B3's onReleased kept)
  loop/run-loop.ts               (edit) A2: revertTakeover()
  loop/loop-browser.ts           (edit) A2: AttachedBrowser.browserCdp, .session
  loop/session-browser.ts        (edit) A2: browserCdp and session wiring
  browser/session.ts             (edit) A2: browserCdp()
  events/emit.ts                 (delete) A2
  runtime/types.ts               (edit) A2: Tx = DbTx
  testing/db.ts                  (edit) A2: insertRun controlUserId
  testing/fake-loop-browser.ts   (edit) A2: unavailableBrowserCdp
  testing/memory-storage.ts      (edit) A11: putFile
  live/live-view.ts              (new) A6
  live/neko-admin.ts             (new) A6
  live/neko-live-view.ts         (new) A6
  live/idle-probe.ts             (new) A6
  live/idle-watch.ts             (new) A12
  live/downloads.ts              (new) A11
  live/live-hooks.ts             (new) A12
  main.ts                        (edit) A13
apps/web/
  lib/server/live/cookie.ts      (new) A7
  lib/server/live/open-live.ts   (new) A7
  lib/server/live/authorize.ts   (new) A8
  lib/server/live/deps.ts        (new) A7/A8
  lib/server/live/procedures.ts  (new) A9
  lib/server/rpc/live-os.ts      (edit) A9: LiveContext gains ResponseHeadersPluginContext (file from B3 E Task 4)
  lib/server/rpc/live-router.ts  (edit) A9 (on top of B3 E Task 4)
  app/api/rpc/[[...rest]]/route.ts (edit) A9: ResponseHeadersPlugin (B3's isCrossSiteWrite kept)
  app/api/live/auth/route.ts     (new) A8
  lib/live/upload.ts             (new) A10
tests/behaviour/
  compose.yml, constants.ts, global-setup.ts, harness.ts   (edit) A2, A6, A11, A13
  live-open.behaviour.test.ts    (new) A7
  live-upload.behaviour.test.ts  (new) A10
  live-downloads.behaviour.test.ts (new) A11
apps/agent/src/live/neko-live-view.behaviour.test.ts (new) A6
apps/agent/src/live/takeover.behaviour.test.ts       (new) A13
infra/traefik/test-dynamic.yml   (replace) A14
compose.live-test.yml            (new) A14
tests/compose/live-routes.int.test.ts (new) A14
tests/live/live-stack.int.test.ts     (new) A15
package.json, .github/workflows/ci.yml (edit) A14, A15
```

Not created (base plan files that are dropped): `packages/contracts/src/server/turn.ts`, `apps/browser-slot/bin/turn-ice`, `apps/browser-slot/test/turn-ice.test.ts`, `infra/coturn/*`, `apps/agent/src/live/{ports,control,runtime,b1-adapters}.ts`, `tests/support/*`, `packages/db/src/queries/events.ts`'s `appendRunEvent` (A2 moves B1's function instead).

---

## 5. Review Focus (amended)

The five inputs most likely to bite a real user that no base-plan test exercised. Each has its test in the named task.

1. **A takeover click when the iframe is open but its WebSocket has not connected yet (or was closed in another tab).** Expect: within ~1 s an `error{takeover_failed}` and `control{agent}`; `runs.controller='agent'`; the agent continues; n.eko `user` still cannot host. Never `agent_error`. *Tests: A2 `worker.int.test.ts` (seam), A12 `live-hooks.test.ts`, A13 `takeover.behaviour.test.ts`.*
2. **A user who last touched the remote screen long before taking over** (the agent ran 20 min; X idle is already 20 min). Expect: the 15-minute auto hand-back counts from the takeover, not from the last X input, so the user is not kicked out at once. *Test: A12 `idle-watch.test.ts`.*
3. **A live iframe whose NEKO_SESSION cookie is missing, duplicated or malformed** (expired tab, cookie jar oddities, crafted request). Expect: ForwardAuth 401 and nothing reaches n.eko; the Better Auth cookie is never forwarded. *Tests: A8 `authorize.test.ts`, A15 stack test.*
4. **The agent clicks a download link while it holds control** (v1: only the user downloads). Expect: the download is cancelled, nothing stays on disk or in Garage, and the user sees `error{download_blocked}`. *Test: A11 `live-downloads.behaviour.test.ts`.*
5. **A run cancelled or killed while the user holds the n.eko host.** Expect: B6's `onLeaseEnding` takes host back and revokes `can_host` before `Browser.close`, within 1 s, even if n.eko is slow. *Test: A12 `live-hooks.test.ts` (timeout and ordering), A13 behaviour test (host is `agent` after a cancel during takeover).*

---
## 6. Tasks

### Task A1: Security fix first — the n.eko `user` member cannot host

Replaces the security half of base Task 3 (S2). **Edit only; never replace the entrypoint (S1).** The current image lets a user holding a live iframe `POST /api/room/control/request`, become n.eko host and send X input while the agent drives over CDP. After this task the `user` member boots with `can_host=false`; only B6's `NekoLiveView.giveControl` (A6, A12) grants it, and only while `controller='user'`. Slots restart on every release (`pool.reset`), so every lease starts from this boot profile.

**Files:**
- Modify: `apps/browser-slot/bin/slot-entrypoint` (one line plus a comment)
- Test: `apps/browser-slot/test/verify.sh` (insert one block; nothing removed)

**Interfaces:**
- Consumes: the existing `verify.sh` helpers `from_ip`, `hmac`, `fail`, `pass` and variables `NET`, `PREFIX`, `CURL`, `ADMIN_SECRET`, `MEMBER_SECRET`.
- Produces: image behaviour "user member starts unhosted". A6's behaviour test and A13's acceptance test rely on it.

- [ ] **Step 1: Write the failing check.** In `apps/browser-slot/test/verify.sh`, insert this block **immediately after** the line `pass "n.eko member passwords derived from the secrets"`:

```bash
# A1 (S2): the user member cannot host until the agent grants it, so a live iframe can never send
# X input while the agent drives over CDP. The whoami and admin checks keep the 403s meaningful:
# the user session is authenticated, and hosting itself works for a member that has the right.
neko_as() { # member password method path -> HTTP status, using that member's own session
  docker run --rm -i --network "$NET" --ip "$PREFIX.11" --entrypoint sh "$CURL" -s -- \
    "$1" "$2" "$3" "$4" "http://$PREFIX.20:8080" <<'SH'
body=$(curl -s -m 4 -c /tmp/jar -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"password\":\"$2\"}" "$5/api/login") || exit 1
tok=$(printf '%s' "$body" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$tok" ]; then
  curl -s -m 4 -b /tmp/jar -H "Authorization: Bearer $tok" -o /dev/null -w '%{http_code}' -X "$3" "$5$4"
else
  curl -s -m 4 -b /tmp/jar -o /dev/null -w '%{http_code}' -X "$3" "$5$4"
fi
SH
}
user_pw="$(hmac "$MEMBER_SECRET")"
admin_pw="$(hmac "$ADMIN_SECRET")"
[[ "$(neko_as user "$user_pw" GET /api/whoami)" == "200" ]] || fail "user member session is not authenticated"
[[ "$(neko_as user "$user_pw" POST /api/room/control/request)" == "403" ]] \
  || fail "user member can request host control at boot (can_host must be false)"
[[ "$(neko_as user "$user_pw" GET /api/room/control)" == "403" ]] \
  || fail "user member can read host control at boot (can_host must be false)"
[[ "$(neko_as agent "$admin_pw" GET /api/room/control)" == "200" ]] \
  || fail "control: the agent member cannot use host control"
pass "user member cannot host until the agent grants it"
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `bash apps/browser-slot/test/verify.sh`
Expected: the earlier checks print `ok - …`, then `VERIFY FAIL: user member can request host control at boot (can_host must be false)`.

- [ ] **Step 3: Make the change.** In `apps/browser-slot/bin/slot-entrypoint`, replace exactly these two lines:

```bash
NEKO_MEMBER_OBJECT_USERS="[{\"username\":\"agent\",\"password\":\"${admin_password}\",\"profile\":$(profile agent true true true true)},{\"username\":\"user\",\"password\":\"${user_password}\",\"profile\":$(profile user false true false false)}]"
export NEKO_MEMBER_OBJECT_USERS
```

with:

```bash
# The user member boots WITHOUT hosting or clipboard rights (spec §10.3 control lock): only the
# agent's LiveView.giveControl grants can_host, and only while runs.controller = 'user'.
NEKO_MEMBER_OBJECT_USERS="[{\"username\":\"agent\",\"password\":\"${admin_password}\",\"profile\":$(profile agent true true true true)},{\"username\":\"user\",\"password\":\"${user_password}\",\"profile\":$(profile user false false false false)}]"
export NEKO_MEMBER_OBJECT_USERS
```

Nothing else in the entrypoint changes in this task.

- [ ] **Step 4: Run it and watch it pass.**

Run:
```bash
bash apps/browser-slot/test/verify.sh
docker build -q -t mastertutor/browser-slot:local apps/browser-slot
docker builder prune -f && docker image prune -f
```
Expected: every line `ok - …`, including `ok - user member cannot host until the agent grants it`, ending with `browser-slot verify: all checks passed`.

- [ ] **Step 5: Commit.**
```bash
git add apps/browser-slot/bin/slot-entrypoint apps/browser-slot/test/verify.sh
git commit -m "fix(browser-slot): the n.eko user member boots without hosting rights (S2)"
```

---

### Task A2: B1 seams for B6 (F3, F4, F5, F7, F8)

One task, two commits: **A2.1** (packages/db) and **A2.2** (agent). Land the B1 final fix wave and B3's seam commit first (pre-flight F11).

**Files:**
- Modify: `packages/db/src/client.ts`, `packages/db/src/schema/runs.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/queries/events.ts`, `packages/db/src/queries/control.ts`, `packages/db/migrations/NNNN_live_control_user.sql` (generated)
- Test: `packages/db/src/queries/control.int.test.ts`
- Modify (fixtures, F8): `apps/agent/src/testing/db.ts`, `apps/agent/src/loop/worker.int.test.ts`, `apps/agent/src/loop/run-loop.int.test.ts`, `tests/behaviour/harness.ts`
- Delete (F7): `apps/agent/src/events/emit.ts`; update its importers `apps/agent/src/loop/step-store.ts`, `apps/agent/src/loop/claim.ts`, `apps/agent/src/loop/worker.int.test.ts`, `apps/agent/src/loop/run-loop.int.test.ts`, `apps/agent/src/events/events.int.test.ts`; `apps/agent/src/runtime/types.ts`
- Modify (F3, F5): `apps/agent/src/loop/hooks.ts`, `apps/agent/src/loop/worker.ts`, `apps/agent/src/loop/run-loop.ts`, `apps/agent/src/loop/loop-browser.ts`, `apps/agent/src/loop/session-browser.ts`, `apps/agent/src/browser/session.ts`, `apps/agent/src/testing/fake-loop-browser.ts`
- Test: `apps/agent/src/loop/worker.int.test.ts` (new `describe`), `apps/agent/src/loop/hooks.test.ts` (new)

**Interfaces:**
- Consumes: B1 as listed in §1; `RunEvent`, `encodeNotify`.
- Produces (exactly the §3 table):
  - `@mastertutor/db`: `type DbTx`; `emitRunEvent(tx: DbTx, runId: string, event: RunEvent): Promise<string>`; `emitRunEvents(tx: DbTx, runId: string, events: readonly RunEvent[]): Promise<string[]>`; `returnControlToAgent(tx: DbTx, runId: string): Promise<boolean>`; `notifyRunControl(tx: DbTx, runId: string): Promise<void>`; `readControlUser(db: Database, runId: string): Promise<string | null>`; column `runs.controlUserId`.
  - `apps/agent/src/loop/hooks.ts`: `UserControlResult`, `ControlTransitions` (new `onUserControl` signature), `LeasedSlot {runId; workspaceId; slotName; session: BrowserSession | null; browserCdp()}`, `ReleasedSlot`, `RunHooks.onLeased`, `RunHooks.onLeaseEnding`, `composeRunHooks`. B3 E's `RunHooks.onReleased(runId: string)` and its `finally` call are left as B3 wrote them.
  - `AttachedBrowser.browserCdp(): Promise<CDPSession>`; `AttachedBrowser.session: BrowserSession | null`; `BrowserSession.browserCdp(): Promise<CDPSession>`; `RunLoop.revertTakeover(): Promise<void>` (returns to `waiting(approval)` when one is pending).
  - `apps/agent/src/testing/fake-loop-browser.ts`: `unavailableBrowserCdp(): Promise<never>`; `apps/agent/src/testing/db.ts`: `InsertRunOptions.controlUserId?: string`.

#### A2.1 — database (F4, F7, F8)

- [ ] **Step 1: Check what B3 already landed.** Run:

```bash
grep -n "control_user_id\|controlUserId" packages/db/src/schema/runs.ts
grep -rn "export async function emitRunEvent" packages/db/src apps/agent/src
grep -n "onReleased(runId: string)" apps/agent/src/loop/hooks.ts
grep -n "onLeased\|onLeaseEnding\|composeRunHooks\|LeasedSlot\|ReleasedSlot" apps/agent/src/loop/hooks.ts
grep -n "browserCdp" apps/agent/src/loop/loop-browser.ts apps/agent/src/browser/session.ts apps/agent/src/loop/worker.ts
grep -n "hooks.onReleased(this.runId)" apps/agent/src/loop/worker.ts
```

Record the output in the task report. Expected: `control_user_id` and `emitRunEvent` in `packages/db` absent; `onReleased(runId: string)` present in `hooks.ts` and `hooks.onReleased(this.runId)` present in `worker.ts` (B3 E); `onLeased`, `onLeaseEnding`, `composeRunHooks`, `LeasedSlot`, `ReleasedSlot` and `browserCdp` absent. Any other result: stop and report `NEEDS_CONTEXT` (orchestrator rule §0.3).

- [ ] **Step 2: Write the failing test.** `packages/db/src/queries/control.int.test.ts`:

```ts
import { decodeNotify } from "@mastertutor/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { runEvents, runs, workspaces } from "../schema/index.ts";
import { startTestDatabase, type TestDatabase } from "../testing.ts";
import { notifyRunControl, readControlUser, returnControlToAgent } from "./control.ts";
import { emitRunEvent } from "./events.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let workspaceId: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = createDb(testDb.ownerUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 2 });
  const [workspace] = await owner.db
    .insert(workspaces)
    .values({ name: "Test" })
    .returning({ id: workspaces.id });
  workspaceId = workspace!.id;
});
afterAll(async () => {
  await Promise.all([owner?.close(), agent?.close()]);
  await testDb?.stop();
});

async function newRun(): Promise<string> {
  const [run] = await owner.db
    .insert(runs)
    .values({ workspaceId, goal: "control", allowedOrigins: ["https://example.com"] })
    .returning({ id: runs.id });
  return run!.id;
}

describe("runs.control_user_id (F8)", () => {
  it("is set exactly when the user holds control", async () => {
    const runId = await newRun();
    await expect(
      owner.db.update(runs).set({ controller: "user" }).where(eq(runs.id, runId)),
    ).rejects.toThrow(/runs_control_user_matches_controller/);
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: "user_a" })
      .where(eq(runs.id, runId));
    await expect(
      owner.db.update(runs).set({ controller: "agent" }).where(eq(runs.id, runId)),
    ).rejects.toThrow(/runs_control_user_matches_controller/);
  });
});

describe("control queries (F4)", () => {
  it("returns control to the agent once, and reports who holds control", async () => {
    const runId = await newRun();
    expect(await readControlUser(agent.db, runId)).toBeNull();
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: "user_a" })
      .where(eq(runs.id, runId));
    expect(await readControlUser(agent.db, runId)).toBe("user_a");
    expect(await agent.db.transaction((tx) => returnControlToAgent(tx, runId))).toBe(true);
    expect(await agent.db.transaction((tx) => returnControlToAgent(tx, runId))).toBe(false);
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toMatchObject({ controller: "agent", controlUserId: null });
  });

  it("notifies run_control with the run id only, on commit", async () => {
    const runId = await newRun();
    const received: string[] = [];
    const { unlisten } = await owner.sql.listen("run_control", (payload) => received.push(payload));
    try {
      await agent.db.transaction(async (tx) => {
        await notifyRunControl(tx, runId);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(received).toEqual([]);
      });
      const deadline = Date.now() + 3_000;
      while (received.length === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received.map((p) => decodeNotify("run_control", p))).toEqual([{ runId }]);
    } finally {
      await unlisten();
    }
  });
});

describe("emitRunEvent in @mastertutor/db (F7)", () => {
  it("is usable by the web role inside a transaction", async () => {
    const web = createDb(testDb.webUrl, { max: 1 });
    try {
      const runId = await newRun();
      const eventId = await web.db.transaction((tx) =>
        emitRunEvent(tx, runId, { type: "user_message", text: "Logged in" }),
      );
      const [row] = await owner.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.id, Number(eventId)));
      expect(row?.payload).toEqual({ type: "user_message", text: "Logged in" });
    } finally {
      await web.close();
    }
  });
});
```

`runEvents.id` is `bigserial({ mode: "number" })`, hence `Number(eventId)`.

- [ ] **Step 3: Run it and watch it fail.**

Run: `pnpm test:int packages/db/src/queries/control.int.test.ts`
Expected: FAIL: `./control.ts` and `./events.ts` do not exist.

- [ ] **Step 4: Add the column and the CHECK, then generate the migration.** In `packages/db/src/schema/runs.ts`, inside `runs`, directly after the `controller:` line, add:

```ts
    /** Better Auth user id of the member holding control; set iff controller = 'user' (B6, F8). */
    controlUserId: text("control_user_id"),
```

and append to the `runs` constraint array, after `runs_wait_reason_matches_status`:

```ts
    check(
      "runs_control_user_matches_controller",
      sql`(${t.controller} = 'user') = (${t.controlUserId} is not null)`,
    ),
```

Then run:
```bash
pnpm --filter @mastertutor/db generate --name live_control_user
grep -c "control_user_id" packages/db/migrations/*_live_control_user.sql
```
Expected: one new migration; the count is at least 2.

- [ ] **Step 5: Add `DbTx`.** Append to `packages/db/src/client.ts`:

```ts
/** A drizzle transaction handle. Writes that must commit with a NOTIFY take one of these. */
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
```

- [ ] **Step 6: Move `emitRunEvent` (F7).** Create `packages/db/src/queries/events.ts` with the body of `apps/agent/src/events/emit.ts`, retyped to `DbTx`:

```ts
import { RunEvent, encodeNotify } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import type { DbTx } from "../client.ts";
import { runEvents } from "../schema/index.ts";

/**
 * Appends one RunEvent and NOTIFYs run_event {runId, eventId} (spec §6). Inside a transaction the
 * notification is delivered on commit only, so the SSE route never sees an uncommitted event.
 * The single implementation for agent and web (principle 6).
 */
export async function emitRunEvent(tx: DbTx, runId: string, event: RunEvent): Promise<string> {
  const payload = RunEvent.parse(event);
  const [row] = await tx
    .insert(runEvents)
    .values({ runId, type: payload.type, payload })
    .returning({ id: runEvents.id });
  if (!row) throw new Error("run_events insert returned no row");
  const eventId = String(row.id);
  await tx.execute(
    sql`select pg_notify('run_event', ${encodeNotify("run_event", { runId, eventId })})`,
  );
  return eventId;
}

export async function emitRunEvents(
  tx: DbTx,
  runId: string,
  events: readonly RunEvent[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const event of events) ids.push(await emitRunEvent(tx, runId, event));
  return ids;
}
```

Then:
- delete `apps/agent/src/events/emit.ts`;
- in `apps/agent/src/loop/step-store.ts`, `apps/agent/src/loop/claim.ts`, `apps/agent/src/loop/worker.int.test.ts`, `apps/agent/src/loop/run-loop.int.test.ts` and `apps/agent/src/events/events.int.test.ts`, replace the import from `../events/emit.ts` (or `./emit.ts`) with the same names imported from `"@mastertutor/db"` (merge into the file's existing `@mastertutor/db` import);
- replace the body of `apps/agent/src/runtime/types.ts` with:

```ts
import type { createLogger } from "@mastertutor/contracts/server";
import type { DbTx } from "@mastertutor/db";

export type Tx = DbTx;
export type Log = ReturnType<typeof createLogger>;
```

Confirm nothing still imports the old path: `grep -rn "events/emit" apps tests` prints nothing.

- [ ] **Step 7: Add the control queries (F4).** `packages/db/src/queries/control.ts`:

```ts
import { encodeNotify } from "@mastertutor/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Database, DbTx } from "../client.ts";
import { runs } from "../schema/index.ts";

/**
 * The one "control goes back to the agent" write (F4): web hand back, the agent's failed-takeover
 * revert and the 15-minute idle hand-back all use it. True if the user held control.
 */
export async function returnControlToAgent(tx: DbTx, runId: string): Promise<boolean> {
  const rows = await tx
    .update(runs)
    .set({ controller: "agent", controlUserId: null })
    .where(and(eq(runs.id, runId), eq(runs.controller, "user")))
    .returning({ id: runs.id });
  return rows.length === 1;
}

/** NOTIFY run_control {runId}; delivered when the transaction commits (spec §3.1 rule 2). */
export async function notifyRunControl(tx: DbTx, runId: string): Promise<void> {
  await tx.execute(
    sql`select pg_notify('run_control', ${encodeNotify("run_control", { runId })})`,
  );
}

/** The member holding control of the run, or null while the agent holds it. */
export async function readControlUser(db: Database, runId: string): Promise<string | null> {
  const [row] = await db
    .select({ controller: runs.controller, userId: runs.controlUserId })
    .from(runs)
    .where(eq(runs.id, runId));
  return row?.controller === "user" ? row.userId : null;
}
```

Append to `packages/db/src/index.ts`:
```ts
export * from "./queries/events.ts";
export * from "./queries/control.ts";
```

- [ ] **Step 8: Update every fixture that sets `controller` (F8, G4).** Each change keeps the CHECK true:

| File | Old | New |
|---|---|---|
| `apps/agent/src/testing/db.ts` `InsertRunOptions` | `controller?: Controller;` | `controller?: Controller;` and, on the next line, `/** Required by runs_control_user_matches_controller when controller is 'user'. */ controlUserId?: string;` |
| `apps/agent/src/testing/db.ts` `insertRun` values | `controller: options.controller ?? "agent",` | `controller: options.controller ?? "agent",` and `controlUserId: options.controller === "user" ? (options.controlUserId ?? "test-user") : null,` |
| `apps/agent/src/loop/worker.int.test.ts` (3 sites: `takeOver`, the "takeover during an act" test, the "sweep notices a takeover" test) | `.set({ controller: "user", status: "waiting", waitReason: "takeover" })` | `.set({ controller: "user", controlUserId: "test-user", status: "waiting", waitReason: "takeover" })` |
| `apps/agent/src/loop/worker.int.test.ts` (2 sites: `handBackTo`, the "takeover during an act" test) | `.set({ controller: "agent" })` | `.set({ controller: "agent", controlUserId: null })` |
| `apps/agent/src/loop/run-loop.int.test.ts` (3 sites, including B3 E's "a takeover while an approval waits supersedes it…") | `.set({ controller: "user" })` | `.set({ controller: "user", controlUserId: "test-user" })` |
| `apps/agent/src/loop/run-loop.int.test.ts` (1 site) | `.set({ controller: "agent" })` | `.set({ controller: "agent", controlUserId: null })` |
| `tests/behaviour/harness.ts` `takeControl` | `.set({ controller: "user", status: "waiting", waitReason: "takeover" })` | `.set({ controller: "user", controlUserId: "behaviour-user", status: "waiting", waitReason: "takeover" })` |
| `tests/behaviour/harness.ts` `handBack` | `.set({ controller: "agent" })` | `.set({ controller: "agent", controlUserId: null })` |

B3 lands before A2.1 (§0.2), so its A5 run-loop test is already in the file and is one of the 3 `user` sites; `control_user_id` has no foreign key, so `"test-user"` needs no user row. Then confirm none is left: `grep -rnE "controller: \"(user|agent)\"" apps/agent/src tests | grep -v "toMatchObject\|controlUserId\|expect"` prints only the `insertRun` default line.

- [ ] **Step 9: Run the database and B1 suites.**

Run:
```bash
pnpm test:int packages/db
pnpm test:int apps/agent
pnpm typecheck && pnpm lint
```
Expected: PASS, including every B1 integration test (G4 fixed).

- [ ] **Step 10: Commit A2.1.**
```bash
pnpm exec prettier --write packages/db apps/agent/src tests/behaviour/harness.ts
git add packages/db apps/agent/src tests/behaviour/harness.ts
git commit -m "feat(db): runs.control_user_id, control queries, emitRunEvent moved to @mastertutor/db (B6 seams F4 F7 F8)"
```

#### A2.2 — agent (F3, F5)

- [ ] **Step 11: Write the failing tests.** Append to `apps/agent/src/loop/worker.int.test.ts` (it already has `start`, `queue`, `takeOver`, `handBackTo`, `controlEvents`, `until`, `row`, `stepsOf`, `click`, `done`, `browsers`, `counter`, `mock`):

```ts
describe("B6 seams (A2)", () => {
  const hangUntilAborted = (_actions: unknown, signal: AbortSignal) =>
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const eventsOf = async (id: string) =>
    (
      await owner.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, id))
        .orderBy(asc(runEvents.id))
    ).map((e) => e.payload);

  it("a takeover the live view cannot deliver returns control to the agent, never agent_error (F3)", async () => {
    const seen: Array<{ afterRestore: boolean }> = [];
    await start({
      hooks: {
        control: {
          onUserControl: async (_slot, _runId, context) => {
            seen.push(context);
            return { ok: false, code: "takeover_failed" };
          },
          onAgentControl: async () => undefined,
        },
      },
    });
    const { run, browser } = await queue([click, done]);
    browser.computerHook = hangUntilAborted;
    await waitFor(
      async () => (await stepsOf(run.id)).some((s) => s.phase === "act" && s.state === "started"),
      { label: "acting" },
    );
    await takeOver(run.id);
    await waitFor(async () => (await controlEvents(run.id)).includes("agent"), {
      label: "control back to the agent",
    });
    browser.computerHook = null;
    await until(run.id, (r) => r.status === "completed", "completed without any hand back");
    const events = await eventsOf(run.id);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "takeover_failed" }));
    expect(events.filter((e) => e.type === "control")).toEqual([{ type: "control", holder: "agent" }]);
    expect(await row(run.id)).toMatchObject({ controller: "agent", controlUserId: null });
    expect(seen).toEqual([{ afterRestore: false }]);
  });

  it("a throwing onUserControl is a failed takeover too, not a failed run (F3)", async () => {
    await start({
      hooks: {
        control: {
          onUserControl: async () => {
            throw new Error("n.eko unreachable");
          },
          onAgentControl: async () => undefined,
        },
      },
    });
    const { run, browser } = await queue([click, done]);
    browser.computerHook = hangUntilAborted;
    await waitFor(
      async () => (await stepsOf(run.id)).some((s) => s.phase === "act" && s.state === "started"),
      { label: "acting" },
    );
    await takeOver(run.id);
    await waitFor(async () => (await controlEvents(run.id)).includes("agent"), { label: "reverted" });
    browser.computerHook = null;
    await until(run.id, (r) => r.status === "completed", "completed");
    expect((await row(run.id)).error).toBeNull();
  });

  it("tells onUserControl when the takeover arrives with a fresh lease (sleeping run woken)", async () => {
    const seen: Array<{ afterRestore: boolean }> = [];
    await start({
      hooks: {
        control: {
          onUserControl: async (_slot, _runId, context) => {
            seen.push(context);
            return { ok: true };
          },
          onAgentControl: async () => undefined,
        },
      },
    });
    const name = `w${++counter}`;
    mock.setScenarios([{ name, turns: [done] }]);
    const run = await insertRun(owner.db, {
      workspaceId,
      goal: `[scenario:${name}] task`,
      status: "sleeping",
      controller: "user",
    });
    browsers.set(run.id, new FakeLoopBrowser());
    await owner.db.update(runs).set({ wakeRequestedAt: sql`now()` }).where(eq(runs.id, run.id));
    await owner.sql.notify("run_wake", encodeNotify("run_wake", { runId: run.id, reason: "takeover" }));
    await waitFor(async () => (await controlEvents(run.id)).includes("user"), { label: "held" });
    expect(seen).toEqual([{ afterRestore: true }]);
    await handBackTo(run.id);
    await until(run.id, (r) => r.status === "completed", "completed after hand back");
  });

  it("calls onLeased before the first navigation, onLeaseEnding(slotReleased) on release, and B3's onReleased(runId) after (F5)", async () => {
    const calls: string[] = [];
    await start({
      hooks: {
        onLeased: async (slot) => {
          calls.push(
            `leased ${slot.slotName} ${browsers.get(slot.runId)?.navigations.length ?? -1} ${slot.session}`,
          );
        },
        onLeaseEnding: async (slot) => {
          calls.push(`ending ${slot.slotName} ${slot.slotReleased}`);
        },
        onReleased: async (runId) => {
          calls.push(`released ${runId}`);
        },
      },
    });
    const { run } = await queue([done]);
    await until(run.id, (r) => r.status === "completed", "completed");
    await waitFor(() => calls.length === 3, { label: "all lifecycle hooks" });
    const slot = /^leased (browser-[12]) 0 null$/.exec(calls[0]!)?.[1];
    expect(slot).toBeDefined();
    expect(calls.slice(1)).toEqual([`ending ${slot} true`, `released ${run.id}`]);
  });

  it("a failed takeover while an approval is pending keeps it pending and the run waiting(approval) (B3 A5 + F3)", async () => {
    const { clock } = gatedClock();
    await start(
      {
        hooks: {
          control: {
            onUserControl: async () => ({ ok: false, code: "takeover_failed" }),
            onAgentControl: async () => undefined,
          },
        },
      },
      clock,
    );
    const { run, browser } = await queue([click, done], "ask", (b) =>
      b.targets.set("10,20", riskyTarget),
    );
    await until(run.id, (r) => r.status === "waiting" && r.waitReason === "approval", "pending");
    await takeOver(run.id);
    await waitFor(async () => (await controlEvents(run.id)).includes("agent"), {
      label: "reverted",
    });
    expect(await row(run.id)).toMatchObject({
      status: "waiting",
      waitReason: "approval",
      controller: "agent",
      controlUserId: null,
    });
    // Every committed transition emits status{…}: none may say running once the approval waited.
    const statuses = (await eventsOf(run.id)).flatMap((e) =>
      e.type === "status" ? [`${e.status}:${e.waitReason}`] : [],
    );
    const waited = statuses.indexOf("waiting:approval");
    expect(waited).toBeGreaterThanOrEqual(0);
    expect(statuses.slice(waited)).not.toContain("running:null");
    expect(statuses.at(-1)).toBe("waiting:approval");
    expect((await owner.db.select().from(approvals).where(eq(approvals.runId, run.id)))[0]?.status).toBe(
      "pending",
    );
    expect(browser.computerRuns).toEqual([]);
  });
});
```

Add `import { FakeLoopBrowser } from "../testing/fake-loop-browser.ts";` only if the file does not import it yet (it does today). The approval test reuses B3 E's `gatedClock`, `riskyTarget`, `approvals` import and `queue(…, "ask", configure)` form from its A5 test (B3 E Task 0.5); `takeOver` sets `waiting(takeover)` from `waiting(approval)` the way the web does (A4). B3 E's own `onReleased(runId)` test ("calls hooks.onReleased once the worker ends (F11)") stays as B3 wrote it.

`apps/agent/src/loop/hooks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RegisteredTool } from "../tools/types.ts";
import { composeRunHooks, withHooks, type LeasedSlot } from "./hooks.ts";

const slot: LeasedSlot = {
  runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  slotName: "browser-1",
  session: null,
  browserCdp: () => Promise.reject(new Error("unused")),
};

describe("composeRunHooks", () => {
  it("runs every onLeased and onLeaseEnding in order, and merges tools and prompt context", async () => {
    const calls: string[] = [];
    const hooks = withHooks(
      composeRunHooks(
        {
          onLeased: async () => void calls.push("a leased"),
          onLeaseEnding: async () => void calls.push("a ending"),
          promptContext: async () => ["Saved sign-ins: zybooks"],
        },
        {
          onLeased: async () => void calls.push("b leased"),
          onLeaseEnding: async () => void calls.push("b ending"),
          promptContext: async () => ["Live view: open"],
        },
      ),
    );
    await hooks.onLeased(slot);
    await hooks.onLeaseEnding({ runId: slot.runId, slotName: "browser-1", slotReleased: true });
    expect(calls).toEqual(["a leased", "b leased", "a ending", "b ending"]);
    expect(await hooks.promptContext({} as never)).toEqual([
      "Saved sign-ins: zybooks",
      "Live view: open",
    ]);
  });

  it("still runs later onLeaseEnding hooks when an earlier one throws", async () => {
    const calls: string[] = [];
    const hooks = composeRunHooks(
      { onLeaseEnding: async () => Promise.reject(new Error("boom")) },
      { onLeaseEnding: async () => void calls.push("b ending") },
    );
    await expect(
      hooks.onLeaseEnding!({ runId: slot.runId, slotName: "browser-1", slotReleased: true }),
    ).rejects.toThrow("boom");
    expect(calls).toEqual(["b ending"]);
  });

  it("keeps B3's onReleased(runId) single-owner and passes it through unchanged", async () => {
    const released: string[] = [];
    const onReleased = async (runId: string) => void released.push(runId);
    await composeRunHooks({ onReleased }, { onLeaseEnding: async () => undefined }).onReleased!(
      slot.runId,
    );
    expect(released).toEqual([slot.runId]);
    expect(() => composeRunHooks({ onReleased }, { onReleased })).toThrow(/onReleased/);
  });

  it("refuses two owners of a single-owner hook, and two owners of one tool name", () => {
    const control = {
      onUserControl: async () => ({ ok: true }) as const,
      onAgentControl: async () => undefined,
    };
    expect(() => composeRunHooks({ control }, { control })).toThrow(/control/);
    const t: RegisteredTool = { name: "read_page", untrusted: true, invoke: async () => ({}) };
    expect(() => composeRunHooks({ functionTools: [t] }, { functionTools: [t] })).toThrow(
      /more than one owner/,
    );
  });
});
```

- [ ] **Step 12: Run them and watch them fail.**

Run: `pnpm test apps/agent/src/loop/hooks.test.ts && pnpm test:int apps/agent/src/loop/worker.int.test.ts`
Expected: tsc-level failures (`afterRestore`, `onLeased`, `onLeaseEnding`, `composeRunHooks` unknown) and the F3 tests failing with the run ending `failed` (`agent_error`).

- [ ] **Step 13: Change `hooks.ts`.** In `apps/agent/src/loop/hooks.ts`:

(a) Replace the `ControlTransitions` interface with:

```ts
/** B6 reports whether the user's live view could take the browser (F3). */
export type UserControlResult = { ok: true } | { ok: false; code: "takeover_failed" };

export interface ControlTransitions {
  /**
   * B6: n.eko host → the user's member session, clipboard on. `afterRestore` is true when the
   * takeover arrives with a fresh lease (a sleeping run woken into takeover), so the live view may
   * still be connecting. Never throws on purpose; a throw is treated as `takeover_failed`.
   */
  onUserControl(
    slotName: string,
    runId: string,
    context: { afterRestore: boolean },
  ): Promise<UserControlResult>;
  /** B6: n.eko host → agent admin session, clipboard off. */
  onAgentControl(slotName: string, runId: string): Promise<void>;
}
```

(b) In `DEFAULT_HOOKS`, replace `control: { onUserControl: async () => undefined, onAgentControl: async () => undefined },` with:

```ts
  control: {
    onUserControl: async () => ({ ok: true }),
    onAgentControl: async () => undefined,
  },
```

(c) Add `import type { CDPSession } from "playwright-core";` and `import type { BrowserSession } from "../browser/session.ts";` to the imports, add these types above `RunHooks`:

```ts
/** A slot just leased to a run (after connect, before restore). */
export interface LeasedSlot {
  runId: string;
  workspaceId: string;
  slotName: string;
  /** The page session (null for fakes); B3's passkey enrolment needs it. */
  session: BrowserSession | null;
  /** Browser-level CDP session (Browser.* domain), opened on first use and cached per lease. */
  browserCdp(): Promise<CDPSession>;
}

/** A lease ending. slotReleased=false: the worker stopped without releasing (lease lost, crash). */
export interface ReleasedSlot {
  runId: string;
  slotName: string;
  slotReleased: boolean;
}
```

add to `RunHooks` (after B3's `onReleased`, which stays as B3 wrote it):

```ts
  /** After the browser connects, before restore. B6 attaches downloads and seats n.eko's host. */
  onLeased(slot: LeasedSlot): Promise<void>;
  /**
   * The lease is ending: from #release before Browser.close (slotReleased: true), or once from the
   * worker's finally before close() when #release never ran. Distinct from B3's onReleased(runId),
   * which runs after close() for per-run cleanup.
   */
  onLeaseEnding(slot: ReleasedSlot): Promise<void>;
```

and to `DEFAULT_HOOKS`:

```ts
  onLeased: async () => undefined,
  onLeaseEnding: async () => undefined,
```

(d) Append `composeRunHooks`:

```ts
/** Hooks several phases provide together; the rest of RunHooks has exactly one owner. */
const MERGED_HOOKS = new Set(["functionTools", "promptContext", "onLeased", "onLeaseEnding"]);

/**
 * Combines phase hook sets (B3 vault, B6 live view, B5, …) for one Supervisor (principle 5:
 * explicit injection, no global registry). onLeased runs in argument order; every onLeaseEnding
 * runs even if an earlier one throws (the first error is rethrown afterwards). B3's
 * onReleased(runId), onClick, sessionStore, maskSources and functionApproval are single-owner.
 * A function tool name may have one owner only.
 */
export function composeRunHooks(...parts: Partial<RunHooks>[]): Partial<RunHooks> {
  const single: Record<string, unknown> = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (value === undefined || MERGED_HOOKS.has(key)) continue;
      if (key in single) throw new Error(`RunHooks.${key} has more than one owner`);
      single[key] = value;
    }
  }
  const tools = parts.flatMap((part) => part.functionTools ?? []);
  const contexts = parts.flatMap((part) => (part.promptContext ? [part.promptContext] : []));
  const leased = parts.flatMap((part) => (part.onLeased ? [part.onLeased] : []));
  const ending = parts.flatMap((part) => (part.onLeaseEnding ? [part.onLeaseEnding] : []));
  const names = tools.map((tool) => tool.name);
  const duplicate = names.find((name, i) => names.indexOf(name) !== i);
  if (duplicate) throw new Error(`function tool ${duplicate} has more than one owner`);
  return {
    ...(single as Partial<RunHooks>),
    ...(tools.length > 0 ? { functionTools: tools } : {}),
    ...(contexts.length > 0
      ? {
          promptContext: async (run: RunSnapshot) =>
            (await Promise.all(contexts.map((context) => context(run)))).flat(),
        }
      : {}),
    ...(leased.length > 0
      ? {
          onLeased: async (slot: LeasedSlot) => {
            for (const hook of leased) await hook(slot);
          },
        }
      : {}),
    ...(ending.length > 0
      ? {
          onLeaseEnding: async (slot: ReleasedSlot) => {
            const results = await Promise.allSettled(ending.map((hook) => hook(slot)));
            const failed = results.find((result) => result.status === "rejected");
            if (failed) throw failed.reason;
          },
        }
      : {}),
  };
}
```

B5 imports this helper instead of defining its own `mergeHooks` (principle 6); the duplicate tool-name guard is the one its test expects.

Note: `onLeaseEnding` hooks run concurrently (`allSettled`) because each is independent cleanup and the release path is latency-sensitive (principle 2); the test above only checks that both ran.

- [ ] **Step 14: Add the browser-level CDP accessor and expose the session.**

In `apps/agent/src/browser/session.ts`, add the field `#browserCdp: Promise<CDPSession> | null = null;` next to `#cdp`, and this method after `cdp()`:

```ts
  /** A browser-level CDP session (the Browser.* domain, e.g. downloads), opened once per lease. */
  browserCdp(): Promise<CDPSession> {
    if (this.#browserCdp === null) {
      const attempt = this.#browser.newBrowserCDPSession();
      this.#browserCdp = attempt;
      attempt.catch(() => {
        if (this.#browserCdp === attempt) this.#browserCdp = null;
      });
    }
    return this.#browserCdp;
  }
```

In `apps/agent/src/loop/loop-browser.ts`, add `import type { CDPSession } from "playwright-core";` and `import type { BrowserSession } from "../browser/session.ts";`, and replace `AttachedBrowser` with:

```ts
export interface AttachedBrowser {
  browser: LoopBrowser;
  /** The page session for lease hooks (B3 passkey enrolment); null for fakes. */
  session: BrowserSession | null;
  /** Browser-level CDP for lease hooks (RunHooks.onLeased). */
  browserCdp(): Promise<CDPSession>;
  close(): Promise<void>;
}
```

In `apps/agent/src/loop/session-browser.ts`, replace `return { browser, close: () => session.close() };` with:

```ts
      return {
        browser,
        session,
        browserCdp: () => session.browserCdp(),
        close: () => session.close(),
      };
```

In `apps/agent/src/testing/fake-loop-browser.ts`, append:

```ts
/** Fakes have no real browser: lease hooks that need Browser.* CDP must not run against them. */
export const unavailableBrowserCdp = (): Promise<never> =>
  Promise.reject(new Error("fake browsers have no browser-level CDP session"));
```

Then add `session: null, browserCdp: unavailableBrowserCdp` to every fake `AttachedBrowser` literal. Find them with `grep -rn "close: async () => undefined" apps/agent/src tests` (today: `worker.int.test.ts`'s `connect` and the `connect` in `fake-loop-browser.ts`); `pnpm typecheck` lists any you miss.

- [ ] **Step 15: Add `RunLoop.revertTakeover`.** In `apps/agent/src/loop/run-loop.ts`, add `returnControlToAgent` to the imports from `"@mastertutor/db"` (add that import if the file only imports `type Database`), add this constant next to `DENIED`:

```ts
const TAKEOVER_FAILED =
  "Taking control needs the live view to be open and connected. Open it, then try again.";
```

and this method directly after `markHandBack()`:

```ts
  /**
   * The takeover could not be delivered to the user's live view (B6, F3): one commit returns
   * control to the agent, tells the UI why, and the agent re-observes before acting again. A run
   * that was waiting on an approval goes straight back to waiting(approval), never via running.
   */
  async revertTakeover(): Promise<void> {
    const pending = this.#pending;
    await this.#deps.store.commit({
      events: [
        { type: "error", code: "takeover_failed", message: TAKEOVER_FAILED },
        { type: "control", holder: "agent" },
      ],
      // A takeover that interrupted waiting(approval) returns there: the approval was never
      // superseded (markTakeover did not run), so the sheet stays and the decision still counts.
      transition: pending
        ? ({
            from: ["waiting", "running"],
            to: "waiting",
            waitReason: "approval",
            reason: pending.request.kind,
          } as Transition)
        : TO_RUNNING,
      extra: async (tx) => {
        await returnControlToAgent(tx, this.#run.id);
      },
    });
    if (!pending) this.reobserve();
  }
```

The worker then calls `resume()` when an approval is pending (Step 16(c)); `resume()` sees `status = 'waiting'` and commits no transition, so the run stays `waiting(approval)` (or acts on a decision that arrived meanwhile).

- [ ] **Step 16: Change the worker.** In `apps/agent/src/loop/worker.ts`:

(a) Add `type UserControlResult` to the import from `./hooks.ts` (`import type { RunHooks, UserControlResult } from "./hooks.ts";`), and add the field `#released = false;` next to `#started`.

(b) In `#restore`, replace `if (run.controller === "user") return this.#holdForUser();` with `if (run.controller === "user") return this.#holdForUser(true);`.

(c) Replace the whole `#holdForUser` method with:

```ts
  /** While the user holds control: no input, no screenshots, no model calls, no sleep (spec §5.1, §10.3). */
  async #holdForUser(afterRestore = false): Promise<StepOutcome> {
    const slot = this.#claim.slotName;
    this.#guard.hold();
    if (!this.#abort.signal.aborted) this.#abort.abort(new Interrupted("takeover"));
    const given = await this.#deps.hooks.control
      .onUserControl(slot, this.runId, { afterRestore })
      .catch((): UserControlResult => ({ ok: false, code: "takeover_failed" }));
    if (!given.ok) return this.#revertTakeover();
    await this.#loop!.markTakeover();
    for (;;) {
      await this.#latch.wait();
      if (this.#stop) return CONTINUE;
      const run = await readRunControl(this.#deps.db, this.runId);
      if (!run || isTerminal(run.status)) return { kind: "cancelled" };
      if (run.controller === "agent") {
        await this.#deps.hooks.control.onAgentControl(slot, this.runId);
        this.#guard.release();
        this.#abort = new AbortController();
        await this.#loop!.markHandBack();
        return CONTINUE;
      }
    }
  }

  /** The user's live view could not take the browser (F3): the agent keeps control and goes on. */
  async #revertTakeover(): Promise<StepOutcome> {
    this.#deps.log.warn({ runId: this.runId, errorCode: "takeover_failed" }, "takeover reverted");
    await this.#loop!.revertTakeover();
    this.#guard.release();
    this.#abort = new AbortController();
    return this.#loop!.hasPendingApproval ? this.#loop!.resume(this.#abort.signal) : CONTINUE;
  }
```

(d) In `#main` directly after the `this.#attached = await this.#deps.connect({ … });` statement, add:

```ts
      await this.#deps.hooks.onLeased({
        runId: this.runId,
        workspaceId: this.workspaceId,
        slotName: this.#claim.slotName,
        session: this.#attached!.session,
        browserCdp: () => this.#attached!.browserCdp(),
      });
```

and in `#main`'s `finally` (as B3 E left it), insert directly **before** `await this.#attached?.close().catch(() => undefined);`:

```ts
      if (this.#attached && !this.#released)
        await this.#deps.hooks
          .onLeaseEnding({ runId: this.runId, slotName: this.#claim.slotName, slotReleased: false })
          .catch(() => undefined);
```

Keep B3's `await this.#deps.hooks.onReleased(this.runId).catch(() => undefined);` after `close()` unchanged. The `finally` then reads, in order: `clearInterval(beat)`, `clearTimeout(this.#deadlineTimer)`, the `onLeaseEnding` block above, `close()`, B3's comment and `onReleased(this.runId)`.

(e) In `#release`, replace `await this.#attached?.close().catch(() => undefined);` with:

```ts
    this.#released = true;
    // Before Browser.close (pool.reset): B6 takes n.eko back from the user and detaches downloads.
    await this.#deps.hooks
      .onLeaseEnding({ runId: this.runId, slotName, slotReleased: true })
      .catch(() =>
        log.warn({ runId: this.runId, errorCode: "release_hook_failed" }, "release hook failed"),
      );
    await this.#attached?.close().catch(() => undefined);
```

- [ ] **Step 17: Run the tests and the B1 suites.**

Run:
```bash
pnpm test apps/agent
pnpm test:int apps/agent
pnpm typecheck && pnpm lint
```
Expected: PASS, including the five new `B6 seams (A2)` tests, B3 E's `onReleased(runId)` (F11) and A5 tests, and every existing B1 test (takeover latency, I1–I3, M1–M7). The B1 behaviour suite runs in A13.

- [ ] **Step 18: Commit A2.2.**
```bash
pnpm exec prettier --write apps/agent/src
git add apps/agent/src
git commit -m "feat(agent): failed takeover returns control to the agent; onLeased/onLeaseEnding and composeRunHooks (B6 seams F3 F5)"
```

---
### Task A3: Live-view contracts and the n.eko login helper (base Task 1, trimmed)

Changed from base Task 1: all TURN pieces are gone (S7, D42), so G1 (`env.test` used `OPENAI_EMBEDDINGS_KEY`) disappears with them; `liveForwardAuthAddress` is the single source of the D41 ForwardAuth address; takeover timing constants replace `TAKEOVER_ABORT_TARGET_MS` (B1 owns the abort target). Unused `TURN_CREDENTIAL_TTL_SECONDS` is deleted (nothing imports it).

**Files:**
- Replace: `packages/contracts/src/live.ts`, `packages/contracts/src/live.test.ts`
- Modify: `packages/contracts/src/constants.ts`, `packages/contracts/src/events.ts`, `packages/contracts/src/events.test.ts`, `packages/contracts/src/server/neko.ts`, `packages/contracts/src/server/neko.test.ts`

**Interfaces:**
- Consumes: `Uuid`, `SlotName`, `RunEvent`, `deriveNekoPassword`.
- Produces from `@mastertutor/contracts`:
  - constants `LIVE_SLOT_COOKIE`, `NEKO_SESSION_COOKIE = "NEKO_SESSION"`, `NEKO_MEMBERS`, `LIVE_COOKIE_TTL_SECONDS = 43200`, `AUTO_HAND_BACK_IDLE_MS = 900000`, `TAKEOVER_GIVE_WAIT_MS = 1000`, `TAKEOVER_RESTORE_WAIT_MS = 15000`, `NEKO_EMBED_QUERY`, `LIVE_PATH_REGEX`, `LIVE_STRIP_REGEX`, `LIVE_AUTH_PATH = "/api/live/auth"`, `DEFAULT_CDP_SUBNET_PREFIX = "172.30.231"`, `SLOT_IDLE_PORT = 9224`;
  - `livePath(runId): string`, `liveEmbedPath(runId): string`, `runIdFromLivePath(uri: string): string | null`, `liveSlotCookiePattern(slotName: string): string`, `liveRouterRule(slotName: string, host: string): string`, `liveForwardAuthAddress(cdpSubnetPrefix?: string): string`;
  - `IceServer`, `OpenLiveResult` (embed regex with the placeholders; `iceServers` stays in the contract and is `[]` in v1);
  - `RunEvent` `download_ready` = `{downloadId, assetId, filename, bytes}`.
- Produces from `@mastertutor/contracts/server`: `loginNeko(o: {baseUrl, username, password, fetch?, timeoutMs?}): Promise<string>`, `NekoLoginError` (`status`), `nekoTokenFromSetCookie(headers: readonly string[]): string | null`.

- [ ] **Step 1: Write the failing tests.**

`packages/contracts/src/live.test.ts` (replace the whole file):

```ts
import { describe, expect, it } from "vitest";
import {
  LIVE_STRIP_REGEX,
  OpenLiveResult,
  liveEmbedPath,
  liveForwardAuthAddress,
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
      iceServers: [],
    });
    expect(awake.sleeping).toBe(false);
    for (const embedPath of [
      "/admin",
      `/live/${runId}/?embed=1`,
      `/live/${runId}/?embed=1&usr=user&pwd=x`,
    ]) {
      expect(
        OpenLiveResult.safeParse({ sleeping: false, slotName: "browser-1", embedPath, iceServers: [] })
          .success,
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

  it("renders the one Traefik rule used by the test routers and Phase 9's labels", () => {
    expect(liveRouterRule("browser-2", "notes.example.com")).toBe(
      "Host(`notes.example.com`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\\s*)live_slot=browser-2\\.`)",
    );
    expect(LIVE_STRIP_REGEX).toBe("^/live/[0-9a-f-]{36}");
    expect(() => liveRouterRule("browser-1", "bad host`")).toThrow();
  });

  it("points ForwardAuth at web's static cdp address, never the ambiguous `web` name (D41)", () => {
    expect(liveForwardAuthAddress()).toBe("http://172.30.231.11:3000/api/live/auth");
    expect(liveForwardAuthAddress("10.42.7")).toBe("http://10.42.7.11:3000/api/live/auth");
    for (const bad of ["web", "1.2.3.4", "1.2", "a.b.c", "300.1.1"]) {
      expect(() => liveForwardAuthAddress(bad), bad).toThrow();
    }
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

Append to `packages/contracts/src/server/neko.test.ts`: **copy verbatim from base plan Task 1, Step 1** (the block starting `import { createServer, type Server } from "node:http";` through the end of `describe("loginNeko", …)`). Move its imports to the top of the file.

- [ ] **Step 2: Run them and watch them fail.**

Run: `pnpm test packages/contracts`
Expected: FAIL: `liveForwardAuthAddress`, `liveRouterRule`, `runIdFromLivePath`, `loginNeko` missing; `download_ready` rejects `assetId`.

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
export const LIVE_COOKIE_TTL_SECONDS = 12 * 60 * 60;
/** Spec §5.1: takeover ends after 15 minutes with no user input, counted from the takeover. */
export const AUTO_HAND_BACK_IDLE_MS = 15 * 60 * 1000;
/** How long a live takeover waits for the user's n.eko session to be connected (F3: inside F3's 2 s). */
export const TAKEOVER_GIVE_WAIT_MS = 1_000;
/** A takeover that arrives with a fresh lease waits longer: the iframe reconnects after the slot event. */
export const TAKEOVER_RESTORE_WAIT_MS = 15_000;
/**
 * n.eko 3.1.6 embeds its legacy client, which auto-connects only when usr/pwd are in the URL.
 * pwd is a placeholder: the legacy /ws handler authenticates with the NEKO_SESSION cookie first.
 */
export const NEKO_EMBED_QUERY = "embed=1&usr=user&pwd=cookie";
/** Traefik PathRegexp for live requests (Go RE2 and JS agree on this pattern). */
export const LIVE_PATH_REGEX = "^/live/[0-9a-f-]{36}/";
/** Traefik StripPrefixRegex: n.eko is served at / behind it. */
export const LIVE_STRIP_REGEX = "^/live/[0-9a-f-]{36}";
/** web's ForwardAuth endpoint for the live routers. */
export const LIVE_AUTH_PATH = "/api/live/auth";
/** Compose default for CDP_SUBNET_PREFIX (agent .10, web .11, Traefik .12). */
export const DEFAULT_CDP_SUBNET_PREFIX = "172.30.231";

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

/** The single source of the per-slot Traefik rule (test file provider here, labels in Phase 9). */
export function liveRouterRule(slotName: string, host: string): string {
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new TypeError("Invalid router host");
  return `Host(\`${host}\`) && PathRegexp(\`${LIVE_PATH_REGEX}\`) && HeaderRegexp(\`Cookie\`, \`${liveSlotCookiePattern(slotName)}\`)`;
}

/**
 * ForwardAuth target by web's static cdp address (D41): on Dokploy's shared network the name `web`
 * can resolve to another app's container, so the live routers never use it.
 */
export function liveForwardAuthAddress(cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX): string {
  const octets = cdpSubnetPrefix.split(".");
  const valid =
    octets.length === 3 && octets.every((o) => /^[0-9]{1,3}$/.test(o) && Number(o) <= 255);
  if (!valid) throw new TypeError("Invalid CDP subnet prefix");
  return `http://${cdpSubnetPrefix}.11:3000${LIVE_AUTH_PATH}`;
}

export const IceServer = z.object({
  urls: z.array(z.string().regex(/^(stun|turns?):/)).min(1),
  username: z.string().max(256).optional(),
  credential: z.string().max(256).optional(),
});
export type IceServer = z.infer<typeof IceServer>;

/** Output of oRPC runs.openLive. A sleeping run holds no slot. v1 has no TURN, so iceServers is []. */
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

`packages/contracts/src/constants.ts`: directly after `PULSE_TCP_PORT`, add:
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

`packages/contracts/src/server/neko.ts`: **append verbatim from base plan Task 1, Step 3** (the block starting `import { NEKO_SESSION_COOKIE } from "../live.ts";` through the end of `loginNeko`), moving the new `import` to the top of the file. Do **not** create `server/turn.ts` and do not touch `server/index.ts`.

- [ ] **Step 4: Run the tests and checks.**

Run: `pnpm test packages/contracts && pnpm typecheck && pnpm lint`
Expected: PASS. `grep -rn "TURN_CREDENTIAL_TTL_SECONDS" apps packages tests` prints nothing.

- [ ] **Step 5: Commit.**
```bash
pnpm exec prettier --write packages/contracts
git add packages/contracts
git commit -m "feat(contracts): live-view routing helpers, D41 ForwardAuth address, n.eko login, download_ready assetId"
```

---

### Task A4: Live access and control-request queries (base Task 2, rewritten)

Changed from base Task 2: drizzle instead of postgres.js `ISql` (one style, like B1 and `queries/workspace.ts`); events go through B1's `emitRunEvent` (F7, moved in A2); the agent-side status writers `markTakeoverWaiting`, `markHandBackRunning`, `revertToAgent` and the download-approval lookup are **not** written (F2, F4, F6); the column and CHECK already landed in A2 (F8). Shared seeds live in `@mastertutor/db/testing` (F9); there is no `tests/support/`.

**Files:**
- Create: `packages/db/src/queries/live.ts`, `packages/db/src/queries/downloads.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/src/testing.ts`
- Test: `packages/db/src/queries/live.int.test.ts`

**Interfaces:**
- Consumes: A2's `emitRunEvent`, `returnControlToAgent`, `notifyRunControl`, `DbTx`; tables `runs`, `browserSlots`, `workspaceMembers`, `assets`, `downloads`, `user`, `workspaces`.
- Produces from `@mastertutor/db`:
  - `MemberRun {id, workspaceId, status, controller, slotName, slotLeased}`; `getRunForMember(db: Database, runId: string, userId: string): Promise<MemberRun | null>`;
  - `canAccessLiveSlot(db: Database, q: {runId: string; slotName: string; userId: string}): Promise<boolean>`;
  - `ControlRequestResult = {ok: true; via: "control" | "wake" | "none"} | {ok: false; reason: "not_found" | "finished" | "not_controller"}`;
  - `requestTakeover(db: Database, input: {runId: string; userId: string}): Promise<ControlRequestResult>`: idempotent for the member already holding control (`via: "none"`, no write, no NOTIFY); `not_controller` while another member holds it (B3 E.8 note 3);
  - `requestHandBack(db: Database, input: {runId: string; userId: string; note: string | null}): Promise<ControlRequestResult>`: while a member holds control, accepted only from that member or a workspace `owner`, else `not_controller`;
  - `findAssetBySha(db: Database, workspaceId: string, sha256: string): Promise<{id: string; key: string} | null>`;
  - `DownloadRecordInput`; `recordDownload(tx: DbTx, input: DownloadRecordInput): Promise<{downloadId: string; assetId: string}>`.
- Produces from `@mastertutor/db/testing`: `seedMember(db: Database, options?: {workspaceId?: string; role?: "owner" | "member"}): Promise<{userId: string; workspaceId: string}>`; `seedRun(db: Database, options: {workspaceId: string; status?: RunStatus; waitReason?: WaitReason | null}): Promise<string>`; `leaseSlotForTest(db: Database, slotName: string, runId: string): Promise<void>`; `releaseSlotForTest(db: Database, slotName: string): Promise<void>` (back to `idle`); `nextNotification(sql: Sql, channel: string, action: () => Promise<unknown>, timeoutMs?: number): Promise<string>`.

- [ ] **Step 1: Add the test seeds.** Append to `packages/db/src/testing.ts` (merge the imports into the top of the file):

```ts
import { randomUUID } from "node:crypto";
import type { RunStatus, WaitReason } from "@mastertutor/contracts";
import { eq } from "drizzle-orm";
import type { Sql } from "postgres";
import type { Database } from "./client.ts";
import { browserSlots, runs, user, workspaceMembers, workspaces } from "./schema/index.ts";

/** A Better Auth user plus (new or given) workspace membership. Use the owner connection. */
export async function seedMember(
  db: Database,
  options: { workspaceId?: string; role?: "owner" | "member" } = {},
): Promise<{ userId: string; workspaceId: string }> {
  const userId = `user_${randomUUID().replaceAll("-", "")}`;
  await db.insert(user).values({ id: userId, name: "Test", email: `${userId}@example.test` });
  const workspaceId =
    options.workspaceId ??
    (await db.insert(workspaces).values({ name: "Test" }).returning({ id: workspaces.id }))[0]!.id;
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role: options.role ?? "owner" });
  return { userId, workspaceId };
}

export async function seedRun(
  db: Database,
  options: { workspaceId: string; status?: RunStatus; waitReason?: WaitReason | null },
): Promise<string> {
  const [run] = await db
    .insert(runs)
    .values({
      workspaceId: options.workspaceId,
      goal: "live test",
      status: options.status ?? "running",
      waitReason: options.waitReason ?? null,
      allowedOrigins: ["https://example.com"],
    })
    .returning({ id: runs.id });
  return run!.id;
}

/** Marks a slot leased to a run the way a claim does (one transaction, both sides). */
export async function leaseSlotForTest(db: Database, slotName: string, runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(browserSlots)
      .set({ state: "leased", runId, leaseOwner: "test", leaseExpiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(browserSlots.name, slotName));
    await tx.update(runs).set({ slotName }).where(eq(runs.id, runId));
  });
}

/** Frees a slot back to idle (tests that drive a real slot must leave it idle for the next file). */
export async function releaseSlotForTest(db: Database, slotName: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(runs).set({ slotName: null }).where(eq(runs.slotName, slotName));
    await tx
      .update(browserSlots)
      .set({ state: "idle", runId: null, leaseOwner: null, leaseExpiresAt: null })
      .where(eq(browserSlots.name, slotName));
  });
}

/** Runs action while LISTENing on channel and returns the first payload. */
export async function nextNotification(
  sql: Sql,
  channel: string,
  action: () => Promise<unknown>,
  timeoutMs = 3_000,
): Promise<string> {
  let deliver!: (payload: string) => void;
  const received = new Promise<string>((resolve) => {
    deliver = resolve;
  });
  const { unlisten } = await sql.listen(channel, (payload) => deliver(payload));
  let timer: NodeJS.Timeout | undefined;
  try {
    await action();
    return await Promise.race([
      received,
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No NOTIFY on ${channel}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await unlisten();
  }
}
```

- [ ] **Step 2: Write the failing test.** `packages/db/src/queries/live.int.test.ts`:

```ts
import { decodeNotify } from "@mastertutor/contracts";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { runEvents, runs } from "../schema/index.ts";
import {
  leaseSlotForTest,
  nextNotification,
  releaseSlotForTest,
  seedMember,
  seedRun,
  startTestDatabase,
  type TestDatabase,
} from "../testing.ts";
import { findAssetBySha, recordDownload } from "./downloads.ts";
import { canAccessLiveSlot, getRunForMember, requestHandBack, requestTakeover } from "./live.ts";

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
  member = await seedMember(owner.db);
  outsider = await seedMember(owner.db);
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close(), agent?.close()]);
  await testDb?.stop();
});

const runRow = async (runId: string) =>
  (await owner.db.select().from(runs).where(eq(runs.id, runId)))[0]!;

describe("member and slot access", () => {
  it("shows a run only to members, with its lease state", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    expect(await getRunForMember(web.db, runId, outsider.userId)).toBeNull();
    expect(await getRunForMember(web.db, runId, member.userId)).toMatchObject({
      id: runId,
      status: "running",
      controller: "agent",
      slotName: null,
      slotLeased: false,
    });
    await leaseSlotForTest(owner.db, "browser-1", runId);
    expect(await getRunForMember(web.db, runId, member.userId)).toMatchObject({
      slotName: "browser-1",
      slotLeased: true,
    });
    await releaseSlotForTest(owner.db, "browser-1");
  });

  it("grants a live slot only for the leased run, to its members", async () => {
    const runA = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const runB = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, "browser-1", runA);
    const ok = { runId: runA, slotName: "browser-1", userId: member.userId };
    expect(await canAccessLiveSlot(web.db, ok)).toBe(true);
    expect(await canAccessLiveSlot(web.db, { ...ok, userId: outsider.userId })).toBe(false);
    expect(await canAccessLiveSlot(web.db, { ...ok, runId: runB })).toBe(false);
    expect(await canAccessLiveSlot(web.db, { ...ok, slotName: "browser-2" })).toBe(false);
    await releaseSlotForTest(owner.db, "browser-1");
    expect(await canAccessLiveSlot(web.db, ok)).toBe(false);
  });
});

describe("takeover and hand back (web role)", () => {
  it("takes control of a running run and notifies run_control", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const payload = await nextNotification(owner.sql, "run_control", async () => {
      expect(await requestTakeover(web.db, { runId, userId: member.userId })).toEqual({
        ok: true,
        via: "control",
      });
    });
    expect(decodeNotify("run_control", payload)).toEqual({ runId });
    expect(await runRow(runId)).toMatchObject({
      status: "waiting",
      waitReason: "takeover",
      controller: "user",
      controlUserId: member.userId,
    });
  });

  it("wakes a sleeping run with reason takeover", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId, status: "sleeping" });
    const payload = await nextNotification(owner.sql, "run_wake", async () => {
      expect(await requestTakeover(web.db, { runId, userId: member.userId })).toEqual({
        ok: true,
        via: "wake",
      });
    });
    expect(decodeNotify("run_wake", payload)).toEqual({ runId, reason: "takeover" });
    const row = await runRow(runId);
    expect(row).toMatchObject({ status: "sleeping", controller: "user", controlUserId: member.userId });
    expect(row.wakeRequestedAt).not.toBeNull();
  });

  it("refuses finished runs and non-members", async () => {
    const done = await seedRun(owner.db, { workspaceId: member.workspaceId, status: "completed" });
    expect(await requestTakeover(web.db, { runId: done, userId: member.userId })).toEqual({
      ok: false,
      reason: "finished",
    });
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    expect(await requestTakeover(web.db, { runId, userId: outsider.userId })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await requestHandBack(web.db, { runId, userId: outsider.userId, note: null })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("is idempotent for the holder and refuses another member (B3 E.8 note 3)", async () => {
    const colleague = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId, userId: colleague.userId });
    const received: string[] = [];
    const { unlisten } = await owner.sql.listen("run_control", (payload) => received.push(payload));
    try {
      expect(await requestTakeover(web.db, { runId, userId: colleague.userId })).toEqual({
        ok: true,
        via: "none",
      });
      expect(await requestTakeover(web.db, { runId, userId: member.userId })).toEqual({
        ok: false,
        reason: "not_controller",
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(received).toEqual([]);
    } finally {
      await unlisten();
    }
    expect(await runRow(runId)).toMatchObject({ controller: "user", controlUserId: colleague.userId });
  });

  it("accepts hand-back only from the controller or a workspace owner", async () => {
    const holder = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const other = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId, userId: holder.userId });
    expect(await requestHandBack(web.db, { runId, userId: other.userId, note: "mine now" })).toEqual({
      ok: false,
      reason: "not_controller",
    });
    expect(await runRow(runId)).toMatchObject({ controller: "user", controlUserId: holder.userId });
    // member is the workspace owner (seedMember's default role): owners may end any takeover.
    expect(await requestHandBack(web.db, { runId, userId: member.userId, note: null })).toEqual({
      ok: true,
      via: "control",
    });
    expect(await runRow(runId)).toMatchObject({ controller: "agent", controlUserId: null });
    // Once the agent holds control, any member's late note is still delivered.
    expect(await requestHandBack(web.db, { runId, userId: other.userId, note: "FYI" })).toEqual({
      ok: true,
      via: "none",
    });
  });

  it("hands back with a note as a user_message, and keeps a late note", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId, userId: member.userId });
    const payload = await nextNotification(owner.sql, "run_control", async () => {
      expect(
        await requestHandBack(web.db, { runId, userId: member.userId, note: "Logged in; continue" }),
      ).toEqual({ ok: true, via: "control" });
    });
    expect(decodeNotify("run_control", payload)).toEqual({ runId });
    expect(await runRow(runId)).toMatchObject({ controller: "agent", controlUserId: null });
    expect(await requestHandBack(web.db, { runId, userId: member.userId, note: null })).toEqual({
      ok: true,
      via: "none",
    });
    // The agent already took control back (e.g. the idle hand-back): the note still reaches it.
    expect(
      await requestHandBack(web.db, { runId, userId: member.userId, note: "Also open chapter 2" }),
    ).toEqual({ ok: true, via: "none" });
    const notes = (
      await owner.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, runId))
        .orderBy(asc(runEvents.id))
    )
      .map((e) => e.payload)
      .filter((p) => p.type === "user_message");
    expect(notes).toEqual([
      { type: "user_message", text: "Logged in; continue" },
      { type: "user_message", text: "Also open chapter 2" },
    ]);
  });
});

describe("download records (agent role)", () => {
  it("dedupes assets per workspace by sha256 and records every download", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
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
      sourceUrl: "https://example.com/a.pdf",
      approvedBy: member.userId,
    };
    expect(await findAssetBySha(agent.db, member.workspaceId, sha256)).toBeNull();
    const first = await agent.db.transaction((tx) => recordDownload(tx, input));
    const second = await agent.db.transaction((tx) => recordDownload(tx, input));
    expect(second.assetId).toBe(first.assetId);
    expect(second.downloadId).not.toBe(first.downloadId);
    expect(await findAssetBySha(agent.db, member.workspaceId, sha256)).toEqual({
      id: first.assetId,
      key: input.key,
    });
  });
});
```

- [ ] **Step 3: Run it and watch it fail.**

Run: `pnpm test:int packages/db/src/queries/live.int.test.ts`
Expected: FAIL: `./live.ts` and `./downloads.ts` do not exist.

- [ ] **Step 4: Implement.**

`packages/db/src/queries/live.ts`:

```ts
import {
  TERMINAL_RUN_STATUSES,
  encodeNotify,
  type Controller,
  type MemberRole,
  type RunStatus,
} from "@mastertutor/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Database, DbTx } from "../client.ts";
import { browserSlots, runs, workspaceMembers } from "../schema/index.ts";
import { notifyRunControl, returnControlToAgent } from "./control.ts";
import { emitRunEvent } from "./events.ts";

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

export interface MemberRun {
  id: string;
  workspaceId: string;
  status: RunStatus;
  controller: Controller;
  slotName: string | null;
  slotLeased: boolean;
}

const memberOf = (userId: string) =>
  and(eq(workspaceMembers.workspaceId, runs.workspaceId), eq(workspaceMembers.userId, userId));

/** The run if userId is a member of its workspace; slotLeased means browser_slots agrees. */
export async function getRunForMember(
  db: Database,
  runId: string,
  userId: string,
): Promise<MemberRun | null> {
  const [row] = await db
    .select({
      id: runs.id,
      workspaceId: runs.workspaceId,
      status: runs.status,
      controller: runs.controller,
      slotName: runs.slotName,
      slotLeased: sql<boolean>`coalesce(${browserSlots.state} = 'leased' and ${browserSlots.runId} = ${runs.id}, false)`,
    })
    .from(runs)
    .innerJoin(workspaceMembers, memberOf(userId))
    .leftJoin(browserSlots, eq(browserSlots.name, runs.slotName))
    .where(eq(runs.id, runId));
  return row ?? null;
}

/** ForwardAuth's DB check (spec §10.2): slot leased to exactly this run, and the user is a member. */
export async function canAccessLiveSlot(
  db: Database,
  query: { runId: string; slotName: string; userId: string },
): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(browserSlots)
    .innerJoin(runs, and(eq(runs.id, browserSlots.runId), eq(runs.slotName, browserSlots.name)))
    .innerJoin(workspaceMembers, memberOf(query.userId))
    .where(
      and(
        eq(browserSlots.name, query.slotName),
        eq(browserSlots.runId, query.runId),
        eq(browserSlots.state, "leased"),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export type ControlRequestResult =
  | { ok: true; via: "control" | "wake" | "none" }
  | { ok: false; reason: "not_found" | "finished" | "not_controller" };

interface LockedRun {
  status: RunStatus;
  controller: Controller;
  controlUserId: string | null;
  /** The requesting member's role in the run's workspace. */
  role: MemberRole;
}

async function lockMemberRun(tx: DbTx, runId: string, userId: string): Promise<LockedRun | null> {
  const [row] = await tx
    .select({
      status: runs.status,
      controller: runs.controller,
      controlUserId: runs.controlUserId,
      role: workspaceMembers.role,
    })
    .from(runs)
    .innerJoin(workspaceMembers, memberOf(userId))
    .where(eq(runs.id, runId))
    .for("update", { of: runs });
  return row ?? null;
}

/**
 * Spec §10.3 takeover, in one transaction. A run holding (or about to hold) a slot moves to
 * waiting(takeover) and NOTIFYs run_control; a sleeping or queued run is woken with reason takeover.
 * Idempotent for the member who already holds control; another member cannot take a held run.
 */
export async function requestTakeover(
  db: Database,
  input: { runId: string; userId: string },
): Promise<ControlRequestResult> {
  return db.transaction(async (tx): Promise<ControlRequestResult> => {
    const run = await lockMemberRun(tx, input.runId, input.userId);
    if (!run) return { ok: false, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false, reason: "finished" };
    // B3 E.8 note 3: a double click must not re-NOTIFY, and nobody steals a held takeover.
    if (run.controller === "user")
      return run.controlUserId === input.userId
        ? { ok: true, via: "none" }
        : { ok: false, reason: "not_controller" };
    if (run.status === "sleeping" || run.status === "queued") {
      await tx
        .update(runs)
        .set({
          controller: "user",
          controlUserId: input.userId,
          ...(run.status === "sleeping" ? { wakeRequestedAt: sql`now()` } : {}),
        })
        .where(eq(runs.id, input.runId));
      await tx.execute(
        sql`select pg_notify('run_wake', ${encodeNotify("run_wake", { runId: input.runId, reason: "takeover" })})`,
      );
      return { ok: true, via: "wake" };
    }
    await tx
      .update(runs)
      .set({
        controller: "user",
        controlUserId: input.userId,
        status: "waiting",
        waitReason: "takeover",
        lastActivityAt: sql`now()`,
      })
      .where(eq(runs.id, input.runId));
    await notifyRunControl(tx, input.runId);
    return { ok: true, via: "control" };
  });
}

/**
 * Spec §10.3 hand back: controller='agent' (the shared F4 write), the optional note as a
 * user_message, and NOTIFY run_control. While a member holds control, only that member or a
 * workspace owner may hand back (B3 E.8 note 3). A note sent after the agent already took control
 * back (idle hand-back) is still delivered.
 */
export async function requestHandBack(
  db: Database,
  input: { runId: string; userId: string; note: string | null },
): Promise<ControlRequestResult> {
  return db.transaction(async (tx): Promise<ControlRequestResult> => {
    const run = await lockMemberRun(tx, input.runId, input.userId);
    if (!run) return { ok: false, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false, reason: "finished" };
    if (run.controller === "user" && run.controlUserId !== input.userId && run.role !== "owner")
      return { ok: false, reason: "not_controller" };
    const changed = run.controller === "user" && (await returnControlToAgent(tx, input.runId));
    if (input.note) await emitRunEvent(tx, input.runId, { type: "user_message", text: input.note });
    if (changed || input.note) await notifyRunControl(tx, input.runId);
    return { ok: true, via: changed ? "control" : "none" };
  });
}
```

`packages/db/src/queries/downloads.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Database, DbTx } from "../client.ts";
import { assets, downloads } from "../schema/index.ts";

export async function findAssetBySha(
  db: Database,
  workspaceId: string,
  sha256: string,
): Promise<{ id: string; key: string } | null> {
  const [row] = await db
    .select({ id: assets.id, key: assets.key })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), eq(assets.sha256, sha256)));
  return row ?? null;
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
  /** The member who held control when the download began (v1: only the user downloads). */
  approvedBy: string;
}

/** assets (deduped per workspace by sha256) + downloads, inside the caller's transaction (spec §10.2.9). */
export async function recordDownload(
  tx: DbTx,
  input: DownloadRecordInput,
): Promise<{ downloadId: string; assetId: string }> {
  const [inserted] = await tx
    .insert(assets)
    .values({
      workspaceId: input.workspaceId,
      sha256: input.sha256,
      bucket: input.bucket,
      key: input.key,
      mime: input.mime,
      bytes: input.bytes,
      sourceUrl: input.sourceUrl.slice(0, 4_096),
    })
    .onConflictDoNothing({ target: [assets.workspaceId, assets.sha256] })
    .returning({ id: assets.id });
  const assetId =
    inserted?.id ??
    (
      await tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.sha256, input.sha256)))
    )[0]?.id;
  if (!assetId) throw new Error("asset row missing after insert");
  const [download] = await tx
    .insert(downloads)
    .values({
      runId: input.runId,
      filename: input.filename,
      assetId,
      bytes: input.bytes,
      approvedBy: input.approvedBy,
    })
    .returning({ id: downloads.id });
  if (!download) throw new Error("downloads insert returned no row");
  return { downloadId: download.id, assetId };
}
```

Append to `packages/db/src/index.ts`:
```ts
export * from "./queries/live.ts";
export * from "./queries/downloads.ts";
```

- [ ] **Step 5: Run the tests.**

Run: `pnpm test:int packages/db && pnpm typecheck && pnpm lint`
Expected: PASS, including the Phase 0 db tests and A2's `control.int.test.ts`.

- [ ] **Step 6: Commit.**
```bash
pnpm exec prettier --write packages/db
git add packages/db
git commit -m "feat(db): live access, takeover/hand-back requests and download records on drizzle (B6)"
```

---

### Task A5: Slot image — legacy client, cookie auth, X idle probe (rest of base Task 3, as edits)

Changed from base Task 3: **every change is an edit** (S1). The entrypoint gains only `9224` in the agent-only port loop (A1 already changed the user profile). No `turn-ice`, no TURN env (S7). `verify.sh` is appended to, keeping `SYS_PTRACE`, the root environ read and its non-empty guards (G2). n.eko chat is off (S4). S5's legacy side endpoints are checked.

**Files:**
- Modify: `apps/browser-slot/Dockerfile`, `apps/browser-slot/bin/slot-entrypoint`, `apps/browser-slot/supervisord/chromium.conf`
- Create: `apps/browser-slot/bin/slot-idle-http`
- Test: `apps/browser-slot/test/verify.sh` (insert one block)

**Interfaces:**
- Consumes: A1's image; `SLOT_IDLE_PORT` (A3) as documentation of the port number.
- Produces: image `mastertutor/browser-slot:local` with: `GET :9224/` → `HTTP/1.0 200` and the X idle milliseconds, agent IP only; `NEKO_LEGACY=true` (legacy `/ws`); cookie auth on (not Secure); implicit hosting off; file-chooser dialog and upload drop on; chat off.

- [ ] **Step 1: Confirm the n.eko setting names before relying on them.** Run:

```bash
docker run --rm --entrypoint sh ghcr.io/m1k1o/neko/chromium:3.1.6 -c \
  'neko serve --help 2>&1 | grep -E -- "--(legacy|session\.cookie\.enabled|session\.cookie\.secure|session\.implicit_hosting|desktop\.file_chooser_dialog|desktop\.upload_drop|chat\.enabled)\b"'
```

Expected: seven lines, one per flag. n.eko maps `a.b_c` to `NEKO_A_B_C`, which gives the env names in Step 4. If any flag is missing, stop and report `BLOCKED` with the output; do not guess another name.

- [ ] **Step 2: Write the failing checks.** In `apps/browser-slot/test/verify.sh`, insert this block **immediately after** the line `pass "raw secrets scrubbed before supervisord"` (where `$neko_environ` is already read):

```bash
# A5: legacy client, cookie auth, chat off, implicit hosting off (read from the n.eko process itself).
for setting in NEKO_LEGACY=true NEKO_SESSION_COOKIE_ENABLED=true NEKO_SESSION_COOKIE_SECURE=false \
  NEKO_SESSION_IMPLICIT_HOSTING=false NEKO_DESKTOP_FILE_CHOOSER_DIALOG=true \
  NEKO_DESKTOP_UPLOAD_DROP=true NEKO_CHAT_ENABLED=false; do
  grep -qx "$setting" <<<"$neko_environ" || fail "n.eko runs without $setting"
done
pass "n.eko legacy, cookie, hosting, upload and chat settings"
[[ "$(from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' "http://$PREFIX.20:8080/ws")" != "404" ]] \
  || fail "legacy client endpoint /ws missing (NEKO_LEGACY)"
from_ip "$PREFIX.11" -o /dev/null -D - -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"user\",\"password\":\"$(hmac "$MEMBER_SECRET")\"}" \
  "http://$PREFIX.20:8080/api/login" | grep -qi '^set-cookie: NEKO_SESSION=' \
  || fail "n.eko login does not set the NEKO_SESSION cookie (cookie auth off)"
pass "legacy /ws endpoint and cookie auth enabled"
# S5: the legacy side endpoints never answer without credentials.
for path in /stats /screenshot.jpg /file; do
  code="$(from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' "http://$PREFIX.20:8080$path")"
  [[ "$code" != "200" ]] || fail "n.eko $path answers 200 without credentials"
done
pass "legacy side endpoints need credentials"

# A5: X idle probe on 9224, agent IP only; it grows without input and XTest (n.eko's path) resets it.
idle_ms() { from_ip "$PREFIX.10" "http://$PREFIX.20:9224/" | tr -d '\r\n'; }
first="$(idle_ms)"
[[ "$first" =~ ^[0-9]+$ ]] || fail "idle probe did not return milliseconds ($first)"
if from_ip "$PREFIX.11" "http://$PREFIX.20:9224/" >/dev/null; then fail "idle probe reachable from a non-agent IP"; fi
grown=""
for _ in $(seq 1 20); do
  now_ms="$(idle_ms)"
  if [[ "$now_ms" =~ ^[0-9]+$ ]] && (( now_ms >= first + 1500 )); then grown=1; break; fi
  sleep 0.5
done
[[ -n "$grown" ]] || fail "X idle time does not grow without input"
docker exec -u neko "$SLOT" sh -c 'DISPLAY=:99.0 xdotool mousemove 37 41 && DISPLAY=:99.0 xdotool mousemove 51 63'
reset=""
for _ in $(seq 1 10); do
  now_ms="$(idle_ms)"
  if [[ "$now_ms" =~ ^[0-9]+$ ]] && (( now_ms < 1000 )); then reset=1; break; fi
  sleep 0.3
done
[[ -n "$reset" ]] || fail "XTest input did not reset the X idle time"
pass "idle probe measures XTest input and is agent-only"
```

- [ ] **Step 3: Run it and watch it fail.**

Run: `bash apps/browser-slot/test/verify.sh`
Expected: `VERIFY FAIL: n.eko runs without NEKO_LEGACY=true`.

- [ ] **Step 4: Implement (edits only).**

`apps/browser-slot/bin/slot-idle-http` (new): **copy verbatim from base plan Task 3, Step 3** (the `slot-idle-http` script).

`apps/browser-slot/supervisord/chromium.conf`: **append verbatim from base plan Task 3, Step 3** (the `[program:idle-probe]` block).

`apps/browser-slot/bin/slot-entrypoint`: replace exactly these lines:

```bash
# Ingress is default-DROP. Allowed: loopback, replies, n.eko (8080) from agent/web/Traefik, CDP (9223)
# and PulseAudio (4713) from the agent, and the WebRTC mux port when configured.
```
```bash
for port in 9223 4713; do
```

with:

```bash
# Ingress is default-DROP. Allowed: loopback, replies, n.eko (8080) from agent/web/Traefik, CDP (9223),
# the X idle probe (9224) and PulseAudio (4713) from the agent, and the WebRTC mux port when configured.
```
```bash
for port in 9223 9224 4713; do
```

Nothing else in the entrypoint changes.

`apps/browser-slot/Dockerfile`, three edits:
1. In the `apt-get install` line, change `socat iptables;` to `socat iptables xprintidle;`.
2. Replace the `COPY --chmod=0755 …` line with:
```dockerfile
COPY --chmod=0755 bin/slot-entrypoint bin/exit-on-chromium bin/slot-health bin/slot-idle-http /usr/local/bin/
```
3. Replace the `ENV …` block with:
```dockerfile
# NEKO_LEGACY: the bundled client speaks the legacy /ws protocol.
# Cookie auth: web relays NEKO_SESSION scoped to /live/<runId>/; the legacy /ws handler
# authenticates with that cookie (whoami) before any password. n.eko's own Set-Cookie never
# reaches browsers (web re-issues the token), so it need not be Secure.
# Implicit hosting off and the user member unhosted (entrypoint): only the agent grants control.
# Chat off: the n.eko page is served same-origin, so it must render no attacker-controlled text (S4).
ENV NEKO_DESKTOP_SCREEN=1280x800@30 \
    NEKO_LOG_LEVEL=warn \
    NEKO_FILETRANSFER_ENABLED=false \
    NEKO_LEGACY=true \
    NEKO_SESSION_COOKIE_ENABLED=true \
    NEKO_SESSION_COOKIE_SECURE=false \
    NEKO_SESSION_IMPLICIT_HOSTING=false \
    NEKO_DESKTOP_FILE_CHOOSER_DIALOG=true \
    NEKO_DESKTOP_UPLOAD_DROP=true \
    NEKO_CHAT_ENABLED=false
```

- [ ] **Step 5: Run it and watch it pass.**

Run:
```bash
bash apps/browser-slot/test/verify.sh
docker build -q -t mastertutor/browser-slot:local apps/browser-slot
docker builder prune -f && docker image prune -f
```
Expected: every line `ok - …` (the Phase 0, B1 and A1 checks included), ending `browser-slot verify: all checks passed`. If "X idle time does not grow", Chromium is resetting the X screensaver timer: inspect with `docker exec … xprintidle` before changing code; never remove the check.

- [ ] **Step 6: Commit.**
```bash
git add apps/browser-slot
git commit -m "feat(browser-slot): legacy n.eko client with cookie auth, chat off, agent-only X idle probe"
```

---
### Task A6: n.eko admin client, `NekoLiveView`, idle-probe client (base Task 4, changed)

Changed from base Task 4: `giveControl` grants `can_host` only after the user's n.eko session is **connected** (a session that merely exists after `openLive`'s login is not a live view), which is what makes Review Focus 1 hold. Real-slot tests run on the B1 behaviour stack (F9, F12); `tests/support/slot.ts` is not written; timing uses `waitFor` (W5).

**Files:**
- Create: `apps/agent/src/live/live-view.ts`, `apps/agent/src/live/neko-admin.ts`, `apps/agent/src/live/neko-live-view.ts`, `apps/agent/src/live/idle-probe.ts`, `tests/behaviour/slot-tools.ts`
- Modify: `tests/behaviour/compose.yml`, `tests/behaviour/constants.ts`
- Test: `apps/agent/src/live/neko-admin.test.ts`, `apps/agent/src/live/neko-live-view.test.ts`, `apps/agent/src/live/neko-live-view.behaviour.test.ts`

**Interfaces:**
- Consumes: `loginNeko`, `deriveNekoPassword`, `NEKO_MEMBERS`, `NEKO_PORT`, `SLOT_IDLE_PORT`, `TAKEOVER_GIVE_WAIT_MS` (A3); the image from A1/A5.
- Produces:
  - `live-view.ts`: `interface Slot { readonly name: string }`; `interface LiveView { giveControl(slot: Slot, userId: string): Promise<void>; takeControl(slot: Slot): Promise<void>; setClipboardAccess(slot: Slot, on: boolean): Promise<void> }` (spec §10.1).
  - `neko-admin.ts`: `NekoApiError` (`status`, `path`); `NekoAdmin { request(slotName, method: "GET" | "POST" | "DELETE", path, body?): Promise<unknown>; forget(slotName): void }`; `createNekoAdmin({adminSecret, baseUrl?, fetch?, timeoutMs?})`.
  - `neko-live-view.ts`: `LiveViewError` (`code: "user_not_connected"`); `createNekoLiveView({admin, giveTimeoutMs?, retryDelayMs?}): LiveView`.
  - `idle-probe.ts`: `SlotIdleProbe { userIdleMs(slotName): Promise<number> }`; `createSlotIdleProbe({url?, fetch?, timeoutMs?})`.
  - `tests/behaviour/constants.ts`: `SLOT_NEKO`, `SLOT_IDLE`, `BEHAVIOUR_NEKO_ADMIN_SECRET`, `BEHAVIOUR_NEKO_MEMBER_SECRET`, `nekoBaseUrlForTests(name)`, `idleUrlForTests(name)`.
  - `tests/behaviour/slot-tools.ts`: `xdotool(slotName, ...args): Promise<string>`; `restartSlot(slotName): Promise<void>` (fresh boot profile, waits for CDP and n.eko).

- [ ] **Step 1: Publish n.eko and the idle probe on the behaviour stack (test only).**

In `tests/behaviour/compose.yml`:
- in `x-slot-env`, replace `NEKO_ALLOWED_IPS: 127.0.0.1` with `NEKO_ALLOWED_IPS: 0.0.0.0/0`, and extend the file's header comment with: `n.eko (8080) and the idle probe (9224) are published on 127.0.0.1 too, for the B6 live-view tests (F9); the same allow-all rule as CDP applies (F12).`;
- `browser-1`: `ports: ["127.0.0.1:19223:9223", "127.0.0.1:18091:8080", "127.0.0.1:18191:9224"]`;
- `browser-2`: `ports: ["127.0.0.1:19224:9223", "127.0.0.1:18092:8080", "127.0.0.1:18192:9224"]`.

Append to `tests/behaviour/constants.ts`:

```ts
/** n.eko and the X idle probe of each behaviour slot, published on loopback (compose.yml). */
export const SLOT_NEKO: Record<string, string> = {
  "browser-1": "http://127.0.0.1:18091",
  "browser-2": "http://127.0.0.1:18092",
};
export const SLOT_IDLE: Record<string, string> = {
  "browser-1": "http://127.0.0.1:18191/",
  "browser-2": "http://127.0.0.1:18192/",
};
/** The test-only n.eko secrets in compose.yml's x-slot-env (dummy values, never production). */
export const BEHAVIOUR_NEKO_ADMIN_SECRET = "behaviour-admin-secret-0123456789abcdef";
export const BEHAVIOUR_NEKO_MEMBER_SECRET = "behaviour-member-secret-0123456789abcde";

export function nekoBaseUrlForTests(name: string): string {
  const url = SLOT_NEKO[name];
  if (!url) throw new Error(`unknown behaviour slot ${name}`);
  return url;
}

export function idleUrlForTests(name: string): string {
  const url = SLOT_IDLE[name];
  if (!url) throw new Error(`unknown behaviour slot ${name}`);
  return url;
}
```

`tests/behaviour/slot-tools.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { COMPOSE_FILE, SLOT_CDP, nekoBaseUrlForTests } from "./constants.ts";

const run = promisify(execFile);
const compose = async (...args: string[]) =>
  (await run("docker", ["compose", "-f", COMPOSE_FILE, ...args], { maxBuffer: 10 * 1024 * 1024 }))
    .stdout;

/** XTest input on the slot's X display: the same path n.eko uses for the user's input. */
export function xdotool(slotName: string, ...args: string[]): Promise<string> {
  return compose("exec", "-T", "-u", "neko", "-e", "DISPLAY=:99.0", slotName, "xdotool", ...args);
}

const answers = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
    (response) => response.ok,
    () => false,
  );

/** Restarts a slot so it runs the boot profile again, then waits for CDP and n.eko. */
export async function restartSlot(slotName: string): Promise<void> {
  await compose("restart", slotName);
  await waitFor(
    async () =>
      (await answers(`${SLOT_CDP[slotName]}/json/version`)) &&
      (await answers(`${nekoBaseUrlForTests(slotName)}/health`)),
    { label: `${slotName} back after restart`, timeoutMs: 90_000, intervalMs: 500 },
  );
}
```

- [ ] **Step 2: Confirm n.eko's session list shape before relying on it.** Run:

```bash
docker build -q -t mastertutor/browser-slot:local apps/browser-slot
docker compose -f tests/behaviour/compose.yml up -d --wait browser-1
jar="$(mktemp)"
pw="$(printf '%s' browser-1 | openssl dgst -sha256 -hmac behaviour-admin-secret-0123456789abcdef -r | cut -d' ' -f1)"
curl -s -c "$jar" -H 'content-type: application/json' \
  -d "{\"username\":\"agent\",\"password\":\"$pw\"}" http://127.0.0.1:18091/api/login >/dev/null
curl -s -b "$jar" http://127.0.0.1:18091/api/sessions; echo
rm -f "$jar"
```

Expected: a JSON array whose `agent` entry has `"state":{… "is_connected":false …}`. `NekoLiveView` reads exactly `id` and `state.is_connected`. If the array or those fields are absent, stop and report `BLOCKED` with the output. Leave the stack up; `pnpm test:behaviour` reuses it with `KEEP_BEHAVIOUR_STACK=1`, otherwise it is recreated.

- [ ] **Step 3: Write the failing tests.**

`apps/agent/src/live/neko-admin.test.ts`: **copy verbatim from base plan Task 4, Step 2.**

`apps/agent/src/live/neko-live-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NekoApiError, type NekoAdmin } from "./neko-admin.ts";
import { LiveViewError, createNekoLiveView } from "./neko-live-view.ts";

function fakeAdmin(script: { connectedAfterPolls: number; giveFails404?: boolean }) {
  const calls: string[] = [];
  let polls = 0;
  const admin: NekoAdmin = {
    async request(_slot, method, path, body) {
      calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
      if (path === "/api/sessions") {
        polls += 1;
        const connected = polls > script.connectedAfterPolls;
        return [
          { id: "agent", state: { is_connected: false } },
          { id: "user", state: { is_connected: connected } },
        ];
      }
      if (path === "/api/room/control/give/user" && script.giveFails404)
        throw new NekoApiError(404, path);
      return null;
    },
    forget() {},
  };
  return { admin, calls };
}

const slot = { name: "browser-2" };

describe("NekoLiveView", () => {
  it("waits for the user's live view to connect, then grants hosting and gives control", async () => {
    const { admin, calls } = fakeAdmin({ connectedAfterPolls: 2 });
    await createNekoLiveView({ admin, retryDelayMs: 1 }).giveControl(slot, "user_1");
    expect(calls).toEqual([
      "GET /api/sessions",
      "GET /api/sessions",
      "GET /api/sessions",
      'POST /api/members/user {"can_host":true}',
      "POST /api/room/control/give/user",
    ]);
  });

  it("never grants hosting when the live view does not connect in time", async () => {
    const { admin, calls } = fakeAdmin({ connectedAfterPolls: 1_000 });
    const view = createNekoLiveView({ admin, giveTimeoutMs: 30, retryDelayMs: 5 });
    const error = await view.giveControl(slot, "user_1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveViewError);
    expect((error as LiveViewError).code).toBe("user_not_connected");
    expect(calls.some((c) => c.startsWith("POST /api/members/user"))).toBe(false);
  });

  it("revokes hosting again if the session vanished between the check and the give", async () => {
    const { admin, calls } = fakeAdmin({ connectedAfterPolls: 0, giveFails404: true });
    await expect(createNekoLiveView({ admin }).giveControl(slot, "user_1")).rejects.toBeInstanceOf(
      LiveViewError,
    );
    expect(calls.at(-1)).toBe('POST /api/members/user {"can_host":false}');
  });

  it("takes control as the agent before revoking the user's hosting right", async () => {
    const { admin, calls } = fakeAdmin({ connectedAfterPolls: 0 });
    const view = createNekoLiveView({ admin });
    await view.takeControl(slot);
    await view.setClipboardAccess(slot, true);
    expect(calls).toEqual([
      "POST /api/room/control/take",
      'POST /api/members/user {"can_host":false}',
      'POST /api/members/user {"can_access_clipboard":true}',
    ]);
  });
});
```

`apps/agent/src/live/neko-live-view.behaviour.test.ts`:

```ts
import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  BEHAVIOUR_NEKO_MEMBER_SECRET,
  idleUrlForTests,
  nekoBaseUrlForTests,
} from "../../../../tests/behaviour/constants.ts";
import { restartSlot, xdotool } from "../../../../tests/behaviour/slot-tools.ts";
import { waitFor } from "../testing/wait.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createNekoAdmin, type NekoAdmin } from "./neko-admin.ts";
import { LiveViewError, createNekoLiveView } from "./neko-live-view.ts";

const SLOT = "browser-1";
const slot = { name: SLOT };
const base = nekoBaseUrlForTests(SLOT);
let admin: NekoAdmin;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  // A fresh boot profile, whatever earlier behaviour files did to this slot's n.eko.
  await restartSlot(SLOT);
  admin = createNekoAdmin({ adminSecret: BEHAVIOUR_NEKO_ADMIN_SECRET, baseUrl: () => base });
});
afterAll(() => {
  for (const socket of sockets) socket.close();
});

const userToken = () =>
  loginNeko({
    baseUrl: base,
    username: "user",
    password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, SLOT),
  });
const asUser = (token: string, method: "GET" | "POST", path: string) =>
  fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}` } }).then(
    (response) => response.status,
  );
async function connectUser(token: string): Promise<WebSocket> {
  const socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
  });
  return socket;
}

describe("NekoLiveView against a real slot (spec §10.1)", () => {
  it("the user member cannot host at boot (A1)", async () => {
    const token = await userToken();
    expect(await asUser(token, "GET", "/api/whoami")).toBe(200);
    expect(await asUser(token, "POST", "/api/room/control/request")).toBe(403);
  });

  it("refuses to give control while the user's live view is not connected", async () => {
    await userToken(); // the session exists, as after openLive, but no websocket is open
    const view = createNekoLiveView({ admin, giveTimeoutMs: 500 });
    const started = Date.now();
    await expect(view.giveControl(slot, "user_1")).rejects.toBeInstanceOf(LiveViewError);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(await admin.request(SLOT, "GET", "/api/members/user")).toMatchObject({
      can_host: false,
    });
  });

  it("moves the n.eko host and the user's rights both ways once connected", async () => {
    const token = await userToken();
    const socket = await connectUser(token);
    const view = createNekoLiveView({ admin });
    await view.takeControl(slot);
    expect(await admin.request(SLOT, "GET", "/api/room/control")).toMatchObject({
      host_id: "agent",
    });

    await view.giveControl(slot, "user_1");
    await view.setClipboardAccess(slot, true);
    expect(await admin.request(SLOT, "GET", "/api/room/control")).toMatchObject({
      host_id: "user",
    });
    expect(await admin.request(SLOT, "GET", "/api/members/user")).toMatchObject({
      can_host: true,
      can_access_clipboard: true,
    });
    expect(await asUser(token, "GET", "/api/room/clipboard")).toBe(200);

    await view.takeControl(slot);
    await view.setClipboardAccess(slot, false);
    expect(await admin.request(SLOT, "GET", "/api/room/control")).toMatchObject({
      host_id: "agent",
    });
    expect(await admin.request(SLOT, "GET", "/api/members/user")).toMatchObject({
      can_host: false,
      can_access_clipboard: false,
    });
    expect(await asUser(token, "POST", "/api/room/control/request")).toBe(403);
    socket.close();
  });

  it("reads the X idle time, which XTest input resets", async () => {
    const probe = createSlotIdleProbe({ url: () => idleUrlForTests(SLOT) });
    await waitFor(async () => (await probe.userIdleMs(SLOT)) >= 1_000, {
      label: "X idle grows without input",
      timeoutMs: 10_000,
      intervalMs: 200,
    });
    await xdotool(SLOT, "mousemove", "211", "157");
    await waitFor(async () => (await probe.userIdleMs(SLOT)) < 800, {
      label: "XTest input resets X idle",
      timeoutMs: 5_000,
      intervalMs: 100,
    });
  });
});
```

- [ ] **Step 4: Run them and watch them fail.**

Run: `pnpm test apps/agent/src/live && pnpm test:behaviour apps/agent/src/live/neko-live-view.behaviour.test.ts`
Expected: FAIL: the `live/` modules do not exist.

- [ ] **Step 5: Implement.**

`apps/agent/src/live/live-view.ts`, `apps/agent/src/live/neko-admin.ts` and `apps/agent/src/live/idle-probe.ts`: **copy verbatim from base plan Task 4, Step 4.**

`apps/agent/src/live/neko-live-view.ts`:

```ts
import { NEKO_MEMBERS, TAKEOVER_GIVE_WAIT_MS } from "@mastertutor/contracts";
import type { LiveView, Slot } from "./live-view.ts";
import { NekoApiError, type NekoAdmin } from "./neko-admin.ts";

export class LiveViewError extends Error {
  readonly code: "user_not_connected";
  constructor(code: "user_not_connected") {
    super("The user's live view is not connected");
    this.name = "LiveViewError";
    this.code = code;
  }
}

export interface NekoLiveViewOptions {
  admin: NekoAdmin;
  /** How long giveControl waits for the user's n.eko websocket to be connected. */
  giveTimeoutMs?: number;
  retryDelayMs?: number;
}

interface NekoSession {
  id?: unknown;
  state?: { is_connected?: unknown };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The only LiveView (spec §10.1), over n.eko's admin REST API. The user member boots unhosted
 * (A1); giveControl grants can_host only once the user's live view is actually connected, so a
 * takeover with no live view fails instead of handing the browser to nobody.
 */
export function createNekoLiveView(options: NekoLiveViewOptions): LiveView {
  const { admin } = options;
  const user = NEKO_MEMBERS.user;
  const profile = (slot: Slot, patch: Record<string, boolean>) =>
    admin.request(slot.name, "POST", `/api/members/${user}`, patch);

  async function userConnected(slot: Slot): Promise<boolean> {
    const sessions = await admin.request(slot.name, "GET", "/api/sessions");
    return (
      Array.isArray(sessions) &&
      (sessions as NekoSession[]).some(
        (session) => session.id === user && session.state?.is_connected === true,
      )
    );
  }

  return {
    async giveControl(slot, _userId) {
      const deadline = Date.now() + (options.giveTimeoutMs ?? TAKEOVER_GIVE_WAIT_MS);
      while (!(await userConnected(slot))) {
        if (Date.now() >= deadline) throw new LiveViewError("user_not_connected");
        await sleep(options.retryDelayMs ?? 100);
      }
      await profile(slot, { can_host: true });
      try {
        await admin.request(slot.name, "POST", `/api/room/control/give/${user}`);
      } catch (error) {
        await profile(slot, { can_host: false }).catch(() => undefined);
        if (error instanceof NekoApiError && error.status === 404)
          throw new LiveViewError("user_not_connected");
        throw error;
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

- [ ] **Step 6: Run the tests.**

Run:
```bash
pnpm test apps/agent/src/live
pnpm test:behaviour apps/agent/src/live/neko-live-view.behaviour.test.ts
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
pnpm exec prettier --write apps/agent/src/live tests/behaviour
git add apps/agent/src/live tests/behaviour
git commit -m "feat(agent): NekoLiveView gives control only to a connected live view; slot idle probe client"
```

---

### Task A7: `openLive` — server-side n.eko login and the signed `live_slot` (base Task 5, changed)

Changed from base Task 5: no TURN (`iceServers: []`); drizzle `Database` instead of `sql`; the real-slot test moves to the behaviour stack (F9). `cookie.ts` and its unit test are unchanged.

**Files:**
- Create: `apps/web/lib/server/live/cookie.ts`, `apps/web/lib/server/live/open-live.ts`, `apps/web/lib/server/live/deps.ts`
- Test: `apps/web/lib/server/live/cookie.test.ts`, `tests/behaviour/live-open.behaviour.test.ts`

**Interfaces:**
- Consumes: `getRunForMember` (A4), `loginNeko`, `NekoLoginError`, `deriveNekoPassword`, `OpenLiveResult`, `liveEmbedPath`, `livePath`, cookie constants (A3); behaviour constants (A6); `seedMember`, `seedRun`, `leaseSlotForTest`, `releaseSlotForTest` (A4).
- Produces:
  - `cookie.ts` (unchanged from base Task 5): `LiveSlotClaim`, `signLiveSlot(secret, claim)`, `verifyLiveSlot(secret, value, expected): string | null`, `parseCookies(header): Map<string, string[]>`, `liveSetCookies(runId, cookies, maxAgeSeconds): string[]`.
  - `open-live.ts`: `LiveDeps {db: Database; nekoMemberSecret: string; liveCookieSecret: string; nekoBaseUrl?(slotName): string; fetch?: typeof fetch; nowSeconds?(): number}`; `LiveAccessError` (`code: "not_found" | "in_use" | "unavailable"`); `OpenLiveOutcome {result: OpenLiveResult; setCookies: string[]}`; `openLive(deps, {runId, userId}): Promise<OpenLiveOutcome>`.
  - `deps.ts`: `getLiveDeps(): LiveDeps` (memoized; reads `getWebEnv()` and `getDb()` on first call only).

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/server/live/cookie.test.ts`: **copy verbatim from base plan Task 5, Step 1.**

`tests/behaviour/live-open.behaviour.test.ts`:

```ts
import { LIVE_SLOT_COOKIE, NEKO_SESSION_COOKIE, liveEmbedPath } from "@mastertutor/contracts";
import { createDb, type DbHandle } from "@mastertutor/db";
import {
  leaseSlotForTest,
  releaseSlotForTest,
  seedMember,
  seedRun,
} from "@mastertutor/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { parseCookies, verifyLiveSlot } from "../../apps/web/lib/server/live/cookie.ts";
import {
  LiveAccessError,
  openLive,
  type LiveDeps,
} from "../../apps/web/lib/server/live/open-live.ts";
import { BEHAVIOUR_NEKO_MEMBER_SECRET, nekoBaseUrlForTests } from "./constants.ts";
import { behaviourEnv } from "./env.ts";

const SLOT = "browser-2";
const now = 1_700_000_000;
let owner: DbHandle;
let web: DbHandle;
let deps: LiveDeps;
let member: { userId: string; workspaceId: string };
let outsider: { userId: string; workspaceId: string };
const sockets: WebSocket[] = [];

beforeAll(async () => {
  const env = behaviourEnv();
  owner = createDb(env.ownerUrl, { max: 2 });
  web = createDb(env.webUrl, { max: 2 });
  member = await seedMember(owner.db);
  outsider = await seedMember(owner.db);
  deps = {
    db: web.db,
    nekoMemberSecret: BEHAVIOUR_NEKO_MEMBER_SECRET,
    liveCookieSecret: "live-cookie-secret-for-tests-0123456789",
    nekoBaseUrl: () => nekoBaseUrlForTests(SLOT),
    nowSeconds: () => now,
  };
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await releaseSlotForTest(owner.db, SLOT);
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close()]);
});

const cookieValue = (setCookies: string[], name: string) =>
  parseCookies(setCookies.map((c) => c.split(";")[0]!).join("; ")).get(name)![0]!;

describe("openLive against a real slot (spec §10.2.1)", () => {
  it("says sleeping when the run holds no slot", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId, status: "sleeping" });
    expect(await openLive(deps, { runId, userId: member.userId })).toEqual({
      result: { sleeping: true },
      setCookies: [],
    });
  });

  it("logs into n.eko server-side and returns run-scoped cookies, no ICE servers in v1", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, SLOT, runId);
    const { result, setCookies } = await openLive(deps, { runId, userId: member.userId });
    expect(result).toEqual({
      sleeping: false,
      slotName: SLOT,
      embedPath: liveEmbedPath(runId),
      iceServers: [],
    });
    expect(setCookies).toHaveLength(2);
    for (const cookie of setCookies) {
      expect(cookie).toContain(
        `; Path=/live/${runId}/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`,
      );
    }
    const slotValue = cookieValue(setCookies, LIVE_SLOT_COOKIE);
    expect(
      verifyLiveSlot(deps.liveCookieSecret, slotValue, {
        runId,
        userId: member.userId,
        nowSeconds: now,
      }),
    ).toBe(SLOT);
    const whoami = await fetch(`${nekoBaseUrlForTests(SLOT)}/api/whoami`, {
      headers: { cookie: `${NEKO_SESSION_COOKIE}=${cookieValue(setCookies, NEKO_SESSION_COOKIE)}` },
    });
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({ id: "user" });
    expect(JSON.stringify(setCookies)).not.toContain(BEHAVIOUR_NEKO_MEMBER_SECRET);
  });

  it("hides other workspaces' runs", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await expect(openLive(deps, { runId, userId: outsider.userId })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("reports in_use while another tab is connected, then recovers when it closes (base Review Focus 2)", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, SLOT, runId);
    const first = await openLive(deps, { runId, userId: member.userId });
    const token = cookieValue(first.setCookies, NEKO_SESSION_COOKIE);
    const socket = new WebSocket(
      `${nekoBaseUrlForTests(SLOT).replace("http", "ws")}/api/ws?token=${token}`,
    );
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("ws failed")));
    });
    const error = await openLive(deps, { runId, userId: member.userId }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveAccessError);
    expect((error as LiveAccessError).code).toBe("in_use");
    socket.close();
    await waitFor(
      () =>
        openLive(deps, { runId, userId: member.userId }).then(
          (r) => !r.result.sleeping,
          () => false,
        ),
      { label: "openLive after the other tab closed", timeoutMs: 15_000, intervalMs: 500 },
    );
  });

  it("reports unavailable when the slot does not answer", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, SLOT, runId);
    await expect(
      openLive(
        { ...deps, nekoBaseUrl: () => "http://127.0.0.1:9" },
        { runId, userId: member.userId },
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `pnpm test apps/web/lib/server/live && pnpm test:behaviour tests/behaviour/live-open.behaviour.test.ts`
Expected: FAIL: `./cookie.ts` and `./open-live.ts` are missing.

- [ ] **Step 3: Implement.**

`apps/web/lib/server/live/cookie.ts`: **copy verbatim from base plan Task 5, Step 3.**

`apps/web/lib/server/live/open-live.ts`:

```ts
import {
  LIVE_COOKIE_TTL_SECONDS,
  LIVE_SLOT_COOKIE,
  NEKO_MEMBERS,
  NEKO_PORT,
  NEKO_SESSION_COOKIE,
  OpenLiveResult,
  liveEmbedPath,
} from "@mastertutor/contracts";
import { NekoLoginError, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { getRunForMember, type Database } from "@mastertutor/db";
import { liveSetCookies, signLiveSlot } from "./cookie.ts";

export interface LiveDeps {
  db: Database;
  nekoMemberSecret: string;
  liveCookieSecret: string;
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
 * /live/<runId>/. v1 has no TURN (D42), so iceServers is empty.
 */
export async function openLive(
  deps: LiveDeps,
  input: { runId: string; userId: string },
): Promise<OpenLiveOutcome> {
  const run = await getRunForMember(deps.db, input.runId, input.userId);
  if (!run) throw new LiveAccessError("not_found");
  if (!run.slotLeased || run.slotName === null)
    return { result: { sleeping: true }, setCookies: [] };
  const slotName = run.slotName;

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
    expiresAt: (deps.nowSeconds ?? nowSeconds)() + LIVE_COOKIE_TTL_SECONDS,
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
    iceServers: [],
  });
  return { result, setCookies };
}
```

`apps/web/lib/server/live/deps.ts`:

```ts
import { getDb } from "../db.ts";
import { getWebEnv } from "../env.ts";
import type { LiveDeps } from "./open-live.ts";

let liveDeps: LiveDeps | undefined;

/** Built on first use, so importing the live router never reads env or opens the database. */
export function getLiveDeps(): LiveDeps {
  if (!liveDeps) {
    const env = getWebEnv();
    liveDeps = {
      db: getDb().db,
      nekoMemberSecret: env.NEKO_MEMBER_SECRET,
      liveCookieSecret: env.LIVE_COOKIE_SECRET,
    };
  }
  return liveDeps;
}
```

- [ ] **Step 4: Run the tests.**

Run:
```bash
pnpm test apps/web/lib/server/live
pnpm test:behaviour tests/behaviour/live-open.behaviour.test.ts
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
pnpm exec prettier --write apps/web/lib/server/live tests/behaviour
git add apps/web/lib/server/live tests/behaviour/live-open.behaviour.test.ts
git commit -m "feat(web): openLive with server-side n.eko login and a signed live_slot cookie"
```

---

### Task A8: `/api/live/auth` ForwardAuth (base Task 6, changed)

Changed from base Task 6: **no `NEKO_SESSION`, no entry** (S3): exactly one well-formed `NEKO_SESSION` is required, so every 200 replaces the browser's `Cookie` header and the Better Auth cookie never reaches n.eko; the base test that locked in the leak is flipped (W4). The session comes from the FE's `getViewer()` (E3), and fixture builds always answer 403.

**Files:**
- Create: `apps/web/lib/server/live/authorize.ts`, `apps/web/app/api/live/auth/route.ts`
- Replace: `apps/web/lib/server/live/deps.ts`
- Test: `apps/web/lib/server/live/authorize.test.ts`

**Interfaces:**
- Consumes: `parseCookies`, `verifyLiveSlot` (A7), `runIdFromLivePath`, `LIVE_SLOT_COOKIE`, `NEKO_SESSION_COOKIE` (A3), `canAccessLiveSlot` (A4), `getViewer`, `getWebEnv`, `getDb`.
- Produces:
  - `AuthorizeDeps {liveCookieSecret: string; canAccess(q: {runId; slotName; userId}): Promise<boolean>; nowSeconds?(): number}`;
  - `AuthorizeInput {forwardedUri: string | null; cookieHeader: string | null; userId: string | null}`;
  - `AuthorizeDecision = {allow: true; upstreamCookie: string} | {allow: false; status: 401 | 403}` (on allow, `upstreamCookie` is always `NEKO_SESSION=<token>`);
  - `authorizeLive(deps, input): Promise<AuthorizeDecision>`;
  - `getAuthorizeDeps(): AuthorizeDeps`;
  - route `GET /api/live/auth`: 200 with `Cookie: NEKO_SESSION=…` and `Cache-Control: no-store`, or 401/403.

- [ ] **Step 1: Write the failing test.** `apps/web/lib/server/live/authorize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { authorizeLive, type AuthorizeDeps } from "./authorize.ts";
import { signLiveSlot } from "./cookie.ts";

const secret = "live-cookie-secret-for-tests-0123456789";
const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const userId = "user_a";
const now = 1_700_000_000;
const SESSION = "better-auth.session_token=s3cr3t";
const NEKO = "NEKO_SESSION=tok123";
const slotCookie = (slotName: string, forRun = runId, forUser = userId) =>
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

const input = (
  cookies: string[],
  uri = `/live/${runId}/api/ws`,
  user: string | null = userId,
) => ({ forwardedUri: uri, cookieHeader: cookies.join("; ") || null, userId: user });

describe("authorizeLive (spec §10.2.2, §12 live-view auth)", () => {
  it("allows a signed cookie for the leased slot and forwards only NEKO_SESSION upstream", async () => {
    const d = deps({ "browser-1": runId });
    const decision = await authorizeLive(d, input([SESSION, slotCookie("browser-1"), NEKO]));
    expect(decision).toEqual({ allow: true, upstreamCookie: NEKO });
    expect(JSON.stringify(decision)).not.toContain("better-auth");
    expect(JSON.stringify(decision)).not.toContain("live_slot");
    expect(d.queries).toEqual([{ runId, slotName: "browser-1", userId }]);
  });

  it("refuses a request without an n.eko session, so the Better Auth cookie never reaches n.eko (S3)", async () => {
    const d = deps({ "browser-1": runId });
    expect(await authorizeLive(d, input([SESSION, slotCookie("browser-1")]))).toEqual({
      allow: false,
      status: 401,
    });
    expect(d.queries).toEqual([]);
  });

  it("refuses duplicate or malformed n.eko sessions", async () => {
    const d = deps({ "browser-1": runId });
    for (const neko of [
      [NEKO, "NEKO_SESSION=other"],
      ["NEKO_SESSION=a\r\nX: y"],
      ["NEKO_SESSION="],
      [`NEKO_SESSION=${"a".repeat(257)}`],
    ]) {
      expect(
        await authorizeLive(d, input([SESSION, slotCookie("browser-1"), ...neko])),
        neko.join("; "),
      ).toEqual({ allow: false, status: 401 });
    }
    expect(d.queries).toEqual([]);
  });

  it("rejects no session, bad paths, missing or forged slot cookies", async () => {
    const d = deps({ "browser-1": runId });
    const valid = slotCookie("browser-1");
    expect(await authorizeLive(d, input([valid, NEKO], undefined, null))).toEqual({
      allow: false,
      status: 401,
    });
    expect(await authorizeLive(d, input([valid, NEKO], "/api/auth/session"))).toEqual({
      allow: false,
      status: 403,
    });
    expect(await authorizeLive(d, input([NEKO]))).toEqual({ allow: false, status: 401 });
    const forged = valid.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(await authorizeLive(d, input([forged, NEKO]))).toEqual({ allow: false, status: 401 });
    expect(await authorizeLive(d, input([slotCookie("browser-1", runId, "user_b"), NEKO]))).toEqual({
      allow: false,
      status: 401,
    });
    expect(d.queries).toEqual([]);
  });

  it("rejects duplicate live_slot cookies so Traefik and auth can never disagree", async () => {
    const d = deps({ "browser-1": runId });
    expect(
      await authorizeLive(
        d,
        input([slotCookie("browser-1"), "live_slot=browser-2.1700000600.x", NEKO]),
      ),
    ).toEqual({ allow: false, status: 401 });
    expect(d.queries).toEqual([]);
  });

  it("rejects a slot leased to another run, an idle slot or a stale cookie", async () => {
    expect(
      await authorizeLive(deps({ "browser-1": "other-run" }), input([slotCookie("browser-1"), NEKO])),
    ).toEqual({ allow: false, status: 403 });
    expect(await authorizeLive(deps({}), input([slotCookie("browser-2"), NEKO]))).toEqual({
      allow: false,
      status: 403,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `pnpm test apps/web/lib/server/live/authorize.test.ts`
Expected: FAIL: `./authorize.ts` is missing.

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
  /** The signed-in user (getViewer), or null. */
  userId: string | null;
}

export type AuthorizeDecision =
  | { allow: true; upstreamCookie: string }
  | { allow: false; status: 401 | 403 };

const NEKO_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Spec §10.2.2: 200 only if the live_slot signature is valid, browser_slots[N].run_id equals the
 * path's run, and the user belongs to that run's workspace. Exactly one live_slot (the one Traefik
 * routed on) and exactly one well-formed NEKO_SESSION are accepted. Traefik copies the 200's
 * Cookie header over the browser's (authResponseHeaders), so n.eko only ever sees NEKO_SESSION;
 * without one there is nothing to replace the browser's cookies with, so the answer is 401 (S3).
 */
export async function authorizeLive(
  deps: AuthorizeDeps,
  input: AuthorizeInput,
): Promise<AuthorizeDecision> {
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
  const neko = cookies.get(NEKO_SESSION_COOKIE) ?? [];
  if (neko.length !== 1 || !NEKO_TOKEN.test(neko[0]!)) return { allow: false, status: 401 };
  if (!(await deps.canAccess({ runId, slotName, userId: input.userId })))
    return { allow: false, status: 403 };
  return { allow: true, upstreamCookie: `${NEKO_SESSION_COOKIE}=${neko[0]}` };
}
```

`apps/web/lib/server/live/deps.ts` (replace the whole file):

```ts
import { canAccessLiveSlot } from "@mastertutor/db";
import { getDb } from "../db.ts";
import { getWebEnv } from "../env.ts";
import type { AuthorizeDeps } from "./authorize.ts";
import type { LiveDeps } from "./open-live.ts";

let liveDeps: LiveDeps | undefined;
let authorizeDeps: AuthorizeDeps | undefined;

/** Built on first use, so importing the live router never reads env or opens the database. */
export function getLiveDeps(): LiveDeps {
  if (!liveDeps) {
    const env = getWebEnv();
    liveDeps = {
      db: getDb().db,
      nekoMemberSecret: env.NEKO_MEMBER_SECRET,
      liveCookieSecret: env.LIVE_COOKIE_SECRET,
    };
  }
  return liveDeps;
}

export function getAuthorizeDeps(): AuthorizeDeps {
  authorizeDeps ??= {
    liveCookieSecret: getWebEnv().LIVE_COOKIE_SECRET,
    canAccess: (query) => canAccessLiveSlot(getDb().db, query),
  };
  return authorizeDeps;
}
```

`apps/web/app/api/live/auth/route.ts`:

```ts
import { getWebEnv } from "@/lib/server/env.ts";
import { authorizeLive } from "@/lib/server/live/authorize.ts";
import { getAuthorizeDeps } from "@/lib/server/live/deps.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

/**
 * Traefik ForwardAuth for /live/<runId>/ (spec §10.2.2). Traefik copies this response's Cookie
 * header onto the upstream request (authResponseHeaders: Cookie), replacing the browser's, so
 * n.eko only ever receives NEKO_SESSION, never the Better Auth or live_slot cookies.
 */
export async function GET(request: Request): Promise<Response> {
  const headers = new Headers({ "cache-control": "no-store" });
  // A fixture build signs in a fake viewer; it must never authorize a real slot (E3).
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API)
    return new Response(null, { status: 403, headers });
  const viewer = await getViewer().catch(() => null);
  const decision = await authorizeLive(getAuthorizeDeps(), {
    forwardedUri: request.headers.get("x-forwarded-uri"),
    cookieHeader: request.headers.get("cookie"),
    userId: viewer?.id ?? null,
  });
  if (!decision.allow) return new Response(null, { status: decision.status, headers });
  headers.set("cookie", decision.upstreamCookie);
  return new Response(null, { status: 200, headers });
}
```

- [ ] **Step 4: Run the tests and the production build.**

Run:
```bash
pnpm test apps/web
pnpm typecheck && pnpm lint
pnpm --filter @mastertutor/web build
pnpm --filter @mastertutor/web check:bundle
```
Expected: PASS; the build lists `/api/live/auth` as dynamic (ƒ); `check:bundle` finds no fixture code.

- [ ] **Step 5: Commit.**
```bash
pnpm exec prettier --write apps/web/lib/server/live apps/web/app/api/live
git add apps/web/lib/server/live apps/web/app/api/live
git commit -m "feat(web): /api/live/auth ForwardAuth: one live_slot, one NEKO_SESSION, upstream cookie rewrite (S3)"
```

---

### Task A9: `runs.openLive`, `runs.takeControl`, `runs.handBack` on the FE `liveRouter` (base Task 7, replaced)

Replaces base Task 7 (E1, E2). There is one router: the frontend's `liveRouter` on `/api/rpc`, already behind `requireViewer`. This task fills its three `notWired` handlers and adds `ResponseHeadersPlugin` to the live handler so `openLive` can set cookies. No second `implement(apiContract)`, no `RequestHeadersPlugin`, no `sessionUserId`, no `getLiveProcedures`.

**Files:**
- Create: `apps/web/lib/server/live/procedures.ts`
- Modify (all on top of B3 E Task 4's edits): `apps/web/lib/server/rpc/live-os.ts`, `apps/web/lib/server/rpc/live-router.ts`, `apps/web/app/api/rpc/[[...rest]]/route.ts`
- Test: `apps/web/lib/server/live/procedures.int.test.ts`, `apps/web/lib/server/rpc/live-router.test.ts`

**Interfaces:**
- Consumes: `openLive`, `LiveAccessError`, `LiveDeps` (A7), `getLiveDeps` (A8's `deps.ts`), `requestTakeover`, `requestHandBack`, `ControlRequestResult` (A4), `RunRef`, `HandBackInput`, `OpenLiveResult`; B3 E Task 4's `liveOs`/`LiveContext` from `apps/web/lib/server/rpc/live-os.ts` (`live-router.ts` already imports `liveOs as os`; `route.ts` already imports `LiveContext` from `live-os.ts` and has B3's `isCrossSiteWrite` check, which stays).
- Produces:
  - `LiveHandlerContext {viewer: {id: string}; resHeaders?: Headers}`;
  - `createLiveHandlers(deps: () => LiveDeps): { openLive(input: RunRef, context): Promise<OpenLiveResult>; takeControl(input: RunRef, context): Promise<{ok: true}>; handBack(input: HandBackInput, context): Promise<{ok: true}> }`;
  - `LiveContext = SessionContext & ResponseHeadersPluginContext` (still exported from `live-os.ts`, widened here);
  - error mapping: `not_found` → `NOT_FOUND`; `in_use` → `CONFLICT`; `unavailable` → `SERVICE_UNAVAILABLE`; finished run → `CONFLICT`; `not_controller` (another member holds control) → `FORBIDDEN`; signed out → `UNAUTHORIZED` (from `requireViewer`).

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/server/live/procedures.int.test.ts`:

```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeNotify } from "@mastertutor/contracts";
import { createDb, type DbHandle } from "@mastertutor/db";
import {
  leaseSlotForTest,
  nextNotification,
  releaseSlotForTest,
  seedMember,
  seedRun,
  startTestDatabase,
  type TestDatabase,
} from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveDeps } from "./open-live.ts";
import { createLiveHandlers } from "./procedures.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let fakeNeko: Server;
let nekoStatus = 200;
let member: { userId: string; workspaceId: string };
let handlers: ReturnType<typeof createLiveHandlers>;

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1"] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  member = await seedMember(owner.db);
  fakeNeko = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (nekoStatus !== 200) return void res.writeHead(nekoStatus).end();
      res
        .writeHead(200, { "set-cookie": "NEKO_SESSION=faketoken; Path=/" })
        .end('{"id":"user"}');
    });
  });
  await new Promise<void>((resolve) => fakeNeko.listen(0, "127.0.0.1", resolve));
  const port = (fakeNeko.address() as AddressInfo).port;
  const deps: LiveDeps = {
    db: web.db,
    nekoMemberSecret: "neko-member-secret-for-tests-0123456789",
    liveCookieSecret: "live-cookie-secret-for-tests-0123456789",
    nekoBaseUrl: () => `http://127.0.0.1:${port}`,
  };
  handlers = createLiveHandlers(() => deps);
});
afterAll(async () => {
  fakeNeko?.close();
  await Promise.all([owner?.close(), web?.close()]);
  await testDb?.stop();
});

const as = (userId: string) => ({ viewer: { id: userId }, resHeaders: new Headers() });

describe("live handlers on liveRouter", () => {
  it("openLive sets both cookies through resHeaders", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, "browser-1", runId);
    const context = as(member.userId);
    expect(await handlers.openLive({ runId }, context)).toMatchObject({
      sleeping: false,
      slotName: "browser-1",
      iceServers: [],
    });
    expect(context.resHeaders.getSetCookie()).toHaveLength(2);
  });

  it("openLive refuses to run without ResponseHeadersPlugin", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await expect(
      handlers.openLive({ runId }, { viewer: { id: member.userId } }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("maps n.eko conflicts and outages to CONFLICT and SERVICE_UNAVAILABLE", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await releaseSlotForTest(owner.db, "browser-1");
    await leaseSlotForTest(owner.db, "browser-1", runId);
    nekoStatus = 422;
    await expect(handlers.openLive({ runId }, as(member.userId))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    nekoStatus = 500;
    await expect(handlers.openLive({ runId }, as(member.userId))).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    nekoStatus = 200;
  });

  it("takeControl and handBack drive the DB and NOTIFY, with NOT_FOUND and CONFLICT errors", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const takeover = await nextNotification(owner.sql, "run_control", () =>
      handlers.takeControl({ runId }, as(member.userId)),
    );
    expect(decodeNotify("run_control", takeover)).toEqual({ runId });
    const back = await nextNotification(owner.sql, "run_control", () =>
      handlers.handBack({ runId, note: "All yours" }, as(member.userId)),
    );
    expect(decodeNotify("run_control", back)).toEqual({ runId });
    const outsider = await seedMember(owner.db);
    await expect(handlers.takeControl({ runId }, as(outsider.userId))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const done = await seedRun(owner.db, { workspaceId: member.workspaceId, status: "cancelled" });
    await expect(
      handlers.handBack({ runId: done, note: null }, as(member.userId)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps another member's takeover or hand-back of a held run to FORBIDDEN", async () => {
    const holder = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const other = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await handlers.takeControl({ runId }, as(holder.userId));
    await expect(handlers.takeControl({ runId }, as(holder.userId))).resolves.toEqual({ ok: true });
    await expect(handlers.takeControl({ runId }, as(other.userId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      handlers.handBack({ runId, note: null }, as(other.userId)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

`apps/web/lib/server/rpc/live-router.test.ts`:

```ts
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { liveRouter } from "./live-router.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("liveRouter live-view procedures", () => {
  it("require a signed-in viewer (typed UNAUTHORIZED, never a bare 401)", async () => {
    const client = createRouterClient(liveRouter, { context: { viewer: null } });
    await expect(client.runs.openLive({ runId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(client.runs.takeControl({ runId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(client.runs.handBack({ runId, note: null })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `pnpm test apps/web/lib/server/rpc && pnpm test:int apps/web/lib/server/live/procedures.int.test.ts`
Expected: FAIL: `./procedures.ts` is missing.

- [ ] **Step 3: Implement.**

`apps/web/lib/server/live/procedures.ts`:

```ts
import type { HandBackInput, OpenLiveResult, RunRef } from "@mastertutor/contracts";
import { requestHandBack, requestTakeover, type ControlRequestResult } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { LiveAccessError, openLive, type LiveDeps } from "./open-live.ts";

/** What liveRouter's handlers receive after requireViewer; resHeaders comes from ResponseHeadersPlugin. */
export interface LiveHandlerContext {
  viewer: { id: string };
  resHeaders?: Headers;
}

function accessError(error: LiveAccessError): Error {
  switch (error.code) {
    case "not_found":
      return new ORPCError("NOT_FOUND", { message: "Run not found" });
    case "in_use":
      return new ORPCError("CONFLICT", { message: "The live view is open in another tab" });
    case "unavailable":
      return new ORPCError("SERVICE_UNAVAILABLE", {
        message: "The browser is not answering; retry shortly",
      });
  }
}

function controlError(result: Extract<ControlRequestResult, { ok: false }>): Error {
  switch (result.reason) {
    case "not_found":
      return new ORPCError("NOT_FOUND", { message: "Run not found" });
    case "finished":
      return new ORPCError("CONFLICT", { message: "The run has finished" });
    case "not_controller":
      return new ORPCError("FORBIDDEN", { message: "Another member is in control of this run" });
  }
}

/** runs.openLive / takeControl / handBack for the one RPC router (E1). deps is read per call. */
export function createLiveHandlers(deps: () => LiveDeps) {
  return {
    async openLive(input: RunRef, context: LiveHandlerContext): Promise<OpenLiveResult> {
      const resHeaders = context.resHeaders;
      if (!resHeaders)
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "runs.openLive needs ResponseHeadersPlugin",
        });
      try {
        const outcome = await openLive(deps(), { runId: input.runId, userId: context.viewer.id });
        for (const cookie of outcome.setCookies) resHeaders.append("set-cookie", cookie);
        return outcome.result;
      } catch (error) {
        if (error instanceof LiveAccessError) throw accessError(error);
        throw error;
      }
    },
    async takeControl(input: RunRef, context: LiveHandlerContext): Promise<{ ok: true }> {
      const result = await requestTakeover(deps().db, {
        runId: input.runId,
        userId: context.viewer.id,
      });
      if (!result.ok) throw controlError(result);
      return { ok: true };
    },
    async handBack(input: HandBackInput, context: LiveHandlerContext): Promise<{ ok: true }> {
      const result = await requestHandBack(deps().db, {
        runId: input.runId,
        userId: context.viewer.id,
        note: input.note,
      });
      if (!result.ok) throw controlError(result);
      return { ok: true };
    },
  };
}
```

`apps/web/lib/server/rpc/live-os.ts` (B3 E Task 4's file), replace `export type LiveContext = SessionContext;` with the following, and add `import type { ResponseHeadersPluginContext } from "@orpc/server/plugins";` to its imports:
```ts
/** The session's viewer plus resHeaders from ResponseHeadersPlugin (B6: openLive sets cookies). */
export type LiveContext = SessionContext & ResponseHeadersPluginContext;
```

`apps/web/lib/server/rpc/live-router.ts` (as B3 E Task 4 left it, importing `liveOs as os` from `./live-os.ts`), three edits:
1. Add to the imports:
```ts
import { getLiveDeps } from "../live/deps.ts";
import { createLiveHandlers } from "../live/procedures.ts";
```
2. Directly after B3's `const vault = createVaultProcedures({ sealer: getSealer, db: getDb });` line, add:
```ts
/** B6: the live view and the control lock (spec §10.2, §10.3). */
const live = createLiveHandlers(getLiveDeps);
```
3. In `runs`, replace the three `notWired` lines for `takeControl`, `handBack` and `openLive` with:
```ts
    takeControl: os.runs.takeControl.handler(({ input, context }) =>
      live.takeControl(input, context),
    ),
    handBack: os.runs.handBack.handler(({ input, context }) => live.handBack(input, context)),
    openLive: os.runs.openLive.handler(({ input, context }) => live.openLive(input, context)),
```

`apps/web/app/api/rpc/[[...rest]]/route.ts` (B3's `LiveContext` import from `live-os.ts` and its `isCrossSiteWrite` check stay as they are), two edits:
1. Add `import { ResponseHeadersPlugin } from "@orpc/server/plugins";` after the `RPCHandler` import.
2. Replace `liveHandler ??= new RPCHandler(liveRouter);` with:
```ts
  // openLive sets the live cookies through context.resHeaders (B6).
  liveHandler ??= new RPCHandler(liveRouter, { plugins: [new ResponseHeadersPlugin()] });
```

- [ ] **Step 4: Run the tests and the build.**

Run:
```bash
pnpm test apps/web
pnpm test:int apps/web/lib/server/live/procedures.int.test.ts
pnpm typecheck && pnpm lint
pnpm --filter @mastertutor/web build && pnpm --filter @mastertutor/web check:bundle
```
Expected: PASS. `lib/fixtures/router.test.ts` still passes (`settings.get` is still `NOT_IMPLEMENTED`), and so do B3's `same-origin.test.ts` and `vault.int.test.ts`.

- [ ] **Step 5: Commit.**
```bash
pnpm exec prettier --write apps/web/lib/server apps/web/app/api/rpc
git add apps/web/lib/server apps/web/app/api/rpc
git commit -m "feat(web): runs.openLive/takeControl/handBack on liveRouter, with ResponseHeadersPlugin"
```

---
### Task A10: User uploads through n.eko `upload/dialog` and `upload/drop` (base Task 10, changed)

Changed from base Task 10: a 401 (ForwardAuth: session ended) maps to `signed_out`, which F3 turns into its typed sign-in redirect; only 403 means `not_in_control` (E7). The real-slot test lives under `tests/behaviour/` and drives n.eko with raw admin `fetch`, never agent modules (E7). It opens the native chooser with a trusted CDP click and waits on n.eko's own dialog detection, not on the locale-dependent "Open File" title or `xdotool key space` (W5). The stub fixture page becomes a real file input.

**Files:**
- Create: `apps/web/lib/live/upload.ts`
- Replace: `tests/fixtures/sites/site/upload.html`
- Test: `apps/web/lib/live/upload.test.ts`, `tests/behaviour/live-upload.behaviour.test.ts`

**Interfaces:**
- Consumes: `livePath`, `VIEWPORT` (contracts); behaviour constants (A6).
- Produces (browser-safe, for F3): `UploadOutcome = "uploaded" | "no_file_dialog" | "not_in_control" | "signed_out" | "failed"`; `UploadOptions {base?, fetch?, headers?}`; `MAX_UPLOAD_FILES = 10`; `uploadToFileDialog(runId, files, options?)`; `dropFiles(runId, files, point, options?)`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/live/upload.test.ts`: **copy verbatim from base plan Task 10, Step 1**, then replace its status table with:
```ts
    for (const [status, outcome] of [
      [422, "no_file_dialog"],
      [403, "not_in_control"],
      [401, "signed_out"],
      [500, "failed"],
    ] as const) {
```

`tests/fixtures/sites/site/upload.html` (replace the stub):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>File input</title>
  </head>
  <body>
    <label for="file">Attach a file</label>
    <input id="file" type="file" />
  </body>
</html>
```

`tests/behaviour/live-upload.behaviour.test.ts`:

```ts
import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { uploadToFileDialog } from "../../apps/web/lib/live/upload.ts";
import {
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  BEHAVIOUR_NEKO_MEMBER_SECRET,
  SITE,
  SLOT_CDP,
  nekoBaseUrlForTests,
} from "./constants.ts";

const SLOT = "browser-2";
const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const base = nekoBaseUrlForTests(SLOT);
let adminToken = "";
let browser: Browser;
let page: Page;
let socket: WebSocket | undefined;

/** Raw n.eko admin calls: a web-side test never imports the agent's NekoLiveView (E7). */
async function admin(method: "GET" | "POST", path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`n.eko ${path} answered HTTP ${response.status}`);
}

beforeAll(async () => {
  adminToken = await loginNeko({
    baseUrl: base,
    username: "agent",
    password: deriveNekoPassword(BEHAVIOUR_NEKO_ADMIN_SECRET, SLOT),
  });
  browser = await chromium.connectOverCDP(SLOT_CDP[SLOT]!);
  const context = browser.contexts()[0]!;
  page = context.pages()[0] ?? (await context.newPage());
});
afterAll(async () => {
  await admin("POST", "/api/room/control/take").catch(() => undefined);
  await admin("POST", "/api/members/user", { can_host: false }).catch(() => undefined);
  socket?.close();
  await browser?.close(); // connectOverCDP: disconnects Playwright, the slot browser keeps running
});

describe("user uploads through n.eko (spec §10.2.8)", () => {
  it("fills an open file chooser only while the user holds control", async () => {
    const token = await loginNeko({
      baseUrl: base,
      username: "user",
      password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, SLOT),
    });
    socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve());
      socket!.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
    });
    const options = { base: `${base}/`, headers: { authorization: `Bearer ${token}` } };
    const file = () => new File(["hello"], "notes.txt", { type: "text/plain" });

    await admin("POST", "/api/room/control/take");
    expect(await uploadToFileDialog(runId, [file()], options)).toBe("not_in_control");
    expect(await uploadToFileDialog(runId, [file()], { base: `${base}/` })).toBe("signed_out");

    await admin("POST", "/api/members/user", { can_host: true });
    await admin("POST", "/api/room/control/give/user");
    expect(await uploadToFileDialog(runId, [file()], options)).toBe("no_file_dialog");

    await page.goto(`${SITE}/upload`);
    await page.bringToFront();
    // A trusted CDP click opens Chromium's native chooser (Playwright intercepts only with a
    // filechooser listener); n.eko detects the dialog itself, so no window title is matched.
    await page.click("#file");
    await waitFor(async () => (await uploadToFileDialog(runId, [file()], options)) === "uploaded", {
      label: "n.eko filled the open file chooser",
      timeoutMs: 15_000,
      intervalMs: 500,
    });
    expect(
      await waitFor(
        () =>
          page.evaluate(
            () => (document.querySelector("#file") as HTMLInputElement).files?.[0]?.name ?? null,
          ),
        { label: "file in the input", timeoutMs: 5_000 },
      ),
    ).toBe("notes.txt");
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `pnpm test apps/web/lib/live && pnpm test:behaviour tests/behaviour/live-upload.behaviour.test.ts`
Expected: FAIL: `./upload.ts` is missing.

- [ ] **Step 3: Implement.** `apps/web/lib/live/upload.ts`:

```ts
import { VIEWPORT, livePath } from "@mastertutor/contracts";

/** Browser-side helper for the run view (F3). Only the user uploads, and only while in control. */
export type UploadOutcome = "uploaded" | "no_file_dialog" | "not_in_control" | "signed_out" | "failed";

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

/** 401 is ForwardAuth's "session ended" (F3 redirects to sign-in); 403 is n.eko's "not the host". */
function outcome(status: number): UploadOutcome {
  if (status >= 200 && status < 300) return "uploaded";
  if (status === 422) return "no_file_dialog";
  if (status === 401) return "signed_out";
  if (status === 403) return "not_in_control";
  return "failed";
}

async function post(
  runId: string,
  endpoint: string,
  form: FormData,
  options: UploadOptions,
): Promise<UploadOutcome> {
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
export function uploadToFileDialog(
  runId: string,
  files: readonly File[],
  options: UploadOptions = {},
): Promise<UploadOutcome> {
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

- [ ] **Step 4: Run the tests.**

Run:
```bash
pnpm test apps/web/lib/live
pnpm test:behaviour tests/behaviour/live-upload.behaviour.test.ts
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
pnpm exec prettier --write apps/web/lib/live tests/behaviour tests/fixtures/sites/site/upload.html
git add apps/web/lib/live tests/behaviour/live-upload.behaviour.test.ts tests/fixtures/sites/site/upload.html
git commit -m "feat(web): user uploads through n.eko; 401 means signed out, 403 means not in control"
```

---

### Task A11: User-only downloads into Garage (base Task 9, replaced)

Replaces base Task 9 (F5, F6, S10). B1 approvals are bound to a model step, so an agent-initiated download has no approval home in v1. **Only the member holding control downloads; taking over is the approval** (recorded deviation). While the agent holds control a download is cancelled, its partial file removed, and the user sees `error{download_blocked}`. The ingestor attaches through `onLeased` (A12) on the lease's browser-level CDP session, which B6 sets **after** Playwright connected (last writer). The hash is streamed and the file is uploaded as a stream (S10). B1's release already deletes `/downloads/<runId>`, so `detach` only removes listeners.

**Files:**
- Create: `apps/agent/src/live/downloads.ts`, `tests/fixtures/sites/site/files/notes.txt`, `tests/fixtures/sites/site/files/notes-copy.txt`, `tests/fixtures/sites/site/files/doc.pdf` (E12)
- Replace: `tests/fixtures/sites/site/download.html`
- Modify: `packages/storage/src/s3.ts`, `apps/agent/src/testing/memory-storage.ts`, `tests/behaviour/compose.yml`, `tests/behaviour/constants.ts`, `tests/behaviour/global-setup.ts`, `tests/behaviour/harness.ts`
- Test: `apps/agent/src/live/downloads.test.ts`, `packages/storage/src/s3.int.test.ts` (one case), `tests/behaviour/live-downloads.behaviour.test.ts`

**Interfaces:**
- Consumes: `LeasedSlot` (A2); `readControlUser`, `emitRunEvent` (A2); `findAssetBySha`, `recordDownload` (A4); `objectKeys`, `safeFilename`, `Storage`.
- Produces:
  - `Storage.putFile(key: string, path: string, options: PutOptions): Promise<void>` (both implementations);
  - `MAX_DOWNLOAD_BYTES = 200 MiB`; `downloadMime(filename): string` (inert allowlist; anything else `application/octet-stream`);
  - `DownloadIngestorDeps {db: Database; storage: Storage; log: Log; slotRoot?: string; localRoot?: string; dirMode?: number; maxBytes?: number}`;
  - `DownloadIngestor {attach(slot: LeasedSlot): Promise<void>; detach(runId: string): Promise<void>}`; `createDownloadIngestor(deps)`;
  - events: `download_ready {downloadId, assetId, filename, bytes}`, `error{download_blocked}`, `error{download_too_large}`;
  - `tests/behaviour/constants.ts`: `BEHAVIOUR_DOWNLOADS_DIR`.

- [ ] **Step 1: Mount the downloads volume on the behaviour slots (test only), and add the fixtures.**

`tests/behaviour/constants.ts`, append:
```ts
/** Host folder mounted at /downloads in both behaviour slots (compose.yml); agent tests read it. */
export const BEHAVIOUR_DOWNLOADS_DIR = "/tmp/mastertutor-behaviour-downloads";
```

`tests/behaviour/compose.yml`: in the `x-slot` anchor add
```yaml
  volumes:
    # Same path as BEHAVIOUR_DOWNLOADS_DIR in constants.ts; global-setup creates it world-writable.
    - /tmp/mastertutor-behaviour-downloads:/downloads
```

`tests/behaviour/global-setup.ts`: add `import { chmodSync, mkdirSync } from "node:fs";`, import `BEHAVIOUR_DOWNLOADS_DIR` from `./constants.ts`, and as the first two lines of `setup`:
```ts
  // The slot entrypoint chowns /downloads to neko (uid 1000); 0777 keeps it writable for this host user.
  mkdirSync(BEHAVIOUR_DOWNLOADS_DIR, { recursive: true });
  chmodSync(BEHAVIOUR_DOWNLOADS_DIR, 0o777);
```

`tests/behaviour/harness.ts`: replace `downloadsDir: "/tmp/mastertutor-behaviour-downloads",` with `downloadsDir: BEHAVIOUR_DOWNLOADS_DIR,` and add `BEHAVIOUR_DOWNLOADS_DIR` to its import from `./constants.ts`.

`tests/fixtures/sites/site/download.html` (replace the stub):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Downloads</title>
  </head>
  <body>
    <a id="notes" href="/files/notes.txt" download>Download notes</a>
    <a id="copy" href="/files/notes-copy.txt" download>Download the same notes again</a>
  </body>
</html>
```

`tests/fixtures/sites/site/files/notes.txt` and `tests/fixtures/sites/site/files/notes-copy.txt`: both contain exactly the line `Hello from the fixture site` (identical bytes; the dedupe test relies on it).

- [ ] **Step 2: Write the failing tests.**

`apps/agent/src/live/downloads.test.ts`: **copy verbatim from base plan Task 9, Step 1** (`downloadMime`).

Append to `packages/storage/src/s3.int.test.ts`, inside `describe("Storage against Garage", …)` (add `import { mkdtemp, writeFile } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path";` at the top):

```ts
  it("streams a local file in with putFile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "putfile-"));
    const file = join(dir, "blob.bin");
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    await writeFile(file, bytes);
    await agent.putFile("downloads/00000000-0000-4000-8000-000000000001/blob.bin", file, {
      contentType: "application/octet-stream",
      sha256: "b".repeat(64),
    });
    expect(
      await agent.getBytes("downloads/00000000-0000-4000-8000-000000000001/blob.bin"),
    ).toEqual(bytes);
    expect(
      await agent.head("downloads/00000000-0000-4000-8000-000000000001/blob.bin"),
    ).toMatchObject({ bytes: bytes.length, sha256: "b".repeat(64) });
  });
```

`tests/behaviour/live-downloads.behaviour.test.ts`:

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunEvent } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { assets, createDb, downloads, runEvents, runs, type DbHandle } from "@mastertutor/db";
import {
  leaseSlotForTest,
  releaseSlotForTest,
  seedMember,
  seedRun,
} from "@mastertutor/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BrowserSession } from "../../apps/agent/src/browser/session.ts";
import {
  createDownloadIngestor,
  type DownloadIngestor,
} from "../../apps/agent/src/live/downloads.ts";
import { createMemoryStorage } from "../../apps/agent/src/testing/memory-storage.ts";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { BEHAVIOUR_DOWNLOADS_DIR, SITE, SLOT_CDP } from "./constants.ts";
import { behaviourEnv } from "./env.ts";

const SLOT = "browser-2";
const FIXTURE = fileURLToPath(new URL("../fixtures/sites/site/files/notes.txt", import.meta.url));
const log = createLogger({ service: "behaviour", level: "silent" });
const storage = createMemoryStorage();
let owner: DbHandle;
let agentDb: DbHandle;
let session: BrowserSession;
let ingestor: DownloadIngestor;
let member: { userId: string; workspaceId: string };
let current: string | null = null;

beforeAll(async () => {
  const env = behaviourEnv();
  owner = createDb(env.ownerUrl, { max: 2 });
  agentDb = createDb(env.agentUrl, { max: 4 });
  member = await seedMember(owner.db);
  // The real BrowserSession: Playwright connects first, then the ingestor sets the behaviour (F6).
  session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP[SLOT]!,
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
  });
  ingestor = createDownloadIngestor({
    db: agentDb.db,
    storage,
    log,
    localRoot: BEHAVIOUR_DOWNLOADS_DIR,
    dirMode: 0o777,
  });
});
afterEach(async () => {
  if (current) await ingestor.detach(current);
  current = null;
  await releaseSlotForTest(owner.db, SLOT);
});
afterAll(async () => {
  await session?.close();
  await Promise.all([owner?.close(), agentDb?.close()]);
});

async function leasedRun(controller: "agent" | "user"): Promise<string> {
  const runId = await seedRun(
    owner.db,
    controller === "user"
      ? { workspaceId: member.workspaceId, status: "waiting", waitReason: "takeover" }
      : { workspaceId: member.workspaceId },
  );
  if (controller === "user")
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: member.userId })
      .where(eq(runs.id, runId));
  await leaseSlotForTest(owner.db, SLOT, runId);
  await ingestor.attach({
    runId,
    workspaceId: member.workspaceId,
    slotName: SLOT,
    session,
    browserCdp: () => session.browserCdp(),
  });
  current = runId;
  return runId;
}
async function clickDownload(id: "notes" | "copy") {
  expect(await session.goto(`${SITE}/download`, new AbortController().signal)).toBe(true);
  await session.page.click(`#${id}`);
}
const rowsFor = (runId: string) =>
  owner.db.select().from(downloads).where(eq(downloads.runId, runId));
const eventsFor = async (runId: string): Promise<RunEvent[]> =>
  (
    await owner.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
  ).map((e) => e.payload);
const localFiles = (runId: string) =>
  readdir(join(BEHAVIOUR_DOWNLOADS_DIR, runId)).catch(() => [] as string[]);

describe("downloads (spec §10.2.9; v1: only the member in control downloads)", () => {
  it("ingests a download made while the user holds control", async () => {
    const runId = await leasedRun("user");
    await clickDownload("notes");
    const [row] = await waitFor(async () => {
      const rows = await rowsFor(runId);
      return rows.length === 1 ? rows : null;
    }, { label: "download recorded", timeoutMs: 15_000 });
    expect(row).toMatchObject({ filename: "notes.txt", approvedBy: member.userId });
    const [asset] = await owner.db.select().from(assets).where(eq(assets.id, row!.assetId!));
    expect(asset!.key).toMatch(new RegExp(`^downloads/${runId}/[0-9a-f]{12}-notes\\.txt$`));
    expect(asset!.mime).toBe("text/plain");
    expect(Buffer.from(storage.objects.get(asset!.key)!)).toEqual(await readFile(FIXTURE));
    expect(await eventsFor(runId)).toContainEqual({
      type: "download_ready",
      downloadId: row!.id,
      assetId: row!.assetId,
      filename: "notes.txt",
      bytes: (await readFile(FIXTURE)).length,
    });
    await waitFor(async () => (await localFiles(runId)).length === 0, {
      label: "local copy deleted",
    });
  });

  it("blocks a download while the agent holds control and leaves nothing behind (Review Focus 4)", async () => {
    const before = storage.objects.size;
    const runId = await leasedRun("agent");
    await clickDownload("notes");
    await waitFor(
      async () =>
        (await eventsFor(runId)).some((e) => e.type === "error" && e.code === "download_blocked"),
      { label: "download_blocked event", timeoutMs: 15_000 },
    );
    await waitFor(async () => (await localFiles(runId)).length === 0, {
      label: "partial file removed",
    });
    expect(await rowsFor(runId)).toHaveLength(0);
    expect(storage.objects.size).toBe(before);
  });

  it("stores identical content once and records both downloads", async () => {
    const runId = await leasedRun("user");
    await clickDownload("notes");
    await waitFor(async () => (await rowsFor(runId)).length === 1, { label: "first", timeoutMs: 15_000 });
    await clickDownload("copy");
    const rows = await waitFor(async () => {
      const all = await rowsFor(runId);
      return all.length === 2 ? all : null;
    }, { label: "second", timeoutMs: 15_000 });
    expect(rows[0]!.assetId).toBe(rows[1]!.assetId);
  });

  it("an inline PDF the agent opens is not a download (B5 capture path)", async () => {
    const before = storage.objects.size;
    const runId = await leasedRun("agent");
    await session.goto(`${SITE}/files/doc.pdf`, new AbortController().signal);
    await waitFor(() => session.page.url().endsWith("/doc.pdf"), { label: "PDF shown inline" });
    // Sentinel: a real download after the PDF. Events are ordered, so exactly one download_blocked
    // (the sentinel's) proves the inline PDF never started a download.
    await clickDownload("notes");
    await waitFor(
      async () =>
        (await eventsFor(runId)).some((e) => e.type === "error" && e.code === "download_blocked"),
      { label: "sentinel blocked", timeoutMs: 15_000 },
    );
    const blocked = (await eventsFor(runId)).filter(
      (e) => e.type === "error" && e.code === "download_blocked",
    );
    expect(blocked).toHaveLength(1);
    await waitFor(async () => (await localFiles(runId)).length === 0, { label: "nothing on disk" });
    expect(storage.objects.size).toBe(before);
  });
});
```

`tests/fixtures/sites/site/files/doc.pdf`: a one-page PDF served inline (nginx answers `.pdf` with `Content-Type: application/pdf` and no `Content-Disposition`). Generate it once and commit the bytes:

```bash
node -e '
const objs = ["<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  "<< /Length 41 >>\nstream\nBT /F1 18 Tf 20 60 Td (Fixture PDF) Tj ET\nendstream",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
let out = "%PDF-1.4\n"; const offsets = [];
objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = out.length;
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
require("node:fs").writeFileSync("tests/fixtures/sites/site/files/doc.pdf", out, "latin1");'
```

- [ ] **Step 3: Run them and watch them fail.**

Run:
```bash
pnpm test apps/agent/src/live/downloads.test.ts
pnpm test:int packages/storage/src/s3.int.test.ts
pnpm test:behaviour tests/behaviour/live-downloads.behaviour.test.ts
```
Expected: FAIL: `putFile` and `./downloads.ts` are missing.

- [ ] **Step 4: Implement.**

`packages/storage/src/s3.ts`:
- add `import { createReadStream } from "node:fs"; import { stat } from "node:fs/promises";` to the imports;
- in `interface Storage`, after `put`, add:
```ts
  /** Streams a local file in without buffering it (downloads up to 200 MiB, spec §10.2.9). */
  putFile(key: string, path: string, options: PutOptions): Promise<void>;
```
- in `createStorage`'s returned object, after `put`, add:
```ts
    async putFile(key, path, options) {
      assertKey(key);
      const { size } = await stat(path);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: createReadStream(path),
          ContentLength: size,
          ContentType: options.contentType,
          Metadata: options.sha256 ? { sha256: options.sha256 } : undefined,
        }),
      );
    },
```
If the Garage test fails with a checksum or `aws-chunked` error, add `requestChecksumCalculation: "WHEN_REQUIRED"` to the `new S3Client({…})` options (the other cases must keep passing) and note it in the report.

`apps/agent/src/testing/memory-storage.ts`: add `import { readFile } from "node:fs/promises";` and, after `put`, add:
```ts
    async putFile(key: string, path: string, options: PutOptions) {
      objects.set(key, new Uint8Array(await readFile(path)));
      types.set(key, options.contentType);
    },
```

`apps/agent/src/live/downloads.ts`:

```ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { RunEvent } from "@mastertutor/contracts";
import {
  emitRunEvent,
  findAssetBySha,
  readControlUser,
  recordDownload,
  type Database,
} from "@mastertutor/db";
import { objectKeys, safeFilename, type Storage } from "@mastertutor/storage";
import type { CDPSession } from "playwright-core";
import type { LeasedSlot } from "../loop/hooks.ts";
import type { Log } from "../runtime/types.ts";

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
  db: Database;
  storage: Storage;
  log: Log;
  /** Download folder root as the slot's Chromium sees it. */
  slotRoot?: string;
  /** The same volume as mounted in this process. */
  localRoot?: string;
  /** Mode for /downloads/<runId>; tests whose host user differs from the slot's need 0o777. */
  dirMode?: number;
  maxBytes?: number;
}

export interface DownloadIngestor {
  attach(slot: LeasedSlot): Promise<void>;
  detach(runId: string): Promise<void>;
}

interface Approved {
  filename: string;
  url: string;
  approvedBy: string;
}

const BLOCKED = "Downloads need you in control: take over, then download it.";

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Spec §10.2.9. Browser.setDownloadBehavior("allowAndName") writes <root>/<runId>/<guid>, never an
 * untrusted name. v1 (F6): a download is approved only by the member holding control when it
 * begins; otherwise it is cancelled and removed. Each decision is taken once, at begin, and
 * progress events wait for it, so a file that finishes instantly is never ingested unapproved
 * and never left on disk.
 */
export function createDownloadIngestor(deps: DownloadIngestorDeps): DownloadIngestor {
  const slotRoot = deps.slotRoot ?? "/downloads";
  const localRoot = deps.localRoot ?? "/downloads";
  const maxBytes = deps.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const attached = new Map<string, () => void>();
  const localFile = (runId: string, guid: string) => path.join(localRoot, runId, guid);
  const emit = (runId: string, event: RunEvent) =>
    deps.db.transaction((tx) => emitRunEvent(tx, runId, event));

  async function removeFile(runId: string, guid: string): Promise<void> {
    await rm(localFile(runId, guid), { force: true });
    await rm(`${localFile(runId, guid)}.crdownload`, { force: true });
  }

  async function decide(
    slot: LeasedSlot,
    cdp: CDPSession,
    guid: string,
    url: string,
    suggested: string,
  ): Promise<Approved | null> {
    const filename = safeFilename(suggested || "download");
    const approvedBy = await readControlUser(deps.db, slot.runId);
    if (approvedBy) return { filename, url: url.slice(0, 4_096), approvedBy };
    await cdp.send("Browser.cancelDownload", { guid }).catch(() => undefined);
    await removeFile(slot.runId, guid);
    await emit(slot.runId, {
      type: "error",
      code: "download_blocked",
      message: `${filename}: ${BLOCKED}`.slice(0, 500),
    });
    return null;
  }

  async function ingest(slot: LeasedSlot, guid: string, approved: Approved): Promise<void> {
    const file = localFile(slot.runId, guid);
    try {
      const { size } = await stat(file);
      if (size > maxBytes) {
        await emit(slot.runId, {
          type: "error",
          code: "download_too_large",
          message: `${approved.filename} is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB`.slice(0, 500),
        });
        return;
      }
      const sha256 = await sha256Of(file);
      const mime = downloadMime(approved.filename);
      const existing = await findAssetBySha(deps.db, slot.workspaceId, sha256);
      const key =
        existing?.key ?? objectKeys.download(slot.runId, `${sha256.slice(0, 12)}-${approved.filename}`);
      if (!existing) await deps.storage.putFile(key, file, { contentType: mime, sha256 });
      await deps.db.transaction(async (tx) => {
        const record = await recordDownload(tx, {
          runId: slot.runId,
          workspaceId: slot.workspaceId,
          filename: approved.filename,
          sha256,
          bucket: deps.storage.bucket,
          key,
          mime,
          bytes: size,
          sourceUrl: approved.url,
          approvedBy: approved.approvedBy,
        });
        await emitRunEvent(tx, slot.runId, {
          type: "download_ready",
          downloadId: record.downloadId,
          assetId: record.assetId,
          filename: approved.filename,
          bytes: size,
        });
      });
    } finally {
      await rm(file, { force: true });
    }
  }

  const failed = (runId: string, errorCode: string) => (error: unknown) =>
    deps.log.error(
      { runId, errorCode, err: error instanceof Error ? error.name : "unknown" },
      "download handling failed",
    );

  return {
    async attach(slot) {
      const dir = path.join(localRoot, slot.runId);
      await mkdir(dir, { recursive: true, mode: deps.dirMode ?? 0o700 });
      if (deps.dirMode !== undefined) await chmod(dir, deps.dirMode);
      const cdp = await slot.browserCdp();
      const decisions = new Map<string, Promise<Approved | null>>();
      const onBegin = (event: { guid: string; url: string; suggestedFilename: string }) => {
        decisions.set(
          event.guid,
          decide(slot, cdp, event.guid, event.url, event.suggestedFilename).catch((error) => {
            failed(slot.runId, "download_decision_failed")(error);
            return null;
          }),
        );
      };
      const onProgress = (event: { guid: string; state: "inProgress" | "completed" | "canceled" }) => {
        if (event.state === "inProgress") return;
        const decision = decisions.get(event.guid) ?? Promise.resolve(null);
        decisions.delete(event.guid);
        void decision
          .then((approved) =>
            event.state === "completed" && approved
              ? ingest(slot, event.guid, approved)
              : removeFile(slot.runId, event.guid),
          )
          .catch(failed(slot.runId, "download_ingest_failed"));
      };
      cdp.on("Browser.downloadWillBegin", onBegin);
      cdp.on("Browser.downloadProgress", onProgress);
      const behaviour = {
        behavior: "allowAndName" as const,
        downloadPath: path.posix.join(slotRoot, slot.runId),
        eventsEnabled: true,
      };
      // Browser-wide, and again for the default context in case Playwright set one for it on connect.
      await cdp.send("Browser.setDownloadBehavior", behaviour);
      const { targetInfos } = await cdp.send("Target.getTargets");
      const contextId = targetInfos.find((target) => target.type === "page")?.browserContextId;
      if (contextId)
        await cdp.send("Browser.setDownloadBehavior", { ...behaviour, browserContextId: contextId });
      attached.set(slot.runId, () => {
        cdp.off("Browser.downloadWillBegin", onBegin);
        cdp.off("Browser.downloadProgress", onProgress);
      });
    },
    async detach(runId) {
      // The CDP session belongs to the lease (BrowserSession); B1's release deletes the folder.
      attached.get(runId)?.();
      attached.delete(runId);
    },
  };
}
```

- [ ] **Step 5: Run the tests.**

Run:
```bash
pnpm test apps/agent/src/live/downloads.test.ts
pnpm test:int packages/storage
pnpm test:behaviour tests/behaviour/live-downloads.behaviour.test.ts
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
pnpm exec prettier --write apps/agent/src packages/storage tests/behaviour tests/fixtures/sites/site
git add apps/agent/src packages/storage tests/behaviour tests/fixtures/sites/site
git commit -m "feat(agent): user-only downloads streamed into Garage with download_ready (F6, S10)"
```

---

### Task A12: B6 live hooks — the n.eko side of B1's control lock (base Task 8, replaced)

Replaces base Task 8 (F2, F3, F4, S2, S11, S12). B6 implements **only** `hooks.control`, `onLeased` and `onLeaseEnding` (B3's `onReleased(runId)` stays the vault's). B1 keeps `run_control`, the guard, the abort, the status transitions and the `control` events. The ordering guarantees come from B1 (§3); these hooks add the n.eko side and fail closed:
- `onUserControl`: give (waits ≤ 1 s, or ≤ 15 s after a fresh lease) → clipboard on → begin B3's passkey enrolment (best effort, B3 E.8 note 1) → arm the idle hand-back. No connected live view: take the host back and return `takeover_failed` (B1 then reverts, A2); enrolment never begins.
- `onAgentControl`: disarm → take the host back (must succeed, or the run fails closed) → finish the enrolment (B3 seals what the user registered; best effort) → clipboard off.
- `onLeased`: remember the lease's `BrowserSession` and workspace for enrolment, seat the agent as host and attach downloads, both best effort within 1 s.
- `onLeaseEnding`: disarm, finish any open enrolment (best effort), detach downloads, and when the slot is really released take the host back within 1 s (S12).
- Idle: 15 minutes with no user input **since the takeover** → `returnControlToAgent` + `error{idle_hand_back}` + `NOTIFY run_control` in one transaction; B1's existing hand-back path does the rest (F4).

**Files:**
- Create: `apps/agent/src/live/idle-watch.ts`, `apps/agent/src/live/live-hooks.ts`
- Test: `apps/agent/src/live/idle-watch.test.ts`, `apps/agent/src/live/live-hooks.test.ts`

**Interfaces:**
- Consumes: `LiveView`, `LiveViewError`, `SlotIdleProbe` (A6); `DownloadIngestor` (A11); `RunHooks`, `LeasedSlot`, `ReleasedSlot`, `UserControlResult` (A2); `BrowserSession` (B1); `readControlUser`, `returnControlToAgent`, `notifyRunControl`, `emitRunEvent` (A2); `AUTO_HAND_BACK_IDLE_MS`, `TAKEOVER_RESTORE_WAIT_MS` (A3); structurally, B3 E's `PasskeyEnrolment` (Task 11), with no import from `apps/agent/src/vault`.
- Produces:
  - `IdleWatch {arm(slotName, runId): void; disarm(runId): void}`; `createIdleWatch({probe, limitMs, pollMs, onIdle(runId): Promise<void>, log, now?})`;
  - `LiveControlStore {controlUser(runId): Promise<string | null>; handBackIdle(runId): Promise<void>}`; `liveControlStore(db: Database): LiveControlStore`;
  - `PasskeyEnrolmentPort {begin(session: BrowserSession): Promise<unknown>; finish(handle: unknown, run: {workspaceId: string; runId: string}): Promise<number>}`;
  - `LiveHooksDeps {store; liveView; idleProbe; downloads; log; enrolment?: PasskeyEnrolmentPort; idleLimitMs?; idlePollMs?; restoreWaitMs?; nekoTimeoutMs?}`;
  - `LiveHooks = Pick<RunHooks, "control" | "onLeased" | "onLeaseEnding">`; `createLiveHooks(deps): LiveHooks`.

- [ ] **Step 1: Write the failing tests.**

`apps/agent/src/live/idle-watch.test.ts`:

```ts
import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import { waitFor } from "../testing/wait.ts";
import { createIdleWatch } from "./idle-watch.ts";

const log = createLogger({ service: "test", level: "silent" });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("idle hand-back watch (spec §5.1)", () => {
  it("counts from the takeover, even when the X idle time was already huge (Review Focus 2)", async () => {
    const calls: number[] = [];
    const watch = createIdleWatch({
      probe: { userIdleMs: async () => 99_000_000 },
      limitMs: 80,
      pollMs: 10,
      log,
      onIdle: async () => void calls.push(performance.now()),
    });
    const armedAt = performance.now();
    watch.arm("browser-1", "run-1");
    await waitFor(() => calls.length === 1, { label: "idle hand-back", timeoutMs: 2_000 });
    expect(calls[0]! - armedAt).toBeGreaterThanOrEqual(80);
    await pause(60);
    expect(calls).toHaveLength(1);
  });

  it("never hands back while the user keeps giving input", async () => {
    const calls: string[] = [];
    const watch = createIdleWatch({
      probe: { userIdleMs: async () => 5 },
      limitMs: 40,
      pollMs: 10,
      log,
      onIdle: async (runId) => void calls.push(runId),
    });
    watch.arm("browser-1", "run-2");
    await pause(200);
    watch.disarm("run-2");
    expect(calls).toEqual([]);
  });

  it("keeps watching through probe failures and retries a failed hand-back", async () => {
    let probes = 0;
    let attempts = 0;
    const watch = createIdleWatch({
      probe: {
        userIdleMs: async () => {
          probes += 1;
          if (probes <= 3) throw new Error("slot busy");
          return 99_000_000;
        },
      },
      limitMs: 30,
      pollMs: 10,
      log,
      onIdle: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("db blip");
      },
    });
    watch.arm("browser-1", "run-3");
    await waitFor(() => attempts === 2, { label: "second attempt", timeoutMs: 2_000 });
    await pause(60);
    expect(attempts).toBe(2);
  });

  it("stops when disarmed", async () => {
    const calls: string[] = [];
    const watch = createIdleWatch({
      probe: { userIdleMs: async () => 99_000_000 },
      limitMs: 50,
      pollMs: 10,
      log,
      onIdle: async (runId) => void calls.push(runId),
    });
    watch.arm("browser-1", "run-4");
    watch.disarm("run-4");
    await pause(150);
    expect(calls).toEqual([]);
  });
});
```

`apps/agent/src/live/live-hooks.test.ts`:

```ts
import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { waitFor } from "../testing/wait.ts";
import type { DownloadIngestor } from "./downloads.ts";
import { createLiveHooks, type LiveControlStore, type PasskeyEnrolmentPort } from "./live-hooks.ts";
import type { LiveView } from "./live-view.ts";
import { LiveViewError } from "./neko-live-view.ts";

const log = createLogger({ service: "test", level: "silent" });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SLOT = "browser-1";
const RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function harness(
  options: {
    /** How many giveControl calls fail with "not connected" first (Infinity: never connects). */
    notConnectedFor?: number;
    take?: "ok" | "fails" | "hangs";
    controlUser?: string | null;
    restoreWaitMs?: number;
    /** Wire a fake B3 passkey enrolment; "begin-fails" makes begin reject. */
    enrolment?: "ok" | "begin-fails";
  } = {},
) {
  const calls: string[] = [];
  let failures = options.notConnectedFor ?? 0;
  let idleMs = 0;
  const liveView: LiveView = {
    async giveControl(slot, userId) {
      calls.push(`give ${slot.name} ${userId}`);
      if (failures > 0) {
        failures -= 1;
        throw new LiveViewError("user_not_connected");
      }
    },
    async takeControl(slot) {
      calls.push(`take ${slot.name}`);
      if (options.take === "hangs") await new Promise(() => undefined);
      if (options.take === "fails") throw new Error("n.eko down");
    },
    async setClipboardAccess(_slot, on) {
      calls.push(`clipboard ${on}`);
    },
  };
  const store: LiveControlStore = {
    controlUser: async () => (options.controlUser === undefined ? "user_1" : options.controlUser),
    handBackIdle: async (runId) => void calls.push(`idle hand-back ${runId}`),
  };
  const downloads: DownloadIngestor = {
    attach: async (slot) => void calls.push(`attach ${slot.runId}`),
    detach: async (runId) => void calls.push(`detach ${runId}`),
  };
  const enrolment: PasskeyEnrolmentPort = {
    async begin(session) {
      calls.push(`enrol begin ${session === SESSION}`);
      if (options.enrolment === "begin-fails") throw new Error("CDP gone");
      return "handle-1";
    },
    async finish(handle, run) {
      calls.push(`enrol finish ${String(handle)} ${run.workspaceId} ${run.runId}`);
      return 1;
    },
  };
  const hooks = createLiveHooks({
    store,
    liveView,
    idleProbe: { userIdleMs: async () => idleMs },
    downloads,
    log,
    ...(options.enrolment ? { enrolment } : {}),
    idleLimitMs: 50,
    idlePollMs: 10,
    restoreWaitMs: options.restoreWaitMs ?? 2_000,
    nekoTimeoutMs: 100,
  });
  return { hooks, calls, userGoesIdle: () => (idleMs = 99_000_000) };
}

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
/** Enrolment only passes the session through to B3; identity is all the test checks. */
const SESSION = {} as BrowserSession;
const leased = {
  runId: RUN,
  workspaceId: WORKSPACE,
  slotName: SLOT,
  session: SESSION,
  browserCdp: () => Promise.reject(new Error("unused")),
};

describe("createLiveHooks: the n.eko side of B1's control lock", () => {
  it("gives control to a connected live view, turns the clipboard on, then arms the idle hand-back", async () => {
    const { hooks, calls, userGoesIdle } = harness();
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
    expect(calls).toEqual([`give ${SLOT} user_1`, "clipboard true"]);
    userGoesIdle();
    await waitFor(() => calls.includes(`idle hand-back ${RUN}`), { label: "idle hand-back" });
  });

  it("fails the takeover and seats the agent again when no live view is connected (Review Focus 1)", async () => {
    const { hooks, calls, userGoesIdle } = harness({ notConnectedFor: Infinity });
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: false,
      code: "takeover_failed",
    });
    expect(calls).toEqual([`give ${SLOT} user_1`, `take ${SLOT}`]);
    userGoesIdle();
    await pause(100);
    expect(calls).not.toContain(`idle hand-back ${RUN}`);
  });

  it("keeps trying for the live view when the takeover arrives with a fresh lease", async () => {
    const { hooks, calls } = harness({ notConnectedFor: 3 });
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: true })).toEqual({
      ok: true,
    });
    expect(calls.filter((c) => c.startsWith("give"))).toHaveLength(4);
  });

  it("gives up after the restore wait", async () => {
    const { hooks } = harness({ notConnectedFor: Infinity, restoreWaitMs: 50 });
    const started = performance.now();
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: true })).toEqual({
      ok: false,
      code: "takeover_failed",
    });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("leaves n.eko alone when control was already handed back", async () => {
    const { hooks, calls } = harness({ controlUser: null });
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
    expect(calls).toEqual([]);
  });

  it("hand back disarms the idle watch, takes the host back, then turns the clipboard off", async () => {
    const { hooks, calls, userGoesIdle } = harness();
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.slice(-2)).toEqual([`take ${SLOT}`, "clipboard false"]);
    userGoesIdle();
    await pause(100);
    expect(calls).not.toContain(`idle hand-back ${RUN}`);
  });

  it("hand back fails closed when n.eko cannot take the host back", async () => {
    const { hooks } = harness({ take: "fails" });
    await expect(hooks.control.onAgentControl(SLOT, RUN)).rejects.toThrow("n.eko down");
  });

  it("onLeased seats the agent and attaches downloads, and never fails the lease", async () => {
    const { hooks, calls } = harness({ take: "fails" });
    await hooks.onLeased(leased);
    expect(calls).toEqual(expect.arrayContaining([`take ${SLOT}`, `attach ${RUN}`]));
  });

  it("onLeaseEnding takes the host back within the bound even if n.eko hangs (Review Focus 5, S12)", async () => {
    const { hooks, calls } = harness({ take: "hangs" });
    const started = performance.now();
    await hooks.onLeaseEnding({ runId: RUN, slotName: SLOT, slotReleased: true });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(calls).toEqual([`detach ${RUN}`, `take ${SLOT}`]);
  });

  it("an unreleased stop only cleans up and never touches n.eko", async () => {
    const { hooks, calls } = harness();
    await hooks.onLeaseEnding({ runId: RUN, slotName: SLOT, slotReleased: false });
    expect(calls).toEqual([`detach ${RUN}`]);
  });
});

describe("createLiveHooks: B3 passkey enrolment during takeover (B3 E.8 note 1)", () => {
  it("begins enrolment after a successful give and finishes it on hand-back", async () => {
    const { hooks, calls } = harness({ enrolment: "ok" });
    await hooks.onLeased(leased);
    calls.length = 0;
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    expect(calls).toEqual([`give ${SLOT} user_1`, "clipboard true", "enrol begin true"]);
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.slice(3)).toEqual([
      `take ${SLOT}`,
      `enrol finish handle-1 ${WORKSPACE} ${RUN}`,
      "clipboard false",
    ]);
    // A second hand-back has nothing left to seal.
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.filter((c) => c.startsWith("enrol finish"))).toHaveLength(1);
  });

  it("a failed give never begins enrolment", async () => {
    const { hooks, calls } = harness({ enrolment: "ok", notConnectedFor: Infinity });
    await hooks.onLeased(leased);
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.some((c) => c.startsWith("enrol"))).toBe(false);
  });

  it("a failing begin never fails the takeover, and leaves nothing to finish", async () => {
    const { hooks, calls } = harness({ enrolment: "begin-fails" });
    await hooks.onLeased(leased);
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
    await hooks.control.onAgentControl(SLOT, RUN);
    expect(calls.some((c) => c.startsWith("enrol finish"))).toBe(false);
  });

  it("a lease ending during takeover finishes enrolment, then forgets the lease", async () => {
    const { hooks, calls } = harness({ enrolment: "ok" });
    await hooks.onLeased(leased);
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    await hooks.onLeaseEnding({ runId: RUN, slotName: SLOT, slotReleased: true });
    expect(calls).toContain(`enrol finish handle-1 ${WORKSPACE} ${RUN}`);
    calls.length = 0;
    await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false });
    expect(calls.some((c) => c.startsWith("enrol"))).toBe(false);
  });

  it("without a session (fake browser) or without the vault, takeover still works", async () => {
    const { hooks, calls } = harness({ enrolment: "ok" });
    await hooks.onLeased({ ...leased, session: null });
    expect(await hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
    expect(calls.some((c) => c.startsWith("enrol"))).toBe(false);
    const plain = harness();
    await plain.hooks.onLeased(leased);
    expect(await plain.hooks.control.onUserControl(SLOT, RUN, { afterRestore: false })).toEqual({
      ok: true,
    });
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `pnpm test apps/agent/src/live`
Expected: FAIL: `./idle-watch.ts` and `./live-hooks.ts` are missing.

- [ ] **Step 3: Implement.**

`apps/agent/src/live/idle-watch.ts`:

```ts
import type { Log } from "../runtime/types.ts";
import type { SlotIdleProbe } from "./idle-probe.ts";

export interface IdleWatchDeps {
  probe: SlotIdleProbe;
  limitMs: number;
  pollMs: number;
  /** Returns control to the agent; a throw is retried on the next poll. */
  onIdle(runId: string): Promise<void>;
  log: Log;
  now?: () => number;
}

export interface IdleWatch {
  arm(slotName: string, runId: string): void;
  disarm(runId: string): void;
}

/**
 * Spec §5.1: a takeover ends after limitMs with no user input. The slot's X idle time counts
 * only the user's input (n.eko injects it through XTest; CDP never touches X), and it is capped
 * by the time since the takeover, so the minutes before the user took over never count.
 */
export function createIdleWatch(deps: IdleWatchDeps): IdleWatch {
  const now = deps.now ?? (() => performance.now());
  const timers = new Map<string, NodeJS.Timeout>();
  const disarm = (runId: string) => {
    clearInterval(timers.get(runId));
    timers.delete(runId);
  };
  return {
    arm(slotName, runId) {
      disarm(runId);
      const since = now();
      let checking = false;
      const timer: NodeJS.Timeout = setInterval(() => {
        if (checking) return;
        checking = true;
        deps.probe
          .userIdleMs(slotName)
          .then(async (idleMs) => {
            if (timers.get(runId) !== timer) return;
            if (Math.min(idleMs, now() - since) < deps.limitMs) return;
            await deps.onIdle(runId);
            if (timers.get(runId) === timer) disarm(runId);
          })
          .catch(() =>
            deps.log.warn({ runId, errorCode: "idle_hand_back_retry" }, "idle check failed"),
          )
          .finally(() => {
            checking = false;
          });
      }, deps.pollMs);
      timer.unref();
      timers.set(runId, timer);
    },
    disarm,
  };
}
```

`apps/agent/src/live/live-hooks.ts`:

```ts
import { AUTO_HAND_BACK_IDLE_MS, TAKEOVER_RESTORE_WAIT_MS } from "@mastertutor/contracts";
import {
  emitRunEvent,
  notifyRunControl,
  readControlUser,
  returnControlToAgent,
  type Database,
} from "@mastertutor/db";
import type { BrowserSession } from "../browser/session.ts";
import type { RunHooks, UserControlResult } from "../loop/hooks.ts";
import type { Log } from "../runtime/types.ts";
import type { DownloadIngestor } from "./downloads.ts";
import type { SlotIdleProbe } from "./idle-probe.ts";
import { createIdleWatch } from "./idle-watch.ts";
import type { LiveView } from "./live-view.ts";
import { LiveViewError } from "./neko-live-view.ts";

const IDLE_MESSAGE = "Control went back to the agent after 15 minutes without input.";
const FAILED: UserControlResult = { ok: false, code: "takeover_failed" };
const RETRY_MS = 100;

/** The two run-row facts the live hooks need; liveControlStore is the database implementation. */
export interface LiveControlStore {
  /** The member holding control, or null once the agent holds it again. */
  controlUser(runId: string): Promise<string | null>;
  /** Idle hand-back: control → agent, a notice for the user, NOTIFY run_control (B1 does the rest). */
  handBackIdle(runId: string): Promise<void>;
}

export function liveControlStore(db: Database): LiveControlStore {
  return {
    controlUser: (runId) => readControlUser(db, runId),
    handBackIdle: (runId) =>
      db.transaction(async (tx) => {
        if (!(await returnControlToAgent(tx, runId))) return;
        await emitRunEvent(tx, runId, { type: "error", code: "idle_hand_back", message: IDLE_MESSAGE });
        await notifyRunControl(tx, runId);
      }),
  };
}

/**
 * B3's passkey enrolment (E.8 note 1), described structurally so the live view never imports the
 * vault: `main.ts` passes `vault.enrolment`. Registrations the user makes during a takeover land
 * in the authenticator begin() installs; finish() seals them and removes it.
 */
export interface PasskeyEnrolmentPort {
  begin(session: BrowserSession): Promise<unknown>;
  finish(handle: unknown, run: { workspaceId: string; runId: string }): Promise<number>;
}

export interface LiveHooksDeps {
  store: LiveControlStore;
  liveView: LiveView;
  idleProbe: SlotIdleProbe;
  downloads: DownloadIngestor;
  log: Log;
  /** Absent in tests that run without the vault. */
  enrolment?: PasskeyEnrolmentPort;
  idleLimitMs?: number;
  idlePollMs?: number;
  /** Patience for a takeover that arrives with a fresh lease (the iframe is still reconnecting). */
  restoreWaitMs?: number;
  /** Bound on the best-effort n.eko calls at lease and release. */
  nekoTimeoutMs?: number;
}

export type LiveHooks = Pick<RunHooks, "control" | "onLeased" | "onLeaseEnding">;

/** Per-lease facts enrolment needs; handle is set while an enrolment is open. */
interface Lease {
  session: BrowserSession | null;
  workspaceId: string;
  handle?: unknown;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** B6's RunHooks: the n.eko side of B1's control lock, plus downloads (spec §10.1–10.3). */
export function createLiveHooks(deps: LiveHooksDeps): LiveHooks {
  const restoreWaitMs = deps.restoreWaitMs ?? TAKEOVER_RESTORE_WAIT_MS;
  const nekoTimeoutMs = deps.nekoTimeoutMs ?? 1_000;
  const idle = createIdleWatch({
    probe: deps.idleProbe,
    limitMs: deps.idleLimitMs ?? AUTO_HAND_BACK_IDLE_MS,
    pollMs: deps.idlePollMs ?? 30_000,
    onIdle: (runId) => deps.store.handBackIdle(runId),
    log: deps.log,
  });
  const leases = new Map<string, Lease>();

  /** Best effort: begin B3's enrolment on the leased page session; a failure never fails the takeover. */
  async function beginEnrolment(runId: string): Promise<void> {
    const lease = leases.get(runId);
    if (!lease?.session || !deps.enrolment) return;
    lease.handle = await deps.enrolment.begin(lease.session).catch((): undefined => {
      deps.log.warn({ runId, errorCode: "enrolment_begin_failed" }, "passkey enrolment");
      return undefined;
    });
  }

  /** Best effort: seal what the user enrolled and close the enrolment (at most once per begin). */
  async function finishEnrolment(runId: string): Promise<void> {
    const lease = leases.get(runId);
    if (lease?.handle === undefined || !deps.enrolment) return;
    const handle = lease.handle;
    lease.handle = undefined;
    await deps.enrolment
      .finish(handle, { workspaceId: lease.workspaceId, runId })
      .catch(() => deps.log.warn({ runId, errorCode: "enrolment_finish_failed" }, "passkey enrolment"));
  }

  /**
   * Best effort within nekoTimeoutMs: the agent's admin session becomes n.eko host and the user
   * loses can_host. Retried, because n.eko may still be starting right after a slot restart.
   */
  async function seatAgent(slotName: string, runId: string, errorCode: string): Promise<void> {
    const deadline = performance.now() + nekoTimeoutMs;
    for (;;) {
      try {
        const left = Math.max(1, deadline - performance.now());
        await withTimeout(deps.liveView.takeControl({ name: slotName }), left);
        return;
      } catch {
        if (performance.now() >= deadline - RETRY_MS) {
          deps.log.warn({ runId, errorCode }, "n.eko host not reset");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }

  async function give(
    slotName: string,
    runId: string,
    userId: string,
    patienceMs: number,
  ): Promise<boolean> {
    const deadline = performance.now() + patienceMs;
    for (;;) {
      try {
        await deps.liveView.giveControl({ name: slotName }, userId);
        return true;
      } catch (error) {
        if (!(error instanceof LiveViewError) || performance.now() >= deadline) {
          deps.log.warn(
            { runId, errorCode: error instanceof LiveViewError ? error.code : "neko_give_failed" },
            "takeover not delivered",
          );
          return false;
        }
      }
    }
  }

  return {
    control: {
      async onUserControl(slotName, runId, { afterRestore }) {
        let userId: string | null;
        try {
          userId = await deps.store.controlUser(runId);
        } catch {
          return FAILED;
        }
        // Handed back before n.eko was touched: nothing to give; B1 hands back next.
        if (userId === null) return { ok: true };
        if (!(await give(slotName, runId, userId, afterRestore ? restoreWaitMs : 0))) {
          await seatAgent(slotName, runId, "neko_take_failed");
          return FAILED;
        }
        await deps.liveView
          .setClipboardAccess({ name: slotName }, true)
          .catch(() => deps.log.warn({ runId, errorCode: "clipboard_on_failed" }, "clipboard off"));
        await beginEnrolment(runId);
        idle.arm(slotName, runId);
        return { ok: true };
      },
      async onAgentControl(slotName, runId) {
        idle.disarm(runId);
        // Must succeed before B1 releases the guard: if n.eko cannot take the host back, the run
        // fails closed rather than let the user and the agent drive at once (spec §10.3).
        await deps.liveView.takeControl({ name: slotName });
        await finishEnrolment(runId);
        await deps.liveView
          .setClipboardAccess({ name: slotName }, false)
          .catch(() => deps.log.warn({ runId, errorCode: "clipboard_off_failed" }, "clipboard"));
      },
    },
    async onLeased(slot) {
      leases.set(slot.runId, { session: slot.session, workspaceId: slot.workspaceId });
      await Promise.all([
        seatAgent(slot.slotName, slot.runId, "neko_seat_failed"),
        deps.downloads
          .attach(slot)
          .catch(() =>
            deps.log.warn({ runId: slot.runId, errorCode: "downloads_attach_failed" }, "downloads"),
          ),
      ]);
    },
    async onLeaseEnding(slot) {
      idle.disarm(slot.runId);
      // A run cancelled during a takeover still seals what the user enrolled (before Browser.close).
      await finishEnrolment(slot.runId);
      leases.delete(slot.runId);
      await deps.downloads.detach(slot.runId).catch(() => undefined);
      // S12: a released run must not leave the user with X input until the container restarts.
      if (slot.slotReleased) await seatAgent(slot.slotName, slot.runId, "neko_release_failed");
    },
  };
}
```

Note: `setClipboardAccess(…, false)` failing after a successful `takeControl` is harmless: n.eko's clipboard routes need host status, which the user no longer has.

- [ ] **Step 4: Run the tests.**

Run: `pnpm test apps/agent/src/live && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
pnpm exec prettier --write apps/agent/src/live
git add apps/agent/src/live
git commit -m "feat(agent): B6 live hooks: give/take n.eko inside B1's lock, idle hand-back, lease lifecycle"
```

---
### Task A13: Wire B6 into the agent and run the takeover acceptance tests (base Task 13, replaced)

Replaces base Task 13 (F1, F10, G3, W3, W6). There is no `b1-adapters.ts`, `ports.ts` or `runtime.ts`: `main.ts` builds the live hooks and composes them with B3's through `composeRunHooks`. The acceptance tests run the real `Supervisor` on the B1 behaviour stack with the B6 hooks; page-level SSRF is already B1's (`network-policy`), so the base test's `/12` allow-list (G3) is gone.

**Files:**
- Modify: `apps/agent/src/main.ts`, `tests/behaviour/harness.ts`
- Test: `apps/agent/src/live/takeover.behaviour.test.ts`, `apps/agent/src/live/idle-hand-back.behaviour.test.ts`

**Interfaces:**
- Consumes: everything from A2–A12; `startBehaviourAgent`, `createRun`, `takeControl`, `handBack`, `events`, `steps`, `slotOf`, `waitForRun` (harness); B3 E Task 13's `vault` and `vaultHooks(vault)` in `main.ts` (`vault.enrolment` satisfies `PasskeyEnrolmentPort`).
- Produces: `startBehaviourAgent(options: {scenarios?; config?; clock?; hooks?: Partial<RunHooks>})`; production agent with `composeRunHooks(vaultHooks(vault), liveHooks)`.

- [ ] **Step 1: Write the failing acceptance tests.**

`apps/agent/src/live/takeover.behaviour.test.ts`:

```ts
import { encodeNotify, type RunEvent } from "@mastertutor/contracts";
import { createLogger, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { createDb, runs, type DbHandle } from "@mastertutor/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockTurn } from "../../../../tests/llm-mock/src/scenario.ts";
import {
  BEHAVIOUR_DOWNLOADS_DIR,
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  BEHAVIOUR_NEKO_MEMBER_SECRET,
  SITE,
  idleUrlForTests,
  nekoBaseUrlForTests,
} from "../../../../tests/behaviour/constants.ts";
import { behaviourEnv } from "../../../../tests/behaviour/env.ts";
import {
  createRun,
  events,
  handBack,
  slotOf,
  startBehaviourAgent,
  steps,
  takeControl,
  waitForRun,
  type BehaviourAgent,
} from "../../../../tests/behaviour/harness.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { waitFor } from "../testing/wait.ts";
import { createDownloadIngestor } from "./downloads.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createLiveHooks, liveControlStore } from "./live-hooks.ts";
import type { LiveView } from "./live-view.ts";
import { createNekoAdmin } from "./neko-admin.ts";
import { createNekoLiveView } from "./neko-live-view.ts";

const log = createLogger({ service: "behaviour", level: "silent" });
const admin = createNekoAdmin({
  adminSecret: BEHAVIOUR_NEKO_ADMIN_SECRET,
  baseUrl: (slot) => nekoBaseUrlForTests(slot),
});
const real = createNekoLiveView({ admin });
/** Database-clock marks of every give (after it completed) and take (before it started), for W6. */
const marks: Array<{ kind: "give" | "take"; slot: string; at: Date }> = [];
let agentDb: DbHandle;
let owner: DbHandle;
let agent: BehaviourAgent;
const sockets: WebSocket[] = [];

const dbNow = async () =>
  new Date(String((await owner.sql<Array<{ now: string }>>`select now()::text as now`)[0]!.now));
const recorded: LiveView = {
  async giveControl(slot, userId) {
    await real.giveControl(slot, userId);
    marks.push({ kind: "give", slot: slot.name, at: await dbNow() });
  },
  async takeControl(slot) {
    marks.push({ kind: "take", slot: slot.name, at: await dbNow() });
    await real.takeControl(slot);
  },
  setClipboardAccess: (slot, on) => real.setClipboardAccess(slot, on),
};

beforeAll(async () => {
  const env = behaviourEnv();
  owner = createDb(env.ownerUrl, { max: 2 });
  agentDb = createDb(env.agentUrl, { max: 2 });
  agent = await startBehaviourAgent({
    hooks: createLiveHooks({
      store: liveControlStore(agentDb.db),
      liveView: recorded,
      idleProbe: createSlotIdleProbe({ url: (slot) => idleUrlForTests(slot) }),
      downloads: createDownloadIngestor({
        db: agentDb.db,
        storage: createMemoryStorage(),
        log,
        localRoot: BEHAVIOUR_DOWNLOADS_DIR,
        dirMode: 0o777,
      }),
      log,
    }),
  });
});
afterAll(async () => {
  for (const socket of sockets) socket.close();
  await agent?.stop();
  await Promise.all([owner?.close(), agentDb?.close()]);
});

const scenario = (name: string, turns: MockTurn[]) => {
  agent.mock.setScenarios([{ name, turns }]);
  return name;
};
const readInteractive: MockTurn = {
  outputs: [{ type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } }],
};
const clickNotes: MockTurn = { outputs: [{ type: "click_named", name: "Notes" }] };
const typeLong: MockTurn = {
  outputs: [{ type: "computer", actions: [{ type: "type", text: "y".repeat(5_000) }] }],
};
const done: MockTurn = { outputs: [{ type: "turn", status: "done", reason: "Finished" }] };
const isTyping = (action: unknown) =>
  ((action as { summary?: string } | null)?.summary ?? "").startsWith("type");
const typingStarted = (runId: string) =>
  waitFor(
    async () =>
      (await steps(agent, runId)).some(
        (s) => s.phase === "act" && s.state === "started" && isTyping(s.action),
      ),
    { label: "typing", timeoutMs: 60_000, intervalMs: 10 },
  );
const controlEvents = async (runId: string) =>
  (await events(agent, runId)).flatMap((e: RunEvent) => (e.type === "control" ? [e.holder] : []));
const hostOf = async (slot: string) =>
  ((await admin.request(slot, "GET", "/api/room/control")) as { host_id?: string }).host_id;
const userCanHost = async (slot: string) =>
  ((await admin.request(slot, "GET", "/api/members/user")) as { can_host?: boolean }).can_host;
/** What the iframe does: openLive's server-side login, then the n.eko websocket. */
async function connectLiveView(slot: string): Promise<string> {
  const base = nekoBaseUrlForTests(slot);
  const token = await loginNeko({
    baseUrl: base,
    username: "user",
    password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, slot),
  });
  const socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
  });
  return token;
}
const closeLiveViews = () => {
  for (const socket of sockets.splice(0)) socket.close();
};

describe("takeover through B1's lock with the n.eko live view (spec §10.3, §12)", () => {
  it("seats the agent as n.eko host at lease, so the user cannot take the browser (A1, S2)", async () => {
    const name = scenario("seat", [readInteractive, clickNotes, typeLong, done]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    expect(await hostOf(slot)).toBe("agent");
    const token = await loginNeko({
      baseUrl: nekoBaseUrlForTests(slot),
      username: "user",
      password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, slot),
    });
    const request = await fetch(`${nekoBaseUrlForTests(slot)}/api/room/control/request`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(request.status).toBe(403);
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed");
  });

  it("a takeover with no live view connected fails, and the agent keeps control (Review Focus 1)", async () => {
    closeLiveViews();
    const name = scenario("no-view", [readInteractive, clickNotes, typeLong, done]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    await takeControl(agent, runId);
    await waitFor(
      async () =>
        (await events(agent, runId)).some((e) => e.type === "error" && e.code === "takeover_failed"),
      { label: "takeover_failed", timeoutMs: 5_000 },
    );
    expect(await controlEvents(runId)).toEqual(["agent"]);
    const [row] = await owner.db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toMatchObject({ controller: "agent", controlUserId: null });
    expect(await hostOf(slot)).toBe("agent");
    expect(await userCanHost(slot)).toBe(false);
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed without hand back");
  });

  it("gives n.eko to a connected live view, and never lets agent input overlap it (W6, base Review Focus 5)", async () => {
    const name = scenario("toggle", [
      readInteractive,
      clickNotes,
      typeLong,
      typeLong,
      typeLong,
      typeLong,
      done,
    ]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    await connectLiveView(slot);

    await takeControl(agent, runId);
    await waitFor(async () => (await controlEvents(runId)).at(-1) === "user", { label: "user" });
    expect(await hostOf(slot)).toBe("user");
    expect(await userCanHost(slot)).toBe(true);

    // Rapid double-clicks: hand back, take over, hand back, without waiting in between.
    await handBack(agent, runId);
    await takeControl(agent, runId);
    await handBack(agent, runId);
    await waitFor(
      async () =>
        (await controlEvents(runId)).at(-1) === "agent" &&
        (await owner.db.select().from(runs).where(eq(runs.id, runId)))[0]?.controller === "agent",
      { label: "settled on the agent", timeoutMs: 10_000 },
    );
    expect(await hostOf(slot)).toBe("agent");
    expect(await userCanHost(slot)).toBe(false);
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed");

    // Never both: no act started while the user held the n.eko host for this slot.
    const windows: Array<[Date, Date]> = [];
    const mine = marks.filter((m) => m.slot === slot);
    mine.forEach((mark, i) => {
      if (mark.kind !== "give") return;
      const next = mine.slice(i + 1).find((m) => m.kind === "take");
      windows.push([mark.at, next?.at ?? new Date(8.64e15)]);
    });
    expect(windows.length).toBeGreaterThan(0);
    for (const step of (await steps(agent, runId)).filter((s) => s.phase === "act")) {
      for (const [given, taken] of windows) {
        const started = step.createdAt.getTime();
        expect(started > given.getTime() && started < taken.getTime(), `act ${step.seq}`).toBe(false);
      }
    }
    closeLiveViews();
  });

  it("a cancel while the user holds control takes the n.eko host back before the slot restarts (Review Focus 5, S12)", async () => {
    const name = scenario("cancel-held", [readInteractive, clickNotes, typeLong, done]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const slot = (await slotOf(agent, runId))!;
    await connectLiveView(slot);
    await takeControl(agent, runId);
    await waitFor(async () => (await controlEvents(runId)).at(-1) === "user", { label: "user" });
    const givenAt = marks.filter((m) => m.slot === slot && m.kind === "give").length;
    await agent.web.db
      .update(runs)
      .set({ status: "cancelled", waitReason: null })
      .where(eq(runs.id, runId));
    await agent.web.sql.notify("run_control", encodeNotify("run_control", { runId }));
    await waitForRun(agent, runId, (run) => run.status === "cancelled" && run.slotName === null, "released");
    const after = marks.filter((m) => m.slot === slot).slice(givenAt);
    expect(after.some((m) => m.kind === "take")).toBe(true);
    closeLiveViews();
  });
});
```

`apps/agent/src/live/idle-hand-back.behaviour.test.ts` (its own file: one agent per file, and this one needs a short idle limit):

```ts
import type { RunEvent } from "@mastertutor/contracts";
import { createLogger, deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { createDb, type DbHandle } from "@mastertutor/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockTurn } from "../../../../tests/llm-mock/src/scenario.ts";
import {
  BEHAVIOUR_DOWNLOADS_DIR,
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  BEHAVIOUR_NEKO_MEMBER_SECRET,
  SITE,
  idleUrlForTests,
  nekoBaseUrlForTests,
} from "../../../../tests/behaviour/constants.ts";
import { behaviourEnv } from "../../../../tests/behaviour/env.ts";
import {
  createRun,
  events,
  slotOf,
  startBehaviourAgent,
  steps,
  takeControl,
  waitForRun,
  type BehaviourAgent,
} from "../../../../tests/behaviour/harness.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { waitFor } from "../testing/wait.ts";
import { createDownloadIngestor } from "./downloads.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createLiveHooks, liveControlStore } from "./live-hooks.ts";
import { createNekoAdmin } from "./neko-admin.ts";
import { createNekoLiveView } from "./neko-live-view.ts";

const log = createLogger({ service: "behaviour", level: "silent" });
const admin = createNekoAdmin({
  adminSecret: BEHAVIOUR_NEKO_ADMIN_SECRET,
  baseUrl: (slot) => nekoBaseUrlForTests(slot),
});
let agentDb: DbHandle;
let agent: BehaviourAgent;
let socket: WebSocket | undefined;

beforeAll(async () => {
  agentDb = createDb(behaviourEnv().agentUrl, { max: 2 });
  agent = await startBehaviourAgent({
    hooks: createLiveHooks({
      store: liveControlStore(agentDb.db),
      liveView: createNekoLiveView({ admin }),
      idleProbe: createSlotIdleProbe({ url: (slot) => idleUrlForTests(slot) }),
      downloads: createDownloadIngestor({
        db: agentDb.db,
        storage: createMemoryStorage(),
        log,
        localRoot: BEHAVIOUR_DOWNLOADS_DIR,
        dirMode: 0o777,
      }),
      log,
      idleLimitMs: 1_500,
      idlePollMs: 200,
    }),
  });
});
afterAll(async () => {
  socket?.close();
  await agent?.stop();
  await agentDb?.close();
});

const turn = (outputs: MockTurn["outputs"]): MockTurn => ({ outputs });

describe("15-minute idle hand-back, with a 1.5 s limit (spec §5.1)", () => {
  it("returns control to the agent when the user gives no input, and the run goes on", async () => {
    agent.mock.setScenarios([
      {
        name: "idle",
        turns: [
          turn([{ type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } }]),
          turn([{ type: "click_named", name: "Notes" }]),
          turn([{ type: "computer", actions: [{ type: "type", text: "y".repeat(5_000) }] }]),
          turn([{ type: "turn", status: "done", reason: "Finished" }]),
        ],
      },
    ]);
    const runId = await createRun(agent, `[scenario:idle] ${SITE}/interactive.html`);
    await waitFor(
      async () => (await steps(agent, runId)).some((s) => s.phase === "act" && s.state === "started"),
      { label: "acting", timeoutMs: 60_000, intervalMs: 10 },
    );
    const slot = (await slotOf(agent, runId))!;
    const base = nekoBaseUrlForTests(slot);
    const token = await loginNeko({
      baseUrl: base,
      username: "user",
      password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, slot),
    });
    socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve());
      socket!.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
    });
    const takenAt = performance.now();
    await takeControl(agent, runId);
    const held = (e: RunEvent) => e.type === "control" && e.holder === "user";
    await waitFor(async () => (await events(agent, runId)).some(held), { label: "user holds" });
    await waitFor(
      async () =>
        (await events(agent, runId)).some((e) => e.type === "error" && e.code === "idle_hand_back"),
      { label: "idle hand-back", timeoutMs: 10_000 },
    );
    expect(performance.now() - takenAt).toBeGreaterThanOrEqual(1_500);
    await waitForRun(agent, runId, (run) => run.controller === "agent", "agent holds again");
    expect(
      ((await admin.request(slot, "GET", "/api/room/control")) as { host_id?: string }).host_id,
    ).toBe("agent");
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed");
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `pnpm test:behaviour apps/agent/src/live/takeover.behaviour.test.ts apps/agent/src/live/idle-hand-back.behaviour.test.ts`
Expected: FAIL: the harness ignores `hooks`, so the agent runs B1's default hooks: no `takeover_failed`, no `idle_hand_back`, and n.eko's host is never `agent`.

- [ ] **Step 3: Let the behaviour harness take hooks.** In `tests/behaviour/harness.ts`:
- add `import type { RunHooks } from "../../apps/agent/src/loop/hooks.ts";`;
- change the `startBehaviourAgent` options type to `{ scenarios?: Scenario[]; config?: Partial<RuntimeConfig>; clock?: Clock; hooks?: Partial<RunHooks> } = {}`;
- in `make`, add `hooks: options.hooks,` to the `new Supervisor({ … })` options.

Run the two files again: they PASS now (A2–A12 are in). If one fails, fix the owning task's code, never the assertion.

- [ ] **Step 4: Wire the hooks into `main.ts`.** In `apps/agent/src/main.ts`:

(a) Add the imports:
```ts
import { createDownloadIngestor } from "./live/downloads.ts";
import { createSlotIdleProbe } from "./live/idle-probe.ts";
import { createLiveHooks, liveControlStore } from "./live/live-hooks.ts";
import { createNekoAdmin } from "./live/neko-admin.ts";
import { createNekoLiveView } from "./live/neko-live-view.ts";
import { composeRunHooks } from "./loop/hooks.ts";
import { DEFAULT_RUNTIME_CONFIG } from "./runtime/config.ts";
```
B3 E Task 13 already added `vaultKeys`, `vault` (`createVault({…})`) and `hooks: vaultHooks(vault)`; B6 edits on top of that.

(b) Directly after B3's `const vault = createVault({…});` statement (and so before `const supervisor = new Supervisor({`), add:
```ts
// B6: n.eko live view and downloads, plugged into B1's control lock (spec §10). B3's passkey
// enrolment runs while the user holds control (B3 E.8 note 1).
const liveHooks = createLiveHooks({
  enrolment: vault.enrolment,
  store: liveControlStore(database.db),
  liveView: createNekoLiveView({
    admin: createNekoAdmin({ adminSecret: env.NEKO_ADMIN_SECRET }),
  }),
  idleProbe: createSlotIdleProbe(),
  downloads: createDownloadIngestor({
    db: database.db,
    storage,
    log,
    localRoot: DEFAULT_RUNTIME_CONFIG.downloadsDir,
  }),
  log,
});
```

(c) In `new Supervisor({ … })`, change B3's `hooks: vaultHooks(vault),` to `hooks: composeRunHooks(vaultHooks(vault), liveHooks),`. The composition has no clash: B3 owns `onReleased`, `onClick`, `sessionStore`, `maskSources`, `functionApproval`, `functionTools`, `promptContext`; B6 owns `control`, `onLeased`, `onLeaseEnding`.

Passkey enrolment end to end (a passkey the user registers during takeover is sealed on hand-back) needs a WebAuthn fixture inside a slot, which needs `--unsafely-treat-insecure-origin-as-secure` for the fixture origin (B3 E.8 note 3); the behaviour slots do not have it, so that case is a Phase 7 E2E item (§8). A12's `live-hooks.test.ts` covers the call order.

- [ ] **Step 5: Run every agent suite.**

Run:
```bash
docker build -q -t mastertutor/browser-slot:local apps/browser-slot
pnpm test apps/agent
pnpm test:int apps/agent
pnpm test:behaviour
pnpm typecheck && pnpm lint
docker builder prune -f && docker image prune -f
```
Expected: PASS. The whole behaviour project passes, including B1's own `runs.behaviour.test.ts` (whose agent runs with the default hooks) and the new B6 files.

- [ ] **Step 6: Commit.**
```bash
pnpm exec prettier --write apps/agent/src tests/behaviour
git add apps/agent/src tests/behaviour/harness.ts
git commit -m "feat(agent): wire B6 live hooks into the agent; takeover and idle hand-back acceptance tests"
```

---

### Task A14: Traefik live routers in the test stack (base Task 11, replaced)

Replaces base Task 11 (S4, S6, S7, G7, D41, D42). B6 ships **only** the test file-provider routers. Production labels belong to Phase 9's `compose.prod.yml` (§8 hands it the exact rule, address and middleware order). No coturn, no `TURN_URLS`, no `PUBLIC_HOST`, no labels or network renames in `compose.yml`. The ForwardAuth address is web's static `.11` (D41), even in tests, so the test stack exercises the production path. A headers middleware adds `frame-ancestors 'self'` and `nosniff` to everything n.eko serves (S4).

**Files:**
- Replace: `infra/traefik/test-dynamic.yml`
- Create: `compose.live-test.yml`
- Modify: `package.json` (scripts)
- Test: `tests/compose/live-routes.int.test.ts`

**Interfaces:**
- Consumes: `liveRouterRule`, `LIVE_STRIP_REGEX`, `liveForwardAuthAddress` (A3); `/api/live/auth` (A8).
- Produces: routers `live-browser-1`, `live-browser-2` (priority 1000; middlewares `live-auth`, `live-strip`, `live-headers`, in that order); scripts `pnpm compose:live <args>` and `pnpm test:live-stack`.

- [ ] **Step 1: Write the failing test.** `tests/compose/live-routes.int.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIVE_STRIP_REGEX, liveForwardAuthAddress, liveRouterRule } from "@mastertutor/contracts";
import { beforeAll, describe, expect, it } from "vitest";

interface Service {
  labels?: Record<string, string>;
  environment?: Record<string, string | null>;
  networks?: Record<string, { ipv4_address?: string } | null>;
  profiles?: string[];
}
interface Config {
  services: Record<string, Service>;
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const load = (files: string[]): Config =>
  JSON.parse(
    execFileSync(
      "docker",
      ["compose", "--env-file", ".env.test", ...files.flatMap((f) => ["-f", f]), "config", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    ),
  ) as Config;
const dynamic = readFileSync(new URL("../../infra/traefik/test-dynamic.yml", import.meta.url), "utf8");
let base: Config;
let live: Config;

beforeAll(() => {
  base = load(["compose.yml"]);
  live = load(["compose.yml", "compose.test.yml", "compose.live-test.yml"]);
});

describe("test file-provider live routers (spec §10.2.2)", () => {
  it("route each slot with the single rule source", () => {
    for (const slot of ["browser-1", "browser-2"]) {
      expect(dynamic).toContain(`rule: '${liveRouterRule(slot, "localhost")}'`);
      expect(dynamic).toContain(`url: http://${slot}:8080`);
    }
    expect(dynamic.match(/middlewares: \[live-auth, live-strip, live-headers\]/g)).toHaveLength(2);
    expect(dynamic.match(/priority: 1000/g)).toHaveLength(2);
    expect(dynamic).toContain(`- '${LIVE_STRIP_REGEX}'`);
  });

  it("send ForwardAuth to web's static cdp address and copy back only the Cookie header (D41, S3)", () => {
    const webIp = base.services.web!.networks!.cdp!.ipv4_address!;
    const address = `http://${webIp}:3000/api/live/auth`;
    expect(address).toBe(liveForwardAuthAddress(webIp.split(".").slice(0, 3).join(".")));
    expect(dynamic).toContain(`address: ${address}`);
    expect(dynamic).not.toContain("http://web:3000/api/live/auth");
    expect(dynamic).toMatch(/authResponseHeaders:\s*\n\s*- Cookie\s*\n/);
  });

  it("add the frame and sniffing guards to everything n.eko serves (S4)", () => {
    expect(dynamic).toContain(`contentSecurityPolicy: "frame-ancestors 'self'"`);
    expect(dynamic).toContain("contentTypeNosniff: true");
  });
});

describe("compose stays production-neutral (S6, S7, D42)", () => {
  it("puts no Traefik labels and no TURN settings on slots; Phase 9 owns production routing", () => {
    for (const [name, service] of Object.entries(base.services)) {
      expect(Object.keys(service.labels ?? {}).filter((k) => k.startsWith("traefik.")), name).toEqual([]);
      if (name.startsWith("browser-"))
        expect(Object.keys(service.environment ?? {}).filter((k) => k.startsWith("TURN_")), name).toEqual([]);
    }
    expect(base.services.coturn).toBeUndefined();
  });

  it("the live overlay runs two slots and tells migrate about both", () => {
    expect(
      Object.entries(live.services)
        .filter(([name, s]) => name.startsWith("browser-") && (s.profiles ?? []).length === 0)
        .map(([name]) => name)
        .sort(),
    ).toEqual(["browser-1", "browser-2"]);
    expect(live.services.migrate!.environment!.BROWSER_SLOTS).toBe("browser-1,browser-2");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `pnpm test:int tests/compose/live-routes.int.test.ts`
Expected: FAIL: no live routers in `test-dynamic.yml`, no `compose.live-test.yml`.

- [ ] **Step 3: Implement.**

`infra/traefik/test-dynamic.yml` (replace the whole file):

```yaml
# Test overlay routes. The live routers use liveRouterRule() and liveForwardAuthAddress() (D41:
# web's static .11 on the cdp network, never the name `web`); tests/compose/live-routes.int.test.ts
# asserts both. ForwardAuth runs BEFORE the strip so it sees /live/<runId>/. Phase 9's
# compose.prod.yml carries the same routers as labels.
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
      middlewares: [live-auth, live-strip, live-headers]
      service: live-browser-1
    live-browser-2:
      rule: 'Host(`localhost`) && PathRegexp(`^/live/[0-9a-f-]{36}/`) && HeaderRegexp(`Cookie`, `(?:^|;\s*)live_slot=browser-2\.`)'
      priority: 1000
      entryPoints: [web]
      middlewares: [live-auth, live-strip, live-headers]
      service: live-browser-2
  middlewares:
    live-auth:
      forwardAuth:
        address: http://172.30.231.11:3000/api/live/auth
        authResponseHeaders:
          - Cookie
    live-strip:
      stripPrefixRegex:
        regex:
          - '^/live/[0-9a-f-]{36}'
    live-headers:
      headers:
        contentSecurityPolicy: "frame-ancestors 'self'"
        contentTypeNosniff: true
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

`compose.live-test.yml`:

```yaml
# Live-view test overlay (B6) on top of compose.test.yml: a second slot for the cross-slot auth
# cases. Run: pnpm compose:live up -d --wait traefik browser-1 browser-2
services:
  browser-2:
    profiles: !reset []
  migrate:
    environment:
      BROWSER_SLOTS: browser-1,browser-2
```

Root `package.json` `scripts`, add:
```json
"compose:live": "docker compose --env-file .env.test -f compose.yml -f compose.test.yml -f compose.live-test.yml",
"test:live-stack": "RUN_LIVE_STACK=1 vitest run --project integration tests/live"
```

- [ ] **Step 4: Run the tests.**

Run:
```bash
pnpm test:int tests/compose
pnpm compose:live config --quiet
```
Expected: PASS (the Phase 0 `compose-config.int.test.ts`, including its `TURN_SECRET`-not-on-slots rule, is unchanged and passes); `config` prints nothing and exits 0.

- [ ] **Step 5: Commit.**
```bash
pnpm exec prettier --write tests/compose package.json
git add infra/traefik/test-dynamic.yml compose.live-test.yml package.json tests/compose/live-routes.int.test.ts
git commit -m "feat(infra): test live routers with D41 ForwardAuth, auth-then-strip and frame guards"
```

---

### Task A15: Stack-level §12 live-view tests through Traefik (base Task 12, changed)

Changed from base Task 12: no TURN probe and no coturn (S7); `openLive` is called through the real `/api/rpc` route, so the FE router wiring and `ResponseHeadersPlugin` are covered (E1); the n.eko client is loaded **through the `/live/<id>/` prefix** and its WebSocket upgrades through it (W1); a request without `NEKO_SESSION` is refused (S3, Review Focus 3). Cookie isolation upstream (W2) is proved by A8's unit test plus that refusal: every request that reaches n.eko carries a Cookie header written by ForwardAuth.

**Files:**
- Create: `tests/live/live-stack.int.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the A14 stack; `signLiveSlot` (A7), `livePath`, `LIVE_SLOT_COOKIE`, `NEKO_SESSION_COOKIE` (A3). The suite runs only with `RUN_LIVE_STACK=1` (`pnpm test:live-stack`).
- Produces: CI coverage of the live view through the real stack.

- [ ] **Step 1: Write the suite.** `tests/live/live-stack.int.test.ts`:

```ts
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LIVE_SLOT_COOKIE, NEKO_SESSION_COOKIE, livePath } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signLiveSlot } from "../../apps/web/lib/server/live/cookie.ts";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const BASE = "http://localhost:18080";
const COMPOSE = [
  "compose",
  "--env-file",
  ".env.test",
  "-f",
  "compose.yml",
  "-f",
  "compose.test.yml",
  "-f",
  "compose.live-test.yml",
];
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
const get = (path: string, cookies: string[]) =>
  fetch(`${BASE}${path}`, { redirect: "manual", headers: { cookie: cookies.join("; ") } });
/** runs.openLive through the real /api/rpc route (oRPC RPC wire format). Returns the live cookies. */
async function openLive(runId: string): Promise<string[]> {
  const response = await fetch(`${BASE}/api/rpc/runs/openLive`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session, origin: BASE },
    body: JSON.stringify({ json: { runId } }),
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as { json: { sleeping: boolean } }).json.sleeping).toBe(false);
  const cookies = response.headers.getSetCookie().map((c) => c.split(";")[0]!);
  expect(cookies.map((c) => c.slice(0, c.indexOf("="))).sort()).toEqual([
    LIVE_SLOT_COOKIE,
    NEKO_SESSION_COOKIE,
  ]);
  return cookies;
}
/** A raw WebSocket upgrade with our cookies: the status, and whether n.eko sent a first frame. */
function upgrade(path: string, cookies: string[]): Promise<{ status: number; frame: boolean }> {
  return new Promise((resolve, reject) => {
    const req = request(`${BASE}${path}`, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": randomBytes(16).toString("base64"),
        cookie: cookies.join("; "),
      },
    });
    req.on("upgrade", (res, socket) => {
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ status: res.statusCode ?? 0, frame: false });
      }, 5_000);
      socket.once("data", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ status: res.statusCode ?? 0, frame: true });
      });
    });
    req.on("response", (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, frame: false });
    });
    req.on("error", reject);
    req.end();
  });
}

describe.skipIf(process.env.RUN_LIVE_STACK !== "1")("live view through the real stack (spec §12)", () => {
  beforeAll(async () => {
    env = Object.fromEntries(
      (await readFile(new URL("../../.env.test", import.meta.url), "utf8"))
        .split("\n")
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    await compose(["down", "-v", "--remove-orphans"]);
    await compose(["up", "-d", "--wait", "traefik", "browser-1", "browser-2"]);
    const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email: "owner@example.test", password: "correct-horse-battery-staple", name: "Owner" }),
    });
    expect(signUp.ok).toBe(true);
    session = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .find((c) => c.startsWith("better-auth.session_token="))!;
    userId = await psql(`select id from "user" where email = 'owner@example.test'`);
    ws1 = await psql(`select workspace_id from workspace_members where user_id = '${userId}'`);
    ws2 = await psql(`with w as (insert into workspaces (name) values ('Other') returning id) select id from w`);
  }, 300_000);
  afterAll(async () => {
    if (process.env.RUN_LIVE_STACK === "1") await compose(["down", "-v", "--remove-orphans"]);
  });

  it("openLive over /api/rpc, then the n.eko client loads and connects through the prefix (W1, E1)", async () => {
    const run1 = await newRun(ws1);
    await lease("browser-1", run1);
    const cookies = [session, ...(await openLive(run1))];
    const index = await get(`${livePath(run1)}?embed=1&usr=user&pwd=cookie`, cookies);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    const html = await index.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      // An absolute asset URL would escape /live/<id>/ and the client would load blank.
      expect(asset, asset).not.toMatch(/^(?:\/|https?:)/);
      expect((await get(`${livePath(run1)}${asset.replace(/^\.\//, "")}`, cookies)).status, asset).toBe(200);
    }
    expect(await upgrade(`${livePath(run1)}ws?usr=user&pwd=cookie`, cookies)).toEqual({
      status: 101,
      frame: true,
    });
  });

  it("rejects every §12 live-view auth case, and never reaches n.eko without NEKO_SESSION (S3)", async () => {
    const run1 = await newRun(ws1);
    const run2 = await newRun(ws1);
    const run3 = await newRun(ws2);
    await lease("browser-1", run1);
    const live1 = await openLive(run1);
    const neko = live1.find((c) => c.startsWith(`${NEKO_SESSION_COOKIE}=`))!;
    const valid = live1.find((c) => c.startsWith(`${LIVE_SLOT_COOKIE}=`))!;
    const path1 = livePath(run1);
    expect((await get(path1, [session, valid, neko])).status).toBe(200);
    // no Better Auth session
    expect((await get(path1, [valid, neko])).status).toBe(401);
    // no n.eko session: refused before n.eko, so the Better Auth cookie is never forwarded
    expect((await get(path1, [session, valid])).status).toBe(401);
    // forged signature
    expect((await get(path1, [session, `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`, neko])).status).toBe(401);
    // duplicate live_slot cookies
    expect((await get(path1, [session, valid, `${LIVE_SLOT_COOKIE}=browser-2.${now() + 600}.x`, neko])).status).toBe(401);
    // a cookie for a slot leased to a different run
    await lease("browser-2", run2);
    expect((await get(path1, [session, slotCookie("browser-2", run1), neko])).status).toBe(403);
    // another workspace's run
    await lease("browser-2", run3);
    expect((await get(livePath(run3), [session, slotCookie("browser-2", run3), neko])).status).toBe(403);
    // an idle slot
    await release("browser-2");
    await psql(`update browser_slots set state = 'idle' where name = 'browser-2'`);
    expect((await get(livePath(run2), [session, slotCookie("browser-2", run2), neko])).status).toBe(403);
    // a stale cookie after release
    await release("browser-1");
    expect((await get(path1, [session, valid, neko])).status).toBe(403);
    // no live_slot at all never reaches n.eko (the web router answers)
    const plain = await get(path1, [session, neko]);
    expect(await plain.text()).not.toMatch(/n\.eko|neko/i);
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
      const reached = await compose(["exec", "-T", "browser-1", "curl", "-s", "-m", "3", "-o", "/dev/null", target]).then(
        () => true,
        () => false,
      );
      expect(reached, target).toBe(false);
    }
  });

  it("keeps n.eko, CDP and the idle probe off the host and the edge network", async () => {
    const browser1 = await compose(["ps", "-q", "browser-1"]);
    for (const line of (await docker(["port", browser1])).split("\n")) expect(line).toContain("59001");
    const ip1 = await docker(["inspect", "-f", '{{(index .NetworkSettings.Networks "mastertutor_cdp").IPAddress}}', browser1]);
    for (const url of [
      "http://browser-1:8080/health",
      `http://${ip1}:8080/health`,
      `http://${ip1}:9223/json/version`,
      `http://${ip1}:9224/`,
    ]) {
      const reached = await docker(["run", "--rm", "--network", "mastertutor_edge", "curlimages/curl:8.22.0", "-s", "-m", "3", "-o", "/dev/null", url]).then(
        () => true,
        () => false,
      );
      expect(reached, url).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Build and run it.** Tasks A1–A14 provide everything, so it should pass; if it fails, fix the owning task's code, not the test. If the W1 case fails because the legacy client references absolute (`/…`) asset or WebSocket URLs, stop and report `BLOCKED`: prefix routing would need a ruling, and the check must not be weakened.

Run:
```bash
pnpm compose:live build
pnpm test:live-stack
pnpm compose:live down -v
docker builder prune -f && docker image prune -f
```
Expected: 4 tests PASS. Without `RUN_LIVE_STACK=1` (plain `pnpm test:int`) the suite is skipped.

- [ ] **Step 3: Add CI.** In `.github/workflows/ci.yml`, job `compose-smoke`:
1. after `- uses: actions/checkout@v4`, add the same three setup steps the `integration` job uses, in the same order: `- uses: pnpm/action-setup@v4`, `- uses: actions/setup-node@v4` with `node-version: 24` and `cache: pnpm`, and `- run: pnpm install --frozen-lockfile`;
2. after `- run: bash scripts/compose-smoke.sh`, add:
```yaml
      - name: Live view stack tests (B6)
        run: |
          pnpm compose:live build
          pnpm test:live-stack
      - name: Live view stack teardown
        if: always()
        run: pnpm compose:live down -v
```

Keep B3 E's `security` job and its Chromium install step in `integration` unchanged (B3 E Task 13 added them to the same file).

- [ ] **Step 4: Commit.**
```bash
pnpm exec prettier --write tests/live .github/workflows/ci.yml
git add tests/live .github/workflows/ci.yml
git commit -m "test(live): live view through Traefik: openLive RPC, client through the prefix, §12 auth cases"
```

---
## 7. Recorded deviations from the spec (replaces the base list)

1. **Embedded client auth.** n.eko 3.1.6 embeds a legacy client that needs `usr`/`pwd` in the URL. The embed path carries the placeholders `usr=user&pwd=cookie`; authentication is the relayed `NEKO_SESSION` cookie through the legacy handler's `whoami`-first path. `liveEmbedPath` and `OpenLiveResult` changed accordingly.
2. **No TURN in v1 (D42).** `openLive` returns `iceServers: []`; the TCP mux covers UDP-hostile networks (run 28). Spec §10.2.5 and the `coturn` row of §3.1 are deferred.
3. **Middleware order.** ForwardAuth runs **before** StripPrefixRegex (spec §10.2.2 lists the strip first), so auth sees `/live/<runId>/`.
4. **Cookie rewrite and 401 without an n.eko session.** ForwardAuth's 200 always replaces the upstream `Cookie` with `NEKO_SESSION` only; a request without exactly one well-formed `NEKO_SESSION` gets 401.
5. **ForwardAuth address.** `http://<CDP prefix>.11:3000/api/live/auth`, not `http://web:3000/…` (D41).
6. **User idle.** Measured by the X server's idle timer via an agent-only probe on 9224, capped by the time since the takeover. CDP input never resets it.
7. **Unhosted user member.** The `user` member boots with `can_host=false` (spec §10.1 lists `can_host`). n.eko runs with legacy mode, cookie auth (not Secure), implicit hosting off, file-chooser and drop handling on, chat off.
8. **Takeover needs a connected live view.** A takeover with no connected n.eko session fails (`error{takeover_failed}`, `control{agent}`); after a fresh lease the agent waits up to 15 s for the iframe to reconnect.
9. **Downloads: taking over is the approval (F6).** Only the member holding control downloads; agent-initiated downloads are cancelled with `error{download_blocked}`. Spec §5.5's "any download needs approval" is met by the takeover itself. This covers only Chromium's file-download path (`Browser.downloadWillBegin` → `Browser.cancelDownload`). Agent-side resource fetches (`Network.loadNetworkResource` via B5's `fetchInBrowser`, under B1's network policy) are not downloads and B6 never touches them. B5's PDF capture reads a PDF the page shows inline, in Chromium's PDF viewer, which is enabled because `policies.json` sets no `AlwaysOpenPdfExternally`, so it keeps working (A11 "an inline PDF the agent opens is not a download"). A PDF served as `Content-Disposition: attachment` is a download and is blocked for the agent in v1. That is a known limit for B5 (see §8).
10. **New column and event fields.** `runs.control_user_id` (with CHECK); `download_ready.assetId`; informational error codes `takeover_failed`, `idle_hand_back`, `download_blocked`, `download_too_large`.
11. **Same-origin n.eko client (S4, accepted risk).** The n.eko legacy client is served same-origin at `/live/<runId>/` and could read the parent DOM. Mitigations: pinned image tag, chat and file transfer off, `frame-ancestors 'self'` and `nosniff` on every live response. Record in spec §15.

## 8. Notes for later phases (replaces the base list)

- **Phase 9 (`compose.prod.yml`, D41).** The production slot labels must use, for each slot: rule = `liveRouterRule(slot, DOMAIN)` (the anchored `(?:^|;\s*)live_slot=browser-N\.` form); middlewares **in this order** `<prefix>-live-auth, <prefix>-live-strip, <prefix>-live-headers` (the current Phase 9 draft lists `strip, auth`, which would hide the run id from ForwardAuth); ForwardAuth `address` = `liveForwardAuthAddress(CDP_SUBNET_PREFIX)` with `authResponseHeaders: Cookie` and `trustForwardHeader: false`; headers middleware `contentSecurityPolicy: "frame-ancestors 'self'"`, `contentTypeNosniff: true`; `traefik.docker.network=mastertutor-cdp` (external). `prod-overlay.int.test.ts` must assert the rule and address against the two helpers. Open host ports 59001–59006 (UDP and TCP) only; no 3478. LAN and tailnet clients need router NAT loopback or a second NAT1TO1 (runbook, S8).
- **Phase 7 / F3 (live UI).** Set the iframe `src` to `embedPath` only after `openLive` resolves, and call `openLive` again on every `slot` event and on Reconnecting. `CONFLICT` (`in_use`) shows "Open in another tab" with no retry loop (E4); one live iframe per run per tab (the PiP and the main view hand the frame off). Revert the optimistic takeover on `error{takeover_failed}` or when no `control{user}` arrives in 2 s; a late `control{user}` after a revert re-applies the user state (E5). Show `idle_hand_back` as an info toast, not an error. Upload outcomes: `signed_out` → the typed sign-in redirect; `no_file_dialog` → "Click the site's upload button first". Show `download_blocked` as "Take over to download".
- **B2.** `assets.url` uses a 300 s TTL for downloads (spec §10.2.9) and never serves active content inline; downloads are stored as `application/octet-stream` unless their type is inert.
- **B3.** B3 E's `onReleased(runId)` (after `close()`, vault `forgetRun`) and `onClick` are single-owner hooks that B6 leaves alone. B6's release-side hook is `onLeaseEnding`. B6 drives B3's passkey enrolment (`vault.enrolment.begin` after a successful give, `finish` on hand-back or lease end) and implements E.8 note 3 (`takeControl` idempotent, `handBack` only from the controller or a workspace owner).
- **B5.** PDF capture (`capturePdf` → `fetchInBrowser`) is unaffected by deviation 9. Attachment-served PDFs cannot be captured by the agent in v1. Either the user takes over and downloads them, or B5 adds a `capture({url})` that fetches the link through `fetchInBrowser` without navigating. B5 imports `composeRunHooks` (A2) instead of defining its own `mergeHooks`, and its seam table reads `RunHooks.onLeased / onLeaseEnding — B6`.
- **Phase 7 E2E (passkeys).** "A passkey enrolled by the user during takeover is sealed on hand-back": needs the WebAuthn fixture in a slot with `--unsafely-treat-insecure-origin-as-secure` for the fixture origin (B3 E.8 note 3). A12 covers the call order with fakes.
- **Spec §15.** Add risk S4 (item 11 above) and the n.eko session-list dependency (`GET /api/sessions` → `state.is_connected`), which A6 Step 2 verifies on every image bump.

## 9. Pre-flight findings: where each one is handled

| IDs | Disposition |
|---|---|
| F1 | A13: no fictional seam; hooks through `new Supervisor({hooks})` |
| F2, S11 | A12: B6 implements only `hooks.control`; no coordinator, no second `run_control` listener, no status writes |
| F3 | A2 (seam + revert), A12 (`takeover_failed`), tests in A2, A12, A13 |
| F4 | A2 `returnControlToAgent`; used by A4 hand back, A2 revert, A12 idle |
| F5 | A2 (`onLeased`, `onLeaseEnding`, `browserCdp`, `session`); B3 E's `onReleased(runId)` untouched |
| F6, S10 | A11: user-only downloads, streamed hash and upload, real `BrowserSession` test |
| F7 | A2: `emitRunEvent` moved to `@mastertutor/db` |
| F8, G4 | A2: column + CHECK + every fixture updated, B1 suites re-run |
| F9, F12, W5 | A6/A7/A10/A11/A13 on the behaviour stack; `waitFor`; no `tests/support/`; no locale-dependent window search |
| F10, G3, W3, W6 | A13 behaviour acceptance tests (abort latency stays B1's; never-both checked on DB clocks) |
| F11 | §0.2 and A2 preamble: B1 fix wave and B3 seam land first |
| F13 | §2 live-view table (`.10` reaches 8080) |
| E1, E2 | A9: handlers on the FE `liveRouter`, `ResponseHeadersPlugin`; fe-track is merged |
| E3 | A8: `getViewer()`; fixture builds answer 403 |
| E4, E5 | §8 handoff to F3 / Phase 7 |
| E6, G1 | Moot: D36 key is in `WebEnv`; no new env tests (TURN dropped) |
| E7 | A10: 401 → `signed_out`; no cross-app import |
| S1, G2 | A1, A5: edits only; `verify.sh` appended, its guards kept |
| S2 | **A1 first** (boot profile), A12 `onLeased` seat, tests in A1, A6, A13 |
| S3, W4 | A8 (401 without `NEKO_SESSION`; flipped test), A15 stack case |
| S4 | A5 chat off, A14 headers middleware, §7 item 11 |
| S5 | A5 `verify.sh` side-endpoint check |
| S6, G7 | A14: no production labels or `PUBLIC_HOST` in `compose.yml`; §8 Phase 9 handoff |
| S7 | Dropped everywhere (§2) |
| S8 | §8 Phase 9 runbook note |
| S12 | A2 `onLeaseEnding` before `Browser.close`, A12 bounded take, A13 cancel test |
| G5, G6 | §2: no `--`; `prettier --write` in every commit step |
| W1 | A15: assets and WebSocket through the prefix |
| W2 | A8 unit test + A15 "no `NEKO_SESSION` → 401" (every forwarded request carries ForwardAuth's Cookie) |

## 10. Self-Review

**1. Spec and ruling coverage.**

| Requirement | Task |
|---|---|
| Ruling: `user` cannot host while `controller='agent'`, fixed first, edit-only, with a test | A1 (verify.sh), A6 and A13 behaviour checks |
| Ruling: takeover only through `hooks.control`, no second coordinator | A2 seam, A12 |
| Ruling: takeover with no live view returns failure, agent keeps control | A2 (worker revert), A6 (connected check), A12, A13 |
| Ruling: ForwardAuth 401 without an n.eko cookie, never forwards Better Auth's | A8, A15 |
| Ruling: production routing per D41/D42 | A3 `liveForwardAuthAddress`, A14, §8 Phase 9 |
| Ruling: use `liveRouter`, no new router | A9 |
| §10.1 `LiveView` / `NekoLiveView` | A6 |
| §10.2.1 `openLive` | A7, A9 |
| §10.2.2 per-slot routers and ForwardAuth | A8, A14, A15 |
| §10.2.3 re-open on slot change | §8 F3 note (client) |
| §10.2.4 media mux / §10.2.5 TURN | unchanged Phase 0 / deferred (D42, §7 item 2) |
| §10.2.7 clipboard only while the user holds control | A6, A12 |
| §10.2.8 uploads | A10 |
| §10.2.9 downloads | A11 (§7 item 9) |
| §10.3 takeover, hand back, sleeping wake into takeover | B1 + A2 (`afterRestore`), A4, A9, A12, A13 |
| B3 E: failed takeover during a pending approval stays `waiting(approval)` | A2 (`revertTakeover`, worker test) |
| B3 E.8 note 1: passkey enrolment during takeover | A2 (`LeasedSlot.session`), A12, A13 (`vault.enrolment`); E2E in §8 |
| B3 E.8 note 3: idempotent takeover, hand-back only from the controller (or owner) | A4, A9 (`FORBIDDEN`) |
| B3 E 0.5 fixture vs `runs_control_user_matches_controller` | A2 Step 8 |
| Deviation 9 vs B5 PDF capture | A11 inline-PDF test, §7 item 9, §8 B5 |
| §5.1 15-minute idle hand-back | A12, A13 |
| §12 live-view auth cases, 8080/9223 isolation, SSRF | A8, A15 |
| §12 takeover lock | B1 tests + A13 |

**2. Placeholder scan.** No "TBD"/"TODO"/"similar to". Unchanged code is referenced as "copy verbatim from base plan Task N, Step M" (binding text that exists). Conditional steps are each decided by a named command's output: A2 Step 1 (a precondition: any result other than the expected post-B3 state stops with `NEEDS_CONTEXT`), A5 Step 1 (n.eko flag names), A6 Step 2 (session list shape), A11 Step 4 (Garage checksum fallback), A15 Step 2 (absolute asset URLs → `BLOCKED`).

**3. Type and name consistency.** `UserControlResult`, `LeasedSlot{runId, workspaceId, slotName, session, browserCdp}`, `ReleasedSlot{runId, slotName, slotReleased}`, `RunHooks.onLeaseEnding` (never B3's `onReleased(runId)`), `composeRunHooks` (A2 → A12, A13); `ControlRequestResult.reason: "not_found" | "finished" | "not_controller"` (A4 → A9); `PasskeyEnrolmentPort` (A12 → A13, satisfied by B3's `vault.enrolment`); `DbTx`, `emitRunEvent`, `returnControlToAgent`, `notifyRunControl`, `readControlUser` (A2 → A4, A11, A12); `seedMember`, `seedRun`, `leaseSlotForTest`, `releaseSlotForTest`, `nextNotification` (A4 → A7, A9, A11); `LiveDeps{db, nekoMemberSecret, liveCookieSecret, nekoBaseUrl?, fetch?, nowSeconds?}` (A7 → A8, A9); `createLiveHandlers(deps: () => LiveDeps)` (A9); `LiveViewError("user_not_connected")` (A6 → A12); `DownloadIngestor{attach(slot: LeasedSlot), detach(runId)}` (A11 → A12, A13); `LiveControlStore`, `liveControlStore`, `createLiveHooks` (A12 → A13); behaviour constants `SLOT_NEKO`, `SLOT_IDLE`, `BEHAVIOUR_NEKO_*`, `BEHAVIOUR_DOWNLOADS_DIR`, `nekoBaseUrlForTests`, `idleUrlForTests` (A6, A11 → A7, A10, A11, A13). `TAKEOVER_GIVE_WAIT_MS` (A3 → A6), `TAKEOVER_RESTORE_WAIT_MS` and `AUTO_HAND_BACK_IDLE_MS` (A3 → A12).

**4. Review Focus.** Each §5 item has a test in its owning task: 1 → A2, A12, A13; 2 → A12 `idle-watch.test.ts`; 3 → A8, A15; 4 → A11; 5 → A12, A13. The base plan's five items stay covered: duplicate `live_slot` (A8, A15), second tab `in_use` (A7), takeover before connect (now §5.1), download race (A11's decide-at-begin path), rapid toggles (A13).

---

**Execution handoff.** Execute A1 → A15 in order with superpowers:subagent-driven-development (recommended: the tasks lean on each other's interfaces, and a shipped mistake here is a security regression in the control lock). A1 can ship on its own immediately; it does not depend on B3.
