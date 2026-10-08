import type { WaitReason } from "@mastertutor/contracts";
import type { Verdict } from "./criteria.ts";
import type { RunTrace } from "./evidence.ts";
import type { FailureClass } from "./types.ts";

export interface WatchSummary {
  budgetHit: boolean;
  stalled: boolean;
  humanWait: WaitReason | null;
  spendCapHit: boolean;
  safetyChecks: string[];
  takeovers: number;
}
export interface FailureSignals {
  trace: RunTrace;
  verdict: Verdict;
  watch: WatchSummary;
}
export interface Failure {
  cls: FailureClass;
  reason: string;
  step: { seq: number; url: string | null; screenshotKey: string | null } | null;
}

/** A suggestion only: the orchestrator confirms or corrects the class in the ticket. */
export function suggestFailureClass(s: FailureSignals): Failure {
  const lastAct =
    [...s.trace.steps].reverse().find((x) => x.phase === "act" && x.screenshotKey !== null) ?? null;
  const step =
    lastAct === null
      ? null
      : { seq: lastAct.seq, url: lastAct.url, screenshotKey: lastAct.screenshotKey };
  const denied = s.trace.approvals.find(
    (a) => a.status === "denied" && (a.kind === "new_origin" || a.kind === "download"),
  );
  if (denied) return { cls: "policy", reason: `policy denied a ${denied.kind} request`, step };
  if (s.watch.safetyChecks.length > 0)
    return {
      cls: "policy",
      reason: `safety check(s) ${s.watch.safetyChecks.join(", ")} stopped the run`,
      step,
    };
  const credential = s.trace.steps.find((x) => x.credentialError !== null);
  if (
    credential ||
    s.watch.humanWait === "captcha" ||
    /sign-?in|log-?in/i.test(s.trace.finalUrl ?? "")
  )
    return {
      cls: "auth",
      reason: credential
        ? `fill_credential error ${credential.credentialError}`
        : "ended on a sign-in page or a CAPTCHA",
      step,
    };
  if (s.watch.budgetHit || s.watch.spendCapHit)
    return {
      cls: "budget",
      reason: s.watch.spendCapHit
        ? "the total spend cap stopped the run"
        : "the run hit its budget",
      step,
    };
  if (s.verdict.unvisited.length > 0)
    return {
      cls: "navigation",
      reason: `${s.verdict.unvisited.length} target page(s) never worked on`,
      step,
    };
  if (s.watch.stalled || s.watch.humanWait === "takeover" || s.trace.waitReason === "takeover")
    return {
      cls: "action",
      reason: s.watch.stalled
        ? "no progress within the stall window"
        : "the loop detector asked for a takeover",
      step,
    };
  return {
    cls: "perception",
    reason: `the agent finished but the evidence shows: ${s.verdict.unmet.slice(0, 3).join("; ")}`,
    step,
  };
}
