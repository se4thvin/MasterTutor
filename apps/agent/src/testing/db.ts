import type {
  ApprovalMode,
  Budget,
  Controller,
  RunStatus,
  WaitReason,
} from "@mastertutor/contracts";
import { runs, settings, workspaces, type Database } from "@mastertutor/db";
import { sql } from "drizzle-orm";

export type RunRecord = typeof runs.$inferSelect;

export async function seedWorkspace(db: Database): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: "Test" })
    .returning({ id: workspaces.id });
  if (!workspace) throw new Error("workspace insert failed");
  await db.insert(settings).values({ workspaceId: workspace.id });
  return workspace.id;
}

export interface InsertRunOptions {
  workspaceId: string;
  goal?: string;
  allowedOrigins?: string[];
  status?: RunStatus;
  waitReason?: WaitReason | null;
  approvalMode?: ApprovalMode;
  budget?: Budget;
  controller?: Controller;
  /** Required by runs_control_user_matches_controller when controller is 'user'. */
  controlUserId?: string;
  leaseOwner?: string;
}

export async function insertRun(db: Database, options: InsertRunOptions): Promise<RunRecord> {
  const [run] = await db
    .insert(runs)
    .values({
      workspaceId: options.workspaceId,
      goal: options.goal ?? "Read the fixture article",
      allowedOrigins: options.allowedOrigins ?? ["http://site.fixtures.test"],
      status: options.status ?? "queued",
      waitReason: options.waitReason ?? null,
      approvalMode: options.approvalMode ?? "ask",
      controller: options.controller ?? "agent",
      controlUserId: options.controller === "user" ? (options.controlUserId ?? "test-user") : null,
      ...(options.budget ? { budget: options.budget } : {}),
      ...(options.leaseOwner
        ? { leaseOwner: options.leaseOwner, leaseExpiresAt: sql`now() + interval '1 hour'` }
        : {}),
    })
    .returning();
  if (!run) throw new Error("run insert failed");
  return run;
}
