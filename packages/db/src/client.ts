import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsQueryResultHKT,
} from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema/index.ts";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  readonly db: Database;
  readonly sql: Sql;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  max?: number;
}

export function createDb(databaseUrl: string, options: CreateDbOptions = {}): DbHandle {
  const sql = postgres(databaseUrl, { max: options.max ?? 10, onnotice: () => undefined });
  const db = drizzle({ client: sql, schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

/** A drizzle transaction handle. Writes that must commit with a NOTIFY take one of these. */
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything query helpers accept: the pool or a transaction. */
export type DbLike = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
