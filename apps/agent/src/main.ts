import { AgentEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { createDb, listBrowserSlots } from "@mastertutor/db";
import { createStorage } from "@mastertutor/storage";
import { assertConcurrencyFitsSlots } from "./boot-checks.ts";
import { startHealthServer } from "./health.ts";
import { createOpenAIModelClient } from "./llm/client.ts";
import { Supervisor } from "./loop/supervisor.ts";
import { slotCdpBaseUrl } from "./slots/probe.ts";

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

const supervisor = new Supervisor({
  db: database,
  storage,
  model: createOpenAIModelClient({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL }),
  slots: env.BROWSER_SLOTS,
  cdpBaseUrl: (name) => slotCdpBaseUrl(name),
  log,
  testMode: env.AGENT_TEST_MODE,
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
await supervisor.start();
log.info({ port: health.port, slots: env.BROWSER_SLOTS.length }, "agent ready");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  // Running runs go to sleep with a wake; the supervisor closes the database handle it owns.
  await supervisor.stop();
  await health.close();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
