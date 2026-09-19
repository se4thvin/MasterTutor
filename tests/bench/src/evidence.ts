import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ApprovalKind,
  ApprovalStatus,
  ReadPageResult,
  RunStatus,
  StepPhase,
  StepState,
  ToolName,
  Uuid,
  WaitReason,
  CallResult,
  summaryMayReachPage,
  unwrapUntrusted,
  type ActionEffect,
} from "@mastertutor/contracts";
import { z } from "zod";

const run = promisify(execFile);

export class SeamMismatch extends Error {
  constructor(detail: string) {
    super(`run_steps shape does not match the harness's reading of it (S12): ${detail}`);
    this.name = "SeamMismatch";
  }
}

const RawStep = z.object({
  seq: z.number().int(),
  phase: StepPhase,
  state: StepState,
  url: z.string().nullable(),
  caption: z.string().nullable(),
  screenshotKey: z.string().nullable(),
  action: z.looseObject({ tool: ToolName, summary: z.string() }).nullable(),
  result: z.unknown().nullable(),
});
const RawApproval = z.object({
  kind: ApprovalKind,
  status: ApprovalStatus,
  decidedBy: z.string().nullable(),
  origin: z.string().nullable(),
  safetyCodes: z
    .array(z.string().nullable())
    .transform((codes) => codes.map((code) => code ?? "unknown")),
});
const RawTrace = z.object({
  status: RunStatus,
  waitReason: WaitReason.nullable(),
  finalUrl: z.string().nullable(),
  steps: z.array(RawStep),
  approvals: z.array(RawApproval),
});

export interface TraceStep {
  seq: number;
  phase: StepPhase;
  state: StepState;
  /** For act steps: the url and screenshot of the observe step the action was decided on. */
  url: string | null;
  screenshotKey: string | null;
  caption: string | null;
  tool: ToolName | null;
  /** Any action in the step reached the page (P10b-7, N1); navigation, scroll, move, wait and screenshot do not (N2). */
  interaction: boolean;
  readPage: ReadPageResult | null;
  credentialError: string | null;
}
export type TraceApproval = z.infer<typeof RawApproval>;
export interface RunTrace {
  runId: string;
  status: RunStatus;
  waitReason: WaitReason | null;
  finalUrl: string | null;
  steps: TraceStep[];
  approvals: TraceApproval[];
}

/**
 * What each action of a computer step did. Rows that recorded no effects (older rows, calls that
 * never ran) fall back to the summary, strictly: a batch ("(+n more)") may hide a click (N1).
 */
function effectsOf(summary: string, result: unknown): ActionEffect[] {
  const parsed = CallResult.safeParse(result);
  if (parsed.success && parsed.data.kind === "computer" && parsed.data.effects)
    return parsed.data.effects;
  return [summaryMayReachPage(summary) ? "input" : "passive"];
}

/**
 * Which computer steps changed a page (P10b-7, I3, N1, N2): any input in the step; navigation
 * (back, forward, reload) is not. CTRL+L, the URL and ENTER count as navigation only when the
 * sequence ends in the ENTER that landed on the typed URL, within or across steps; a sequence
 * that is broken off or never lands is input.
 */
function interactions(steps: readonly { done: boolean; effects: ActionEffect[] }[]): boolean[] {
  const result = steps.map(() => false);
  let pending: number[] = [];
  const flush = () => {
    for (const index of pending) result[index] = true;
    pending = [];
  };
  steps.forEach((step, index) => {
    if (!step.done) return;
    for (const effect of step.effects) {
      if (effect === "address_bar") pending.push(index);
      else if (effect === "address_bar_landed") pending = [];
      else {
        flush();
        if (effect === "input") result[index] = true;
      }
    }
  });
  flush();
  return result;
}

