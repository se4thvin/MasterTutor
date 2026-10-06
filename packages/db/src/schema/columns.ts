import { sql } from "drizzle-orm";
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** jsonb DEFAULT from a contracts constant, so the value is defined once. */
export const jsonbDefault = (value: unknown) =>
  sql.raw(`'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`);
