import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { startTestDatabase, type TestDatabase } from "../testing.ts";
import { ensureWorkspaceMember, workspaceIdOf } from "./workspace.ts";
import {
  VaultAliasTaken,
  VaultAuditCursorInvalid,
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
  getVaultItemListRow,
  listVaultItems,
  loadBrowserSessions,
  loadSealedSecret,
  putVaultSecret,
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
let aliasCounter = 0;

/** Every test makes its own item, so tests pass alone, reordered or shuffled (review 10). */
async function newItem(
  options: { secrets?: Parameters<typeof createVaultItem>[1]["secrets"]; grantedBy?: string } = {},
): Promise<{ id: string; alias: string }> {
  const alias = `item-${++aliasCounter}`;
  const { id } = await createVaultItem(web.db, {
    workspaceId,
    alias,
    origin,
    label: alias,
    imap: null,
    secrets: options.secrets ?? [],
    actor: userId,
  });
  if (options.grantedBy)
    await insertVaultGrant(agent.db, { itemId: id, origin, approvedBy: options.grantedBy });
  return { id, alias };
}
const listed = async (alias: string) =>
  (await listVaultItems(web.db, workspaceId)).find((row) => row.alias === alias);

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
    const { id, alias } = await newItem({
      secrets: [
        { field: "username", sealed: bytes(1) },
        { field: "password", sealed: bytes(2) },
      ],
    });
    const item = await listed(alias);
    expect(item).toMatchObject({ id, alias, origin, hasImap: false, sessionSaved: false });
    expect(item?.fields).toEqual(["username", "password"]);
    const rows =
      await owner.sql`select action, approved_by, outcome from vault_audit where item_id = ${id}`;
    expect(rows).toEqual([{ action: "create", approved_by: userId, outcome: "ok" }]);
  });

  it("reads one item's list row by id, scoped to the workspace (review 10)", async () => {
    const { id, alias } = await newItem({ secrets: [{ field: "password", sealed: bytes(1) }] });
    expect(await getVaultItemListRow(web.db, workspaceId, id)).toEqual(await listed(alias));
    expect(await getVaultItemListRow(web.db, otherWorkspaceId, id)).toBeNull();
  });

  it("rejects a duplicate alias", async () => {
    const { alias } = await newItem();
    await expect(
      createVaultItem(web.db, {
        workspaceId,
        alias,
        origin,
        label: "x",
        imap: null,
        secrets: [],
        actor: userId,
      }),
    ).rejects.toBeInstanceOf(VaultAliasTaken);
  });

  it("replaces and removes secrets, keeping fields in sync", async () => {
    const { id, alias } = await newItem({
      secrets: [
        { field: "username", sealed: bytes(1) },
        { field: "password", sealed: bytes(2) },
      ],
    });
    await setVaultSecret(web.db, {
      workspaceId,
      itemId: id,
      secret: { field: "password", sealed: bytes(3) },
      actor: userId,
    });
    expect(await loadSealedSecret(agent.db, id, "password")).toEqual(Buffer.from(bytes(3)));
    await setVaultSecret(web.db, {
      workspaceId,
      itemId: id,
      secret: { field: "totp", sealed: bytes(4) },
      actor: userId,
    });
    expect((await findVaultItemByAlias(agent.db, workspaceId, alias))?.fields).toEqual([
      "username",
      "password",
      "totp",
    ]);
    await removeVaultSecret(web.db, { workspaceId, itemId: id, field: "totp", actor: userId });
    expect((await findVaultItemByAlias(agent.db, workspaceId, alias))?.fields).toEqual([
      "username",
      "password",
    ]);
    expect(await loadSealedSecret(agent.db, id, "totp")).toBeNull();
  });

  it("scopes every write to the caller's workspace", async () => {
    const { id } = await newItem();
    await expect(
      setVaultSecret(web.db, {
        workspaceId: otherWorkspaceId,
        itemId: id,
        secret: { field: "pin", sealed: bytes(5) },
        actor: userId,
      }),
    ).rejects.toBeInstanceOf(VaultNotFound);
    await expect(
      deleteVaultItem(web.db, { workspaceId: otherWorkspaceId, itemId: id, actor: userId }),
    ).rejects.toBeInstanceOf(VaultNotFound);
  });

  it("reports and forgets a saved session", async () => {
    const { alias } = await newItem();
    await upsertBrowserSession(agent.db, { workspaceId, alias, origin, sealed: bytes(6) });
    expect((await listed(alias))?.sessionSaved).toBe(true);
    await forgetBrowserSession(web.db, { workspaceId, alias, origin, actor: userId });
    expect((await listed(alias))?.sessionSaved).toBe(false);
  });

  it("marks a session saved only on the item it belongs to", async () => {
    const saved = await newItem();
    const other = await newItem();
    await upsertBrowserSession(agent.db, {
      workspaceId,
      alias: saved.alias,
      origin,
      sealed: bytes(8),
    });
    expect((await listed(saved.alias))?.sessionSaved).toBe(true);
    expect((await listed(other.alias))?.sessionSaved).toBe(false);
    await forgetBrowserSession(web.db, { workspaceId, alias: saved.alias, origin, actor: userId });
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

  it("refuses a malformed or impossible audit cursor instead of restarting or failing (review 6)", async () => {
    const id = "0d857de5-7d4e-4b8a-9788-4dc60ab2890f";
    for (const cursor of [
      "garbage",
      `2026-13-40T00:00:00.000Z|${id}`,
      `2026-02-30T00:00:00.000Z|${id}`,
    ]) {
      await expect(
        listVaultAudit(web.db, workspaceId, { limit: 2, cursor }),
        cursor,
      ).rejects.toBeInstanceOf(VaultAuditCursorInvalid);
    }
  });

  it("deletes an item with its secrets, grants and sessions, keeping its audit trail", async () => {
    const { id, alias } = await newItem({ grantedBy: userId });
    await upsertBrowserSession(agent.db, { workspaceId, alias, origin, sealed: bytes(7) });
    await deleteVaultItem(web.db, { workspaceId, itemId: id, actor: userId });
    expect(await findVaultItemByAlias(agent.db, workspaceId, alias)).toBeNull();
    const sessions = await loadBrowserSessions(agent.db, workspaceId, [origin]);
    expect(sessions.map((session) => session.alias)).not.toContain(alias);
    const [grants] =
      await owner.sql`select count(*)::int as n from vault_grants where item_id = ${id}`;
    expect(grants?.n).toBe(0);
    const rows = await owner.sql`select action from vault_audit where item_id = ${id} order by at`;
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
    const { id } = await newItem();
    expect(await getVaultGrantApprover(agent.db, id, origin)).toBeNull();
    await insertVaultGrant(agent.db, { itemId: id, origin, approvedBy: userId });
    await insertVaultGrant(agent.db, { itemId: id, origin, approvedBy: "someone-else" });
    expect(await getVaultGrantApprover(agent.db, id, origin)).toBe(userId);
  });

  it("writes a secret only into an item of the given workspace (review 9)", async () => {
    const { id, alias } = await newItem();
    await expect(
      putVaultSecret(
        agent.db,
        { workspaceId: otherWorkspaceId, itemId: id },
        {
          field: "pin",
          sealed: bytes(20),
        },
      ),
    ).rejects.toBeInstanceOf(VaultNotFound);
    expect(await loadSealedSecret(agent.db, id, "pin")).toBeNull();
    await putVaultSecret(
      agent.db,
      { workspaceId, itemId: id },
      { field: "pin", sealed: bytes(21) },
    );
    expect(await loadSealedSecret(agent.db, id, "pin")).toEqual(Buffer.from(bytes(21)));
    expect((await findVaultItemByAlias(agent.db, workspaceId, alias))?.fields).toEqual(["pin"]);
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
    const { alias } = await newItem({ grantedBy: userId });
    await upsertBrowserSession(agent.db, { workspaceId, alias, origin, sealed: bytes(11) });
    await upsertBrowserSession(agent.db, { workspaceId, alias, origin, sealed: bytes(12) });
    expect(await loadBrowserSessions(agent.db, workspaceId, ["https://elsewhere.example"])).toEqual(
      [],
    );
    const session = (await loadBrowserSessions(agent.db, workspaceId, [origin])).find(
      (row) => row.alias === alias,
    );
    expect(session?.sealed).toEqual(Buffer.from(bytes(12)));
  });

  it("loads a session only for an alias a human granted on that origin (S11)", async () => {
    const { id, alias } = await newItem();
    await upsertBrowserSession(agent.db, { workspaceId, alias, origin, sealed: bytes(13) });
    const aliases = async () =>
      (await loadBrowserSessions(agent.db, workspaceId, [origin])).map((session) => session.alias);
    expect(await aliases()).not.toContain(alias);
    expect(await hasHumanVaultGrant(agent.db, { workspaceId, alias, origin })).toBe(false);
    await owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${id}, ${origin}, ${userId})`;
    expect(await hasHumanVaultGrant(agent.db, { workspaceId, alias, origin })).toBe(true);
    expect(await aliases()).toContain(alias);
  });

  it("refuses a grant decided by policy, even from the owner role (review 8)", async () => {
    const { id, alias } = await newItem();
    await expect(
      owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${id}, ${origin}, 'policy')`,
    ).rejects.toThrow(/vault_grants_human_approver/);
    await expect(
      insertVaultGrant(agent.db, { itemId: id, origin, approvedBy: "policy" }),
    ).rejects.toThrow();
    expect(await hasHumanVaultGrant(agent.db, { workspaceId, alias, origin })).toBe(false);
  });

  it("refuses a grant decided by bypass mode too (D44, m7)", async () => {
    const { id, alias } = await newItem();
    await expect(
      owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${id}, ${origin}, 'bypass')`,
    ).rejects.toThrow(/vault_grants_human_approver/);
    expect(await hasHumanVaultGrant(agent.db, { workspaceId, alias, origin })).toBe(false);
  });

  it("migration 0003 removes existing policy grants before adding its CHECK (review 15)", async () => {
    const { readFile } = await import("node:fs/promises");
    const migration = await readFile(
      new URL("../../migrations/0003_vault_grants_human_approver.sql", import.meta.url),
      "utf8",
    );
    const { id, alias } = await newItem();
    await owner.sql.begin(async (tx) => {
      // As a database that ran 0002 only: no CHECK yet, and a policy grant already written.
      await tx`alter table vault_grants drop constraint vault_grants_human_approver`;
      await tx`insert into vault_grants (item_id, origin, approved_by) values (${id}, ${origin}, 'policy')`;
      for (const statement of migration.split("--> statement-breakpoint"))
        await tx.unsafe(statement);
    });
    expect(await hasHumanVaultGrant(agent.db, { workspaceId, alias, origin })).toBe(false);
    const [rows] =
      await owner.sql`select count(*)::int as n from vault_grants where approved_by = 'policy'`;
    expect(rows?.n).toBe(0);
    await expect(
      owner.sql`insert into vault_grants (item_id, origin, approved_by) values (${id}, ${origin}, 'policy')`,
    ).rejects.toThrow(/vault_grants_human_approver/);
  });
});
