import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { startTestDatabase, type TestDatabase } from "../testing.ts";
import { ensureWorkspaceMember, workspaceIdOf } from "./workspace.ts";
import {
  VaultAliasTaken,
  VaultNotFound,
  appendVaultAudit,
  consumeOtpCode,
  createVaultItem,
  deleteVaultItem,
  findVaultItemByAlias,
  forgetBrowserSession,
  getVaultGrantApprover,
  insertVaultGrant,
  listRunCredentialUses,
  listVaultAudit,
  hasHumanVaultGrant,
  listVaultItems,
  loadBrowserSessions,
  loadSealedSecret,
  removeVaultSecret,
  setVaultSecret,
  submitOtpCode,
  upsertBrowserSession,
} from "./vault.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let agent: DbHandle;
let workspaceId: string;
let otherWorkspaceId: string;
const userId = "u-vault";
const origin = "https://learn.zybooks.com";
const bytes = (n: number) => new Uint8Array([n, n, n]);

async function newRun(
  status: "queued" | "sleeping" | "completed" = "queued",
  ws = workspaceId,
): Promise<string> {
  const [row] = await owner.sql<{ id: string }[]>`
    insert into runs (workspace_id, goal, allowed_origins, status)
    values (${ws}, 'goal', ${[origin]}, ${status}) returning id`;
  return row!.id;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 2 });
  await owner.sql`insert into "user" (id, name, email) values (${userId}, 'U', 'u@example.test')`;
  ({ workspaceId } = await ensureWorkspaceMember(web.db, userId));
  const [other] = await owner.sql<
    { id: string }[]
  >`insert into workspaces (name) values ('Other') returning id`;
  otherWorkspaceId = other!.id;
});
afterAll(async () => {
  await Promise.all([web?.close(), agent?.close(), owner?.close()]);
  await testDb?.stop();
});

