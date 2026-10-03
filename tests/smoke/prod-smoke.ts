// Real-model smoke with one takeover (spec §16 Phase 9 "done when"; D47 prod-like). Runs on the
// Mac against Task 22A's stack (compose.yml + compose.prod.yml + tests/bench/compose.local.yml),
// while the caller holds /tmp/mt-behaviour.lock. Spends at most --max-usd (≤ $1), never retries,
// and cancels its run on any exit. Credentials come only from SMOKE_EMAIL / SMOKE_PASSWORD.
// Usage: SMOKE_EMAIL=… SMOKE_PASSWORD=… pnpm prod:smoke [--sign-up] [--max-usd 1]
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  NoteDetail,
  Ok,
  Page,
  RUN_EVENT_SSE_NAME,
  RUN_STATUSES,
  RunDetail,
  RunSummary,
  TERMINAL_RUN_STATUSES,
  decodeRunEventData,
  runEventsPath,
  type Controller,
  type CreateRunInput,
} from "@mastertutor/contracts";
import { chromium } from "playwright-core";
import {
  PROD_LIKE_LOCAL_FILES,
  prodModeProblems,
  resolveForProdCheck,
} from "../compose/prod-mode.ts";

export interface SmokeOptions {
  base: URL;
  maxUsd: number;
  signUp: boolean;
  envFiles: string[];
}

export function parseSmokeArgs(argv: readonly string[]): SmokeOptions {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      base: { type: "string", default: "http://localhost:18080" },
      "max-usd": { type: "string", default: "1" },
      "sign-up": { type: "boolean", default: false },
      "env-file": { type: "string", multiple: true, default: [".env", ".env.bench"] },
    },
  });
  const base = new URL(values.base);
  const loopback = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  const schemeOk = base.protocol === "https:" || (base.protocol === "http:" && loopback);
  if (!schemeOk || base.pathname !== "/" || base.search !== "") {
    throw new Error("--base must be an origin: http only on loopback, https otherwise");
  }
  const maxUsd = Number(values["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 1) {
    throw new Error("--max-usd must be > 0 and ≤ 1");
  }
  return { base, maxUsd, signUp: values["sign-up"], envFiles: values["env-file"] };
}

/**
 * The lock and prod-mode config check describe the local D47 stack; against a real deploy they
 * are meaningless, and `pnpm deploy:check-env` is the production gate instead.
 */
export function needsLocalPreflight(base: URL): boolean {
  return base.hostname === "localhost" || base.hostname === "127.0.0.1";
}

export interface SmokeEvidence {
  detail: RunDetail;
  note: NoteDetail | null;
  controlHolders: Controller[];
}

export function controlHolders(sse: string): Controller[] {
  const holders: Controller[] = [];
  for (const block of sse.split("\n\n")) {
    const lines = block.split("\n");
    if (!lines.includes(`event: ${RUN_EVENT_SSE_NAME}`)) continue;
    const data = lines.find((line) => line.startsWith("data: "));
    const record = data ? decodeRunEventData(data.slice("data: ".length)) : null;
    if (record?.event.type === "control") holders.push(record.event.holder);
  }
  return holders;
}

export function smokeProblems(evidence: SmokeEvidence): string[] {
  const problems: string[] = [];
  if (evidence.detail.status !== "completed") {
    problems.push(`run status is ${evidence.detail.status}, not completed`);
  }
  if (evidence.detail.noteId === null) problems.push("run produced no note");
  if (evidence.note) {
    if (!["verified", "partial"].includes(evidence.note.note.fidelity)) {
      problems.push(`note fidelity is ${evidence.note.note.fidelity}`);
    }
    if (evidence.note.blocks.length < 10) {
      problems.push(`note has ${evidence.note.blocks.length} blocks, expected at least 10`);
    }
  }
  const user = evidence.controlHolders.indexOf("user");
  if (user === -1 || !evidence.controlHolders.slice(user + 1).includes("agent")) {
    problems.push("no control event handed the browser to the user and back to the agent");
  }
  return problems;
}

/* ------------------------------ live run ------------------------------ */

