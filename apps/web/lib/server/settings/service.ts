import {
  USAGE_MAX_RUNS,
  type SettingsView,
  type UpdateSettingsInput,
  type UsageInput,
  type UsageReport,
} from "@mastertutor/contracts";
import {
  browserSlots,
  notifyRunWake,
  runSteps,
  runs,
  settings,
  type Database,
} from "@mastertutor/db";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { ServiceError } from "../service-error.ts";

/** settings.updated_at to the microsecond, as text: the defaults' version (D14). */
const version = sql<string>`to_char(${settings.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const LIVE_VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
/**
 * A version this module could have issued: the format, and a real instant Postgres accepts (no
 * month 13 or Feb 30, and no year 0000, which JS allows but timestamptz input refuses).
 */
function isLiveVersion(version: string): boolean {
  if (!LIVE_VERSION.test(version) || version.startsWith("0000")) return false;
  const toMs = `${version.slice(0, 23)}Z`;
  const at = Date.parse(toMs);
  return Number.isFinite(at) && new Date(at).toISOString() === toMs;
}
const VIEW = {
  killSwitch: settings.killSwitch,
  defaultBudget: settings.defaultBudget,
  defaultAllowedOrigins: settings.defaultAllowedOrigins,
  concurrency: settings.concurrency,
  version,
};
const missing = () => new ServiceError("not_found", "This workspace has no settings yet.");
const stale = () => new ServiceError("conflict", "Settings changed elsewhere. Reload them.");

export async function getSettings(db: Database, workspaceId: string): Promise<SettingsView> {
  const [row] = await db.select(VIEW).from(settings).where(eq(settings.workspaceId, workspaceId));
  if (!row) throw missing();
  return row;
}

/**
 * Writes the defaults only when `version` is still current (D14). Concurrency is capped by the
 * slots that exist (spec §11: concurrency equals the slot count at most).
 */
export async function updateSettings(
  db: Database,
  workspaceId: string,
  input: UpdateSettingsInput,
): Promise<SettingsView> {
  if (!isLiveVersion(input.version)) throw stale();
  return db.transaction(async (tx) => {
    if (input.concurrency !== undefined) {
      const [slots] = await tx.select({ n: count() }).from(browserSlots);
      if (input.concurrency > (slots?.n ?? 0))
        throw new ServiceError("invalid", "Concurrency can't exceed the browser slots.");
    }
    const [row] = await tx
      .update(settings)
      .set({
        ...(input.defaultBudget ? { defaultBudget: input.defaultBudget } : {}),
        ...(input.defaultAllowedOrigins
          ? { defaultAllowedOrigins: [...new Set(input.defaultAllowedOrigins)] }
          : {}),
        ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(settings.workspaceId, workspaceId),
          sql`${settings.updatedAt} = ${input.version}::timestamptz`,
        ),
      )
      .returning(VIEW);
    if (row) return row;
    const [exists] = await tx
      .select({ id: settings.workspaceId })
      .from(settings)
      .where(eq(settings.workspaceId, workspaceId));
    throw exists ? stale() : missing();
  });
}

/**
 * Spec §5.5. On: run_wake {null, kill} makes every agent abort and cancel within 1 s. Off: a
 * claim-loop wake (run_wake {null, resume}, routed to the supervisor's #kick) so nothing waits for
 * the 30 s sweep. Leaves updated_at alone, so an open defaults draft keeps its version.
 */
export async function setKillSwitch(
  db: Database,
  workspaceId: string,
  on: boolean,
): Promise<SettingsView> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(settings)
      .set({ killSwitch: on })
      .where(eq(settings.workspaceId, workspaceId))
      .returning(VIEW);
    if (!row) throw missing();
    await notifyRunWake(tx, null, on ? "kill" : "resume");
    return row;
  });
}

const dayStart = (day: string) => sql`(${day}::date)::timestamp at time zone 'UTC'`;
const dayEnd = (day: string) => sql`(${day}::date + 1)::timestamp at time zone 'UTC'`;

/**
 * Settings → Usage (spec §12 metrics). perDay is dense over the UTC days of the range (D52).
 * stepLatencyMs is act-step duration (run_steps holds phase latency). openaiErrorRate is the share
 * of the range's runs that failed with a model_* code (the agent's ModelUnavailable codes, M2).
 */
export async function usageReport(
  db: Database,
  workspaceId: string,
  input: UsageInput,
): Promise<UsageReport> {
  const inRange = and(
    eq(runs.workspaceId, workspaceId),
    gte(runs.createdAt, dayStart(input.from)),
    lt(runs.createdAt, dayEnd(input.to)),
  );
  const [perDay, perRun, latency, errors] = await Promise.all([
    db.execute<{ day: string; runs: number; usd: number; steps: number }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day,
             count(r.id)::int as runs,
             coalesce(sum((r.usage->>'usd')::float8), 0)::float8 as usd,
             coalesce(sum((r.usage->>'steps')::int), 0)::int as steps
      from generate_series(${input.from}::date::timestamp, ${input.to}::date::timestamp, interval '1 day') as d(day)
      left join runs r
        on r.workspace_id = ${workspaceId}
       and r.created_at >= (d.day at time zone 'UTC')
       and r.created_at < ((d.day + interval '1 day') at time zone 'UTC')
      group by d.day
      order by d.day`),
    db
      .select({
        runId: runs.id,
        goal: runs.goal,
        status: runs.status,
        usd: sql<number>`(${runs.usage}->>'usd')::float8`,
        steps: sql<number>`(${runs.usage}->>'steps')::int`,
      })
      .from(runs)
      .where(inRange)
      .orderBy(desc(runs.createdAt))
      .limit(USAGE_MAX_RUNS),
    db
      .select({
        p50: sql<
          number | null
        >`percentile_cont(0.5) within group (order by (extract(epoch from ${runSteps.updatedAt} - ${runSteps.createdAt}) * 1000)::float8)`,
        p95: sql<
          number | null
        >`percentile_cont(0.95) within group (order by (extract(epoch from ${runSteps.updatedAt} - ${runSteps.createdAt}) * 1000)::float8)`,
      })
      .from(runSteps)
      .innerJoin(runs, eq(runs.id, runSteps.runId))
      .where(
        and(
          eq(runs.workspaceId, workspaceId),
          eq(runSteps.phase, "act"),
          eq(runSteps.state, "done"),
          gte(runSteps.createdAt, dayStart(input.from)),
          lt(runSteps.createdAt, dayEnd(input.to)),
        ),
      ),
    db
      .select({
        total: count(),
        failed: sql<number>`(count(*) filter (where ${runs.error}->>'code' like 'model\\_%'))::int`,
      })
      .from(runs)
      .where(inRange),
  ]);
  const round = (value: number | null | undefined) =>
    value === null || value === undefined ? null : Math.round(value);
  const total = errors[0]?.total ?? 0;
  return {
    perDay: [...perDay],
    perRun,
    stepLatencyMs: { p50: round(latency[0]?.p50), p95: round(latency[0]?.p95) },
    openaiErrorRate: total === 0 ? null : (errors[0]?.failed ?? 0) / total,
  };
}
