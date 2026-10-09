import { randomUUID } from "node:crypto";
import { PersonDecider, type RunStatus, type WaitReason } from "@mastertutor/contracts";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Sql } from "postgres";
import type { Database } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { browserSlots, runs, user, workspaceMembers, workspaces } from "./schema/index.ts";

export const TEST_ROLE_PASSWORDS = {
  web: "test_web_password_0123456789ab",
  agent: "test_agent_password_0123456789",
  observer: "test_observer_password_012345",
} as const;

export interface TestDatabase {
  ownerUrl: string;
  webUrl: string;
  agentUrl: string;
  observerUrl: string;
  stop(): Promise<void>;
}

/** A migrated pgvector Postgres in Testcontainers with web_role, agent_role and observer_role ready to log in. */
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
    observerPassword: TEST_ROLE_PASSWORDS.observer,
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
    observerUrl: asRole("observer_role", TEST_ROLE_PASSWORDS.observer),
    stop: async () => {
      // Stop only. On a loaded host docker stop can return while the daemon still reports the
      // container running, and testcontainers' remove then fails with 409 (it failed a whole
      // integration file once). Ryuk removes stopped containers on a laptop; on the CI host the
      // run's label-scoped cleanup does (scripts/remote-test/run-on-host.sh).
      await container.stop({ remove: false });
    },
  };
}

/** A Better Auth user plus (new or given) workspace membership. Use the owner connection. */
export async function seedMember(
  db: Database,
  options: { workspaceId?: string; role?: "owner" | "member" } = {},
): Promise<{ userId: PersonDecider; workspaceId: string }> {
  const userId = PersonDecider.parse(`user_${randomUUID().replaceAll("-", "")}`);
  await db.insert(user).values({ id: userId, name: "Test", email: `${userId}@example.test` });
  const workspaceId =
    options.workspaceId ??
    (await db.insert(workspaces).values({ name: "Test" }).returning({ id: workspaces.id }))[0]!.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId, role: options.role ?? "owner" });
  return { userId, workspaceId };
}

export async function seedRun(
  db: Database,
  options: { workspaceId: string; status?: RunStatus; waitReason?: WaitReason | null },
): Promise<string> {
  const [run] = await db
    .insert(runs)
    .values({
      workspaceId: options.workspaceId,
      goal: "live test",
      status: options.status ?? "running",
      waitReason: options.waitReason ?? null,
      allowedOrigins: ["https://example.com"],
    })
    .returning({ id: runs.id });
  return run!.id;
}

/** Marks a slot leased to a run the way a claim does (one transaction, both sides). */
export async function leaseSlotForTest(
  db: Database,
  slotName: string,
  runId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(browserSlots)
      .set({
        state: "leased",
        runId,
        leaseOwner: "test",
        leaseExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .where(eq(browserSlots.name, slotName));
    await tx.update(runs).set({ slotName }).where(eq(runs.id, runId));
  });
}

/** Frees a slot back to idle (tests that drive a real slot must leave it idle for the next file). */
export async function releaseSlotForTest(db: Database, slotName: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(runs).set({ slotName: null }).where(eq(runs.slotName, slotName));
    await tx
      .update(browserSlots)
      .set({ state: "idle", runId: null, leaseOwner: null, leaseExpiresAt: null })
      .where(eq(browserSlots.name, slotName));
  });
}

/** Runs action while LISTENing on channel and returns the first payload. */
export async function nextNotification(
  sql: Sql,
  channel: string,
  action: () => Promise<unknown>,
  timeoutMs = 3_000,
): Promise<string> {
  let deliver!: (payload: string) => void;
  const received = new Promise<string>((resolve) => {
    deliver = resolve;
  });
  const { unlisten } = await sql.listen(channel, (payload) => deliver(payload));
  let timer: NodeJS.Timeout | undefined;
  try {
    await action();
    return await Promise.race([
      received,
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No NOTIFY on ${channel}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await unlisten();
  }
}