const TASK = {
  goal: "Open https://en.wikipedia.org/wiki/Ada_Lovelace and capture the article, with its images, as a note.",
  allowedOrigins: ["https://en.wikipedia.org", "https://upload.wikimedia.org"],
  approvalMode: "auto_within_allowlist",
} as const;
const UNFINISHED = RUN_STATUSES.filter(
  (s) => !(TERMINAL_RUN_STATUSES as readonly string[]).includes(s),
);
const isTerminal = (status: string) =>
  (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Session {
  base: URL;
  cookies: { name: string; value: string }[];
}
const cookieHeader = (s: Session) => s.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

async function rpc<T>(
  s: Session,
  path: string,
  input: unknown,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const response = await fetch(new URL(`/api/rpc/${path}`, s.base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: s.base.origin,
      cookie: cookieHeader(s),
    },
    body: JSON.stringify({ json: input }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as { json?: { code?: string } };
  if (!response.ok) throw new Error(`${path} failed: ${body.json?.code ?? response.status}`);
  return schema.parse(body.json);
}

async function signIn(base: URL, signUp: boolean): Promise<Session> {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password)
    throw new Error("set SMOKE_EMAIL and SMOKE_PASSWORD (no defaults, P9-27)");
  const post = (path: string, body: unknown) =>
    fetch(new URL(path, base), {
      method: "POST",
      headers: { "content-type": "application/json", origin: base.origin },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  const response = signUp
    ? await post("/api/auth/sign-up/email", { email, password, name: "Smoke" })
    : await post("/api/auth/sign-in/email", { email, password });
  if (!response.ok) {
    throw new Error(`${signUp ? "sign-up" : "sign-in"} failed: HTTP ${response.status}`);
  }
  const cookies = response.headers.getSetCookie().map((line) => {
    const [pair] = line.split(";");
    const at = pair!.indexOf("=");
    return { name: pair!.slice(0, at), value: pair!.slice(at + 1) };
  });
  if (cookies.length === 0) throw new Error("no session cookie");
  return { base, cookies };
}

async function waitFor<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1_000);
  }
}

export async function runProdSmoke(options: SmokeOptions): Promise<void> {
  if (needsLocalPreflight(options.base)) {
    if (!existsSync("/tmp/mt-behaviour.lock")) {
      throw new Error("hold /tmp/mt-behaviour.lock first (one heavy stack at a time)");
    }
    const mode = prodModeProblems(resolveForProdCheck(options.envFiles, PROD_LIKE_LOCAL_FILES));
    if (mode.length > 0) throw new Error(`stack is not production mode:\n${mode.join("\n")}`);
  }

  const session = await signIn(options.base, options.signUp);
  for (const status of UNFINISHED) {
    const page = await rpc(session, "runs/list", { status, limit: 1 }, Page(RunSummary));
    if (page.items.length > 0) {
      throw new Error(`run ${page.items[0]!.id} is ${status}; finish or cancel it first (P9-28)`);
    }
  }

  const input: CreateRunInput = {
    ...TASK,
    allowedOrigins: [...TASK.allowedOrigins],
    targetFolderId: null,
    budget: { maxSteps: 30, maxUsd: options.maxUsd, maxActiveMinutes: 10 },
  };
  const run = await rpc(session, "runs/create", input, RunSummary);
  let finished = false;
  const cancel = async () => {
    if (!finished) await rpc(session, "runs/cancel", { runId: run.id }, Ok).catch(() => undefined);
  };
  const onSignal = () => void cancel().finally(() => process.exit(130));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const get = () => rpc(session, "runs/get", { runId: run.id }, RunDetail);
    // P9-29: the takeover happens only on a running run that holds a slot.
    await waitFor("the run to start on a slot", 120_000, async () => {
      const d = await get();
      if (isTerminal(d.status)) throw new Error(`run ended early: ${d.status}`);
      return d.status === "running" && d.slotName !== null ? d : null;
    });

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(session.cookies.map((c) => ({ ...c, url: options.base.origin })));
    const page = await context.newPage();
    await page.goto(new URL(`/runs/${run.id}`, options.base).href);
    const video = page.frameLocator(".run-live iframe").locator("video");
    await waitFor("live video frames", 60_000, async () =>
      (await video.evaluate((v: HTMLVideoElement) => v.videoWidth).catch(() => 0)) > 0
        ? true
        : null,
    );

    if ((await get()).status !== "running") {
      throw new Error("run left running before the takeover (P9-29)");
    }
    await rpc(session, "runs/takeControl", { runId: run.id }, Ok);
    await waitFor("controller=user", 5_000, async () =>
      (await get()).controller === "user" ? true : null,
    );
    await rpc(session, "runs/handBack", { runId: run.id, note: null }, Ok);
    await waitFor("controller=agent", 5_000, async () =>
      (await get()).controller === "agent" ? true : null,
    );

    const detail = await waitFor("a terminal status", 12 * 60_000, async () => {
      const d = await get();
      if (d.status === "waiting" && d.waitReason !== "takeover") {
        throw new Error(`run waits for ${d.waitReason}; the smoke never decides for a person`);
      }
      return isTerminal(d.status) ? d : null;
    });
    finished = true;
    const note = detail.noteId
      ? await rpc(session, "notes/get", { noteId: detail.noteId }, NoteDetail)
      : null;
    const sse = await fetch(new URL(runEventsPath(run.id), options.base), {
      headers: { accept: "text/event-stream", cookie: cookieHeader(session) },
      signal: AbortSignal.timeout(30_000),
    }).then((r) => r.text());
    const problems = smokeProblems({ detail, note, controlHolders: controlHolders(sse) });
    if (problems.length > 0) {
      throw new Error(`smoke failed for run ${run.id}:\n${problems.join("\n")}`);
    }
    console.log(`PROD SMOKE OK ${run.id} ($${detail.usage.usd.toFixed(2)})`);
  } finally {
    await browser.close();
    await cancel();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runProdSmoke(parseSmokeArgs(process.argv.slice(2)));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
