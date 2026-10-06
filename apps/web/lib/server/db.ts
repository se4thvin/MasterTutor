import { createDb, type DbHandle } from "@mastertutor/db";
import { getWebEnv } from "./env.ts";

let handle: DbHandle | undefined;

export function getDb(): DbHandle {
  handle ??= createDb(getWebEnv().DATABASE_URL, { max: 10 });
  return handle;
}
