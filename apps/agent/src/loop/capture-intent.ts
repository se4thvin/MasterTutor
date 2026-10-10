import { redactBrief } from "../capture/brief.ts";
import { CaptureBrief, CaptureQuestion, type SitePreference } from "@mastertutor/contracts";
import { siteKey } from "@mastertutor/contracts/server";
import { capturePreferences, runs, type Database } from "@mastertutor/db";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { IntentModel } from "../capture/intent-model.ts";
import type { StepWriter } from "../tools/types.ts";
import type { RunSnapshot } from "./run-state.ts";

export interface CaptureState {
  brief: CaptureBrief;
  question: CaptureQuestion | null;
  confirmedAt?: Date | null;
}
export async function captureState(db: Database, runId: string): Promise<CaptureState | null> {
  const [row] = await db
    .select({
      brief: runs.captureBrief,
      question: runs.captureQuestion,
      confirmedAt: runs.captureConfirmedAt,
    })
    .from(runs)
    .where(eq(runs.id, runId));
  return row?.brief
    ? {
        brief: CaptureBrief.parse(row.brief),
        confirmedAt: row.confirmedAt,
        question: row.question ? CaptureQuestion.parse(row.question) : null,
      }
    : null;
}
export async function preferencesFor(
  db: Database,
  run: Pick<RunSnapshot, "workspaceId" | "allowedOrigins">,
): Promise<SitePreference[]> {
  const domains = [...new Set(run.allowedOrigins.map(siteKey))];
  if (!domains.length) return [];
  const rows = await db
    .select({ domain: capturePreferences.domain, brief: capturePreferences.brief })
    .from(capturePreferences)
    .where(
      and(
        eq(capturePreferences.workspaceId, run.workspaceId),
        inArray(capturePreferences.domain, domains),
      ),
    );
  return rows.map((row) => ({ domain: row.domain, brief: CaptureBrief.parse(row.brief) }));
}
/** Called before the worker navigates, and refreshed at every loop phase (D56). */
export async function initializeCaptureIntent(
  db: Database,
  model: IntentModel,
  run: RunSnapshot,
  step: StepWriter,
  signal: AbortSignal,
  redact: (text: string) => string,
  remembered: Map<string, string> = new Map(),
): Promise<CaptureState> {
  const existing = await captureState(db, run.id);
  if (existing) {
    // An up-front question may precede source discovery. Only a person's confirmed scope
    // becomes a default; newer Settings edits win. Remember successful commits per worker
    // so established sites add no writes or events on the hot path.
    if (existing.confirmedAt && !existing.question) {
      const at = existing.confirmedAt;
      const stamp = at.toISOString();
      const domains = [...new Set(run.allowedOrigins.map(siteKey))].filter(
        (domain) => remembered.get(`${run.id}:${domain}`) !== stamp,
      );
      if (domains.length) {
        step.defer(async (tx) => {
          await tx
            .insert(capturePreferences)
            .values(
              domains.map((domain) => ({
                workspaceId: run.workspaceId,
                domain,
                brief: existing.brief,
              })),
            )
            .onConflictDoUpdate({
              target: [capturePreferences.workspaceId, capturePreferences.domain],
              set: { brief: existing.brief, updatedAt: sql`clock_timestamp()` },
              setWhere: lte(capturePreferences.updatedAt, at),
            });
        });
        step.afterCommit(async () => {
          for (const domain of domains) remembered.set(`${run.id}:${domain}`, stamp);
          // Hooks live for the worker process, so the successful-site cache stays bounded.
          while (remembered.size > 1000) remembered.delete(remembered.keys().next().value!);
        });
      }
    }
    return existing;
  }
  const preferences = await preferencesFor(db, run);
  const safePreferences = preferences.map((p) => ({
    ...p,
    brief: redactBrief(p.brief, redact),
  }));
  const intent = await model.derive(redact(run.goal), safePreferences, { step, signal });
  const domains = [...new Set(run.allowedOrigins.map(siteKey))];
  const consistent =
    domains.length > 0 &&
    preferences.length === domains.length &&
    preferences.every((p) => JSON.stringify(p.brief) === JSON.stringify(preferences[0]!.brief));
  const brief = CaptureBrief.parse(
    intent.ambiguous && consistent ? safePreferences[0]!.brief : redactBrief(intent.brief, redact),
  );
  const question =
    intent.ambiguous && !consistent
      ? CaptureQuestion.parse({ question: "What should I keep in your notes?", domains })
      : null;
  step.defer(async (tx) => {
    await tx
      .update(runs)
      .set({ captureBrief: brief, captureQuestion: question })
      .where(and(eq(runs.id, run.id), isNull(runs.captureBrief)));
  });
  step.emit({ type: "capture_brief", brief });
  if (question) step.emit({ type: "capture_asked", question });
  return { brief, question };
}
