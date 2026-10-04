import { decodeNotify, type RunEvent } from "@mastertutor/contracts";
import {
  approvals,
  assets,
  createDb,
  downloads,
  emitRunEvent,
  ensureWorkspaceMember,
  folders,
  runEvents,
  runSteps,
  runs,
  settings,
  type DbHandle,
} from "@mastertutor/db";
import {
  nextNotification,
  seedMember,
  seedRun,
  startTestDatabase,
  type TestDatabase,
} from "@mastertutor/db/testing";
import { createRouterClient } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRunProcedures } from "../rpc/runs.ts";
import type { Viewer } from "../viewer.ts";

const viewer: Viewer = { id: "u-runs", name: "R", email: "runs@example.test" };
const MISSING = "00000000-0000-4000-8000-00000000dead";

let tdb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let workspaceId: string;

const client = (who: Viewer | null = viewer) =>
  createRouterClient(
    { runs: createRunProcedures({ db: () => web }) },
    { context: { viewer: who } },
  );
const eventsOf = async (runId: string): Promise<RunEvent[]> =>
  (
    await web.db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
  ).map((r) => r.payload);
const runRow = async (runId: string) =>
  (await web.db.select().from(runs).where(eq(runs.id, runId)))[0]!;
const pendingApproval = async (runId: string, kind: "risky_click" | "budget" = "risky_click") => {
  const request =
    kind === "budget"
      ? {
          kind,
          exceeded: "steps" as const,
          usage: {
            steps: 150,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            usd: 1,
            activeMs: 0,
          },
          budget: { maxSteps: 150, maxUsd: 5, maxActiveMinutes: 60 },
        }
      : {
          kind,
          action: { type: "click" as const, x: 10, y: 10, button: "left" as const },
          label: "Delete",
          url: "https://example.com/",
          screenshotKey: null,
        };
  const [row] = await owner.db
    .insert(approvals)
    .values({ runId, stepSeq: 3, kind, request })
    .returning({ id: approvals.id });
  return row!.id;
};

beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  owner = createDb(tdb.ownerUrl, { max: 2 });
  web = createDb(tdb.webUrl, { max: 4 });
  await owner.sql`insert into "user" (id, name, email) values (${viewer.id}, ${viewer.name}, ${viewer.email})`;
  ({ workspaceId } = await ensureWorkspaceMember(web.db, viewer.id));
});
afterAll(async () => {
  await Promise.all([web?.close(), owner?.close()]);
  await tdb?.stop();
});

