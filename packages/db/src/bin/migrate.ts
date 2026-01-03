import { MigrateEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { runMigrations } from "../migrate.ts";

const env = parseEnv(MigrateEnv, process.env);
const log = createLogger({ service: "migrate", level: env.LOG_LEVEL });
await runMigrations({
  databaseUrl: env.DATABASE_URL,
  webPassword: env.WEB_DB_PASSWORD,
  agentPassword: env.AGENT_DB_PASSWORD,
  slots: env.BROWSER_SLOTS,
});
log.info({ slots: env.BROWSER_SLOTS.length }, "migrations, grants and slot rows applied");
