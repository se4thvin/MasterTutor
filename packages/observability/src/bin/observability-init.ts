import { OBSERVE_USERS, ObservabilityInitEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { upsertAlerts } from "../alerts.ts";
import { createO2Client, waitForO2 } from "../client.ts";
import { DASHBOARDS } from "../dashboards/catalog.ts";
import { upsertDashboards } from "../dashboards/upsert.ts";
import {
  provisionAlertDelivery,
  provisionRoot,
  provisionStreams,
  provisionUsers,
} from "../provision.ts";

// One-shot (spec §11): idempotent, so every deploy re-applies users, retention, dashboards, alerts.
const env = parseEnv(ObservabilityInitEnv, process.env);
const log = createLogger({ service: "observability-init", level: env.LOG_LEVEL });
// /healthz checks no credential; the root password is checked (and rotated if asked) next (review I4).
await waitForO2(
  createO2Client({
    baseUrl: env.OBSERVE_URL,
    email: OBSERVE_USERS.root,
    password: env.OBSERVE_ROOT_PASSWORD,
  }),
);
const root = await provisionRoot({
  baseUrl: env.OBSERVE_URL,
  current: env.OBSERVE_ROOT_PASSWORD,
  previous: env.OBSERVE_ROOT_PASSWORD_PREVIOUS,
}).catch((error: unknown) => {
  // Fails loudly: a fatal line in the job's log and a non-zero exit (runbook §13 checks it).
  log.fatal({ err: error }, "observability-init cannot sign in as OpenObserve's root");
  process.exit(1);
});
await provisionUsers(root, {
  ingest: env.OBSERVE_INGEST_PASSWORD,
  viewer: env.OBSERVE_VIEWER_PASSWORD,
  copilot: env.OBSERVE_COPILOT_PASSWORD,
});
await provisionStreams(root);
await provisionAlertDelivery(root, {
  url: env.ALERT_WEBHOOK_URL,
  secret: env.ALERT_WEBHOOK_SECRET,
});
await upsertDashboards(root);
await upsertAlerts(root, { spendUsdPerHour: env.SPEND_ALERT_USD_PER_HOUR });
log.info({ dashboards: DASHBOARDS.length }, "observability ready");
