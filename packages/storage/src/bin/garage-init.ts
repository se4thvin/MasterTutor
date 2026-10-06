import { GarageInitEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { bootstrapGarage, waitForGarageAdmin } from "../garage-admin.ts";

const env = parseEnv(GarageInitEnv, process.env);
const log = createLogger({ service: "garage-init", level: env.LOG_LEVEL });
await waitForGarageAdmin({ adminUrl: env.GARAGE_ADMIN_URL, adminToken: env.GARAGE_ADMIN_TOKEN });
const result = await bootstrapGarage({
  adminUrl: env.GARAGE_ADMIN_URL,
  adminToken: env.GARAGE_ADMIN_TOKEN,
  bucket: env.S3_BUCKET,
  capacityBytes: env.GARAGE_CAPACITY_BYTES,
  keys: [
    {
      name: "web",
      accessKeyId: env.S3_WEB_ACCESS_KEY_ID,
      secretAccessKey: env.S3_WEB_SECRET_ACCESS_KEY,
      read: true,
      write: false,
    },
    {
      name: "agent",
      accessKeyId: env.S3_AGENT_ACCESS_KEY_ID,
      secretAccessKey: env.S3_AGENT_SECRET_ACCESS_KEY,
      read: true,
      write: true,
    },
  ],
});
log.info(
  { bucket: env.S3_BUCKET, createdBucket: result.createdBucket, importedKeys: result.importedKeys },
  "garage ready",
);
