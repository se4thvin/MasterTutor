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
} from "@mastertutor/contracts";
import { z } from "zod";
import { CallResult } from "../../../apps/agent/src/loop/call-result.ts";
import { unwrapUntrusted } from "../../../apps/agent/src/tools/untrusted.ts";

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
  /** A click, double click, drag, keypress or typing (P10b-7); scroll, move, wait and screenshot are not. */
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

/** The first words of describeCall's summary for the actions that change a page. */
const INTERACTION = /^(?:click|double click|drag|press|type) /;

export function traceSql(runId: string): string {
  const id = Uuid.parse(runId);
  return `select json_build_object(
  'status', r.status, 'waitReason', r.wait_reason, 'finalUrl', r.current_url,
  'steps', coalesce((select json_agg(json_build_object(
      'seq', s.seq, 'phase', s.phase, 'state', s.state, 'url', s.url, 'caption', s.caption,
      'screenshotKey', s.screenshot_key, 'action', s.action,
      'result', case when s.phase = 'act' and s.action->>'tool' in ('read_page', 'fill_credential') then s.result end
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
  const steps = raw.data.steps.map((step): TraceStep => {
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
      interaction: done && tool === "computer" && INTERACTION.test(step.action?.summary ?? ""),
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
