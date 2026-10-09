import { COPILOT_LIMITS, OBSERVE_USERS, ObserverQueryEnv, parseEnv } from "@mastertutor/contracts";
import { createO2Client } from "@mastertutor/observability/query";
import { createO2Query } from "./o2.ts";
import { createQueryProxyServer } from "./query-proxy.ts";

const env = parseEnv(ObserverQueryEnv, process.env);
const server = createQueryProxyServer(
  createO2Query(
    createO2Client({
      baseUrl: env.OBSERVE_URL,
      email: OBSERVE_USERS.copilot,
      password: env.OBSERVE_COPILOT_PASSWORD,
      timeoutMs: COPILOT_LIMITS.queryTimeoutMs,
    }),
  ),
);
// Bind only the observer-facing interface, never the shared OpenObserve network.
server.listen(4001, "observer-query-private");
const shutdown = () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
