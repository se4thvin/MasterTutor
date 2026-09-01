// Benchmark harness CLI (Phase 10). It never accepts site credentials (D34): the Vault UI is the only path.
//   pnpm bench init --stack test|prod
//   pnpm bench run|baseline|survey --suite fixtures|zybooks [--track computer_use|browser_use|both] [--only key]...
//        [--approval-mode auto_within_allowlist|bypass] [--acknowledge-bypass] [--max-total-usd N] [--max-run-usd N]
//        [--once] [--continue-after-review <record.md>] [--retries N] [--human-timeout-min 20] [--stall-min 10]
//        [--allow-incomplete-baseline] [--reuse-baseline] [--mock]
//   pnpm bench vault-check --suite fixtures|zybooks
//   pnpm bench watch <runId>
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  AUTO_HAND_BACK_IDLE_MS,
  TOOL_PROFILES,
  Uuid,
  type ToolProfile,
} from "@mastertutor/contracts";
import { z } from "zod";
import { SignUpClosed, authCookie, createApi } from "./app-client.ts";
import {
  BENCH_ACCOUNT_FILE,
  STACK_COMPOSE,
  assertNoSiteCredentialsInEnv,
  readBenchEnv,
  writeBenchEnv,
  type BenchEnv,
} from "./config.ts";
import { loadRunTrace } from "./evidence.ts";
import {
  assertContinueAllowed,
  readFrontmatter,
  renderReport,
  renderTicket,
  type RecordSummary,
  type SuiteRunResult,
} from "./report.ts";
import {
  runBaseline,
  runSuite,
  selectBenchmarks,
  type RunnerDeps,
  type SpendBook,
  type SuiteRunOptions,
} from "./run-suite.ts";
import { assertMayStart, openLedger, totalUsd, type Ledger } from "./ledger.ts";
import { appendEvidence } from "./appendix.ts";
import { ensureFixtureVaultItem, fixturesSuite } from "./suites/fixtures.ts";
import { surveySuite, zybooksSuite } from "./suites/zybooks.ts";
import { writeSurveyEvidence } from "./survey.ts";
import {
  BENCH_APPROVAL_MODES,
  STACKS,
  SUITE_IDS,
  type StackName,
  type SuiteDefinition,
  type SuiteId,
  type VaultRequirement,
} from "./types.ts";
import { vaultStatus } from "./vault-check.ts";
import { assertProdMode } from "./prod-check.ts";
import type { BenchApi } from "./app-client.ts";
import { watchRun, type WatchPolicy } from "./watch.ts";

/** 0 ok; 1 a run failed or errored; 2 a usage error; 3 vault-check: an item is not ready. */
export const BENCH_EXIT = { ok: 0, failed: 1, usage: 2, vaultNotReady: 3 } as const;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** D46: $500 total and $50 per run for zyBooks (D47); fixtures $10 total, $3 per run (07 T22A). */
export const SUITE_DEFAULTS = {
  fixtures: { maxTotalUsd: 10, maxRunUsd: 3, onBudget: "finish_now", onSafetyCheck: "deny" },
  zybooks: { maxTotalUsd: 500, maxRunUsd: 50, onBudget: "ask_human", onSafetyCheck: "ask_human" },
} as const satisfies Record<
  SuiteId,
  { maxTotalUsd: number; maxRunUsd: number } & Pick<WatchPolicy, "onBudget" | "onSafetyCheck">
>;
/** Hard caps (D46, review I2): no flag or env variable raises them. */
const ZYBOOKS_CAP_USD = 500;
const ZYBOOKS_RUN_CAP_USD = 50;
const SUITES: Record<SuiteId, () => SuiteDefinition> = {
  fixtures: fixturesSuite,
  zybooks: zybooksSuite,
};

export type CliCommand =
  | { kind: "init"; stack: StackName; baseUrl: string | null; origin: string | null }
  | { kind: "watch"; runId: string }
  | { kind: "vault-check"; suite: SuiteId }
  | { kind: "resolve"; id: string }
  | { kind: "run" | "baseline" | "survey"; suite: SuiteId; options: SuiteRunOptions };

const money = (flag: string) =>
  z.coerce
    .number({ error: `${flag} must be a number` })
    .positive(`${flag} must be positive`)
    .max(1_000, `${flag} is at most 1000`);

function oneOf<T extends string>(values: readonly T[], flag: string, value: string | undefined): T {
  if (value === undefined || !(values as readonly string[]).includes(value))
    throw new UsageError(`${flag} must be one of ${values.join(", ")}`);
  return value as T;
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UsageError(result.error.issues[0]?.message ?? "invalid value");
  return result.data;
}

