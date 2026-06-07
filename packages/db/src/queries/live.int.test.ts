import { randomUUID } from "node:crypto";
import { decodeNotify } from "@mastertutor/contracts";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.ts";
import { assets, downloads, runEvents, runs } from "../schema/index.ts";
import {
  leaseSlotForTest,
  nextNotification,
  releaseSlotForTest,
  seedMember,
  seedRun,
  startTestDatabase,
  type TestDatabase,
} from "../testing.ts";
import {
  discardDownload,
  fileKeptDownload,
  findAssetBySha,
  discardPendingDownloads,
  pendingDownloads,
  recordDownload,
  recordPendingDownload,
  upsertAsset,
} from "./downloads.ts";
import { returnControlToAgent } from "./control.ts";
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

  it("keeps a shared asset, and the object key it names, when the run that stored it is deleted (ruling)", async () => {
    const first = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const second = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const shared = {
      workspaceId: member.workspaceId,
      filename: "c.pdf",
      sha256: "c".repeat(64),
      bucket: "mastertutor",
      key: `downloads/${first}/cccccccccccc-c.pdf`,
      mime: "application/pdf",
      bytes: 3,
      sourceUrl: "https://example.com/c.pdf",
      approvedBy: member.userId,
    };
    const stored = await agent.db.transaction((tx) =>
      recordDownload(tx, { ...shared, runId: first }),
    );
    const reused = await agent.db.transaction((tx) =>
      recordDownload(tx, { ...shared, runId: second }),
    );
    expect(reused.assetId).toBe(stored.assetId);
    await owner.db.delete(runs).where(eq(runs.id, first));
    // The first run's download row goes with it; the asset (and so its object) stays referenced.
    expect(await owner.db.select().from(downloads).where(eq(downloads.runId, first))).toEqual([]);
    const [asset] = await owner.db.select().from(assets).where(eq(assets.id, stored.assetId));
    expect(asset).toMatchObject({ key: shared.key });
    expect(
      await owner.db.select().from(downloads).where(eq(downloads.assetId, stored.assetId)),
    ).toHaveLength(1);
  });

  it("holds a download made during control as pending; hand-back keeps only the listed ones (keep or discard)", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId, userId: member.userId });
    const [kept, dropped, otherRun] = [randomUUID(), randomUUID(), randomUUID()];
    const elsewhere = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId: elsewhere, userId: member.userId });
    for (const [id, run] of [
      [kept, runId],
      [dropped, runId],
      [otherRun, elsewhere],
    ] as const)
      await agent.db.transaction((tx) =>
        recordPendingDownload(tx, {
          id,
          runId: run,
          filename: `${id.slice(0, 4)}.txt`,
          bytes: 5,
          approvedBy: member.userId,
        }),
      );
    // Nothing pending is a stored asset yet.
    expect((await pendingDownloads(agent.db, runId)).map((d) => d.id).sort()).toEqual(
      [kept, dropped].sort(),
    );
    expect(
      await requestHandBack(web.db, {
        runId,
        userId: member.userId,
        note: null,
        keep: [kept, otherRun],
      }),
    ).toEqual({ ok: true, via: "control" });
    const pending = await pendingDownloads(agent.db, runId);
    expect(pending.find((d) => d.id === kept)?.keptAt).not.toBeNull();
    expect(pending.find((d) => d.id === dropped)?.keptAt).toBeNull();
    // Another run's download is never decided through this run's hand-back.
    expect((await pendingDownloads(agent.db, elsewhere))[0]?.keptAt).toBeNull();

    const filed = await agent.db.transaction((tx) =>
      fileKeptDownload(tx, {
        downloadId: kept,
        runId,
        workspaceId: member.workspaceId,
        sha256: "d".repeat(64),
        bucket: "mastertutor",
        key: `downloads/${runId}/dddddddddddd-kept.txt`,
        mime: "text/plain",
        sourceUrl: null,
      }),
    );
    await agent.db.transaction((tx) => discardDownload(tx, runId, dropped));
    expect(await pendingDownloads(agent.db, runId)).toEqual([]);
    const rows = await owner.db.select().from(downloads).where(eq(downloads.runId, runId));
    expect(rows).toEqual([expect.objectContaining({ id: kept, assetId: filed.assetId })]);
  });

  it("applies keep only when this user's own hand-back passes control to the agent (N1)", async () => {
    const holder = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const held = async (runId: string) => {
      const id = randomUUID();
      await agent.db.transaction((tx) =>
        recordPendingDownload(tx, {
          id,
          runId,
          filename: "h.txt",
          bytes: 1,
          approvedBy: holder.userId,
        }),
      );
      return id;
    };
    const keptAt = async (runId: string) => (await pendingDownloads(agent.db, runId))[0]?.keptAt;

    // Idle hand-back first (the agent took control back): a later keep marks nothing.
    const idle = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId: idle, userId: holder.userId });
    const idleDownload = await held(idle);
    await agent.db.transaction((tx) => returnControlToAgent(tx, idle));
    expect(
      await requestHandBack(web.db, {
        runId: idle,
        userId: holder.userId,
        note: null,
        keep: [idleDownload],
      }),
    ).toEqual({ ok: true, via: "none" });
    expect(await keptAt(idle)).toBeNull();

    // An owner ending someone else's takeover cannot keep that person's downloads.
    const forced = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId: forced, userId: holder.userId });
    const forcedDownload = await held(forced);
    expect(
      await requestHandBack(web.db, {
        runId: forced,
        userId: member.userId,
        note: null,
        keep: [forcedDownload],
      }),
    ).toEqual({ ok: true, via: "control" });
    expect(await keptAt(forced)).toBeNull();

    // The holder's own hand-back keeps.
    const own = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId: own, userId: holder.userId });
    const ownDownload = await held(own);
    await requestHandBack(web.db, {
      runId: own,
      userId: holder.userId,
      note: null,
      keep: [ownDownload],
    });
    expect(await keptAt(own)).not.toBeNull();
  });

  it("records a held download only while that person still holds control (N2)", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const record = (approvedBy: string) =>
      agent.db.transaction((tx) =>
        recordPendingDownload(tx, {
          id: randomUUID(),
          runId,
          filename: "h.txt",
          bytes: 1,
          approvedBy,
        }),
      );
    expect(await record(member.userId)).toBe(false); // the agent holds control
    await requestTakeover(web.db, { runId, userId: member.userId });
    expect(await record(outsider.userId)).toBe(false); // someone else's
    expect(await record(member.userId)).toBe(true);
    await requestHandBack(web.db, { runId, userId: member.userId, note: null, keep: [] });
    expect(await record(member.userId)).toBe(false); // handed back meanwhile
    expect(await pendingDownloads(agent.db, runId)).toHaveLength(1);
  });

  it("discards every held download of a run in one call, and names them (N4)", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await requestTakeover(web.db, { runId, userId: member.userId });
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids)
      await agent.db.transaction((tx) =>
        recordPendingDownload(tx, {
          id,
          runId,
          filename: "h.txt",
          bytes: 1,
          approvedBy: member.userId,
        }),
      );
    expect((await agent.db.transaction((tx) => discardPendingDownloads(tx, runId))).sort()).toEqual(
      ids.sort(),
    );
    expect(await pendingDownloads(agent.db, runId)).toEqual([]);
  });

  it("upserts an asset once per workspace and sha256, whichever path stores it", async () => {
    const asset = {
      workspaceId: member.workspaceId,
      sha256: "e".repeat(64),
      bucket: "mastertutor",
      key: "downloads/00000000-0000-4000-8000-000000000001/eeeeeeeeeeee-e.pdf",
      mime: "application/pdf",
      bytes: 4,
      sourceUrl: null,
    };
    const first = await agent.db.transaction((tx) => upsertAsset(tx, asset));
    const again = await agent.db.transaction((tx) =>
      upsertAsset(tx, { ...asset, key: "downloads/other/key.pdf" }),
    );
    expect(again).toBe(first);
    expect((await owner.db.select().from(assets).where(eq(assets.id, first)))[0]?.key).toBe(
      asset.key,
    );
  });
});
