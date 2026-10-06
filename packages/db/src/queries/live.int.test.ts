import { decodeNotify } from "@mastertutor/contracts";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { downloads, runEvents, runs } from "../schema/index.ts";
import {
  leaseSlotForTest,
  nextNotification,
  releaseSlotForTest,
  seedMember,
  seedRun,
  startTestDatabase,
  type TestDatabase,
} from "../testing.ts";
import { findAssetBySha, recordDownload } from "./downloads.ts";
import { canAccessLiveSlot, getRunForMember, requestHandBack, requestTakeover } from "./live.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let agent: DbHandle;
let member: { userId: string; workspaceId: string };
let outsider: { userId: string; workspaceId: string };

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  agent = createDb(testDb.agentUrl, { max: 2 });
  member = await seedMember(owner.db);
  outsider = await seedMember(owner.db);
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close(), agent?.close()]);
  await testDb?.stop();
});

const runRow = async (runId: string) =>
  (await owner.db.select().from(runs).where(eq(runs.id, runId)))[0]!;

describe("member and slot access", () => {
  it("shows a run only to members, with its lease state", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    expect(await getRunForMember(web.db, runId, outsider.userId)).toBeNull();
    expect(await getRunForMember(web.db, runId, member.userId)).toMatchObject({
      id: runId,
      status: "running",
      controller: "agent",
      slotName: null,
      slotLeased: false,
    });
    await leaseSlotForTest(owner.db, "browser-1", runId);
    expect(await getRunForMember(web.db, runId, member.userId)).toMatchObject({
      slotName: "browser-1",
      slotLeased: true,
    });
    await releaseSlotForTest(owner.db, "browser-1");
  });

  it("grants a live slot only for the leased run, to its members", async () => {
    const runA = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const runB = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, "browser-1", runA);
    const ok = { runId: runA, slotName: "browser-1", userId: member.userId };
    expect(await canAccessLiveSlot(web.db, ok)).toBe(true);
    expect(await canAccessLiveSlot(web.db, { ...ok, userId: outsider.userId })).toBe(false);
    expect(await canAccessLiveSlot(web.db, { ...ok, runId: runB })).toBe(false);
    expect(await canAccessLiveSlot(web.db, { ...ok, slotName: "browser-2" })).toBe(false);
    await releaseSlotForTest(owner.db, "browser-1");
    expect(await canAccessLiveSlot(web.db, ok)).toBe(false);
  });
});