/** Pure: argv (no `--`) and the suite's records → a validated command. Unknown flags throw. */
export function parseCli(
  argv: readonly string[],
  listRecords: (suite: SuiteId) => RecordSummary[],
): CliCommand {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      stack: { type: "string" },
      "base-url": { type: "string" },
      origin: { type: "string" },
      suite: { type: "string" },
      track: { type: "string", default: "both" },
      only: { type: "string", multiple: true },
      mock: { type: "boolean", default: false },
      "approval-mode": { type: "string" },
      "acknowledge-bypass": { type: "boolean", default: false },
      "max-total-usd": { type: "string" },
      "max-run-usd": { type: "string" },
      once: { type: "boolean", default: false },
      "continue-after-review": { type: "string" },
      retries: { type: "string", default: "0" },
      "human-timeout-min": { type: "string", default: "20" },
      "stall-min": { type: "string", default: "10" },
      "allow-incomplete-baseline": { type: "boolean", default: false },
      "reuse-baseline": { type: "boolean", default: false },
    },
  });
  const [command, arg, ...extra] = positionals;
  if (extra.length > 0) throw new UsageError(`unexpected arguments: ${extra.join(" ")}`);
  if (command === "init") {
    const url = (flag: string, value: string | undefined) =>
      value === undefined ? null : parsed(z.url({ error: `${flag} must be a URL` }), value);
    return {
      kind: "init",
      stack: oneOf(STACKS, "--stack", values.stack),
      baseUrl: url("--base-url", values["base-url"]),
      origin: url("--origin", values.origin),
    };
  }
  if (command === "watch") return { kind: "watch", runId: parsed(Uuid, arg) };
  if (command === "resolve") return { kind: "resolve", id: parsed(Uuid, arg) };
  const suite = oneOf(SUITE_IDS, "--suite", values.suite);
  if (command === "vault-check") return { kind: "vault-check", suite };
  if (command !== "run" && command !== "baseline" && command !== "survey")
    throw new UsageError(
      "usage: pnpm bench <init|run|baseline|survey|vault-check|watch|resolve> …",
    );
  if (command === "survey" && suite !== "zybooks")
    throw new UsageError("survey supports --suite zybooks only");

  const defaults = SUITE_DEFAULTS[suite];
  if (values.mock && suite === "zybooks")
    throw new UsageError(
      "--mock is for harness tests on the fixtures suite only; zyBooks runs prod-like (D47)",
    );
  const approvalMode =
    values["approval-mode"] === undefined
      ? null
      : oneOf(BENCH_APPROVAL_MODES, "--approval-mode", values["approval-mode"]);
  if (approvalMode === "bypass" && !values["acknowledge-bypass"])
    throw new UsageError("--approval-mode bypass needs --acknowledge-bypass (D44)");
  const tracks: readonly ToolProfile[] =
    values.track === "both" ? [...TOOL_PROFILES] : [oneOf(TOOL_PROFILES, "--track", values.track)];
  const maxTotalUsd =
    values["max-total-usd"] === undefined
      ? defaults.maxTotalUsd
      : parsed(money("--max-total-usd"), values["max-total-usd"]);
  if (suite === "zybooks" && maxTotalUsd > ZYBOOKS_CAP_USD)
    throw new UsageError(
      `--max-total-usd: the zyBooks benchmark is capped at $${ZYBOOKS_CAP_USD} (D46)`,
    );
  const maxRunUsd =
    values["max-run-usd"] === undefined
      ? defaults.maxRunUsd
      : parsed(money("--max-run-usd"), values["max-run-usd"]);
  if (suite === "zybooks" && maxRunUsd > ZYBOOKS_RUN_CAP_USD)
    throw new UsageError(`--max-run-usd: a zyBooks run is capped at $${ZYBOOKS_RUN_CAP_USD} (D46)`);
  if (maxRunUsd > maxTotalUsd) throw new UsageError("--max-run-usd cannot exceed --max-total-usd");
  const retries = parsed(z.coerce.number().int().min(0).max(5), values.retries);
  const humanTimeoutMs = parsed(z.coerce.number().positive(), values["human-timeout-min"]) * 60_000;
  if (humanTimeoutMs < AUTO_HAND_BACK_IDLE_MS)
    throw new UsageError(
      `--human-timeout-min must be at least ${AUTO_HAND_BACK_IDLE_MS / 60_000} (B6's auto hand-back)`,
    );
  const stallMs = parsed(z.coerce.number().positive(), values["stall-min"]) * 60_000;

  const reviewPath = values["continue-after-review"] ?? null;
  let continues: string | null = null;
  if (reviewPath !== null) {
    if (values.once) throw new UsageError("--once and --continue-after-review conflict");
    try {
      // Only this suite's records are listed, so another suite's record is "no record" (D46 gate).
      continues = assertContinueAllowed(reviewPath, listRecords(suite));
    } catch (error) {
      throw new UsageError(`--continue-after-review: ${(error as Error).message}`);
    }
  }
  if (command === "survey" && continues === null)
    throw new UsageError(
      "survey runs only as a reviewed continuation: --continue-after-review <record> (D46)",
    );
  const once = continues === null && (suite === "zybooks" || values.once);
  if (once && retries > 0)
    throw new UsageError(
      "--retries needs --continue-after-review <reviewed report>: the first run never retries (D46)",
    );

  return {
    kind: command,
    suite,
    options: {
      mock: values.mock,
      tracks,
      only: values.only ?? null,
      approvalMode,
      bypassAcknowledged: values["acknowledge-bypass"],
      maxTotalUsd,
      maxRunUsd,
      once,
      retries,
      continues,
      policy: {
        onBudget: defaults.onBudget,
        onSafetyCheck: defaults.onSafetyCheck,
        humanTimeoutMs,
        stallMs,
      },
      allowIncompleteBaseline: values["allow-incomplete-baseline"],
      reuseBaseline: values["reuse-baseline"],
      command: argv.join(" "),
    },
  };
}

