import type { createLogger } from "@mastertutor/contracts/server";
import type { DbTx } from "@mastertutor/db";

export type Tx = DbTx;
export type Log = ReturnType<typeof createLogger>;
