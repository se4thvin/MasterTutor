import { AgentEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { createDb, listBrowserSlots } from "@mastertutor/db";
import { createStorage } from "@mastertutor/storage";
import { assertConcurrencyFitsSlots } from "./boot-checks.ts";
import { startHealthServer } from "./health.ts";
import { createLibraryServices, libraryHooks } from "./library.ts";
import { createDownloadIngestor } from "./live/downloads.ts";
import { createSlotIdleProbe } from "./live/idle-probe.ts";
import { createLiveHooks, liveControlStore } from "./live/live-hooks.ts";
import { createNekoAdmin } from "./live/neko-admin.ts";
import { createNekoLiveView } from "./live/neko-live-view.ts";
import { createOpenAIModelClient } from "./llm/client.ts";
import { createOpenAI } from "./llm/openai.ts";
import { composeRunHooks } from "./loop/hooks.ts";
import { Supervisor } from "./loop/supervisor.ts";
import { DEFAULT_RUNTIME_CONFIG } from "./runtime/config.ts";
import { slotCdpBaseUrl } from "./slots/probe.ts";
import { createVault, vaultHooks } from "./vault/index.ts";
import { takeVaultKeys } from "./vault/key-env.ts";

// S2: the private key lives in the vault's key pair only; nothing else can read it from the env.
const { keys: vaultKeys, env } = await takeVaultKeys(parseEnv(AgentEnv, process.env), process.env);
const log = createLogger({ service: "agent", level: env.LOG_LEVEL });
const database = createDb(env.DATABASE_URL, { max: 10 });
const storage = createStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});
// One stateless OpenAI client per process (D38): the loop's model client and every later phase use it.
const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL });
const library = createLibraryServices({
  db: database.db,
  storage,
  openai,
  log: log.child({ module: "library" }),
});
const vault = createVault({
  db: database.db,
  keys: vaultKeys,
  log: log.child({ module: "vault" }),
  testMode: env.AGENT_TEST_MODE,
});

// B6: the n.eko live view and the person's downloads, plugged into B1's control lock (spec §10).
// B3's passkey enrolment runs while the person holds control (B3 E.8 note 1).
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
    log: log.child({ module: "downloads" }),
    localRoot: DEFAULT_RUNTIME_CONFIG.downloadsDir,
  }),
  log: log.child({ module: "live" }),
});

try {
  await assertConcurrencyFitsSlots(database.db, env.BROWSER_SLOTS.length);
} catch (error) {
  log.fatal({ err: error }, "boot check failed");
  await database.close();
  process.exit(1);
}

const supervisor = new Supervisor({
  db: database,
  storage,
  model: createOpenAIModelClient(openai),
  slots: env.BROWSER_SLOTS,
  cdpBaseUrl: (name) => slotCdpBaseUrl(name),
  log,
  testMode: env.AGENT_TEST_MODE,
  // B3 owns the vault hooks; B6 owns control, onLeased and onLeaseEnding; B2 adds the library tools
  // (no overlap: a clash throws).
  hooks: composeRunHooks(vaultHooks(vault), liveHooks, libraryHooks(library)),
  config: { shutdownDrainMs: env.AGENT_SHUTDOWN_DRAIN_MS },
});

// /healthz listens first: starting the supervisor waits for every slot to come back (up to minutes).
const health = await startHealthServer({
  port: env.AGENT_HEALTH_PORT,
  checks: {
    db: async () => database.sql`select 1`,
    storage: () => storage.ping(),
  },
  details: async () => ({
    runs: supervisor.activeRuns.length,
    slots: Object.fromEntries(
      (await listBrowserSlots(database.db, env.BROWSER_SLOTS)).map((slot) => [
        slot.name,
        slot.state,
      ]),
    ),
  }),
});
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  // Running runs go to sleep with a wake; the supervisor closes the database handle it owns.
  await supervisor.stop();
  await health.close();
  process.exit(0);
}
// Registered before the (possibly long) boot reconcile, so a SIGTERM during boot is graceful too.
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await supervisor.start();
log.info({ port: health.port, slots: env.BROWSER_SLOTS.length }, "agent ready");
