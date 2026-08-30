// The durable bench ledger (review I1, I2). It lives on the host, outside the repo and every stack
// volume, so wiping or re-creating the bench stack never resets spend or the one-run rule (D46).
// Append-only JSON lines; one CLI at a time holds its exclusive lock.
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { SUITE_IDS, type SuiteId } from "./types.ts";

/** From the passwd entry, not $HOME, so an environment variable cannot point it elsewhere. */
export function ledgerDir(): string {
  return join(userInfo().homedir, ".mastertutor-bench");
}

const Usd = z.number().nonnegative().finite();
const LedgerEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    id: z.uuid(),
    suite: z.enum(SUITE_IDS),
    command: z.string(),
    at: z.string(),
  }),
  z.object({ type: z.literal("spend"), id: z.uuid(), usd: Usd, at: z.string() }),
  z.object({
    type: z.literal("end"),
    id: z.uuid(),
    usd: Usd,
    record: z.string().nullable(),
    at: z.string(),
  }),
  z.object({ type: z.literal("resolve"), id: z.uuid(), at: z.string() }),
  z.object({ type: z.literal("cancel"), id: z.uuid(), at: z.string() }),
]);
type LedgerEvent = z.infer<typeof LedgerEvent>;

export interface LedgerEntry {
  id: string;
  suite: SuiteId;
  command: string;
  startedAt: string;
  /** running: started and never ended, which includes a crashed or killed CLI. */
  /** cancelled: stopped by SIGINT/SIGTERM after cancelling its runs through runs.cancel. */
  status: "running" | "finished" | "resolved" | "cancelled";
  /** Highest spend recorded for this invocation; it never goes down. */
  usd: number;
  record: string | null;
}

export class LedgerBusy extends Error {
  constructor(pid: string) {
    super(`Another bench CLI (pid ${pid}) holds the ledger lock; one invocation at a time (D46).`);
    this.name = "LedgerBusy";
  }
}

export class LedgerRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerRefused";
  }
}

function fold(text: string): LedgerEntry[] {
  const entries = new Map<string, LedgerEntry>();
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let event: LedgerEvent;
    try {
      event = LedgerEvent.parse(JSON.parse(line));
    } catch {
      throw new Error(
        `bench ledger line ${index + 1} is unreadable; fix it by hand rather than lose recorded spend`,
      );
    }
    if (event.type === "start") {
      entries.set(event.id, {
        id: event.id,
        suite: event.suite,
        command: event.command,
        startedAt: event.at,
        status: "running",
        usd: 0,
        record: null,
      });
      continue;
    }
    const entry = entries.get(event.id);
    if (!entry) throw new Error(`bench ledger line ${index + 1} names an unknown run ${event.id}`);
    if (event.type === "spend") entry.usd = Math.max(entry.usd, event.usd);
    else if (event.type === "end") {
      entry.usd = Math.max(entry.usd, event.usd);
      entry.status = "finished";
      entry.record = event.record;
    } else entry.status = event.type === "cancel" ? "cancelled" : "resolved";
  }
  return [...entries.values()];
}

/** Everything a suite has spent, crashed and resolved invocations included (I2). */
export function totalUsd(entries: readonly LedgerEntry[], suite: SuiteId): number {
  return entries.filter((e) => e.suite === suite).reduce((sum, e) => sum + e.usd, 0);
}

/**
 * I1: no invocation starts while an earlier one is still marked running, and a zyBooks run after
 * the first needs the reviewed continuation (`--continue-after-review`, Task 25B).
 */
export function assertMayStart(
  entries: readonly LedgerEntry[],
  suite: SuiteId,
  continues: string | null,
): void {
  const running = entries.find((e) => e.status === "running");
  if (running)
    throw new LedgerRefused(
      `bench run ${running.id} (${running.suite}, started ${running.startedAt}) is still marked running: it crashed or was killed. Check that run in the app, then: pnpm bench resolve ${running.id}`,
    );
  if (suite === "zybooks" && continues === null && entries.some((e) => e.suite === "zybooks"))
    throw new LedgerRefused(
      "A zyBooks run is already recorded. A further run needs --continue-after-review <reviewed record> (D46, Task 25B).",
    );
}

export interface Ledger {
  entries(): LedgerEntry[];
  /** The intent record, written before any run starts. Returns its id. */
  start(suite: SuiteId, command: string): string;
  checkpoint(id: string, usd: number): void;
  end(id: string, usd: number, record: string | null): void;
  /** `pnpm bench resolve <id>`: a person has checked a run that never ended. */
  resolve(id: string): void;
  /** The CLI was interrupted and cancelled its runs; the last checkpointed spend stays. */
  cancel(id: string): void;
  close(): void;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function takeLock(path: string): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = readFileSync(path, "utf8").trim();
      if (attempt === 0 && /^\d+$/.test(holder) && !isAlive(Number(holder))) {
        unlinkSync(path); // the holder died; its run, if any, stays marked running
        continue;
      }
      throw new LedgerBusy(holder);
    }
  }
}

/** Opens the ledger and holds its exclusive lock until close(). */
export function openLedger(dir = ledgerDir()): Ledger {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, "ledger.lock");
  const file = join(dir, "ledger.jsonl");
  takeLock(lock);
  let open = true;
  const read = () => fold(existsSync(file) ? readFileSync(file, "utf8") : "");
  const append = (event: LedgerEvent) => {
    if (!open) throw new Error("bench ledger is closed");
    appendFileSync(file, `${JSON.stringify(LedgerEvent.parse(event))}\n`, { mode: 0o600 });
  };
  const running = (id: string) => {
    const entry = read().find((e) => e.id === id);
    if (entry?.status !== "running") throw new LedgerRefused(`bench run ${id} is not running`);
    return entry;
  };
  const at = () => new Date().toISOString();
  return {
    entries: read,
    start(suite, command) {
      const id = randomUUID();
      append({ type: "start", id, suite, command, at: at() });
      return id;
    },
    checkpoint(id, usd) {
      if (usd > running(id).usd) append({ type: "spend", id, usd, at: at() });
    },
    end(id, usd, record) {
      running(id);
      append({ type: "end", id, usd, record, at: at() });
    },
    resolve(id) {
      running(id);
      append({ type: "resolve", id, at: at() });
    },
    cancel(id) {
      running(id);
      append({ type: "cancel", id, at: at() });
    },
    close() {
      if (!open) return;
      open = false;
      unlinkSync(lock);
    },
  };
}
