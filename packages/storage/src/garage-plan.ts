import type { GarageInitEnv } from "@mastertutor/contracts";
import type { GarageBootstrapOptions } from "./garage-admin.ts";

/**
 * What garage-init provisions: the app bucket with web (read) and agent (read/write) keys, and,
 * when its keys are set, OpenObserve's own bucket with a key that can reach nothing else (D50).
 */
export function garageBuckets(env: GarageInitEnv): GarageBootstrapOptions[] {
  const common = {
    adminUrl: env.GARAGE_ADMIN_URL,
    adminToken: env.GARAGE_ADMIN_TOKEN,
    capacityBytes: env.GARAGE_CAPACITY_BYTES,
  };
  const plan: GarageBootstrapOptions[] = [
    {
      ...common,
      bucket: env.S3_BUCKET,
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
    },
  ];
  if (env.S3_OBSERVE_ACCESS_KEY_ID && env.S3_OBSERVE_SECRET_ACCESS_KEY)
    plan.push({
      ...common,
      bucket: env.S3_OBSERVE_BUCKET,
      keys: [
        {
          name: "openobserve",
          accessKeyId: env.S3_OBSERVE_ACCESS_KEY_ID,
          secretAccessKey: env.S3_OBSERVE_SECRET_ACCESS_KEY,
          read: true,
          write: true,
        },
      ],
    });
  return plan;
}
