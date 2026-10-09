// Shared helpers for the observability suite (scripts/observability-stack.sh, D50). The stack serves
// https on 127.0.0.1:TEST_HTTP_PORT with Traefik's self-signed certificate; the app is
// localhost:<port>, OpenObserve is obs.localhost:<port> (observabilityOrigin). Requests carry the
// Host they are meant for, so no name resolution is needed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observabilityOrigin } from "@mastertutor/contracts";

export const enabled = process.env["RUN_OBSERVABILITY_STACK"] === "1";
const port = process.env["TEST_HTTP_PORT"] ?? "18080";
const dc = (process.env["MT_OBS_DC"] ?? "").split("\n").filter(Boolean);

/** The app's origin (BETTER_AUTH_URL in compose.suite.yml) and OpenObserve's. */
export const APP = `https://localhost:${port}`;
export const OBS = observabilityOrigin(APP);

/** docker compose with exactly the suite's files, env files and profiles. */
export function compose(args: string[]): string {
  const [command, ...rest] = dc;
  return execFileSync(command!, [...rest, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
}

/** One value from the run's generated env file (the D50 secrets). */
export function obsEnv(key: string): string {
  const line = readFileSync(process.env["MT_OBS_ENV"]!, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line!.slice(key.length + 1);
}

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** name=value pairs from Set-Cookie. */
  cookies: string[];
}

/** One https request through Traefik for `origin` (APP or OBS), never following redirects. */
export function request(
  origin: string,
  path: string,
  options: {
    method?: string;
    cookie?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Reply> {
  const host = new URL(origin).host;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port: Number(port),
        servername: new URL(origin).hostname,
        rejectUnauthorized: false, // Traefik's self-signed default certificate
        path,
        method: options.method ?? "GET",
        headers: {
          host,
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            cookies: (res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]!),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** An oRPC call as `cookie` (the RPC wire format: {"json": input}, from the app's own Origin). */
export async function rpc<T = unknown>(cookie: string, path: string, input: unknown): Promise<T> {
  const reply = await request(APP, `/api/rpc/${path}`, {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ json: input }),
  });
  if (reply.status !== 200) throw new Error(`rpc ${path}: HTTP ${reply.status}`);
  return (JSON.parse(reply.body) as { json: T }).json;
}

/** Better Auth email sign-up; returns the session cookie header. */
export async function signUp(email: string): Promise<string> {
  const reply = await request(APP, "/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({
      email,
      password: "observability-test-password",
      name: email.split("@")[0],
    }),
  });
  if (reply.status !== 200) throw new Error(`sign-up failed: ${reply.status}`);
  return reply.cookies.join("; ");
}

/**
 * The owner's way into OpenObserve (D50 ruling I-2): the app's /observability hands a ticket to
 * obs.<host>/api/observability/session, which sets the obs host's own session cookie.
 */
export async function obsSession(appCookie: string): Promise<string> {
  const handoff = await request(APP, "/observability", { cookie: appCookie });
  const ticket = /name="ticket" value="([^"]+)"/.exec(handoff.body)?.[1];
  if (!ticket) throw new Error(`no hand-off ticket (HTTP ${handoff.status})`);
  const session = await request(OBS, "/api/observability/session", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `ticket=${encodeURIComponent(ticket)}`,
  });
  if (session.status !== 200) throw new Error(`obs session: HTTP ${session.status}`);
  return session.cookies.join("; ");
}

/** An OpenObserve search as the owner, through the obs host's ForwardAuth. */
export async function search(
  obsCookie: string,
  type: "logs" | "traces",
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const now = Date.now() * 1_000;
  const reply = await request(OBS, `/observability/api/default/_search?type=${type}`, {
    method: "POST",
    cookie: obsCookie,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: {
        sql,
        start_time: now - 3_600_000_000,
        end_time: now + 60_000_000,
        from: 0,
        size: 1000,
      },
    }),
  });
  if (reply.status !== 200)
    throw new Error(`search: HTTP ${reply.status} ${reply.body.slice(0, 300)}`);
  return (JSON.parse(reply.body) as { hits?: Array<Record<string, unknown>> }).hits ?? [];
}

/** A PromQL instant query as the owner. */
export async function promQuery(obsCookie: string, query: string): Promise<unknown[]> {
  const reply = await request(
    OBS,
    `/observability/api/default/prometheus/api/v1/query?query=${encodeURIComponent(query)}`,
    { cookie: obsCookie },
  );
  if (reply.status !== 200) return [];
  return (JSON.parse(reply.body) as { data?: { result?: unknown[] } }).data?.result ?? [];
}

export async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = "no value";
  for (;;) {
    const value = await probe().catch((error: unknown) => {
      last = String(error);
      return null;
    });
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting (last: ${last})`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

/** The files run in name order, one at a time; earlier files leave what later ones read. */
const STATE = join(tmpdir(), `mt-obs-state-${port}.json`);
export interface SuiteState {
  /** App session cookies, and the owner's obs.<host> session cookie. */
  owner: string;
  member: string;
  obs: string;
  /** The forced failing run (2-pipeline) and the canary its goal carries. */
  runId?: string;
  canary?: string;
  pushPath?: string;
}
export function saveState(value: SuiteState): void {
  writeFileSync(STATE, JSON.stringify(value), { mode: 0o600 });
}
export function state(): SuiteState {
  return JSON.parse(readFileSync(STATE, "utf8")) as SuiteState;
}

/** `docker compose port` exits non-zero when nothing is published. */
export function publishedPort(service: string, target: number): string {
  try {
    return compose(["port", service, String(target)]).trim();
  } catch {
    return "";
  }
}
