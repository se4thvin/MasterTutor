import { OBSERVE_USERS, ObservabilityInitEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { upsertAlerts } from "../alerts.ts";
import { createO2Client, waitForO2 } from "../client.ts";
import { DASHBOARDS } from "../dashboards/catalog.ts";
import { upsertDashboards } from "../dashboards/upsert.ts";
import { provisionAlertDelivery, provisionStreams, provisionUsers } from "../provision.ts";

// One-shot (spec §11): idempotent, so every deploy re-applies users, retention, dashboards, alerts.
const env = parseEnv(ObservabilityInitEnv, process.env);
const log = createLogger({ service: "observability-init", level: env.LOG_LEVEL });
const root = createO2Client({
  baseUrl: env.OBSERVE_URL,
  email: OBSERVE_USERS.root,
  password: env.OBSERVE_ROOT_PASSWORD,
});
await waitForO2(root);
await provisionUsers(root, {
  ingest: env.OBSERVE_INGEST_PASSWORD,
  viewer: env.OBSERVE_VIEWER_PASSWORD,
});
await provisionStreams(root);
await provisionAlertDelivery(root, {
  url: env.ALERT_WEBHOOK_URL,
  secret: env.ALERT_WEBHOOK_SECRET,
});
await upsertDashboards(root);
await upsertAlerts(root, { spendUsdPerHour: env.SPEND_ALERT_USD_PER_HOUR });
log.info({ dashboards: DASHBOARDS.length }, "observability ready");
