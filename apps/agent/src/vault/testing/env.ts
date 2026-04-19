import type { ImapConfig, TypedSecretField } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { createDb, createVaultItem, ensureWorkspaceMember, type DbHandle } from "@mastertutor/db";
import { startTestDatabase } from "@mastertutor/db/testing";
import { sealValue } from "@mastertutor/sealing";
import {
  generateVaultKeyPair,
  vaultKeyPairFromPrivate,
  type VaultKeyPair,
} from "@mastertutor/sealing/open";
import { defaultSleep, type VaultDeps } from "../context.ts";
import { resolveVaultTarget, type Log } from "../runtime.ts";
import { createSecretFingerprints } from "../fingerprints.ts";

export interface CapturedLog {
  logger: Log;
  text(): string;
}

/** A logger whose output the canary tests can scan (spec §12: logs). */
export function captureLog(): CapturedLog {
  const lines: string[] = [];
  const logger = createLogger({
    service: "agent-test",
    level: "debug",
    destination: {
      write: (line: string) => {
        lines.push(line);
      },
    },
  });
  return { logger, text: () => lines.join("") };
}

export interface SeedItem {
  alias: string;
  origin: string;
  secrets: Partial<Record<TypedSecretField, string>>;
  imap?: ImapConfig | null;
}

export interface VaultTestEnv {
  owner: DbHandle;
  web: DbHandle;
  agent: DbHandle;
  workspaceId: string;
  userId: string;
  keys: VaultKeyPair;
  log: CapturedLog;
  newRun(allowedOrigins?: string[]): Promise<string>;
  /** Seeds through the real web path (seal with the public key, web_role insert). */
  seedItem(input: SeedItem): Promise<string>;
  deps(overrides?: Partial<VaultDeps>): VaultDeps;
  stop(): Promise<void>;
}

export async function startVaultTestEnv(): Promise<VaultTestEnv> {
  const testDb = await startTestDatabase();
  const owner = createDb(testDb.ownerUrl, { max: 2 });
  const web = createDb(testDb.webUrl, { max: 2 });
  const agent = createDb(testDb.agentUrl, { max: 4 });
  const userId = "vault-test-user";
  await owner.sql`insert into "user" (id, name, email) values (${userId}, 'Vault Tester', 'vault@example.test')`;
  const { workspaceId } = await ensureWorkspaceMember(web.db, userId);
  const keys = await vaultKeyPairFromPrivate((await generateVaultKeyPair()).privateKeyBase64);
  const log = captureLog();
  return {
    owner,
    web,
    agent,
    workspaceId,
    userId,
    keys,
    log,
    async newRun(allowedOrigins = ["https://example.com"]) {
      const [row] = await owner.sql<{ id: string }[]>`
        insert into runs (workspace_id, goal, allowed_origins) values (${workspaceId}, 'vault test', ${allowedOrigins}) returning id`;
      return row!.id;
    },
    async seedItem({ alias, origin, secrets, imap = null }) {
      const entries = (Object.entries(secrets) as [TypedSecretField, string | undefined][]).filter(
        (entry): entry is [TypedSecretField, string] => entry[1] !== undefined,
      );
      const sealed = await Promise.all(
        entries.map(async ([field, value]) => ({
          field,
          sealed: await sealValue(
            keys.publicKey,
            { kind: "secret", workspaceId, alias, origin, field },
            value,
          ),
        })),
      );
      const { id } = await createVaultItem(web.db, {
        workspaceId,
        alias,
        origin,
        label: alias,
        imap,
        secrets: sealed,
        actor: userId,
      });
      return id;
    },
    deps(overrides = {}) {
      return {
        db: agent.db,
        keys,
        log: log.logger,
        resolveRef: resolveVaultTarget,
        fingerprints: createSecretFingerprints(),
        logins: { noteLogin: () => undefined },
        imapUsed: new Map(),
        signInStarted: new Map(),
        totpSteps: new Map(),
        otpImapWaitMs: 3_000,
        testMode: true,
        now: () => Date.now(),
        sleep: defaultSleep,
        ...overrides,
      };
    },
    async stop() {
      await Promise.all([agent.close(), web.close(), owner.close()]);
      await testDb.stop();
    },
  };
}
