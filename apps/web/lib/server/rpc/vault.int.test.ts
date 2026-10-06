import { createDb, ensureWorkspaceMember, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
// Test-only exception (W9): the test plays the agent to prove what web sealed.
import { openSealed, vaultKeyPairFromPrivate, type VaultKeyPair } from "@mastertutor/sealing/open";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Viewer } from "../viewer.ts";
import { createSealer } from "../vault/sealer.ts";
import { createVaultProcedures } from "./vault.ts";

// The .env.test dummy pair (Phase 0): web gets the public half. It protects nothing.
const TEST_PUBLIC = "y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=";
const TEST_PRIVATE = "kCNZsvnP2oSO4FaU/yZoEi4TCPUK/EKw1zn4wI/5s1c=";
const CANARY = "PELICAN3WEB7CANARY";
const viewer: Viewer = { id: "u-web-vault", name: "U", email: "web-vault@example.test" };
const ORIGIN = "https://learn.zybooks.com";

let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let keys: VaultKeyPair;
let workspaceId: string;
const procedures = createVaultProcedures({
  sealer: () => createSealer(TEST_PUBLIC),
  db: () => web,
});
const router = { vault: procedures.vault, runs: { submitOtp: procedures.submitOtp } };
const client = (who: Viewer | null = viewer) =>
  createRouterClient(router, { context: { viewer: who } });
const secretBinding = (field: "password" | "totp") =>
  ({ kind: "secret", workspaceId, alias: "zybooks", origin: ORIGIN, field }) as const;

async function sealedSecret(itemId: string, field: string): Promise<Uint8Array> {
  const [row] = await owner.sql<{ sealed: Buffer }[]>`
    select sealed from vault_secrets where item_id = ${itemId} and field = ${field}`;
  return row!.sealed;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
  await owner.sql`insert into "user" (id, name, email) values (${viewer.id}, 'U', ${viewer.email})`;
  ({ workspaceId } = await ensureWorkspaceMember(web.db, viewer.id));
});
afterAll(async () => {
  await Promise.all([web?.close(), owner?.close()]);
  await testDb?.stop();
});

