import {
  TRAJECTORY_MAX,
  WATCHER_REVIEW_EVERY,
  WATCHER_RULES,
  deciderClass,
  toOrigin,
  type ApprovalMode,
  type RiskLevel,
  type RunEvent,
  type TrajectoryDigest,
  type TrajectoryEntry,
  type WatcherSignal,
  type TrajectoryState,
} from "@mastertutor/contracts";

const DIGEST_ENTRIES = 50;

/** One run event as trajectory codes (spec §6.9): never captions, summaries, URLs or text. */
export function entriesOf(event: RunEvent): TrajectoryEntry[] {
  switch (event.type) {
    case "step":
      return event.phase === "act" && event.state === "done" && event.action
        ? [
            {
              kind: "act",
              origin: event.url ? toOrigin(event.url) : null,
              tool: event.action.tool,
              detail: "",
            },
          ]
        : [];
    case "approval_requested":
      return [{ kind: "ask", origin: null, tool: null, detail: event.request.kind }];
    case "approval_resolved":
      return [
        {
          kind: "decision",
          origin: null,
          tool: null,
          detail: `${event.status}_${deciderClass(event.decidedBy)}`,
        },
      ];
    case "guard":
      return [{ kind: "guard", origin: null, tool: null, detail: event.verdict }];
    case "error":
      return [{ kind: "error", origin: null, tool: null, detail: "" }];
    default:
      return [];
  }
}

/** The run's recent trajectory and the deterministic detectors over it (GD §3.2, Hills et al.). */
export class Trajectory {
  #entries: TrajectoryEntry[] = [];
  #flows: number[] = [];
  readonly #fired = new Set<WatcherSignal>();
  #guardReviews = 0;
  #riskLevel: RiskLevel = "normal";

  constructor(state?: TrajectoryState) {
    if (state) {
      this.#entries = [...state.entries];
      this.#flows = [...state.flows];
      for (const signal of state.fired) this.#fired.add(signal);
      this.#guardReviews = state.guardReviews;
      if (this.#fired.size) this.#riskLevel = "elevated";
    }
  }

  get state(): TrajectoryState {
    return {
      entries: [...this.#entries],
      flows: [...this.#flows],
      fired: [...this.#fired],
      guardReviews: this.#guardReviews,
    };
  }

  get riskLevel(): RiskLevel {
    return this.#riskLevel;
  }

  add(events: readonly RunEvent[]): { signals: WatcherSignal[]; reviewDue: boolean } {
    let periodic = false;
    for (const event of events) {
      if (event.type === "guard" && event.items > 0) {
        this.#flows = [...this.#flows, event.flows].slice(-WATCHER_RULES.egressFlows.window);
        this.#guardReviews += 1;
        if (this.#guardReviews % WATCHER_REVIEW_EVERY === 0) periodic = true;
      }
      this.#entries = [...this.#entries, ...entriesOf(event)].slice(-TRAJECTORY_MAX);
    }
    const signals = this.#detect().filter((signal) => !this.#fired.has(signal));
    for (const signal of signals) this.#fired.add(signal);
    if (signals.length > 0) this.#riskLevel = "elevated";
    return { signals, reviewDue: signals.length > 0 || periodic };
  }

  #detect(): WatcherSignal[] {
    const last = (kind: TrajectoryEntry["kind"], n: number) =>
      this.#entries.filter((entry) => entry.kind === kind).slice(-n);
    const signals: WatcherSignal[] = [];
    const origins = new Set(
      last("act", WATCHER_RULES.originFanout.window).flatMap((e) => (e.origin ? [e.origin] : [])),
    );
    if (origins.size >= WATCHER_RULES.originFanout.distinct) signals.push("origin_fanout");
    if (
      last("decision", WATCHER_RULES.personDenials.window).filter(
        (e) => e.detail === "denied_person",
      ).length >= WATCHER_RULES.personDenials.count
    )
      signals.push("person_denials");
    if (this.#flows.reduce((a, b) => a + b, 0) >= WATCHER_RULES.egressFlows.count)
      signals.push("egress_flows");
    if (
      last("guard", WATCHER_RULES.guardFlags.window).filter((e) => e.detail === "flag").length >=
      WATCHER_RULES.guardFlags.count
    )
      signals.push("guard_flags");
    if (
      this.#entries.slice(-WATCHER_RULES.errorBurst.window).filter((e) => e.kind === "error")
        .length >= WATCHER_RULES.errorBurst.count
    )
      signals.push("error_burst");
    return signals;
  }

  digest(base: {
    goal: string;
    mode: ApprovalMode;
    allowedOrigins: readonly string[];
  }): TrajectoryDigest {
    return {
      goal: base.goal,
      mode: base.mode,
      allowedOrigins: base.allowedOrigins.slice(0, 10),
      entries: this.#entries.slice(-DIGEST_ENTRIES),
      signals: [...this.#fired],
    };
  }
}
