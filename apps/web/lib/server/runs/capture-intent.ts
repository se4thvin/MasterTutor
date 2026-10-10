import {
  CaptureBrief,
  PersonDecider,
  SetCaptureBriefInput,
  SetCapturePreferenceInput,
  TERMINAL_RUN_STATUSES,
  type SitePreference,
} from "@mastertutor/contracts";
import { siteKey } from "@mastertutor/contracts/server";
import {
  capturePreferences,
  emitRunEvent,
  notifyRunWake,
  runs,
  type Database,
  type DbTx,
} from "@mastertutor/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { ServiceError } from "../service-error.ts";
import type { RunScope } from "./create-run.ts";
import { screenCaptureScope } from "../vault/scope-screen.ts";

async function savePreference(tx: DbTx, workspaceId: string, domain: string, brief: CaptureBrief) {
  await tx
    .insert(capturePreferences)
    .values({ workspaceId, domain, brief })
    .onConflictDoUpdate({
      target: [capturePreferences.workspaceId, capturePreferences.domain],
      set: { brief, updatedAt: sql`clock_timestamp()` },
    });
}
export async function listCapturePreferences(
  db: Database,
  workspaceId: string,
): Promise<{ items: SitePreference[] }> {
  const rows = await db
    .select({ domain: capturePreferences.domain, brief: capturePreferences.brief })
    .from(capturePreferences)
    .where(eq(capturePreferences.workspaceId, workspaceId))
    .orderBy(asc(capturePreferences.domain));
  return { items: rows.map((row) => ({ ...row, brief: CaptureBrief.parse(row.brief) })) };
}
export async function setCapturePreference(
  db: Database,
  scope: RunScope,
  raw: unknown,
  screen: (workspaceId: string, text: string) => Promise<void> = screenCaptureScope,
): Promise<void> {
  PersonDecider.parse(scope.actor);
  const input = SetCapturePreferenceInput.parse(raw);
  await screen(scope.workspaceId, input.brief.scopeNote);
  let domain: string;
  try {
    domain = siteKey(input.url);
  } catch {
    throw new ServiceError("invalid", "Enter an http(s) site without credentials.");
  }
  await db.transaction((tx) => savePreference(tx, scope.workspaceId, domain, input.brief));
}
/** Scope is a person-only decision. Action approval mode has no effect on this path. */
export async function setCaptureBrief(
  db: Database,
  scope: RunScope,
  raw: SetCaptureBriefInput,
  screen: (workspaceId: string, text: string) => Promise<void> = screenCaptureScope,
): Promise<void> {
  const by = PersonDecider.parse(scope.actor);
  const input = SetCaptureBriefInput.parse(raw);
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, input.runId), eq(runs.workspaceId, scope.workspaceId)))
      .for("update");
    if (!run) throw new ServiceError("not_found", "That run doesn't exist.");
    if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status))
      throw new ServiceError("conflict", "This run has finished.");
    await screen(scope.workspaceId, input.brief.scopeNote);
    const domains = run.captureQuestion?.domains ?? [...new Set(run.allowedOrigins.map(siteKey))];
    const resume =
      run.captureQuestion &&
      run.status === "waiting" &&
      run.waitReason === "approval" &&
      run.controller === "agent";
    await tx
      .update(runs)
      .set({
        ...(resume ? { status: "running" as const, waitReason: null } : {}),
        captureBrief: input.brief,
        captureConfirmedAt: sql`clock_timestamp()`,
        captureQuestion: null,
        wakeRequestedAt: sql`now()`,
      })
      .where(eq(runs.id, input.runId));
    for (const domain of domains) await savePreference(tx, scope.workspaceId, domain, input.brief);
    await emitRunEvent(
      tx,
      input.runId,
      run.captureQuestion
        ? { type: "capture_answered", brief: input.brief, by }
        : { type: "capture_brief", brief: input.brief },
    );
    if (resume)
      await emitRunEvent(tx, input.runId, {
        type: "status",
        status: "running",
        waitReason: null,
        reason: "capture_scope_answered",
      });
    await notifyRunWake(tx, input.runId, "approval");
  });
}
