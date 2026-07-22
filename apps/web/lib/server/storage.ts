// B2 Task 11 (base plan) creates this file; Phase 7 Task 0D created it early for the screenshot
// routes. B2 keeps it as is.
import { createStorage, type Storage } from "@mastertutor/storage";
import { getWebEnv } from "./env.ts";

let storage: Storage | undefined;

/** web's Garage client: read-only key (spec §3.1 rule 6). */
export function getStorage(): Storage {
  if (!storage) {
    const env = getWebEnv();
    storage = createStorage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  return storage;
}
