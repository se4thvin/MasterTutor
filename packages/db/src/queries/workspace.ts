import { DEFAULT_CONCURRENCY, type MemberRole } from "@mastertutor/contracts";
import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { settings, user, workspaceMembers, workspaces } from "../schema/index.ts";

export async function hasAnyUser(db: Database): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).limit(1);
  return rows.length > 0;
}

/** Thrown inside the bootstrap lock when joining is not allowed and the workspace already exists. */
export class WorkspaceClosedError extends Error {
  constructor() {
    super("The workspace already exists and joining is closed");
    this.name = "WorkspaceClosedError";
  }
}

export interface Membership {
  workspaceId: string;
  role: MemberRole;
}

/**
 * v1 has one workspace (D4). The first user becomes its owner and creates its settings;
 * later users join as members unless `joinExisting` is false (then they get WorkspaceClosedError).
 * Serialized with an advisory lock so racing sign-ups agree.
 */
export async function ensureWorkspaceMember(
  db: Database,
  userId: string,
  options: { joinExisting?: boolean } = {},
): Promise<Membership> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('mastertutor.workspace_bootstrap'))`,
    );
    const [existing] = await tx
      .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .limit(1);
    if (existing) return existing;

    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .orderBy(asc(workspaces.createdAt))
      .limit(1);
    if (workspace) {
      if (options.joinExisting === false) throw new WorkspaceClosedError();
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: workspace.id, userId, role: "member" });
      return { workspaceId: workspace.id, role: "member" };
    }

    const [created] = await tx
      .insert(workspaces)
      .values({ name: "Workspace" })
      .returning({ id: workspaces.id });
    if (!created) throw new Error("workspace insert returned no row");
    await tx.insert(settings).values({
      workspaceId: created.id,
      concurrency: sql`least(${sql.raw(String(DEFAULT_CONCURRENCY))}, greatest(1, (select count(*) from browser_slots)))::int`,
    });
    await tx.insert(workspaceMembers).values({ workspaceId: created.id, userId, role: "owner" });
    return { workspaceId: created.id, role: "owner" };
  });
}
