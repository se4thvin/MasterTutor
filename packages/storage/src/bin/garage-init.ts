import { GarageInitEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { bootstrapGarage, waitForGarageAdmin } from "../garage-admin.ts";
import { garageBuckets } from "../garage-plan.ts";

const env = parseEnv(GarageInitEnv, process.env);
const log = createLogger({ service: "garage-init", level: env.LOG_LEVEL });
await waitForGarageAdmin({ adminUrl: env.GARAGE_ADMIN_URL, adminToken: env.GARAGE_ADMIN_TOKEN });
// One bootstrap per bucket: the layout step is idempotent, so the second call only adds its bucket.
for (const options of garageBuckets(env)) {
  const result = await bootstrapGarage(options);
  log.info(
    {
      bucket: options.bucket,
      createdBucket: result.createdBucket,
      importedKeys: result.importedKeys,
    },
    "garage ready",
  );
}
