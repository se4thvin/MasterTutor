import {
  EMPTY_USAGE,
  GUARD_LIMITS,
  POST_INJECTION_STEPS,
  type GuardInput,
  type GuardVerdict,
  type RiskLevel,
} from "@mastertutor/contracts";
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { loadGuardLedger } from "@mastertutor/db";
import { RedactionTripped, assertRedacted } from "@mastertutor/observer";
import {
  DenialLedger,
  buildGuardInput,
  guardEffect,
  type GuardItemDraft,
  type LedgerState,
} from "@mastertutor/observer/guard";
import { instrument } from "@mastertutor/telemetry/instrument";
import { recordObserverFailure, recordObserverSpend } from "@mastertutor/telemetry/record";
import type { RunSnapshot } from "../../loop/run-state.ts";
import { UNAVAILABLE_VERDICT, type GuardReviewer, type ReviewOutcome } from "./reviewer.ts";
import { guardItemOf } from "./turn.ts";
import type {
  GuardItemOutcome,
  GuardTurnResult,
  SeenItem,
  StepGuard,
  StepGuardFactory,
} from "./types.ts";

const NOTHING: GuardTurnResult = {
  outcomes: new Map(),
  event: null,
  review: null,
  usage: EMPTY_USAGE,
  limit: false,
};
const ACTUATIONS = new Set(["click", "type", "keypress", "submit"]);

