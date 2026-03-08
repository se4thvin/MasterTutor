import { createDb, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { sealValue } from "@mastertutor/sealing";
import {
  generateVaultKeyPair,
  openSealed,
  vaultKeyPairFromPrivate,
  type VaultKeyPair,
} from "@mastertutor/sealing/open";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RotationError, rotateVaultKeys } from "./rotate.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let a: VaultKeyPair;
let b: VaultKeyPair;
let ws: string;
let runId: string;
const origin = "https://example.com";
const secretBinding = () =>
  ({ kind: "secret", workspaceId: ws, alias: "site", origin, field: "password" }) as const;
const sessionBinding = () => ({ kind: "session", workspaceId: ws, alias: "site", origin }) as const;
const otpBinding = () => ({ kind: "otp", workspaceId: ws, runId }) as const;

async function pair(): Promise<VaultKeyPair> {
  return vaultKeyPairFromPrivate((await generateVaultKeyPair()).privateKeyBase64);
}
async function column(query: Promise<{ v: Buffer }[]>): Promise<Buffer> {
  return (await query)[0]!.v;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = createDb(testDb.ownerUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 2 });
  [a, b] = [await pair(), await pair()];
  [{ id: ws }] = (await owner.sql`insert into workspaces (name) values ('W') returning id`) as [
    { id: string },
  ];
  const [{ id: itemId }] = (await owner.sql`
    insert into vault_items (workspace_id, alias, origin, label, fields) values (${ws}, 'site', ${origin}, 'S', '{password}')
    returning id`) as [{ id: string }];
  [{ id: runId }] =
    (await owner.sql`insert into runs (workspace_id, goal, allowed_origins) values (${ws}, 'g', ${[origin]}) returning id`) as [
      { id: string },
    ];
  await owner.sql`insert into vault_secrets (item_id, field, sealed)
                  values (${itemId}, 'password', ${Buffer.from(await sealValue(a.publicKey, secretBinding(), "pw-1"))})`;
  await owner.sql`insert into browser_sessions (workspace_id, alias, origin, sealed_state)
                  values (${ws}, 'site', ${origin}, ${Buffer.from(await sealValue(a.publicKey, sessionBinding(), "{}"))})`;
  await owner.sql`insert into otp_codes (run_id, sealed) values (${runId}, ${Buffer.from(await sealValue(a.publicKey, otpBinding(), "123456"))})`;
  await owner.sql`insert into otp_codes (run_id, sealed, consumed_at)
                  values (${runId}, ${Buffer.from(await sealValue(a.publicKey, otpBinding(), "999999"))}, now())`;
});
afterAll(async () => {
  await Promise.all([agent?.close(), owner?.close()]);
  await testDb?.stop();
});

describe("rotateVaultKeys", () => {
  it("re-seals every live row to the next key in one transaction", async () => {
    const report = await rotateVaultKeys(agent.sql, a, b);
    expect(report).toEqual({
      secrets: 1,
      sessions: 1,
      otpCodes: 1,
      alreadyRotated: 0,
      deadOtpCodes: 1,
    });
    const secret = await column(owner.sql<{ v: Buffer }[]>`select sealed as v from vault_secrets`);
    expect(new TextDecoder().decode(await openSealed(b, secret, secretBinding()))).toBe("pw-1");
    await expect(openSealed(a, secret, secretBinding())).rejects.toMatchObject({
      code: "cannot_open",
    });
    const state = await column(
      owner.sql<{ v: Buffer }[]>`select sealed_state as v from browser_sessions`,
    );
    expect(new TextDecoder().decode(await openSealed(b, state, sessionBinding()))).toBe("{}");
    const code = await column(owner.sql<{ v: Buffer }[]>`select sealed as v from otp_codes`);
    expect(new TextDecoder().decode(await openSealed(b, code, otpBinding()))).toBe("123456");
  });

  it("is idempotent, so it can be re-run after the redeploy", async () => {
    expect(await rotateVaultKeys(agent.sql, a, b)).toEqual({
      secrets: 0,
      sessions: 0,
      otpCodes: 0,
      alreadyRotated: 3,
      deadOtpCodes: 0,
    });
  });

  it("re-seals stragglers that web sealed with the old public key mid-rotation", async () => {
    await owner.sql`update browser_sessions set sealed_state = ${Buffer.from(await sealValue(a.publicKey, sessionBinding(), "late"))}`;
    expect((await rotateVaultKeys(agent.sql, a, b)).sessions).toBe(1);
  });

  it("rolls back entirely when a row opens with neither key", async () => {
    const c = await pair();
    await owner.sql`update browser_sessions set sealed_state = ${Buffer.from(await sealValue(c.publicKey, sessionBinding(), "x"))}`;
    const before = await column(owner.sql<{ v: Buffer }[]>`select sealed as v from vault_secrets`);
    await expect(rotateVaultKeys(agent.sql, b, a)).rejects.toBeInstanceOf(RotationError);
    expect(await column(owner.sql<{ v: Buffer }[]>`select sealed as v from vault_secrets`)).toEqual(
      before,
    );
  });
});
