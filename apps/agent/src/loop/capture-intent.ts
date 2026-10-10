import { CaptureBrief, CaptureQuestion, type SitePreference } from "@mastertutor/contracts";
import { siteKey } from "@mastertutor/contracts/server";
import { capturePreferences, runs, type Database } from "@mastertutor/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { IntentModel } from "../capture/intent-model.ts";
import type { StepWriter } from "../tools/types.ts";
import type { RunSnapshot } from "./run-state.ts";

export interface CaptureState {
  brief: CaptureBrief;
  question: CaptureQuestion | null;
}
export async function captureState(db: Database, runId: string): Promise<CaptureState | null> {
  const [row] = await db
    .select({ brief: runs.captureBrief, question: runs.captureQuestion })
    .from(runs)
    .where(eq(runs.id, runId));
  return row?.brief
    ? {
        brief: CaptureBrief.parse(row.brief),
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
): Promise<CaptureState> {
  const existing = await captureState(db, run.id);
  if (existing) return existing;
  const preferences = await preferencesFor(db, run);
  const safePreferences = preferences.map((p) => ({
    ...p,
    brief: { ...p.brief, scopeNote: redact(p.brief.scopeNote) },
  }));
  const intent = await model.derive(redact(run.goal), safePreferences, { step, signal });
  const domains = [...new Set(run.allowedOrigins.map(siteKey))];
  const consistent =
    domains.length > 0 &&
    preferences.length === domains.length &&
    preferences.every((p) => JSON.stringify(p.brief) === JSON.stringify(preferences[0]!.brief));
  const brief = CaptureBrief.parse(
    intent.ambiguous && consistent
      ? safePreferences[0]!.brief
      : { ...intent.brief, scopeNote: redact(intent.brief.scopeNote) },
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