describe("takeover and hand back (web role)", () => {
  it("takes control of a running run and notifies run_control", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const payload = await nextNotification(owner.sql, "run_control", async () => {
      expect(await requestTakeover(web.db, { runId, userId: member.userId })).toEqual({
        ok: true,
        via: "control",
      });
    });
    expect(decodeNotify("run_control", payload)).toEqual({ runId });
    expect(await runRow(runId)).toMatchObject({
      status: "waiting",
      waitReason: "takeover",
      controller: "user",
      controlUserId: member.userId,
    });
  });

  it("keeps a code or CAPTCHA wait on the row and moves an approval wait to takeover (M7)", async () => {
    for (const waitReason of ["otp", "captcha"] as const) {
      const runId = await seedRun(owner.db, {
        workspaceId: member.workspaceId,
        status: "waiting",
        waitReason,
      });
      const payload = await nextNotification(owner.sql, "run_control", async () => {
        expect(await requestTakeover(web.db, { runId, userId: member.userId })).toEqual({
          ok: true,
          via: "control",
        });
      });
      expect(decodeNotify("run_control", payload)).toEqual({ runId });
      const row = await runRow(runId);
      expect(row).toMatchObject({
        status: "waiting",
        waitReason,
        controller: "user",
        controlUserId: member.userId,
      });
      expect(row.lastActivityAt).not.toBeNull();
    }
    const approvalRun = await seedRun(owner.db, {
      workspaceId: member.workspaceId,
      status: "waiting",
      waitReason: "approval",
    });
    await requestTakeover(web.db, { runId: approvalRun, userId: member.userId });
    expect(await runRow(approvalRun)).toMatchObject({ status: "waiting", waitReason: "takeover" });
  });

  it("wakes a sleeping run with reason takeover", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId, status: "sleeping" });
    const payload = await nextNotification(owner.sql, "run_wake", async () => {
      expect(await requestTakeover(web.db, { runId, userId: member.userId })).toEqual({
        ok: true,
        via: "wake",
      });
    });
    expect(decodeNotify("run_wake", payload)).toEqual({ runId, reason: "takeover" });
    const row = await runRow(runId);
    expect(row).toMatchObject({
      status: "sleeping",
      controller: "user",
      controlUserId: member.userId,
    });
    expect(row.wakeRequestedAt).not.toBeNull();
  });

  it("refuses finished runs and non-members", async () => {
    const done = await seedRun(owner.db, { workspaceId: member.workspaceId, status: "completed" });
    expect(await requestTakeover(web.db, { runId: done, userId: member.userId })).toEqual({
      ok: false,
      reason: "finished",
    });
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    expect(await requestTakeover(web.db, { runId, userId: outsider.userId })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await requestHandBack(web.db, { runId, userId: outsider.userId, note: null })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("is idempotent for the holder and refuses another member (B3 E.8 note 3)", async () => {
    const colleague = await seedMember(owner.db, {
      workspaceId: member.workspaceId,
      role: "member",
    });
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId, userId: colleague.userId });
    const received: string[] = [];
    const { unlisten } = await owner.sql.listen("run_control", (payload) => received.push(payload));
    try {
      expect(await requestTakeover(web.db, { runId, userId: colleague.userId })).toEqual({
        ok: true,
        via: "none",
      });
      expect(await requestTakeover(web.db, { runId, userId: member.userId })).toEqual({
        ok: false,
        reason: "not_controller",
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(received).toEqual([]);
    } finally {
      await unlisten();
    }
    expect(await runRow(runId)).toMatchObject({
      controller: "user",
      controlUserId: colleague.userId,
    });
  });

  it("accepts hand-back only from the controller or a workspace owner", async () => {
    const holder = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const other = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId, userId: holder.userId });
    expect(
      await requestHandBack(web.db, { runId, userId: other.userId, note: "mine now" }),
    ).toEqual({
      ok: false,
      reason: "not_controller",
    });
    expect(await runRow(runId)).toMatchObject({ controller: "user", controlUserId: holder.userId });
    // member is the workspace owner (seedMember's default role): owners may end any takeover.
    expect(await requestHandBack(web.db, { runId, userId: member.userId, note: null })).toEqual({
      ok: true,
      via: "control",
    });
    expect(await runRow(runId)).toMatchObject({ controller: "agent", controlUserId: null });
    // Once the agent holds control, any member's late note is still delivered.
    expect(await requestHandBack(web.db, { runId, userId: other.userId, note: "FYI" })).toEqual({
      ok: true,
      via: "none",
    });
  });

  it("hands back with a note as a user_message, and keeps a late note", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId, userId: member.userId });
    const payload = await nextNotification(owner.sql, "run_control", async () => {
      expect(
        await requestHandBack(web.db, {
          runId,
          userId: member.userId,
          note: "Logged in; continue",
        }),
      ).toEqual({ ok: true, via: "control" });
    });
    expect(decodeNotify("run_control", payload)).toEqual({ runId });
    expect(await runRow(runId)).toMatchObject({ controller: "agent", controlUserId: null });
    expect(await requestHandBack(web.db, { runId, userId: member.userId, note: null })).toEqual({
      ok: true,
      via: "none",
    });
    // The agent already took control back (e.g. the idle hand-back): the note still reaches it.
    expect(
      await requestHandBack(web.db, { runId, userId: member.userId, note: "Also open chapter 2" }),
    ).toEqual({ ok: true, via: "none" });
    const notes = (
      await owner.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, runId))
        .orderBy(asc(runEvents.id))
    )
      .map((e) => e.payload)
      .filter((p) => p.type === "user_message");
    expect(notes).toEqual([
      { type: "user_message", text: "Logged in; continue" },
      { type: "user_message", text: "Also open chapter 2" },
    ]);
  });
});

describe("download records (agent role)", () => {
  it("dedupes assets per workspace by sha256 and records every download", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const sha256 = "a".repeat(64);
    const input = {
      runId,
      workspaceId: member.workspaceId,
      filename: "a.pdf",
      sha256,
      bucket: "mastertutor",
      key: `downloads/${runId}/aaaaaaaaaaaa-a.pdf`,
      mime: "application/pdf",
      bytes: 3,
      sourceUrl: "https://example.com/a.pdf",
      approvedBy: member.userId,
    };
    expect(await findAssetBySha(agent.db, member.workspaceId, sha256)).toBeNull();
    const first = await agent.db.transaction((tx) => recordDownload(tx, input));
    const second = await agent.db.transaction((tx) => recordDownload(tx, input));
    expect(second.assetId).toBe(first.assetId);
    expect(second.downloadId).not.toBe(first.downloadId);
    expect(await findAssetBySha(agent.db, member.workspaceId, sha256)).toEqual({
      id: first.assetId,
      key: input.key,
    });
  });

  it("refuses a download whose run belongs to another workspace", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const input = {
      runId,
      workspaceId: outsider.workspaceId,
      filename: "b.pdf",
      sha256: "b".repeat(64),
      bucket: "mastertutor",
      key: `downloads/${runId}/bbbbbbbbbbbb-b.pdf`,
      mime: "application/pdf",
      bytes: 3,
      sourceUrl: "https://example.com/b.pdf",
      approvedBy: member.userId,
    };
    await expect(agent.db.transaction((tx) => recordDownload(tx, input))).rejects.toThrow(
      /workspace/,
    );
    expect(await findAssetBySha(agent.db, outsider.workspaceId, input.sha256)).toBeNull();
    expect(await owner.db.select().from(downloads).where(eq(downloads.runId, runId))).toEqual([]);
  });
});
