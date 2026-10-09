import { MAX_UNTRUSTED, untrustedText } from "@mastertutor/contracts";
import { findRuns, runDetail, type DbLike } from "@mastertutor/db";
import { RunDetailArgs, RunsFindArgs } from "@mastertutor/observer/copilot";
import { invalid, type ToolFn } from "./types.ts";

export const runsFind =
  (db: DbLike): ToolFn =>
  async (raw, ctx) => {
    const args = RunsFindArgs.safeParse(raw);
    if (!args.success) return invalid(args.error.issues.map((i) => i.message).join("; "));
    const rows = await findRuns(db, ctx.caller.workspaceId, args.data);
    return {
      summary: `${rows.length} runs`,
      query: { ...args.data },
      columns: [
        "run",
        "status",
        "approval_mode",
        "observer_mode",
        "model",
        "usd",
        "steps",
        "error_code",
        "created_at",
        "finished_at",
      ],
      rows: rows.map((r) => [
        ctx.handles.handleOf(r.id),
        r.status,
        r.approvalMode,
        r.observerMode,
        r.model,
        Number(r.usage.usd.toFixed(4)),
        r.usage.steps,
        r.errorCode,
        r.createdAt.toISOString(),
        r.finishedAt?.toISOString() ?? null,
      ]),
      truncated: rows.length >= args.data.limit,
      tainted: false,
      outcome: "ok",
      error: null,
      chart: null,
    };
  };

export const runDetailTool =
  (db: DbLike): ToolFn =>
  async (raw, ctx) => {
    const args = RunDetailArgs.safeParse(raw);
    if (!args.success) return invalid(args.error.issues.map((i) => i.message).join("; "));
    const runId = ctx.handles.runIdOf(args.data.run);
    if (!runId) return invalid(`Unknown run handle ${args.data.run}; use runs_find first.`);
    // Both the question's opt-in and the tool argument are needed (D52, spec §7.5).
    const includeUntrusted = ctx.includeUntrusted && args.data.includeUntrusted;
    const detail = await runDetail(db, ctx.caller.workspaceId, runId, { includeUntrusted });
    if (!detail) return invalid(`Run ${args.data.run} is not in this workspace.`);
    const clean = (text: string | null) =>
      text === null ? null : untrustedText(text, MAX_UNTRUSTED);
    const rows = [
      ...(detail.goal ? [["goal", null, null, null, clean(detail.goal)]] : []),
      ...detail.steps.map((s) => [
        "step",
        s.seq,
        s.phase,
        s.state,
        [s.tool, s.origin, clean(s.caption)].filter(Boolean).join(" · ") || null,
      ]),
      ...detail.approvals.map((a) => ["approval", a.stepSeq, a.kind, a.status, a.decider]),
      ...detail.guard.map((g) => [
        "guard",
        g.stepSeq,
        g.verdict,
        g.category,
        `${g.stage}${g.applied ? " applied" : ""} ${g.latencyMs} ms`,
      ]),
      ...detail.events
        .filter((e) => e.type !== "step")
        .map((e) => ["event", null, e.type, e.guardVerdict, e.guardCategory]),
    ].slice(0, 200);
    return {
      summary: `${args.data.run}: ${detail.run.status}${detail.run.errorCode ? ` (${detail.run.errorCode})` : ""}`,
      query: { run: args.data.run, includeUntrusted },
      columns: ["kind", "seq", "what", "status", "detail"],
      rows,
      truncated: rows.length >= 200,
      tainted: includeUntrusted,
      outcome: "ok",
      error: null,
      chart: null,
    };
  };
