import { DEFAULT_BUDGET, PersonDecider } from "@mastertutor/contracts";
import { createDb, ensureWorkspaceMember, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBenchmarkProcedures, mapBenchmarkError } from "../rpc/benchmarks.ts";
import type { Viewer } from "../viewer.ts";
import {
  BenchmarkNameTaken,
  BenchmarkNotFound,
  BenchmarkRunNotFinished,
  createBenchmark,
  type CreateRunFn,
  gradeBenchmarkRun,
  listBenchmarkRuns,
  listBenchmarks,
  startBenchmark,
} from "./service.ts";

const viewer: Viewer = { id: "u-bench", name: "B", email: "bench@example.test" };
let tdb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let workspaceId: string;
let otherWorkspaceId: string;
const scope = () => ({ workspaceId, actor: PersonDecider.parse(viewer.id) });
const client = () =>
  createRouterClient(
    { benchmarks: createBenchmarkProcedures({ db: () => web }) },
    { context: { viewer } },
  );

const input = (name: string) => ({
  name,
  task: "Complete the fixture activities",
  allowedOrigins: ["http://bench.fixtures.test"],
  approvalMode: "auto_within_allowlist" as const,
  toolProfile: "computer_use" as const,
  budget: DEFAULT_BUDGET,
  successCriteria: "3 of 3 completed",
});

beforeAll(async () => {
  tdb = await startTestDatabase();
  owner = createDb(tdb.ownerUrl, { max: 2 });
  web = createDb(tdb.webUrl, { max: 4 });
  await owner.sql`insert into "user" (id, name, email) values (${viewer.id}, 'B', ${viewer.email})`;
  ({ workspaceId } = await ensureWorkspaceMember(web.db, viewer.id));
  const [ws] = await owner.sql`insert into workspaces (name) values ('other') returning id`;
  otherWorkspaceId = ws!.id as string;
});
afterAll(async () => {
  await Promise.all([web?.close(), owner?.close()]);
  await tdb?.stop();
});

