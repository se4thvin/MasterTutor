import type {
  ApprovalRequest,
  ApprovalMode,
  ObserverMode,
  RunEvent,
  Usage,
  ComputerAction,
  FunctionToolName,
  PolicyDecision,
  RiskLevel,
  GuardState,
} from "@mastertutor/contracts";
import type { TargetDescription } from "../../browser/page-helpers.ts";
import type { ProvenanceLabel } from "../provenance.ts";

/**
 * One thing in a model turn the Guard may review: a computer action, a function call, or a
 * run-level request (new origin, download). `target` and `args` stay in the agent: turn.ts copies
 * only flags and codes out of them.
 */
export interface SeenItem {
  /** The loop's item key (actionItem/functionItem/safetyItem), or "run" for a run-level request. */
  item: string;
  callId: string | null;
  index: number | null;
  action: ComputerAction | null;
  tool: FunctionToolName | null;
  args: unknown;
  target: TargetDescription | null;
  /** The request the policy classified, when the item needs approval. */
  request: ApprovalRequest | null;
  /** What the policy decided for that request. */
  policy: PolicyDecision | null;
}

export interface TurnFacts {
  pageOrigin: string | null;
  allowedOrigins: readonly string[];
  actuatedOrigins: ReadonlySet<string>;
  injectionWindow: boolean;
  riskLevel: RiskLevel;
  label(text: string, pageOrigin: string | null): ProvenanceLabel;
}

import type { GuardReviewRow, Database } from "@mastertutor/db";
import type { LedgerState } from "@mastertutor/observer/guard";
import type { RunSnapshot } from "../../loop/run-state.ts";

export type { GuardItemOutcome, GuardHold } from "@mastertutor/contracts";
import type { GuardItemOutcome, GuardHold } from "@mastertutor/contracts";
export type GuardEvent = Extract<RunEvent, { type: "guard" }>;

export interface GuardTurnRequest {
  mode?: ApprovalMode;
  seen: readonly SeenItem[];
  pageOrigin: string | null;
  allowedOrigins: readonly string[];
  loopHits: number;
  label: TurnFacts["label"];
}

export interface GuardTurnResult {
  /** Items whose decision the Guard changes (enforce only), by loop item key. */
  outcomes: ReadonlyMap<string, GuardItemOutcome>;
  ledgerBefore?: LedgerState;
  event: GuardEvent | null;
  review: Omit<GuardReviewRow, "runId" | "stepSeq"> | null;
  usage: Usage;
  /** The denial budget is spent: ask a run-level denial_limit hold before anything else. */
  limit: boolean;
}

/** The Guard for one run (spec §6). Injected through RunLoopDeps.guards; tests may omit it. */
export interface StepGuard {
  readonly rollout: ObserverMode;
  /** Pure metadata staging inside a step transaction; asynchronous calls start only after commit. */
  stage(events: readonly RunEvent[]): GuardState;
  startWatcher(): void;
  stopWatcher(abortCurrent?: boolean): void;
  recordActuation(origin: string | null): void;
  updateContext(mode: ApprovalMode, allowedOrigins: readonly string[]): void;
  review(turn: GuardTurnRequest, signal: AbortSignal): Promise<GuardTurnResult>;
  /** Reconcile proposed outcomes with decisions the loop actually applied. */
  recordApplied(result: GuardTurnResult, applied: { blocked: number; asked: boolean }): void;
  /** A person approved a denial_limit hold: the ledger starts again (persisted by the caller). */
  personCleared(): LedgerState;
  /** G6: committed run events, in order (the trajectory watcher's only input). */
  ingest(events: readonly RunEvent[]): void;
  /** G6: a hold the watcher set, taken once at the next step boundary. */
  takeHold(): GuardHold | null;
  /** G6: spend of async reviews not charged yet, taken once at the next step boundary. */
  takeUsage(): Usage | null;
  /** G6: the watcher's own guard event, taken once at the next step boundary. */
  takeEvent(): GuardEvent | null;
  /** Drains bounded reviews before completion; also used for deterministic tests. */
  settled?(): Promise<void>;
}

export interface StepGuardFactory {
  forRun(
    run: RunSnapshot,
    deps: { db: Database; redact(text: string): string },
  ): Promise<StepGuard>;
}
