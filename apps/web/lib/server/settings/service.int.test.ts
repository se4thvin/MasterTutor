import { decodeNotify, EMPTY_USAGE } from "@mastertutor/contracts";
import { createDb, ensureWorkspaceMember, runSteps, runs, type DbHandle } from "@mastertutor/db";
import {
  nextNotification,
  seedMember,
  startTestDatabase,
  type TestDatabase,
} from "@mastertutor/db/testing";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSettingsProcedures } from "../rpc/settings.ts";
import type { Viewer } from "../viewer.ts";

const viewer: Viewer = { id: "u-settings", name: "S", email: "settings@example.test" };
const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

let tdb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;

const client = (who: Viewer | null = viewer) =>
  createRouterClient(
    { settings: createSettingsProcedures({ db: () => web }) },
    { context: { viewer: who } },
  );

beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  owner = createDb(tdb.ownerUrl, { max: 2 });
  web = createDb(tdb.webUrl, { max: 4 });
  await owner.sql`insert into "user" (id, name, email) values (${viewer.id}, ${viewer.name}, ${viewer.email})`;
  await ensureWorkspaceMember(web.db, viewer.id);
});
afterAll(async () => {
  await Promise.all([web?.close(), owner?.close()]);
  await tdb?.stop();
});

describe("settings.* on the live router (Task 0B)", () => {
  it("requires a session, and reads the defaults with a microsecond version", async () => {
    await expect(client(null).settings.get({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const view = await client().settings.get({});
    expect(view).toMatchObject({ killSwitch: false, concurrency: 2, defaultAllowedOrigins: [] });
    expect(view.version).toMatch(VERSION);
  });

  it("updates against the current version, and refuses a stale or foreign one (D14)", async () => {
    const before = await client().settings.get({});
    const after = await client().settings.update({
      version: before.version,
      defaultAllowedOrigins: ["example.com/x", "https://example.com"],
      defaultBudget: { maxSteps: 40, maxUsd: 2, maxActiveMinutes: 30 },
    });
    expect(after.defaultAllowedOrigins).toEqual(["https://example.com"]);
    expect(after.version).not.toBe(before.version);
    await expect(
      client().settings.update({ version: before.version, concurrency: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      client().settings.update({ version: "not-a-version", concurrency: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    for (const impossible of ["2026-13-01T00:00:00.000000Z", "2026-02-30T00:00:00.000000Z"])
      await expect(
        client().settings.update({ version: impossible, concurrency: 1 }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      client().settings.update({ version: after.version, concurrency: 3 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("kill switch on NOTIFYs kill, off wakes the claim loop, and neither changes the version", async () => {
    const before = await client().settings.get({});
    const on = await nextNotification(web.sql, "run_wake", () =>
      client().settings.setKillSwitch({ on: true }),
    );
    expect(decodeNotify("run_wake", on)).toEqual({ runId: null, reason: "kill" });
    const off = await nextNotification(web.sql, "run_wake", () =>
      client().settings.setKillSwitch({ on: false }),
    );
    expect(decodeNotify("run_wake", off)).toEqual({ runId: null, reason: "resume" });
    const after = await client().settings.get({});
    expect(after).toMatchObject({ killSwitch: false, version: before.version });
  });

  it("reports usage as a dense UTC daily series with runs, latency and the model error rate (D52)", async () => {
    const member = await seedMember(owner.db);
    const who = { id: member.userId, name: "U", email: `${member.userId}@example.test` };
    const day = (d: string, time = "10:00:00") => new Date(`${d}T${time}.000Z`);
    const [done] = await owner.db
      .insert(runs)
      .values({
        workspaceId: member.workspaceId,
        goal: "done",
        allowedOrigins: ["https://example.com"],
        status: "completed",
        usage: { ...EMPTY_USAGE, usd: 1.25, steps: 10 },
        createdAt: day("2026-10-02"),
        finishedAt: day("2026-10-02", "11:00:00"),
      })
      .returning({ id: runs.id });
    await owner.db.insert(runs).values({
      workspaceId: member.workspaceId,
      goal: "outage",
      allowedOrigins: ["https://example.com"],
      status: "failed",
      error: { code: "model_unavailable", message: "The model is unavailable." },
      usage: { ...EMPTY_USAGE, usd: 0.5, steps: 2 },
      createdAt: day("2026-10-04", "23:59:59"),
    });
    await owner.db.insert(runSteps).values([
      {
        runId: done!.id,
        seq: 0,
        phase: "act",
        state: "done",
        createdAt: day("2026-10-02"),
        updatedAt: day("2026-10-02", "10:00:01"),
      },
      {
        runId: done!.id,
        seq: 1,
        phase: "act",
        state: "done",
        createdAt: day("2026-10-02"),
        updatedAt: day("2026-10-02", "10:00:03"),
      },
    ]);
    const report = await client(who).settings.usage({ from: "2026-10-01", to: "2026-10-05" });
    expect(report.perDay).toEqual([
      { day: "2026-10-01", runs: 0, usd: 0, steps: 0 },
      { day: "2026-10-02", runs: 1, usd: 1.25, steps: 10 },
      { day: "2026-10-03", runs: 0, usd: 0, steps: 0 },
      { day: "2026-10-04", runs: 1, usd: 0.5, steps: 2 },
      { day: "2026-10-05", runs: 0, usd: 0, steps: 0 },
    ]);
    expect(report.perRun.map((r) => r.goal)).toEqual(["outage", "done"]);
    expect(report.stepLatencyMs).toEqual({ p50: 2000, p95: 2900 });
    expect(report.openaiErrorRate).toBe(0.5);
    const empty = await client(who).settings.usage({ from: "2026-01-01", to: "2026-01-02" });
    expect(empty).toMatchObject({
      perRun: [],
      stepLatencyMs: { p50: null, p95: null },
      openaiErrorRate: null,
    });
    expect(empty.perDay).toHaveLength(2);
  });
});