describe("benchmarks service", () => {
  it("creates, lists per workspace and refuses duplicate names", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("fixture@computer_use#a1"));
    expect(view).toMatchObject({
      name: "fixture@computer_use#a1",
      toolProfile: "computer_use",
      approvalMode: "auto_within_allowlist",
    });
    await expect(
      createBenchmark(web.db, workspaceId, input("fixture@computer_use#a1")),
    ).rejects.toBeInstanceOf(BenchmarkNameTaken);
    expect((await listBenchmarks(web.db, workspaceId)).map((b) => b.name)).toContain(
      "fixture@computer_use#a1",
    );
    expect(await listBenchmarks(web.db, otherWorkspaceId)).toEqual([]);
  });

  it("starts a run through Task 0's createRun, in one transaction, with the benchmark's mode and profile", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("start-test"));
    await expect(
      startBenchmark(
        web.db,
        { workspaceId: otherWorkspaceId, actor: PersonDecider.parse(viewer.id) },
        view.id,
      ),
    ).rejects.toBeInstanceOf(BenchmarkNotFound);
    const started = await startBenchmark(web.db, scope(), view.id);
    const [run] =
      await owner.sql`select approval_mode, tool_profile, status from runs where id = ${started.runId}`;
    expect(run).toMatchObject({
      approval_mode: "auto_within_allowlist",
      tool_profile: "computer_use",
      status: "queued",
    });
    const [attempt] =
      await owner.sql`select run_id, outcome from benchmark_runs where id = ${started.benchmarkRunId}`;
    expect(attempt).toMatchObject({ run_id: started.runId, outcome: "pending" });
  });

  it("leaves no attempt behind when the run cannot be created", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("start-fails"));
    const failing: CreateRunFn = async () => {
      throw new Error("boom");
    };
    await expect(startBenchmark(web.db, scope(), view.id, failing)).rejects.toThrow("boom");
    const [row] =
      await owner.sql`select count(*)::int as n from benchmark_runs where benchmark_id = ${view.id}`;
    expect(row?.n).toBe(0);
  });

  it("bypass: create needs the acknowledgement, start carries it to the run (D44, P10a-15)", async () => {
    const api = client();
    const bypass = { ...input("bypass-test"), approvalMode: "bypass" as const };
    await expect(api.benchmarks.create(bypass)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const view = await api.benchmarks.create({ ...bypass, bypassAcknowledged: true });
    const { runId } = await api.benchmarks.start({ benchmarkId: view.id });
    const [run] = await owner.sql`select approval_mode from runs where id = ${runId}`;
    expect(run?.approval_mode).toBe("bypass");
  });

  it("shows live metrics while pending, refuses early grading, snapshots on grade and caps a takeover at partial", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("grade-test"));
    const { benchmarkRunId, runId } = await startBenchmark(web.db, scope(), view.id);
    await owner.sql`update runs set usage = ${JSON.stringify({ steps: 12, inputTokens: 900, cachedInputTokens: 0, outputTokens: 80, usd: 0.42, activeMs: 9000 })}::jsonb where id = ${runId}`;
    await owner.sql`insert into run_events (run_id, type, payload) values
      (${runId}, 'control', ${JSON.stringify({ type: "control", holder: "user" })}::jsonb),
      (${runId}, 'control', ${JSON.stringify({ type: "control", holder: "agent" })}::jsonb)`;

    const [pending] = await listBenchmarkRuns(web.db, workspaceId, {
      benchmarkId: view.id,
      limit: 10,
    });
    expect(pending).toMatchObject({
      outcome: "pending",
      steps: 12,
      usd: 0.42,
      takeovers: 1,
      finishedAt: null,
    });

    await expect(
      gradeBenchmarkRun(web.db, workspaceId, viewer.id, {
        benchmarkRunId,
        outcome: "failed",
        failureNotes: null,
      }),
    ).rejects.toBeInstanceOf(BenchmarkRunNotFinished);

    await owner.sql`update runs set status = 'completed', finished_at = now() where id = ${runId}`;
    const graded = await gradeBenchmarkRun(web.db, workspaceId, viewer.id, {
      benchmarkRunId,
      outcome: "passed",
      failureNotes: null,
    });
    expect(graded).toMatchObject({
      outcome: "partial",
      steps: 12,
      usd: 0.42,
      takeovers: 1,
      gradedBy: viewer.id,
    });
    expect(graded.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("a re-grade after a usage change rewrites only the verdict, never the snapshot (P10a-14)", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("regrade-test"));
    const { benchmarkRunId, runId } = await startBenchmark(web.db, scope(), view.id);
    await owner.sql`update runs set status = 'failed', finished_at = now(),
      usage = ${JSON.stringify({ steps: 5, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, usd: 0.1, activeMs: 1 })}::jsonb where id = ${runId}`;
    const first = await gradeBenchmarkRun(web.db, workspaceId, "first-grader", {
      benchmarkRunId,
      outcome: "failed",
      failureNotes: "class: action",
    });
    await owner.sql`update runs set usage = ${JSON.stringify({ steps: 99, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, usd: 9, activeMs: 0 })}::jsonb where id = ${runId}`;
    const again = await gradeBenchmarkRun(web.db, workspaceId, "second-grader", {
      benchmarkRunId,
      outcome: "partial",
      failureNotes: "class: perception",
    });
    expect(again).toMatchObject({
      outcome: "partial",
      failureNotes: "class: perception",
      gradedBy: "second-grader",
      steps: 5,
      usd: 0.1,
    });
    expect(again.durationMs).toBe(first.durationMs);
    expect(again.finishedAt).toBe(first.finishedAt);
  });

  it("never grades another workspace's run, and maps errors to oRPC codes", async () => {
    const view = await createBenchmark(web.db, workspaceId, input("cross-ws"));
    const { benchmarkRunId } = await startBenchmark(web.db, scope(), view.id);
    await expect(
      gradeBenchmarkRun(web.db, otherWorkspaceId, "x", {
        benchmarkRunId,
        outcome: "failed",
        failureNotes: null,
      }),
    ).rejects.toBeInstanceOf(BenchmarkNotFound);
    const api = client();
    await expect(api.benchmarks.create(input("cross-ws"))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(api.benchmarks.grade({ benchmarkRunId, outcome: "failed" })).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
    await expect(
      api.benchmarks.start({ benchmarkId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await api.benchmarks.runs({ benchmarkId: view.id })).items).toHaveLength(1);
    // Anything that is not a benchmark error passes through unchanged (a 500 without detail).
    const other = new Error("db down");
    expect(() => mapBenchmarkError(other)).toThrow(other);
  });
});

it("defaults benchmark attempts to shadow and accepts an explicit per-attempt enforce override", async () => {
  const view = await createBenchmark(web.db, workspaceId, input("guard-rollout"));
  const shadow = await startBenchmark(web.db, scope(), view.id);
  const enforced = await startBenchmark(web.db, scope(), view.id, undefined, "enforce");
  const [a] = await owner.sql`select observer_mode from runs where id = ${shadow.runId}`;
  const [b] = await owner.sql`select observer_mode from runs where id = ${enforced.runId}`;
  expect(a?.observer_mode).toBe("shadow");
  expect(b?.observer_mode).toBe("enforce");
});
