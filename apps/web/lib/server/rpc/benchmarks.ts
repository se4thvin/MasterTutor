import type { DbHandle } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import {
  type BenchmarkScope,
  BenchmarkNameTaken,
  BenchmarkNotFound,
  BenchmarkRunNotFinished,
  createBenchmark,
  gradeBenchmarkRun,
  listBenchmarkRuns,
  listBenchmarks,
  startBenchmark,
} from "../benchmarks/service.ts";
import { served } from "../service-error.ts";
import { workspaceScoped } from "./workspace-scope.ts";

export function mapBenchmarkError(error: unknown): never {
  if (error instanceof BenchmarkNotFound)
    throw new ORPCError("NOT_FOUND", { message: error.message });
  if (error instanceof BenchmarkNameTaken || error instanceof BenchmarkRunNotFinished)
    throw new ORPCError("CONFLICT", { message: error.message });
  throw error;
}

/**
 * benchmarks.* (spec §11): every procedure runs in the viewer's workspace (Task 0 middleware).
 * start goes through createRun, whose ServiceErrors (the kill switch) `served` maps as runs.create does.
 */
export function createBenchmarkProcedures(deps: { db(): DbHandle }) {
  const scoped = workspaceScoped(deps.db);
  return {
    list: scoped.benchmarks.list.handler(async ({ context }) => ({
      items: await listBenchmarks(context.db.db, context.workspaceId),
    })),
    create: scoped.benchmarks.create.handler(({ context, input }) =>
      createBenchmark(context.db.db, context.workspaceId, input).catch(mapBenchmarkError),
    ),
    start: scoped.benchmarks.start.handler(({ context, input }) => {
      const scope: BenchmarkScope = { workspaceId: context.workspaceId, actor: context.actor };
      return served(() =>
        startBenchmark(context.db.db, scope, input.benchmarkId).catch(mapBenchmarkError),
      );
    }),
    runs: scoped.benchmarks.runs.handler(async ({ context, input }) => ({
      items: await listBenchmarkRuns(context.db.db, context.workspaceId, input),
    })),
    grade: scoped.benchmarks.grade.handler(({ context, input }) =>
      gradeBenchmarkRun(context.db.db, context.workspaceId, context.actor, input).catch(
        mapBenchmarkError,
      ),
    ),
  };
}
