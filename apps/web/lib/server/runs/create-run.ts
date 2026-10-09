import {
  CreateRunInput,
  encodeNotify,
  type PersonDecider,
  type RunSummary,
} from "@mastertutor/contracts";
import { folders, runs, settings, type Database } from "@mastertutor/db";
import { and, eq, sql } from "drizzle-orm";
import { ServiceError } from "../service-error.ts";
import { RUN_MESSAGES } from "./messages.ts";
import { runSummaryOf } from "./views.ts";

/** Who acts and where: the viewer's workspace (workspaceScoped) and their user id. */
export interface RunScope {
  workspaceId: string;
  actor: PersonDecider;
}

/**
 * runs.create (spec §5.2, S3). One transaction inserts the queued run and NOTIFYs run_queued, so
 * an agent only ever claims a committed run. The input is validated again here because T18's
 * benchmarks.start calls this directly: bypass always carries its acknowledgement (D44). The kill
 * switch row is share-locked, so a run cannot slip in while the switch is being turned on.
 */
export async function createRun(
  db: Database,
  scope: RunScope,
  input: CreateRunInput,
): Promise<RunSummary> {
  const parsed = CreateRunInput.safeParse(input);
  if (!parsed.success)
    throw new ServiceError("invalid", parsed.error.issues[0]?.message ?? "Invalid run.");
  const valid = parsed.data;
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ killSwitch: settings.killSwitch, defaultBudget: settings.defaultBudget })
      .from(settings)
      .where(eq(settings.workspaceId, scope.workspaceId))
      .for("share");
    if (!workspace) throw new ServiceError("not_found", "This workspace has no settings yet.");
    if (workspace.killSwitch) throw new ServiceError("conflict", RUN_MESSAGES.killSwitchOn);
    if (valid.targetFolderId !== null) {
      const [folder] = await tx
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(eq(folders.id, valid.targetFolderId), eq(folders.workspaceId, scope.workspaceId)),
        );
      if (!folder) throw new ServiceError("not_found", "That folder doesn't exist.");
    }
    const [row] = await tx
      .insert(runs)
      .values({
        workspaceId: scope.workspaceId,
        goal: valid.goal,
        approvalMode: valid.approvalMode,
        observerMode: valid.observerMode,
        toolProfile: valid.toolProfile,
        budget: valid.budget ?? workspace.defaultBudget,
        allowedOrigins: [...new Set(valid.allowedOrigins)],
        targetFolderId: valid.targetFolderId,
      })
      .returning();
    if (!row) throw new Error("runs insert returned no row");
    await tx.execute(
      sql`select pg_notify('run_queued', ${encodeNotify("run_queued", { runId: row.id })})`,
    );
    return runSummaryOf(row);
  });
}
