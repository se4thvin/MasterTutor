import { ObserverEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { createDb } from "@mastertutor/db";
import { getTelemetry } from "@mastertutor/telemetry";
import { createRoutes } from "./routes.ts";
import { startPurge } from "./purge.ts";
import { createObserverServer } from "./server.ts";

const env = parseEnv(ObserverEnv, process.env);
const log = createLogger({ service: "observer", level: env.LOG_LEVEL });
const database = createDb(env.DATABASE_URL, { max: 4 });
const routes = await createRoutes({ env, db: database.db, log });
const server = createObserverServer({
  token: env.OBSERVER_INTERNAL_TOKEN,
  appOrigin: new URL(env.PUBLIC_URL).origin,
  routes,
  log,
});
const stopPurge = startPurge(database.db, log);
server.listen(env.OBSERVER_PORT, "0.0.0.0");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  stopPurge();
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections();
  await closed;
  await database.close();
  await getTelemetry().shutdown(3_000);
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