describe("web side (as web_role)", () => {
  it("creates an item with sealed secrets, its fields and a create audit row", async () => {
    const { id } = await createVaultItem(web.db, {
      workspaceId,
      alias: "zybooks",
      origin,
      label: "zyBooks",
      imap: null,
      secrets: [
        { field: "username", sealed: bytes(1) },
        { field: "password", sealed: bytes(2) },
      ],
      actor: userId,
    });
    const [item] = await listVaultItems(web.db, workspaceId);
    expect(item).toMatchObject({
      id,
      alias: "zybooks",
      origin,
      hasImap: false,
      sessionSaved: false,
    });
    expect(item?.fields).toEqual(["username", "password"]);
    const audit = await listVaultAudit(web.db, workspaceId, { limit: 10, cursor: null });
    expect(audit.items[0]).toMatchObject({
      action: "create",
      alias: "zybooks",
      approvedBy: userId,
      outcome: "ok",
    });
  });

  it("rejects a duplicate alias", async () => {
    await expect(
      createVaultItem(web.db, {
        workspaceId,
        alias: "zybooks",
        origin,
        label: "x",
        imap: null,
        secrets: [],
        actor: userId,
      }),
    ).rejects.toBeInstanceOf(VaultAliasTaken);
  });

  it("replaces and removes secrets, keeping fields in sync", async () => {
    const item = await findVaultItemByAlias(agent.db, workspaceId, "zybooks");
    await setVaultSecret(web.db, {
      workspaceId,
      itemId: item!.id,
      secret: { field: "password", sealed: bytes(3) },
      actor: userId,
    });
    expect(await loadSealedSecret(agent.db, item!.id, "password")).toEqual(Buffer.from(bytes(3)));
    await setVaultSecret(web.db, {
      workspaceId,
      itemId: item!.id,
      secret: { field: "totp", sealed: bytes(4) },
      actor: userId,
    });
    expect((await findVaultItemByAlias(agent.db, workspaceId, "zybooks"))?.fields).toEqual([
      "username",
      "password",
      "totp",
    ]);
    await removeVaultSecret(web.db, {
      workspaceId,
      itemId: item!.id,
      field: "totp",
      actor: userId,
    });
    expect((await findVaultItemByAlias(agent.db, workspaceId, "zybooks"))?.fields).toEqual([
      "username",
      "password",
    ]);
    expect(await loadSealedSecret(agent.db, item!.id, "totp")).toBeNull();
  });

  it("scopes every write to the caller's workspace", async () => {
    const item = await findVaultItemByAlias(agent.db, workspaceId, "zybooks");
    await expect(
      setVaultSecret(web.db, {
        workspaceId: otherWorkspaceId,
        itemId: item!.id,
        secret: { field: "pin", sealed: bytes(5) },
        actor: userId,
      }),
    ).rejects.toBeInstanceOf(VaultNotFound);
    await expect(
      deleteVaultItem(web.db, { workspaceId: otherWorkspaceId, itemId: item!.id, actor: userId }),
    ).rejects.toBeInstanceOf(VaultNotFound);
  });

  it("reports and forgets a saved session", async () => {
    await upsertBrowserSession(agent.db, {
      workspaceId,
      alias: "zybooks",
      origin,
      sealed: bytes(6),
    });
    expect((await listVaultItems(web.db, workspaceId))[0]?.sessionSaved).toBe(true);
    await forgetBrowserSession(web.db, { workspaceId, alias: "zybooks", origin, actor: userId });
    expect((await listVaultItems(web.db, workspaceId))[0]?.sessionSaved).toBe(false);
  });

  it("pages the audit log newest first without overlap", async () => {
    for (let i = 0; i < 3; i++) {
      await appendVaultAudit(web.db, {
        workspaceId,
        itemId: null,
        alias: `a${i}`,
        origin,
        field: null,
        action: "update",
        runId: null,
        approvedBy: userId,
        outcome: "ok",
      });
    }
    const first = await listVaultAudit(web.db, workspaceId, { limit: 2, cursor: null });
    const second = await listVaultAudit(web.db, workspaceId, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const ids = new Set(first.items.map((row) => row.id));
    expect(second.items.some((row) => ids.has(row.id))).toBe(false);
  });

  it("deletes an item with its secrets, grants and sessions, keeping its audit trail", async () => {
    const item = await findVaultItemByAlias(agent.db, workspaceId, "zybooks");
    await upsertBrowserSession(agent.db, {
      workspaceId,
      alias: "zybooks",
      origin,
      sealed: bytes(7),
    });
    await insertVaultGrant(agent.db, { itemId: item!.id, origin, approvedBy: userId });
    await deleteVaultItem(web.db, { workspaceId, itemId: item!.id, actor: userId });
    expect(await findVaultItemByAlias(agent.db, workspaceId, "zybooks")).toBeNull();
    expect(await loadBrowserSessions(agent.db, workspaceId, [origin])).toEqual([]);
    const [grants] =
      await owner.sql`select count(*)::int as n from vault_grants where item_id = ${item!.id}`;
    expect(grants?.n).toBe(0);
    const rows =
      await owner.sql`select action from vault_audit where item_id = ${item!.id} order by at`;
    expect(rows.map((row) => row.action)).toContain("delete");
  });

  it("finds the caller's workspace", async () => {
    expect(await workspaceIdOf(web.db, userId)).toBe(workspaceId);
    expect(await workspaceIdOf(web.db, "nobody")).toBeNull();
  });

  it("submits an OTP code, requests a wake and notifies otp_ready", async () => {
    const runId = await newRun("sleeping");
    const listener = postgres(testDb.agentUrl, { max: 1 });
    const payloads: string[] = [];
    await listener.listen("otp_ready", (payload) => payloads.push(payload));
    expect(await submitOtpCode(web.db, { workspaceId, runId, sealed: bytes(8) })).toBe("ok");
    await expect.poll(() => payloads.length).toBe(1);
    expect(JSON.parse(payloads[0]!)).toEqual({ runId });
    const [run] = await owner.sql`select wake_requested_at from runs where id = ${runId}`;
    expect(run?.wake_requested_at).not.toBeNull();
    expect(await consumeOtpCode(agent.db, runId)).toEqual(Buffer.from(bytes(8)));
    expect(await consumeOtpCode(agent.db, runId)).toBeNull();
    await listener.end();
  });

  it("refuses codes for finished or foreign runs and ignores expired codes", async () => {
    expect(
      await submitOtpCode(web.db, {
        workspaceId,
        runId: await newRun("completed"),
        sealed: bytes(9),
      }),
    ).toBe("finished");
    expect(
      await submitOtpCode(web.db, {
        workspaceId,
        runId: await newRun("queued", otherWorkspaceId),
        sealed: bytes(9),
      }),
    ).toBe("not_found");
    const runId = await newRun();
    await submitOtpCode(web.db, { workspaceId, runId, sealed: bytes(10) });
    await owner.sql`update otp_codes set expires_at = now() - interval '1 second' where run_id = ${runId}`;
    expect(await consumeOtpCode(agent.db, runId)).toBeNull();
  });
});

describe("agent side (as agent_role)", () => {
  it("records grants once and reads who approved them", async () => {
    const { id } = await createVaultItem(web.db, {
      workspaceId,
      alias: "site",
      origin,
      label: "Site",
      imap: null,
      secrets: [],
      actor: userId,
    });
    expect(await getVaultGrantApprover(agent.db, id, origin)).toBeNull();
    await insertVaultGrant(agent.db, { itemId: id, origin, approvedBy: userId });
    await insertVaultGrant(agent.db, { itemId: id, origin, approvedBy: "someone-else" });
    expect(await getVaultGrantApprover(agent.db, id, origin)).toBe(userId);
  });

  it("recovers which aliases a run used from its successful fills", async () => {
    const runId = await newRun();
    const row = {
      workspaceId,
      itemId: null,
      origin,
      field: "password",
      runId,
      approvedBy: userId,
    } as const;
    await appendVaultAudit(agent.db, { ...row, alias: "site", action: "fill", outcome: "ok" });
    await appendVaultAudit(agent.db, { ...row, alias: "site", action: "fill", outcome: "ok" });
    await appendVaultAudit(agent.db, {
      ...row,
      alias: "evil",
      action: "denied",
      outcome: "origin_mismatch",
    });
    expect(await listRunCredentialUses(agent.db, runId)).toEqual([{ alias: "site", origin }]);
  });

  it("loads sessions only for the requested origins", async () => {
    await upsertBrowserSession(agent.db, { workspaceId, alias: "site", origin, sealed: bytes(11) });
    await upsertBrowserSession(agent.db, { workspaceId, alias: "site", origin, sealed: bytes(12) });
    expect(await loadBrowserSessions(agent.db, workspaceId, ["https://elsewhere.example"])).toEqual(
      [],
    );
    const [session] = await loadBrowserSessions(agent.db, workspaceId, [origin]);
    expect(session?.sealed).toEqual(Buffer.from(bytes(12)));
  });

  it("loads a session only for an alias a human granted on that origin (S11)", async () => {
    const { id } = await createVaultItem(web.db, {
      workspaceId,
      alias: "auto",
      origin,
      label: "Auto",
      imap: null,
      secrets: [],
      actor: userId,
    });
    await upsertBrowserSession(agent.db, { workspaceId, alias: "auto", origin, sealed: bytes(13) });
    const aliases = async () =>
      (await loadBrowserSessions(agent.db, workspaceId, [origin])).map((session) => session.alias);
    expect(await aliases()).not.toContain("auto");
    expect(await hasHumanVaultGrant(agent.db, { workspaceId, alias: "auto", origin })).toBe(false);
    await owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${id}, ${origin}, 'policy')`;
    expect(await hasHumanVaultGrant(agent.db, { workspaceId, alias: "auto", origin })).toBe(false);
    expect(await aliases()).not.toContain("auto");
    await owner.sql`update vault_grants set approved_by = ${userId} where item_id = ${id}`;
    expect(await hasHumanVaultGrant(agent.db, { workspaceId, alias: "auto", origin })).toBe(true);
    expect(await aliases()).toContain("auto");
  });
});
