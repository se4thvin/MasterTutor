import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  LIVE_SLOT_COOKIE,
  MAX_UPLOAD_BYTES,
  NEKO_SESSION_COOKIE,
  livePath,
} from "@mastertutor/contracts";
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
];
const compose = async (args: string[]) =>
  (
    await run("docker", [...COMPOSE, ...args], { cwd: root, maxBuffer: 50 * 1024 * 1024 })
  ).stdout.trim();
const docker = async (args: string[]) => (await run("docker", args, { cwd: root })).stdout.trim();
const psql = (query: string) =>
  compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "owner",
    "-d",
    "mastertutor",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-At",
    "-c",
    query,
  ]);

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
  expect(cookies.map((c) => c.slice(0, c.indexOf("="))).sort()).toEqual(
    [LIVE_SLOT_COOKIE, NEKO_SESSION_COOKIE].sort(),
  );
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

describe.skipIf(process.env.RUN_LIVE_STACK !== "1")(
  "live view through the real stack (spec §12)",
  () => {
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
        body: JSON.stringify({
          email: "owner@example.test",
          password: "correct-horse-battery-staple",
          name: "Owner",
        }),
      });
      expect(signUp.ok).toBe(true);
      session = signUp.headers
        .getSetCookie()
        .map((c) => c.split(";")[0]!)
        .find((c) => c.startsWith("better-auth.session_token="))!;
      userId = await psql(`select id from "user" where email = 'owner@example.test'`);
      ws1 = await psql(`select workspace_id from workspace_members where user_id = '${userId}'`);
      ws2 = await psql(
        `with w as (insert into workspaces (name) values ('Other') returning id) select id from w`,
      );
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
        expect(
          (await get(`${livePath(run1)}${asset.replace(/^\.\//, "")}`, cookies)).status,
          asset,
        ).toBe(200);
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
      expect(
        (
          await get(path1, [
            session,
            `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`,
            neko,
          ])
        ).status,
      ).toBe(401);
      // duplicate live_slot cookies
      expect(
        (await get(path1, [session, valid, `${LIVE_SLOT_COOKIE}=browser-2.${now() + 600}.x`, neko]))
          .status,
      ).toBe(401);
      // a cookie for a slot leased to a different run
      await lease("browser-2", run2);
      expect((await get(path1, [session, slotCookie("browser-2", run1), neko])).status).toBe(403);
      // another workspace's run
      await lease("browser-2", run3);
      expect(
        (await get(livePath(run3), [session, slotCookie("browser-2", run3), neko])).status,
      ).toBe(403);
      // an idle slot
      await release("browser-2");
      await psql(`update browser_slots set state = 'idle' where name = 'browser-2'`);
      expect(
        (await get(livePath(run2), [session, slotCookie("browser-2", run2), neko])).status,
      ).toBe(403);
      // a stale cookie after release
      await release("browser-1");
      expect((await get(path1, [session, valid, neko])).status).toBe(403);
      // no live_slot at all never reaches n.eko (the web router answers)
      const plain = await get(path1, [session, neko]);
      expect(await plain.text()).not.toMatch(/n\.eko|neko/i);
    });

    it("refuses an upload over MAX_UPLOAD_BYTES at Traefik with 413, after authentication (A14)", async () => {
      const run1 = await newRun(ws1);
      await lease("browser-1", run1);
      const cookies = [session, ...(await openLive(run1))];
      const upload = (bytes: number, withCookies: string[]) =>
        fetch(`${BASE}${livePath(run1)}api/room/upload/drop`, {
          method: "POST",
          headers: { cookie: withCookies.join("; "), "content-type": "application/octet-stream" },
          body: new Uint8Array(bytes),
        }).then((response) => response.status);
      expect(await upload(MAX_UPLOAD_BYTES + 1, cookies)).toBe(413);
      // Within the limit it reaches n.eko, which refuses a viewer who is not host.
      expect(await upload(1_024, cookies)).not.toBe(413);
      // Unauthenticated: refused by ForwardAuth before anything is buffered.
      expect(await upload(1_024, [session])).not.toBe(200);
      expect(await upload(MAX_UPLOAD_BYTES + 1, [])).not.toBe(200);
    });

    it("blocks SSRF from inside a slot (spec §12 security 5)", async () => {
      const browser2 = await compose(["ps", "-q", "browser-2"]);
      const ip2 = await docker([
        "inspect",
        "-f",
        '{{(index .NetworkSettings.Networks "mastertutor_cdp").IPAddress}}',
        browser2,
      ]);
      const prefix = env.CDP_SUBNET_PREFIX ?? "172.30.231";
      const targets = [
        "http://postgres:5432/",
        "http://garage:3900/",
        "http://web:3000/healthz",
        `http://${prefix}.10:8787/healthz`,
        `http://${prefix}.11:3000/healthz`,
        "http://169.254.169.254/latest/meta-data/",
        `http://${ip2}:9223/json/version`,
        `http://${ip2}:4713/`,
        `http://${ip2}:9224/`,
        `http://${ip2}:8080/health`,
      ];
      for (const target of targets) {
        const reached = await compose([
          "exec",
          "-T",
          "browser-1",
          "curl",
          "-s",
          "-m",
          "3",
          "-o",
          "/dev/null",
          target,
        ]).then(
          () => true,
          () => false,
        );
        expect(reached, target).toBe(false);
      }
    });

    it("keeps n.eko, CDP and the idle probe off the host and the edge network", async () => {
      const browser1 = await compose(["ps", "-q", "browser-1"]);
      for (const line of (await docker(["port", browser1])).split("\n"))
        expect(line).toContain("59001");
      const ip1 = await docker([
        "inspect",
        "-f",
        '{{(index .NetworkSettings.Networks "mastertutor_cdp").IPAddress}}',
        browser1,
      ]);
      for (const url of [
        "http://browser-1:8080/health",
        `http://${ip1}:8080/health`,
        `http://${ip1}:9223/json/version`,
        `http://${ip1}:9224/`,
      ]) {
        const reached = await docker([
          "run",
          "--rm",
          "--network",
          "mastertutor_edge",
          "curlimages/curl:8.22.0",
          "-s",
          "-m",
          "3",
          "-o",
          "/dev/null",
          url,
        ]).then(
          () => true,
          () => false,
        );
        expect(reached, url).toBe(false);
      }
    });
  },
);
