import { findVaultItemByAlias, getVaultGrantApprover } from "@mastertutor/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedBy, credentialApproval } from "./grants.ts";
import { NOT_STORED, withItemSecret } from "./secrets.ts";
import { humanApproval, policyApproval } from "./testing/browser.ts";
import { startVaultTestEnv, type VaultTestEnv } from "./testing/env.ts";

const origin = "https://learn.zybooks.com";
let env: VaultTestEnv;
const item = async (alias = "zybooks") =>
  (await findVaultItemByAlias(env.agent.db, env.workspaceId, alias))!;

beforeAll(async () => {
  env = await startVaultTestEnv();
  await env.seedItem({ alias: "zybooks", origin, secrets: { password: "MARMOT4CANARY8VELVET" } });
});
afterAll(async () => env?.stop());

describe("first-use approval and grants", () => {
  it("asks only on the pinned origin and only before a grant exists", async () => {
    expect(await credentialApproval(env.deps(), `${origin}/signin`, await item())).toEqual({
      kind: "credential_first_use",
      alias: "zybooks",
      origin,
    });
    expect(
      await credentialApproval(env.deps(), "https://learn.zybooks.co/signin", await item()),
    ).toBeNull();
  });

  it("a policy approval authorizes the call without writing a lasting grant (Review Focus 4)", async () => {
    const zybooks = await item();
    expect(await approvedBy(env.deps(), policyApproval(), zybooks)).toBe("policy");
    expect(await getVaultGrantApprover(env.agent.db, zybooks.id, origin)).toBeNull();
    expect(await approvedBy(env.deps(), null, zybooks)).toBeNull();
  });

  it("ignores an approval of another kind", async () => {
    expect(
      await approvedBy(env.deps(), { kind: "risky_click", decidedBy: env.userId }, await item()),
    ).toBeNull();
  });

  it("a human approval writes the grant, after which no approval is needed", async () => {
    const zybooks = await item();
    expect(await approvedBy(env.deps(), humanApproval(env.userId), zybooks)).toBe(env.userId);
    expect(await approvedBy(env.deps(), null, zybooks)).toBe(env.userId);
    expect(await credentialApproval(env.deps(), origin, zybooks)).toBeNull();
  });
});

describe("withItemSecret", () => {
  it("opens a stored field bound to its row, or reports it missing", async () => {
    const zybooks = await item();
    expect(
      await withItemSecret(env.deps(), env.workspaceId, zybooks, "password", async (t) => t),
    ).toBe("MARMOT4CANARY8VELVET");
    expect(await withItemSecret(env.deps(), env.workspaceId, zybooks, "pin", async (t) => t)).toBe(
      NOT_STORED,
    );
  });

  it("refuses a ciphertext copied from another item's row", async () => {
    await env.seedItem({ alias: "other", origin, secrets: { password: "SOMETHING-ELSE-12" } });
    await env.owner.sql`
      update vault_secrets set sealed = (select s.sealed from vault_secrets s join vault_items i on i.id = s.item_id
                                         where i.alias = 'zybooks' and s.field = 'password')
      where item_id = (select id from vault_items where alias = 'other') and field = 'password'`;
    await expect(
      withItemSecret(env.deps(), env.workspaceId, await item("other"), "password", async (t) => t),
    ).rejects.toMatchObject({ code: "binding_mismatch" });
  });
});
