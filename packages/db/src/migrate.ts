import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DbPassword } from "@mastertutor/contracts";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { syncBrowserSlots } from "./queries/slots.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
const GRANTS_FILE = fileURLToPath(new URL("../sql/grants.sql", import.meta.url));

export interface MigrateOptions {
  /** Owner (superuser) connection; never given to web or agent. */
  databaseUrl: string;
  webPassword: string;
  agentPassword: string;
  slots: readonly string[];
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  // DbPassword's alphabet has no quotes or backslashes, so interpolation below is safe.
  const webPassword = DbPassword.parse(options.webPassword);
  const agentPassword = DbPassword.parse(options.agentPassword);
  const sql = postgres(options.databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle({ client: sql }), { migrationsFolder: MIGRATIONS_DIR });
    const grants = await readFile(GRANTS_FILE, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(grants);
      await tx.unsafe(`ALTER ROLE web_role WITH LOGIN PASSWORD '${webPassword}'`);
      await tx.unsafe(`ALTER ROLE agent_role WITH LOGIN PASSWORD '${agentPassword}'`);
      await syncBrowserSlots(tx, options.slots);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
