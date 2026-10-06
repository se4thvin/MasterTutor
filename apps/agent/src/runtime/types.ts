import type { createLogger } from "@mastertutor/contracts/server";
import type { Database } from "@mastertutor/db";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Log = ReturnType<typeof createLogger>;