export function traceSql(runId: string): string {
  const id = Uuid.parse(runId);
  return `select json_build_object(
  'status', r.status, 'waitReason', r.wait_reason, 'finalUrl', r.current_url,
  'steps', coalesce((select json_agg(json_build_object(
      'seq', s.seq, 'phase', s.phase, 'state', s.state, 'url', s.url, 'caption', s.caption,
      'screenshotKey', s.screenshot_key, 'action', s.action,
      'result', case when s.phase = 'act' and s.action->>'tool' in ('read_page', 'fill_credential', 'computer') then s.result end
    ) order by s.seq) from run_steps s where s.run_id = r.id), '[]'::json),
  'approvals', coalesce((select json_agg(json_build_object(
      'kind', a.kind, 'status', a.status, 'decidedBy', a.decided_by, 'origin', a.request->>'origin',
      'safetyCodes', coalesce((select json_agg(c->>'code') from jsonb_array_elements(coalesce(a.request->'safetyChecks', '[]'::jsonb)) c), '[]'::json)
    ) order by a.created_at) from approvals a where a.run_id = r.id), '[]'::json)
) from runs r where r.id = '${id}'`;
}

function functionOutput(result: unknown): string | null {
  const parsed = CallResult.safeParse(result);
  return parsed.success && parsed.data.kind === "function" ? parsed.data.output : null;
}

function readPageOf(seq: number, result: unknown): ReadPageResult | null {
  const output = functionOutput(result);
  const envelope = output === null ? null : unwrapUntrusted(output);
  if (envelope === null) return null; // a tool error ({"error":…}) is not evidence
  try {
    const parsed = ReadPageResult.safeParse(JSON.parse(envelope.content));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  throw new SeamMismatch(`read_page result at seq ${seq}`);
}

function credentialErrorOf(result: unknown): string | null {
  const output = functionOutput(result);
  if (output === null) return null;
  try {
    const value = JSON.parse(output) as { error?: unknown };
    return typeof value.error === "string" ? value.error : null;
  } catch {
    return null;
  }
}

export function parseTrace(runId: string, json: unknown): RunTrace {
  const raw = RawTrace.safeParse(json);
  if (!raw.success) throw new SeamMismatch(raw.error.issues[0]?.message ?? "invalid trace");
  let seen: { url: string | null; screenshotKey: string | null } = {
    url: null,
    screenshotKey: null,
  };
  const computer = raw.data.steps.map((step) => ({
    done: step.phase === "act" && step.state === "done" && step.action?.tool === "computer",
    effects: step.action?.tool === "computer" ? effectsOf(step.action.summary, step.result) : [],
  }));
  const changed = interactions(computer);
  const steps = raw.data.steps.map((step, index): TraceStep => {
    if (step.phase === "observe" && step.url !== null)
      seen = { url: step.url, screenshotKey: step.screenshotKey };
    const act = step.phase === "act";
    const done = act && step.state === "done";
    const tool = step.action?.tool ?? null;
    return {
      seq: step.seq,
      phase: step.phase,
      state: step.state,
      url: act ? (step.url ?? seen.url) : step.url,
      screenshotKey: act ? (step.screenshotKey ?? seen.screenshotKey) : step.screenshotKey,
      caption: step.caption,
      tool,
      interaction: changed[index]!,
      readPage: done && tool === "read_page" ? readPageOf(step.seq, step.result) : null,
      credentialError: done && tool === "fill_credential" ? credentialErrorOf(step.result) : null,
    };
  });
  return {
    runId,
    status: raw.data.status,
    waitReason: raw.data.waitReason,
    finalUrl: raw.data.finalUrl,
    steps,
    approvals: raw.data.approvals,
  };
}

/** §3.3(e): bypass auto-approves new origins, so leaving the allowed origins is a breach the report flags. */
export function bypassNewOrigins(trace: RunTrace): string[] {
  return trace.approvals
    .filter((a) => a.kind === "new_origin" && a.status === "approved" && a.decidedBy === "bypass")
    .map((a) => a.origin ?? "unknown");
}

/** Reads the trace as the DB owner inside the stack, read-only. Postgres is not published on the host. */
export async function loadRunTrace(compose: readonly string[], runId: string): Promise<RunTrace> {
  const [command, ...args] = compose;
  const { stdout } = await run(
    command!,
    [
      ...args,
      "exec",
      "-T",
      "-e",
      "PGOPTIONS=-c default_transaction_read_only=on",
      "postgres",
      "psql",
      "-U",
      "owner",
      "-d",
      "mastertutor",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      traceSql(runId),
    ],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  return parseTrace(runId, JSON.parse(stdout.trim()));
}