describe("runs.* on the live router (Task 0A)", () => {
  it("requires a session and a workspace", async () => {
    await expect(client(null).runs.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await owner.sql`insert into "user" (id, name, email) values ('u-none', 'N', 'none@example.test')`;
    const stranger = { id: "u-none", name: "N", email: "none@example.test" };
    await expect(client(stranger).runs.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates a queued run in one transaction with NOTIFY run_queued, using the defaults", async () => {
    let created: { id: string } | undefined;
    const payload = await nextNotification(web.sql, "run_queued", async () => {
      created = await client().runs.create({
        goal: "Read the article",
        allowedOrigins: ["example.com/a", "https://example.com"],
      });
    });
    expect(decodeNotify("run_queued", payload)).toEqual({ runId: created!.id });
    const row = await runRow(created!.id);
    expect(row).toMatchObject({
      workspaceId,
      status: "queued",
      approvalMode: "ask",
      controller: "agent",
      allowedOrigins: ["https://example.com"],
      budget: { maxSteps: 150, maxUsd: 5, maxActiveMinutes: 60 },
    });
  });

  it("refuses a folder outside the workspace, bypass without the acknowledgement, and the kill switch", async () => {
    const stranger = await seedMember(owner.db);
    const [foreign] = await owner.db
      .insert(folders)
      .values({ workspaceId: stranger.workspaceId, name: "Theirs" })
      .returning({ id: folders.id });
    await expect(
      client().runs.create({
        goal: "x",
        allowedOrigins: ["https://example.com"],
        targetFolderId: foreign!.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      client().runs.create({
        goal: "x",
        allowedOrigins: ["https://example.com"],
        approvalMode: "bypass",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const bypass = await client().runs.create({
      goal: "x",
      allowedOrigins: ["https://example.com"],
      approvalMode: "bypass",
      bypassAcknowledged: true,
    });
    expect(bypass.approvalMode).toBe("bypass");
    await owner.db
      .update(settings)
      .set({ killSwitch: true })
      .where(eq(settings.workspaceId, workspaceId));
    try {
      await expect(
        client().runs.create({ goal: "x", allowedOrigins: ["https://example.com"] }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await owner.db
        .update(settings)
        .set({ killSwitch: false })
        .where(eq(settings.workspaceId, workspaceId));
    }
  });

  it("lists newest first with a keyset cursor, scoped to the workspace", async () => {
    const member = await seedMember(owner.db);
    const lister = { id: member.userId, name: "L", email: `${member.userId}@example.test` };
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [row] = await owner.db
        .insert(runs)
        .values({
          workspaceId: member.workspaceId,
          goal: `g${i}`,
          allowedOrigins: ["https://example.com"],
          createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)),
        })
        .returning({ id: runs.id });
      ids.push(row!.id);
    }
    const first = await client(lister).runs.list({ limit: 2 });
    expect(first.items.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    const second = await client(lister).runs.list({ limit: 2, cursor: first.nextCursor });
    expect(second.items.map((r) => r.id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
    await expect(client(lister).runs.list({ cursor: "4" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const mine = await client().runs.list({ limit: 100 });
    expect(mine.items.some((r) => ids.includes(r.id))).toBe(false);
  });

  it("gets a run with its pending approvals and last event id, and hides other workspaces", async () => {
    const runId = await seedRun(owner.db, {
      workspaceId,
      status: "waiting",
      waitReason: "approval",
    });
    const approvalId = await pendingApproval(runId);
    const eventId = await web.db.transaction((tx) =>
      emitRunEvent(tx, runId, { type: "slot", slotName: "browser-1" }),
    );
    const detail = await client().runs.get({ runId });
    expect(detail.pendingApprovals.map((a) => a.id)).toEqual([approvalId]);
    expect(detail.lastEventId).toBe(eventId);
    const stranger = await seedMember(owner.db);
    const foreign = await seedRun(owner.db, { workspaceId: stranger.workspaceId });
    await expect(client().runs.get({ runId: foreign })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(client().runs.get({ runId: MISSING })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("snapshots the run's stored downloads: filed only, cleaned, this run and workspace only", async () => {
    const runId = await seedRun(owner.db, { workspaceId, status: "completed" });
    const asset = async (sha256: string, ws = workspaceId) =>
      (
        await owner.db
          .insert(assets)
          .values({
            workspaceId: ws,
            sha256,
            bucket: "b",
            key: `k/${sha256}`,
            mime: "application/pdf",
            bytes: 1,
          })
          .returning({ id: assets.id })
      )[0]!.id;
    const agentAsset = await asset("a1");
    const keptAsset = await asset("a2");
    const [agentDl] = await owner.db
      .insert(downloads)
      .values({
        runId,
        filename: "../week-2\u202Ereport.pdf",
        bytes: 2_048,
        approvedBy: viewer.id,
        assetId: agentAsset,
      })
      .returning({ id: downloads.id, createdAt: downloads.createdAt });
    const [keptDl] = await owner.db
      .insert(downloads)
      .values({
        runId,
        filename: "slides.pptx",
        bytes: 9,
        approvedBy: viewer.id,
        assetId: keptAsset,
        byUser: true,
        keptAt: new Date(),
      })
      .returning({ id: downloads.id, createdAt: downloads.createdAt });
    // Discarded at hand-back, still held, and filed with its asset since deleted: never shown.
    await owner.db.insert(downloads).values([
      {
        runId,
        filename: "discarded.pdf",
        bytes: 1,
        approvedBy: viewer.id,
        byUser: true,
        discardedAt: new Date(),
      },
      { runId, filename: "held.pdf", bytes: 1, approvedBy: viewer.id, byUser: true, pending: true },
      { runId, filename: "gone.pdf", bytes: 1, approvedBy: viewer.id },
    ]);
    const stranger = await seedMember(owner.db);
    const foreign = await seedRun(owner.db, { workspaceId: stranger.workspaceId });
    await owner.db.insert(downloads).values({
      runId: foreign,
      filename: "theirs.pdf",
      bytes: 1,
      approvedBy: "x",
      assetId: await asset("a3", stranger.workspaceId),
    });
    const detail = await client().runs.get({ runId });
    expect(detail.downloads).toEqual([
      {
        id: agentDl!.id,
        assetId: agentAsset,
        filename: "week-2_report.pdf",
        bytes: 2_048,
        at: agentDl!.createdAt.toISOString(),
      },
      {
        id: keptDl!.id,
        assetId: keptAsset,
        filename: "slides.pptx",
        bytes: 9,
        at: keptDl!.createdAt.toISOString(),
      },
    ]);
    await expect(client().runs.get({ runId: foreign })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("snapshots the downloads held during control: undecided, this run and workspace only (A11)", async () => {
    const runId = await seedRun(owner.db, {
      workspaceId,
      status: "waiting",
      waitReason: "takeover",
    });
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: viewer.id })
      .where(eq(runs.id, runId));
    const [held] = await owner.db
      .insert(downloads)
      .values({
        runId,
        filename: "week-2 report.pdf",
        bytes: 2_048,
        approvedBy: viewer.id,
        pending: true,
      })
      .returning({ id: downloads.id });
    // Already kept (being filed), already filed, and another run's held file: never offered.
    await owner.db.insert(downloads).values([
      {
        runId,
        filename: "kept.pdf",
        bytes: 1,
        approvedBy: viewer.id,
        pending: true,
        keptAt: new Date(),
      },
      { runId, filename: "filed.pdf", bytes: 1, approvedBy: viewer.id },
    ]);
    const stranger = await seedMember(owner.db);
    const foreign = await seedRun(owner.db, { workspaceId: stranger.workspaceId });
    await owner.db
      .insert(downloads)
      .values({ runId: foreign, filename: "theirs.pdf", bytes: 1, approvedBy: "x", pending: true });
    const detail = await client().runs.get({ runId });
    expect(detail.heldDownloads).toEqual([
      { id: held!.id, filename: "week-2 report.pdf", bytes: 2_048 },
    ]);
    // Once control is back with the agent, nothing is held for this person to decide.
    await owner.db
      .update(runs)
      .set({ controller: "agent", controlUserId: null })
      .where(eq(runs.id, runId));
    expect((await client().runs.get({ runId })).heldDownloads).toEqual([]);
  });

  it("lists steps after a seq, keeping only the StepAction fields", async () => {
    const runId = await seedRun(owner.db, { workspaceId });
    await owner.db.insert(runSteps).values(
      [0, 1, 2].map((seq) => ({
        runId,
        seq,
        phase: "act" as const,
        state: "done" as const,
        action: { tool: "computer", summary: `step ${seq}`, point: null, callId: "c1" },
      })),
    );
    const { items } = await client().runs.steps({ runId, afterSeq: 0 });
    expect(items.map((s) => s.seq)).toEqual([1, 2]);
    expect(items[0]!.action).toEqual({ tool: "computer", summary: "step 1", point: null });
    await expect(client().runs.steps({ runId: MISSING })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("cancels: status event, superseded approvals, NOTIFY run_control; idempotent; refuses a finished run", async () => {
    const runId = await seedRun(owner.db, {
      workspaceId,
      status: "waiting",
      waitReason: "approval",
    });
    const approvalId = await pendingApproval(runId);
    const payload = await nextNotification(web.sql, "run_control", () =>
      client().runs.cancel({ runId }),
    );
    expect(decodeNotify("run_control", payload)).toEqual({ runId });
    expect(await runRow(runId)).toMatchObject({
      status: "cancelled",
      waitReason: null,
      controller: "agent",
    });
    expect((await runRow(runId)).finishedAt).not.toBeNull();
    const [approval] = await web.db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(approval).toMatchObject({ status: "superseded", decidedBy: viewer.id });
    expect(await eventsOf(runId)).toEqual([
      { type: "approval_resolved", approvalId, status: "superseded", decidedBy: viewer.id },
      { type: "status", status: "cancelled", waitReason: null, reason: "cancelled by the user" },
    ]);
    await expect(client().runs.cancel({ runId })).resolves.toEqual({ ok: true });
    const done = await seedRun(owner.db, { workspaceId, status: "completed" });
    await expect(client().runs.cancel({ runId: done })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("hides other workspaces' runs from cancel, resume and sendMessage, and leaves them untouched", async () => {
    const stranger = await seedMember(owner.db);
    const foreign = await seedRun(owner.db, {
      workspaceId: stranger.workspaceId,
      status: "sleeping",
    });
    await expect(client().runs.cancel({ runId: foreign })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(client().runs.resume({ runId: foreign })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      client().runs.sendMessage({ runId: foreign, text: "not yours" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await runRow(foreign)).toMatchObject({ status: "sleeping", wakeRequestedAt: null });
    expect(await eventsOf(foreign)).toEqual([]);
  });

  it("sends a message as a user_message event and wakes a sleeping run", async () => {
    const runId = await seedRun(owner.db, { workspaceId, status: "sleeping" });
    const payload = await nextNotification(web.sql, "run_wake", () =>
      client().runs.sendMessage({ runId, text: "Skip the quiz" }),
    );
    expect(decodeNotify("run_wake", payload)).toEqual({ runId, reason: "message" });
    expect(await eventsOf(runId)).toEqual([{ type: "user_message", text: "Skip the quiz" }]);
    expect((await runRow(runId)).wakeRequestedAt).not.toBeNull();
    const done = await seedRun(owner.db, { workspaceId, status: "failed" });
    await expect(client().runs.sendMessage({ runId: done, text: "x" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("resumes a sleeping run with a wake request and NOTIFY run_wake(resume)", async () => {
    const runId = await seedRun(owner.db, { workspaceId, status: "sleeping" });
    const payload = await nextNotification(web.sql, "run_wake", () =>
      client().runs.resume({ runId }),
    );
    expect(decodeNotify("run_wake", payload)).toEqual({ runId, reason: "resume" });
    expect((await runRow(runId)).wakeRequestedAt).not.toBeNull();
  });

  it("records the viewer as decidedBy (D11), emits approval_resolved and wakes the run", async () => {
    const runId = await seedRun(owner.db, {
      workspaceId,
      status: "waiting",
      waitReason: "approval",
    });
    const approvalId = await pendingApproval(runId, "budget");
    const payload = await nextNotification(web.sql, "run_wake", () =>
      client().runs.decideApproval({
        approvalId,
        decision: "approved",
        budgetChoice: "finish_now",
      }),
    );
    expect(decodeNotify("run_wake", payload)).toEqual({ runId, reason: "approval" });
    const [row] = await web.db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row).toMatchObject({
      status: "approved",
      decidedBy: viewer.id,
      edit: { instruction: null, budgetChoice: "finish_now" },
    });
    expect(await eventsOf(runId)).toEqual([
      { type: "approval_resolved", approvalId, status: "approved", decidedBy: viewer.id },
    ]);
    await expect(
      client().runs.decideApproval({ approvalId, decision: "denied" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a budget choice on another kind, and approvals of other workspaces", async () => {
    const runId = await seedRun(owner.db, {
      workspaceId,
      status: "waiting",
      waitReason: "approval",
    });
    const approvalId = await pendingApproval(runId);
    await expect(
      client().runs.decideApproval({ approvalId, decision: "approved", budgetChoice: "extend" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const stranger = await seedMember(owner.db);
    const foreignRun = await seedRun(owner.db, {
      workspaceId: stranger.workspaceId,
      status: "waiting",
      waitReason: "approval",
    });
    const foreign = await pendingApproval(foreignRun);
    await expect(
      client().runs.decideApproval({ approvalId: foreign, decision: "denied" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [untouched] = await web.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, foreign)));
    expect(untouched!.status).toBe("pending");
  });
});
