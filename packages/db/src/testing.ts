import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "./migrate.ts";

export const TEST_ROLE_PASSWORDS = {
  web: "test_web_password_0123456789ab",
  agent: "test_agent_password_0123456789",
} as const;

export interface TestDatabase {
  ownerUrl: string;
  webUrl: string;
  agentUrl: string;
  stop(): Promise<void>;
}

/** A migrated pgvector Postgres in Testcontainers with web_role/agent_role ready to log in. */
export async function startTestDatabase(options: { slots?: string[] } = {}): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg17")
    .withDatabase("mastertutor")
    .withUsername("owner")
    .withPassword("owner_password")
    .start();
  const ownerUrl = container.getConnectionUri();
  await runMigrations({
    databaseUrl: ownerUrl,
    webPassword: TEST_ROLE_PASSWORDS.web,
    agentPassword: TEST_ROLE_PASSWORDS.agent,
    slots: options.slots ?? ["browser-1"],
  });
  const asRole = (role: string, password: string) => {
    const url = new URL(ownerUrl);
    url.username = role;
    url.password = password;
    return url.toString();
  };
  return {
    ownerUrl,
    webUrl: asRole("web_role", TEST_ROLE_PASSWORDS.web),
    agentUrl: asRole("agent_role", TEST_ROLE_PASSWORDS.agent),
    stop: async () => {
      await container.stop();
    },
  };
}