function nextTicketId(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const max = readdirSync(dir).reduce(
    (m, f) => Math.max(m, Number(/^BT-(\d+)\.md$/.exec(f)?.[1] ?? 0)),
    0,
  );
  return `BT-${String(max + 1).padStart(4, "0")}`;
}

const RECORDS_ROOT = "orchestration/benchmarks";

/** A suite's records, oldest first. Ids sort by name: the run number is zero-padded. */
export function listRecords(suite: SuiteId, root = RECORDS_ROOT): RecordSummary[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter(
      (d) =>
        new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${suite}-\\d{2,}$`).test(d) &&
        existsSync(join(root, d, "record.md")),
    )
    .sort()
    .map((d) => ({
      id: d,
      path: join(root, d, "record.md"),
      fields: readFrontmatter(readFileSync(join(root, d, "record.md"), "utf8")),
    }));
}

/** The full outcome and failure record; mock runs go to the git-ignored .out and write no tickets (P10b-15). */
export function writeRecord(
  result: SuiteRunResult,
  root = result.mock ? "tests/bench/.out" : RECORDS_ROOT,
): string {
  const day = result.finishedAt.slice(0, 10);
  mkdirSync(root, { recursive: true });
  const n = readdirSync(root).filter((d) => d.startsWith(`${day}-${result.suite}-`)).length + 1;
  const dir = join(root, `${day}-${result.suite}-${String(n).padStart(2, "0")}`);
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, "record.md");
  if (!result.mock) {
    const tickets = join(root, "tickets");
    for (const r of result.results.filter((x) => x.outcome !== "passed")) {
      r.ticket = nextTicketId(tickets);
      writeFileSync(
        join(tickets, `${r.ticket}.md`),
        renderTicket(r.ticket, r, reportPath, result.finishedAt),
      );
    }
  }
  writeFileSync(reportPath, renderReport(result, reportPath));
  return reportPath;
}

const today = () => new Date().toISOString().slice(0, 10);
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
const exec = promisify(execFile);

async function init(cmd: Extract<CliCommand, { kind: "init" }>): Promise<void> {
  let existing: BenchEnv | null;
  try {
    existing = existsSync(BENCH_ACCOUNT_FILE) ? readBenchEnv() : null;
  } catch {
    existing = null;
  }
  const env: BenchEnv = {
    BENCH_STACK: cmd.stack,
    BENCH_BASE_URL: cmd.baseUrl ?? existing?.BENCH_BASE_URL ?? "http://localhost:18080",
    BENCH_EMAIL: existing?.BENCH_EMAIL ?? "bench-owner@local.test",
    BENCH_PASSWORD: existing?.BENCH_PASSWORD ?? randomBytes(24).toString("base64url"),
  };
  const origin = cmd.origin ?? existing?.BENCH_APP_ORIGIN;
  if (origin) env.BENCH_APP_ORIGIN = origin;
  // The real Better Auth flow (D47): sign up once, sign in after.
  await authCookie(
    env.BENCH_BASE_URL,
    env.BENCH_EMAIL,
    env.BENCH_PASSWORD,
    existing ? "sign-in" : "sign-up",
    env.BENCH_APP_ORIGIN,
  );
  writeBenchEnv(BENCH_ACCOUNT_FILE, env);
  log(
    `${BENCH_ACCOUNT_FILE} written (mode 600). Sign in to the UI with BENCH_EMAIL and the password in that file to use the Vault page.`,
  );
}

export function exitCodeOf(error: unknown): number {
  return error instanceof UsageError ? BENCH_EXIT.usage : BENCH_EXIT.failed;
}

/** Every required item's status line; 0 only when all are ready and complete (D34: names only). */
export async function vaultCheck(
  api: BenchApi,
  suite: SuiteDefinition,
): Promise<{ code: 0 | 3; lines: string[] }> {
  const statuses = await Promise.all(
    requirements(suite).map((requirement) => vaultStatus(api, requirement)),
  );
  return {
    code: statuses.every((s) => s.ready) ? BENCH_EXIT.ok : BENCH_EXIT.vaultNotReady,
    lines: statuses.map((s) => s.line),
  };
}

function requirements(suite: SuiteDefinition): VaultRequirement[] {
  const seen = new Map<string, VaultRequirement>();
  for (const b of suite.benchmarks)
    if (b.requiredVaultItem)
      seen.set(`${b.requiredVaultItem.alias}|${b.requiredVaultItem.origin}`, b.requiredVaultItem);
  return [...seen.values()];
}

/**
 * One invocation inside the durable ledger (I1, I2): refused while an earlier run is still marked
 * running or (zyBooks) without the reviewed continuation; the intent is written before any run
 * starts, spend is checkpointed during it, and the entry closes only after its record is written.
 * If `run` throws or the process dies, the entry stays running until `pnpm bench resolve <id>`.
 */
export async function recordedRun(
  ledger: Ledger,
  suite: SuiteId,
  continues: string | null,
  command: string,
  run: (spend: SpendBook) => Promise<SuiteRunResult>,
  write: (result: SuiteRunResult) => string,
  interrupt?: Interrupt,
): Promise<{ result: SuiteRunResult; path: string }> {
  assertMayStart(ledger.entries(), suite, continues);
  const priorUsd = totalUsd(ledger.entries(), suite);
  const id = ledger.start(suite, command);
  const runIds: string[] = [];
  const stop = interrupt ? cancelOnSignal(interrupt, ledger, id, runIds) : () => undefined;
  try {
    const result = await run({
      priorUsd,
      checkpoint: (usd) => ledger.checkpoint(id, usd),
      runStarted: (runId) => void runIds.push(runId),
    });
    const path = write(result);
    ledger.end(id, Math.max(0, result.spentAfterUsd - result.spentBeforeUsd), path);
    return { result, path };
  } finally {
    stop();
  }
}

export interface Interrupt {
  api: BenchApi;
  log(line: string): void;
  exit(code: number): void;
}

/**
 * SIGINT/SIGTERM: cancel every run this invocation started through the person-facing runs.cancel,
 * mark the ledger entry cancelled (its last checkpointed spend stays), release the lock, exit 130.
 * Returns the function that removes the handlers.
 */
function cancelOnSignal(
  interrupt: Interrupt,
  ledger: Ledger,
  entryId: string,
  runIds: readonly string[],
): () => void {
  let handling = false;
  const handler = (signal: NodeJS.Signals) => {
    if (handling) return;
    handling = true;
    interrupt.log(`${signal}: cancelling ${runIds.length} run(s)`);
    void (async () => {
      for (const runId of runIds)
        // An already-finished run refuses the cancel; that is fine.
        await interrupt.api.runs
          .cancel({ runId })
          .catch((error: unknown) => interrupt.log(`cancel ${runId}: ${(error as Error).message}`));
      ledger.cancel(entryId);
      ledger.close();
      interrupt.exit(130);
    })();
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}

/** --mock runs are harness tests on llm-mock (D47): no real spend, so no ledger. */
const NO_SPEND: SpendBook = {
  priorUsd: 0,
  checkpoint: () => undefined,
  runStarted: () => undefined,
};

async function main(argv: string[]): Promise<void> {
  assertNoSiteCredentialsInEnv(process.env);
  const cmd = parseCli(argv, (suite) => listRecords(suite));
  if (cmd.kind === "init") return init(cmd);
  if (cmd.kind === "resolve") {
    const ledger = openLedger();
    try {
      ledger.resolve(cmd.id);
    } finally {
      ledger.close();
    }
    log(`bench run ${cmd.id} marked resolved; its recorded spend still counts toward the cap.`);
    return;
  }
  const env = readBenchEnv();
  const cookie = await authCookie(
    env.BENCH_BASE_URL,
    env.BENCH_EMAIL,
    env.BENCH_PASSWORD,
    "sign-in",
    env.BENCH_APP_ORIGIN,
  );
  const api = createApi(env.BENCH_BASE_URL, cookie, env.BENCH_APP_ORIGIN);
  if (cmd.kind === "watch") {
    await watchRun({ api, baseUrl: env.BENCH_BASE_URL, cookie, log, now: Date.now }, cmd.runId, {
      onBudget: "ask_human",
      onSafetyCheck: "ask_human",
      humanTimeoutMs: Number.POSITIVE_INFINITY,
      stallMs: Number.POSITIVE_INFINITY,
    });
    return;
  }
  const suite = cmd.kind === "survey" ? surveySuite() : SUITES[cmd.suite]();
  if (env.BENCH_STACK !== suite.stack)
    throw new UsageError(
      `suite ${suite.id} runs on the ${suite.stack} stack, but ${BENCH_ACCOUNT_FILE} is for ${env.BENCH_STACK}`,
    );
  if (cmd.kind === "vault-check") {
    const { code, lines } = await vaultCheck(api, suite);
    for (const line of lines) log(line);
    process.exitCode = code;
    return;
  }
  if (suite.id === "fixtures") {
    // Test stack only (suite.stack is "test"): the dummy login comes from the committed .env.test.
    log(
      `fixture vault item: ${await ensureFixtureVaultItem(api, readFileSync(".env.test", "utf8"))}`,
    );
  }
  // D47: the prod-like stack runs only after its preflight; a stack that is not prod-like is refused.
  if (suite.stack === "local") await assertProdMode(STACK_COMPOSE.local);
  const compose = STACK_COMPOSE[suite.stack];
  const deps = (spend: SpendBook): RunnerDeps => ({
    api,
    baseUrl: env.BENCH_BASE_URL,
    cookie,
    log,
    now: Date.now,
    today,
    records: () => listRecords(suite.id),
    compose,
    spend,
    loadTrace: loadRunTrace,
    reset: async (command) => {
      const [c, ...a] = compose;
      await exec(c!, [...a, ...command]);
    },
  });
  const options = cmd.options;
  selectBenchmarks(suite, options); // usage mistakes fail before the ledger records anything
  const run = (spend: SpendBook) =>
    cmd.kind === "baseline"
      ? runBaseline(suite, options, deps(spend))
      : runSuite(suite, options, deps(spend));
  let result: SuiteRunResult;
  let path: string;
  if (options.mock) {
    result = await run(NO_SPEND);
    path = writeRecord(result);
  } else {
    const ledger = openLedger();
    try {
      ({ result, path } = await recordedRun(
        ledger,
        suite.id,
        options.continues,
        options.command,
        run,
        (r) => writeRecord(r),
        { api, log, exit: (code) => process.exit(code) },
      ));
    } finally {
      ledger.close();
    }
  }
  log(`record: ${path}`);
  // Evidence the record needs beyond T20's report (Task 23): per-step evidence on every real
  // zyBooks record, and the survey's numbers (raw page text goes only to the git-ignored .raw/).
  const evidence = { api, compose, loadTrace: loadRunTrace };
  if (suite.id === "zybooks" && !result.mock) await appendEvidence(result, path, evidence, suite);
  if (cmd.kind === "survey")
    log(
      `survey evidence: ${(await writeSurveyEvidence(result, path, evidence)) ?? "none (no run started)"}`,
    );
  if (result.mode === "once")
    log(
      `Stopped after one run (D46). Review ${path}, set reviewed: true, reviewed_by and authorize: N in its frontmatter, then continue with --continue-after-review ${path}.`,
    );
  process.exitCode =
    result.results.length > 0 && result.results.every((r) => r.outcome === "passed")
      ? BENCH_EXIT.ok
      : BENCH_EXIT.failed;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof SignUpClosed || error instanceof UsageError ? error.message : error,
    );
    process.exitCode = exitCodeOf(error);
  });
