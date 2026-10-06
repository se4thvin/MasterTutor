import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodeNotify, type RunStatus, type WaitReason } from "@mastertutor/contracts";
import {
  approvals,
  browserSlots,
  createDb,
  ensureWorkspaceMember,
  runTranscript,
  runs,
  type DbHandle,
} from "@mastertutor/db";
import { startTestDatabase } from "@mastertutor/db/testing";
import {
  generateVaultKeyPair,
  vaultKeyPairFromPrivate,
  type VaultKeyPair,
} from "@mastertutor/sealing/open";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Scenario } from "../../../../../tests/llm-mock/src/scenario.ts";
import { startLlmMock, type LlmMock } from "../../../../../tests/llm-mock/src/server.ts";
import { createOpenAIModelClient } from "../../llm/client.ts";
import { Supervisor } from "../../loop/supervisor.ts";
import type { BrowserControl } from "../../slots/lifecycle.ts";
import { insertRun, type InsertRunOptions } from "../../testing/db.ts";
import { createMemoryStorage } from "../../testing/memory-storage.ts";
import { waitFor } from "../../testing/wait.ts";
import { createVault, vaultHooks } from "../index.ts";
import { startChromium } from "./chromium.ts";
import { captureLog } from "./env.ts";

export interface VaultScenario {
  owner: DbHandle;
  storage: ReturnType<typeof createMemoryStorage>;
  mock: LlmMock;
  workspaceId: string;
  userId: string;
  keys: VaultKeyPair;
  logs(): string;
  /**
   * Queues a run with these options (allowed origins, mode, …), tagged for the named scenario.
   * The options pass through untouched: no vault code reads the approval mode (D44).
   */
  start(
    input: { name: string; goal: string } & Omit<InsertRunOptions, "workspaceId" | "goal">,
  ): Promise<string>;
  /** Waits until the run waits for a person or ends, then reports where it stopped. */
  settle(runId: string): Promise<{ status: RunStatus; waitReason: WaitReason | null }>;
  /** The web's decideApproval for the pending approval, as the scenario user. */
  decide(runId: string, decision: "approved" | "denied"): Promise<void>;
  /** Every function_call_output the model was sent (run_transcript). */
  toolOutputs(runId: string): Promise<string[]>;
  stop(): Promise<void>;
}

/** A slot whose browser "restarts" instantly: the local Chromium stays up (F12). */
function localControl(): BrowserControl {
  let generation = 0;
  return {
    readBrowserId: async () => `local-${generation}`,
    closeBrowser: async () => void (generation += 1),
  };
}

/**
 * A queued run needs two idle slots (one stays free for wakes, spec §5.2), so the scenario has two;
 * both are the one local Chromium, and only one run ever leases.
 */
const SLOTS = ["browser-1", "browser-2"];

const SETTLED: readonly RunStatus[] = ["waiting", "completed", "failed", "cancelled"];

/**
 * The real B1 loop (Supervisor, RunWorker, SessionLoopBrowser, masking, network policy) with the
 * vault plugged in through hooks, a local Chromium as the only slot, llm-mock as the model and
 * memory storage as Garage (F12). Test only.
 */
export async function startVaultScenario(options: {
  scenarios: Scenario[];
  chromiumArgs: string[];
}): Promise<VaultScenario> {
  const testDb = await startTestDatabase({ slots: SLOTS });
  const owner = createDb(testDb.ownerUrl, { max: 2 });
  const web = createDb(testDb.webUrl, { max: 2 });
  const agentDb = createDb(testDb.agentUrl, { max: 6 });
  const userId = "scenario-user";
  await owner.sql`insert into "user" (id, name, email) values (${userId}, 'Scenario', 'scenario@example.test')`;
  const { workspaceId } = await ensureWorkspaceMember(web.db, userId);
  const keys = await vaultKeyPairFromPrivate((await generateVaultKeyPair()).privateKeyBase64);
  const log = captureLog();
  const mock = await startLlmMock({ scenarios: options.scenarios });
  const chromium = await startChromium(options.chromiumArgs);
  const downloadsDir = await mkdtemp(path.join(os.tmpdir(), "vault-downloads-"));
  const storage = createMemoryStorage();
  const vault = createVault({ db: agentDb.db, keys, log: log.logger, testMode: true });
  const supervisor = new Supervisor({
    db: agentDb,
    storage,
    model: createOpenAIModelClient({ apiKey: "scenario", baseURL: `${mock.url}/v1` }),
    slots: SLOTS,
    cdpBaseUrl: async () => chromium.cdpBaseUrl,
    log: log.logger,
    testMode: true,
    hooks: vaultHooks(vault),
    browserControl: localControl(),
    config: { slotPollMs: 5, shutdownDrainMs: 5_000, downloadsDir },
  });
  await supervisor.start();
  await waitFor(
    async () =>
      (await owner.db.select().from(browserSlots).where(eq(browserSlots.state, "idle"))).length ===
      SLOTS.length,
    { label: "slot idle", timeoutMs: 30_000 },
  );
  const read = async (runId: string) =>
    (await owner.db.select().from(runs).where(eq(runs.id, runId)))[0]!;
  return {
    owner,
    storage,
    mock,
    workspaceId,
    userId,
    keys,
    logs: () => log.text(),
    async start({ name, goal, ...options }) {
      const run = await insertRun(owner.db, {
        ...options,
        workspaceId,
        goal: `[scenario:${name}] ${goal}`,
      });
      await owner.sql.notify("run_queued", encodeNotify("run_queued", { runId: run.id }));
      return run.id;
    },
    async settle(runId) {
      const run = await waitFor(
        async () => {
          const row = await read(runId);
          return SETTLED.includes(row.status) ? row : null;
        },
        { label: "run settled", timeoutMs: 90_000, intervalMs: 50 },
      );
      return { status: run.status, waitReason: run.waitReason };
    },
    async decide(runId, decision) {
      await owner.db
        .update(approvals)
        .set({ status: decision, decidedBy: userId, decidedAt: sql`now()` })
        .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")));
      await owner.db
        .update(runs)
        .set({ wakeRequestedAt: sql`now()` })
        .where(eq(runs.id, runId));
      await owner.sql.notify("run_wake", encodeNotify("run_wake", { runId, reason: "approval" }));
      await waitFor(async () => (await read(runId)).status !== "waiting", {
        label: "resumed",
        timeoutMs: 30_000,
      });
    },
    async toolOutputs(runId) {
      const rows = await owner.db
        .select({ item: runTranscript.item })
        .from(runTranscript)
        .where(eq(runTranscript.runId, runId))
        .orderBy(asc(runTranscript.seq));
      return rows.flatMap((row) => {
        // A transcript row is { dir, item, responseId, … }: the model-facing item is inside.
        const item = (row.item as { item?: { type?: string; output?: unknown } }).item ?? {};
        return item.type === "function_call_output" && typeof item.output === "string"
          ? [item.output]
          : [];
      });
    },
    async stop() {
      await supervisor.stop(); // closes agentDb
      await Promise.all([mock.close(), chromium.stop(), web.close(), owner.close()]);
      await rm(downloadsDir, { recursive: true, force: true });
      await testDb.stop();
    },
  };
}
