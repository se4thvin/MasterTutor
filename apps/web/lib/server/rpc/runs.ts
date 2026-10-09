import type { DbHandle } from "@mastertutor/db";
import { createRun, type RunScope } from "../runs/create-run.ts";
import {
  cancelRun,
  decideRunApproval,
  getRun,
  listRunSteps,
  listRuns,
  resumeRun,
  sendRunMessage,
  setRunApprovalMode,
} from "../runs/service.ts";
import { served } from "../service-error.ts";
import { workspaceScoped } from "./workspace-scope.ts";

const scopeOf = (context: RunScope): RunScope => ({
  workspaceId: context.workspaceId,
  actor: context.actor,
});

/**
 * runs.* for the live router. submitOtp stays in vault.ts (it seals) and openLive, takeControl
 * and handBack in B6's live/procedures.ts; liveRouter assembles all three.
 */
export function createRunProcedures(deps: { db(): DbHandle }) {
  const scoped = workspaceScoped(deps.db);
  return {
    create: scoped.runs.create.handler(({ context, input }) =>
      served(() => createRun(context.db.db, scopeOf(context), input)),
    ),
    list: scoped.runs.list.handler(({ context, input }) =>
      served(() => listRuns(context.db.db, scopeOf(context), input)),
    ),
    get: scoped.runs.get.handler(({ context, input }) =>
      served(() => getRun(context.db.db, scopeOf(context), input.runId)),
    ),
    steps: scoped.runs.steps.handler(({ context, input }) =>
      served(() => listRunSteps(context.db.db, scopeOf(context), input)),
    ),
    cancel: scoped.runs.cancel.handler(async ({ context, input }) => {
      await served(() => cancelRun(context.db.db, scopeOf(context), input.runId));
      return { ok: true as const };
    }),
    resume: scoped.runs.resume.handler(async ({ context, input }) => {
      await served(() => resumeRun(context.db.db, scopeOf(context), input.runId));
      return { ok: true as const };
    }),
    sendMessage: scoped.runs.sendMessage.handler(async ({ context, input }) => {
      await served(() => sendRunMessage(context.db.db, scopeOf(context), input));
      return { ok: true as const };
    }),
    setApprovalMode: scoped.runs.setApprovalMode.handler(async ({ context, input }) => {
      await served(() => setRunApprovalMode(context.db.db, scopeOf(context), input));
      return { ok: true as const };
    }),
    decideApproval: scoped.runs.decideApproval.handler(async ({ context, input }) => {
      await served(() => decideRunApproval(context.db.db, scopeOf(context), input));
      return { ok: true as const };
    }),
  };
}
