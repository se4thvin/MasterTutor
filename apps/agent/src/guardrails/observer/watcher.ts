import {
  EMPTY_USAGE,
  GUARD_TIMEOUT_MS,
  TrajectoryDigest,
  redactForTitle,
  type RiskLevel,
  type ApprovalMode,
  type RunEvent,
  type Usage,
} from "@mastertutor/contracts";
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { RedactionTripped, assertRedacted } from "@mastertutor/observer";
import { Trajectory } from "@mastertutor/observer/guard";
import { instrument } from "@mastertutor/telemetry/instrument";
import { recordObserverFailure, recordObserverSpend } from "@mastertutor/telemetry/record";
import type { RunSnapshot } from "../../loop/run-state.ts";
import { addUsage } from "../../llm/pricing.ts";
import type { GuardReviewer } from "./reviewer.ts";
import type { GuardEvent, GuardHold } from "./types.ts";

/**
 * Detective, off the hot path (spec §6.9): reads the run's own committed events in process, never
 * OTel. On a detector hit (or every 10 reviews) it reviews a code-only digest; an escalate or block
 * becomes a hold the loop asks at its next observe. It fails open: errors are counted, never thrown.
 */
export class TrajectoryWatcher {
  readonly #run: RunSnapshot;
  readonly #reviewer: GuardReviewer;
  readonly #redact: (text: string) => string;
  readonly #trajectory = new Trajectory();
  #inFlight: Promise<void> | null = null;
  #hold: GuardHold | null = null;
  #usage: Usage | null = null;
  #events: GuardEvent[] = [];
  #reviewDue = false;
  #mode: ApprovalMode;
  #allowedOrigins: readonly string[];

  constructor(options: {
    run: RunSnapshot;
    reviewer: GuardReviewer;
    redact(text: string): string;
  }) {
    this.#run = options.run;
    this.#mode = options.run.approvalMode;
    this.#allowedOrigins = options.run.allowedOrigins;
    this.#reviewer = options.reviewer;
    this.#redact = options.redact;
  }

  updateContext(mode: ApprovalMode, allowedOrigins: readonly string[]): void {
    this.#mode = mode;
    this.#allowedOrigins = [...allowedOrigins];
  }

  get riskLevel(): RiskLevel {
    return this.#trajectory.riskLevel;
  }

  ingest(events: readonly RunEvent[]): void {
    const { reviewDue } = this.#trajectory.add(events);
    if (reviewDue) {
      this.#reviewDue = true;
      if (!this.#inFlight)
        this.#inFlight = this.#drain().finally(() => {
          this.#inFlight = null;
        });
    }
  }

  async #drain(): Promise<void> {
    while (this.#reviewDue) {
      this.#reviewDue = false;
      await this.#review();
    }
  }

  async #review(): Promise<void> {
    const rollout = this.#run.observerMode;
    await instrument(
      SPAN.observerReview,
      {
        [ATTR.runId]: this.#run.id,
        [ATTR.observerRole]: "watcher",
        [ATTR.observerRollout]: rollout,
      },
      async (span) => {
        try {
          const digest = TrajectoryDigest.parse(
            this.#trajectory.digest({
              goal: redactForTitle(this.#run.goal).slice(0, 1_000),
              mode: this.#mode,
              allowedOrigins: this.#allowedOrigins,
            }),
          );
          assertRedacted(JSON.stringify(digest), this.#redact);
          const outcome = await this.#reviewer.reviewTrajectory(
            digest,
            AbortSignal.timeout(GUARD_TIMEOUT_MS * 2),
          );
          this.#usage = addUsage(this.#usage ?? EMPTY_USAGE, outcome.usage);
          recordObserverSpend("watcher", outcome.usage.usd);
          span.set({
            [ATTR.observerVerdict]: outcome.verdict.verdict,
            [ATTR.observerStage]: outcome.verdict.stage,
            [ATTR.observerOutcome]: outcome.failure ?? "ok",
          });
          if (outcome.failure) {
            recordObserverFailure("watcher", outcome.failure);
            return;
          }
          const { verdict, category, stage, rationale } = outcome.verdict;
          const stops = verdict === "escalate" || verdict === "block";
          const applied = stops && rollout === "enforce";
          if (applied) this.#hold = { verdict, category, rationale };
          this.#events.push({
            type: "guard",
            verdict,
            category,
            stage,
            rollout,
            applied,
            items: 0,
            flows: 0,
          });
        } catch (error) {
          recordObserverFailure(
            "watcher",
            error instanceof RedactionTripped ? "redacted" : "error",
          );
        }
      },
    );
  }

  takeHold(): GuardHold | null {
    const hold = this.#hold;
    this.#hold = null;
    return hold;
  }

  takeUsage(): Usage | null {
    const usage = this.#usage;
    this.#usage = null;
    return usage;
  }

  takeEvent(): GuardEvent | null {
    return this.#events.shift() ?? null;
  }

  /** Resolves once bounded reviews finish (completion and deterministic tests). */
  async settled(): Promise<void> {
    await this.#inFlight;
  }
}