export function createStepGuard(options: {
  run: RunSnapshot;
  reviewer: GuardReviewer;
  redact(text: string): string;
  ledger: LedgerState;
}): StepGuard {
  const { run, reviewer, redact } = options;
  const rollout = run.observerMode;
  let ledger = new DenialLedger(options.ledger);
  const beforeReview = new WeakMap<GuardTurnResult, LedgerState>();
  const actuated = new Set<string>();
  const initialOrigins = run.allowedOrigins.length;
  let turns = 0;
  let injectionAt: number | null = null;
  let injectionSignals = 0;
  const riskLevel: RiskLevel = "normal";

  const row = (
    verdict: GuardVerdict,
    applied: boolean,
    input: GuardInput | null,
    outcome: Pick<ReviewOutcome, "latencyMs" | "usage">,
  ) => ({
    stage: verdict.stage,
    verdict: verdict.verdict,
    category: verdict.category,
    rollout,
    applied,
    input,
    latencyMs: outcome.latencyMs,
    usd: outcome.usage.usd,
    ...ledger.state,
  });

  return {
    rollout,
    review(turn, signal) {
      return instrument(
        SPAN.observerReview,
        { [ATTR.runId]: run.id, [ATTR.observerRole]: "guard", [ATTR.observerRollout]: rollout },
        async (span) => {
          turns += 1;
          if (
            turn.seen.some(
              (s) =>
                s.request?.kind === "risky_click" &&
                (s.request.safetyChecks ?? []).some((c) => c.code === "malicious_instructions"),
            )
          ) {
            injectionAt = turns;
            injectionSignals += 1;
          }
          const facts = {
            pageOrigin: turn.pageOrigin,
            allowedOrigins: turn.allowedOrigins,
            actuatedOrigins: actuated,
            injectionWindow: injectionAt !== null && turns - injectionAt <= POST_INJECTION_STEPS,
            riskLevel,
            label: turn.label,
          };
          const reviewed: Array<{ seen: SeenItem; draft: GuardItemDraft }> = [];
          for (const seen of turn.seen) {
            const draft = guardItemOf(seen, facts);
            if (draft) reviewed.push({ seen, draft });
          }
          if (reviewed.length === 0) {
            if (ledger.state.consecutive === 0) return NOTHING;
            ledger.recordTurn(0);
            return {
              ...NOTHING,
              review: row(
                {
                  verdict: "allow",
                  category: "other",
                  stage: "rules",
                  itemKeys: [],
                  rationale: "",
                },
                false,
                null,
                { latencyMs: 0, usage: EMPTY_USAGE },
              ),
            };
          }
          if (turn.pageOrigin !== null && reviewed.some((r) => ACTUATIONS.has(r.draft.actionClass)))
            actuated.add(turn.pageOrigin);
          const flows = reviewed.filter((r) => r.draft.sent?.provenance === "other_origin").length;
          const items = Math.min(reviewed.length, GUARD_LIMITS.items);

          if (rollout === "enforce" && ledger.reachedLimit()) {
            const verdict: GuardVerdict = {
              verdict: "escalate",
              category: "denial_limit",
              stage: "rules",
              itemKeys: [],
              rationale: "",
            };
            span.set({
              [ATTR.observerVerdict]: "escalate",
              [ATTR.observerCategory]: "denial_limit",
              [ATTR.observerStage]: "rules",
              [ATTR.observerOutcome]: "limit",
            });
            return {
              outcomes: new Map(),
              event: {
                type: "guard",
                verdict: "escalate",
                category: "denial_limit",
                stage: "rules",
                rollout,
                applied: true,
                items,
                flows,
              },
              review: row(verdict, true, null, { latencyMs: 0, usage: EMPTY_USAGE }),
              usage: EMPTY_USAGE,
              limit: true,
            };
          }

          let input: GuardInput | null;
          let outcome: ReviewOutcome;
          let failure: ReviewOutcome["failure"] | "redacted";
          try {
            input = buildGuardInput({
              goal: run.goal,
              mode: turn.mode ?? run.approvalMode,
              allowedOrigins: turn.allowedOrigins,
              page: {
                origin: turn.pageOrigin,
                inAllowed:
                  turn.pageOrigin !== null && turn.allowedOrigins.includes(turn.pageOrigin),
              },
              items: reviewed.map((r) => r.draft),
              run: {
                step: turns,
                newOrigins: Math.max(0, turn.allowedOrigins.length - initialOrigins),
                denials: ledger.state,
                loopHits: turn.loopHits,
                injectionSignals,
                riskLevel,
              },
            });
            // Nothing leaves the process if the exact-match redactor would change one character.
            assertRedacted(JSON.stringify(input), redact);
            outcome = await reviewer.review(input, signal);
            failure = outcome.failure;
          } catch (error) {
            if (signal.aborted) throw error;
            // The input failed its schema or the redaction assertion: fail closed, store no input.
            failure = error instanceof RedactionTripped ? "redacted" : "invalid";
            outcome = {
              verdict: UNAVAILABLE_VERDICT,
              usage: EMPTY_USAGE,
              latencyMs: 0,
              failure: null,
            };
            input = null;
          }
          if (failure) recordObserverFailure("guard", failure);
          recordObserverSpend("guard", outcome.usage.usd);

          const { verdict } = outcome;
          const keys = verdict.itemKeys.length > 0 ? new Set(verdict.itemKeys) : null;
          const outcomes = new Map<string, GuardItemOutcome>();
          reviewed.forEach((r, i) => {
            // Items beyond the input cap were not reviewed: they fail closed.
            const v = i < GUARD_LIMITS.items ? verdict : UNAVAILABLE_VERDICT;
            if (i < GUARD_LIMITS.items && keys && !keys.has(`i${i + 1}`)) return;
            const effect = guardEffect(v.verdict, turn.mode ?? run.approvalMode, rollout);
            if (effect === "none") return;
            outcomes.set(r.seen.item, {
              effect,
              verdict: v.verdict === "block" ? "block" : "escalate",
              category: v.category,
              rationale: v.rationale,
            });
          });
          const previous = ledger.state;
          ledger.recordTurn([...outcomes.values()].filter((o) => o.effect === "deny").length);
          const applied = outcomes.size > 0;
          span.set({
            [ATTR.observerVerdict]: verdict.verdict,
            [ATTR.observerCategory]: verdict.category,
            [ATTR.observerStage]: verdict.stage,
            [ATTR.observerOutcome]: failure ?? "ok",
          });
          const result: GuardTurnResult = {
            outcomes,
            event: {
              type: "guard",
              verdict: verdict.verdict,
              category: verdict.category,
              stage: verdict.stage,
              rollout,
              applied,
              items,
              flows,
            },
            review: row(verdict, applied, input, outcome),
            usage: outcome.usage,
            limit: false,
          };
          beforeReview.set(result, previous);
          return result;
        },
      );
    },
    recordApplied(result, applied) {
      const previous = beforeReview.get(result);
      if (!previous) return;
      beforeReview.delete(result);
      ledger = new DenialLedger(previous);
      ledger.recordTurn(applied.blocked);
      if (result.review)
        Object.assign(result.review, ledger.state, {
          applied: applied.blocked > 0 || applied.asked,
        });
      if (result.event) result.event.applied = applied.blocked > 0 || applied.asked;
    },
    personCleared() {
      ledger.personCleared();
      return ledger.state;
    },
    ingest() {},
    takeHold: () => null,
    takeUsage: () => null,
  };
}

/** One factory per process; one StepGuard per run, its ledger restored from guard_reviews. */
export function createStepGuardFactory(deps: { reviewer: GuardReviewer }): StepGuardFactory {
  return {
    async forRun(run, { db, redact }) {
      return createStepGuard({
        run,
        reviewer: deps.reviewer,
        redact,
        ledger: await loadGuardLedger(db, run.id),
      });
    },
  };
}