describe("vault procedures on the live router", () => {
  it("rejects callers without a session, and signed-in users without a workspace", async () => {
    await expect(client(null).vault.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await owner.sql`insert into "user" (id, name, email) values ('stranger', 'S', 's@example.test')`;
    const stranger = { id: "stranger", name: "S", email: "s@example.test" };
    await expect(client(stranger).vault.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates an item, seals each secret bound to its row and never returns a value", async () => {
    const view = await client().vault.create({
      alias: "zybooks",
      origin: "learn.zybooks.com/signin",
      label: "zyBooks",
      secrets: { username: "me@example.test", password: CANARY },
    });
    expect(view).toMatchObject({
      alias: "zybooks",
      origin: ORIGIN,
      fields: ["username", "password"],
    });
    expect(JSON.stringify(view)).not.toContain(CANARY);
    const opened = await openSealed(
      keys,
      await sealedSecret(view.id, "password"),
      secretBinding("password"),
    );
    expect(new TextDecoder().decode(opened)).toBe(CANARY);
    expect(JSON.stringify(await client().vault.list({}))).not.toContain(CANARY);
  });

  it("returns CONFLICT for a duplicate alias", async () => {
    await expect(
      client().vault.create({ alias: "zybooks", origin: ORIGIN, label: "x", secrets: {} }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("validates TOTP keys and PINs before sealing, and seals an otpauth link whole (E3)", async () => {
    const [item] = (await client().vault.list({})).items;
    await expect(
      client().vault.setSecret({ itemId: item!.id, field: "totp", value: "not-a-key" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client().vault.setSecret({ itemId: item!.id, field: "pin", value: "12" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const link =
      "otpauth://totp/ACME:me?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256";
    await client().vault.setSecret({ itemId: item!.id, field: "totp", value: link });
    const opened = await openSealed(
      keys,
      await sealedSecret(item!.id, "totp"),
      secretBinding("totp"),
    );
    expect(new TextDecoder().decode(opened)).toBe(link);
  });

  it("refuses an email-code password on an item without mail settings (E4)", async () => {
    const [item] = (await client().vault.list({})).items;
    await expect(
      client().vault.setSecret({ itemId: item!.id, field: "imap_password", value: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("replaces and removes a secret", async () => {
    const [item] = (await client().vault.list({})).items;
    await client().vault.setSecret({ itemId: item!.id, field: "password", value: "rotated-value" });
    const opened = await openSealed(
      keys,
      await sealedSecret(item!.id, "password"),
      secretBinding("password"),
    );
    expect(new TextDecoder().decode(opened)).toBe("rotated-value");
    await client().vault.removeSecret({ itemId: item!.id, field: "totp" });
    expect((await client().vault.list({})).items[0]?.fields).not.toContain("totp");
  });

  it("hides other workspaces' items", async () => {
    const [other] = await owner.sql<
      { id: string }[]
    >`insert into workspaces (name) values ('Other') returning id`;
    const [foreign] = await owner.sql<{ id: string }[]>`
      insert into vault_items (workspace_id, alias, origin, label) values (${other!.id}, 'theirs', 'https://a.example', 'A')
      returning id`;
    await expect(client().vault.delete({ itemId: foreign!.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("forgets a saved session idempotently and lists the audit trail (E6)", async () => {
    await owner.sql`insert into browser_sessions (workspace_id, alias, origin, sealed_state)
                    values (${workspaceId}, 'zybooks', ${ORIGIN}, ${Buffer.from([1])})`;
    expect((await client().vault.list({})).items[0]?.sessionSaved).toBe(true);
    await client().vault.forgetSession({ alias: "zybooks", origin: ORIGIN });
    expect((await client().vault.list({})).items[0]?.sessionSaved).toBe(false);
    await expect(
      client().vault.forgetSession({ alias: "zybooks", origin: ORIGIN }),
    ).resolves.toEqual({ ok: true });
    const audit = await client().vault.audit({ limit: 50, cursor: null });
    expect(audit.items.map((row) => row.action)).toEqual(
      expect.arrayContaining(["create", "update", "delete"]),
    );
    expect(JSON.stringify(audit)).not.toContain(CANARY);
  });

  it("deletes an item", async () => {
    const [item] = (await client().vault.list({})).items;
    await client().vault.delete({ itemId: item!.id });
    expect((await client().vault.list({})).items).toEqual([]);
  });
});

describe("vault.audit cursor (review 6)", () => {
  it("answers a malformed or impossible cursor with BAD_REQUEST", async () => {
    for (const cursor of [
      "garbage",
      "2026-13-40T00:00:00.000Z|0d857de5-7d4e-4b8a-9788-4dc60ab2890f",
    ]) {
      await expect(client().vault.audit({ limit: 10, cursor })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
  });
});

describe("runs.submitOtp", () => {
  it("seals the code to the run, wakes it and notifies otp_ready", async () => {
    const [run] = await owner.sql<{ id: string }[]>`
      insert into runs (workspace_id, goal, allowed_origins, status, wait_reason)
      values (${workspaceId}, 'g', ${["https://a.example"]}, 'waiting', 'otp') returning id`;
    // G2: apps/web cannot import postgres; listen through the db package's own handle.
    const listener = createDb(testDb.agentUrl, { max: 1 });
    const payloads: string[] = [];
    await listener.sql.listen("otp_ready", (payload) => payloads.push(payload));
    await expect(client().runs.submitOtp({ runId: run!.id, code: "482913" })).resolves.toEqual({
      ok: true,
    });
    await expect.poll(() => payloads).toEqual([JSON.stringify({ runId: run!.id })]);
    const [code] = await owner.sql<
      { sealed: Buffer }[]
    >`select sealed from otp_codes where run_id = ${run!.id}`;
    const opened = await openSealed(keys, code!.sealed, {
      kind: "otp",
      workspaceId,
      runId: run!.id,
    });
    expect(new TextDecoder().decode(opened)).toBe("482913");
    const [woken] = await owner.sql`select wake_requested_at from runs where id = ${run!.id}`;
    expect(woken?.wake_requested_at).not.toBeNull();
    await listener.close();
  });

  it("refuses finished and unknown runs", async () => {
    const [done] = await owner.sql<{ id: string }[]>`
      insert into runs (workspace_id, goal, allowed_origins, status) values (${workspaceId}, 'g', ${["https://a.example"]}, 'completed')
      returning id`;
    await expect(
      client().runs.submitOtp({ runId: done!.id, code: "123456" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      client().runs.submitOtp({ runId: "00000000-0000-4000-8000-000000000000", code: "123456" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
