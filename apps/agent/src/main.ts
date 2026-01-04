import { AgentEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { createDb, listBrowserSlots } from "@mastertutor/db";
import { createStorage } from "@mastertutor/storage";
import { assertConcurrencyFitsSlots } from "./boot-checks.ts";
import { startHealthServer } from "./health.ts";

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

const health = await startHealthServer({
  port: env.AGENT_HEALTH_PORT,
  checks: {
    db: async () => database.sql`select 1`,
    storage: () => storage.ping(),
  },
  details: async () => ({
    slots: Object.fromEntries(
      (await listBrowserSlots(database.db, env.BROWSER_SLOTS)).map((slot) => [
        slot.name,
        slot.state,
      ]),
    ),
  }),
});
log.info({ port: health.port, slots: env.BROWSER_SLOTS.length }, "agent ready");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  await health.close();
  await database.close();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
