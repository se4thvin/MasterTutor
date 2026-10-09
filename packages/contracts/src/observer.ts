/**
 * The Observer's contracts (D52, spec §6–§7): what the Guard may see and answer, the trajectory
 * digest, and the Copilot's wire shapes. Metadata only: no field here can hold page text, typed
 * text, a URL, agent prose or a secret.
 */
import { z } from "zod";
import { ApprovalKind, ApprovalMode } from "./enums.ts";
import { GuardCategory, GuardStage, GuardVerdictName } from "./guard-codes.ts";
import { DEFAULT_CDP_SUBNET_PREFIX, webCdpOrigin } from "./live.ts";
import { Alias, IsoDateTime, Origin, Uuid } from "./primitives.ts";
import { ToolName } from "./tool-call.ts";

/* ----------------------------------- Guard ----------------------------------- */

export const GUARD_TRIGGERS = [
  "risky_item",
  "vault_fill",
  "data_egress",
  "first_actuation_off_allowlist",
  "post_injection_window",
  "elevated_risk",
] as const;
export const GuardTrigger = z.enum(GUARD_TRIGGERS);
export type GuardTrigger = z.infer<typeof GuardTrigger>;

export const ACTION_CLASSES = [
  "click",
  "type",
  "keypress",
  "navigate",
  "download",
  "vault_fill",
  "passkey",
  "submit",
  "other",
] as const;
export const ActionClass = z.enum(ACTION_CLASSES);
export type ActionClass = z.infer<typeof ActionClass>;

/** A target's role, from its tag: never its label or text. */
export const TARGET_ROLES = [
  "link",
  "button",
  "input",
  "select",
  "textarea",
  "frame",
  "history",
  "other",
] as const;
export const TargetRole = z.enum(TARGET_ROLES);
export type TargetRole = z.infer<typeof TargetRole>;

/** Where typed text came from (spec §6.3): a class, never the text. */
export const PROVENANCES = ["none", "goal", "same_origin", "other_origin", "novel"] as const;
export const Provenance = z.enum(PROVENANCES);
export type Provenance = z.infer<typeof Provenance>;

export const RISK_LEVELS = ["normal", "elevated"] as const;
export const RiskLevel = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const GUARD_LIMITS = {
  items: 20,
  origins: 10,
  goalChars: 1_000,
  rationaleChars: 300,
  safetyChecks: 20,
  digestEntries: 50,
} as const;

const Count = z.number().int().min(0).max(1_000_000);
export const GuardLedgerState = z.strictObject({ consecutive: Count, total: Count });
export type GuardLedgerState = z.infer<typeof GuardLedgerState>;
export const GuardItemKey = z.string().regex(/^i(?:[1-9]|1[0-9]|20)$/);
const SafetyCode = z.string().regex(/^[a-z_]{1,64}$/);

export const GuardItem = z.strictObject({
  key: GuardItemKey,
  actionClass: ActionClass,
  triggers: z.array(GuardTrigger).min(1).max(GUARD_TRIGGERS.length),
  policyKind: ApprovalKind.nullable(),
  policyDecision: z.enum(["approved", "denied", "ask"]).nullable(),
  target: z
    .strictObject({
      role: TargetRole,
      formKind: z.enum(["login", "search", "other"]).nullable(),
      isFormSubmit: z.boolean(),
      isSecretField: z.boolean(),
      opaqueFrame: z.boolean(),
      hasDownload: z.boolean(),
      formPostsTo: Origin.nullable(),
    })
    .nullable(),
  destination: z
    .strictObject({ origin: Origin, inAllowed: z.boolean(), carriesQuery: z.boolean() })
    .nullable(),
  sent: z
    .strictObject({ provenance: Provenance, sourceOrigin: Origin.nullable(), chars: Count })
    .nullable(),
  vault: z
    .strictObject({ alias: Alias, itemOrigin: Origin.nullable(), firstUse: z.boolean() })
    .nullable(),
  safetyChecks: z.array(SafetyCode).max(GUARD_LIMITS.safetyChecks),
});
export type GuardItem = z.infer<typeof GuardItem>;

export const GuardInput = z.strictObject({
  /** redactForTitle(run.goal): user-authored, so trusted, and scrubbed of links and secrets. */
  goal: z.string().max(GUARD_LIMITS.goalChars),
  mode: ApprovalMode,
  allowedOrigins: z.array(Origin).max(GUARD_LIMITS.origins),
  page: z.strictObject({ origin: Origin.nullable(), inAllowed: z.boolean() }),
  items: z.array(GuardItem).min(1).max(GUARD_LIMITS.items),
  run: z.strictObject({
    step: Count,
    newOrigins: Count,
    denials: GuardLedgerState,
    loopHits: Count,
    injectionSignals: Count,
    riskLevel: RiskLevel,
  }),
});
export type GuardInput = z.infer<typeof GuardInput>;

/** Stage 1 (gpt-6-luna): a tiny answer, leaning to review when unsure (spec §6.5). */
export const GuardScreen = z.strictObject({ decision: z.enum(["allow", "review"]) });
export type GuardScreen = z.infer<typeof GuardScreen>;

/** Stage 2: only on a screen's review. The rationale is model output: untrusted, card-only. */
export const GuardReview = z.strictObject({
  verdict: GuardVerdictName,
  category: GuardCategory,
  itemKeys: z.array(GuardItemKey).max(GUARD_LIMITS.items),
  rationale: z.string().max(GUARD_LIMITS.rationaleChars),
});
export type GuardReview = z.infer<typeof GuardReview>;

/** What one review concluded, whichever stage ended it. */
export const GuardVerdict = z.strictObject({
  verdict: GuardVerdictName,
  category: GuardCategory,
  stage: GuardStage,
  itemKeys: z.array(GuardItemKey).max(GUARD_LIMITS.items),
  rationale: z.string().max(GUARD_LIMITS.rationaleChars),
});
export type GuardVerdict = z.infer<typeof GuardVerdict>;

export const GUARD_ESCALATION = { consecutive: 3, total: 20 } as const;
/** One deadline for both stages; a late answer fails closed (spec §6.5). Pinned by the spike. */
export const GUARD_TIMEOUT_MS = 8_000;
export const GUARD_MAX_OUTPUT_TOKENS = { screen: 400, review: 1_200 } as const;
/** The only words a blocked agent gets: never the rationale (spec §6.5, GD §3.3). */
export const GUARD_BLOCKED_NOTE =
  "Blocked by the safety observer. Do not retry or work around it; choose a different approach or ask the user.";
/** Turns after a malicious_instructions check during which every actuation is reviewed. */
export const POST_INJECTION_STEPS = 5;
/** The screen's reasoning effort, pinned by the spike (spec §10): luna refuses "minimal". */
export const GUARD_REASONING: "none" | "low" | null = "none";

/* ------------------------------ trajectory watcher ------------------------------ */

export const WATCHER_SIGNALS = [
  "origin_fanout",
  "person_denials",
  "egress_flows",
  "guard_flags",
  "error_burst",
] as const;
export const WatcherSignal = z.enum(WATCHER_SIGNALS);
export type WatcherSignal = z.infer<typeof WatcherSignal>;

export const TRAJECTORY_ENTRY_KINDS = ["act", "ask", "decision", "guard", "error"] as const;
export const TrajectoryEntry = z.strictObject({
  kind: z.enum(TRAJECTORY_ENTRY_KINDS),
  origin: Origin.nullable(),
  tool: ToolName.nullable(),
  /** A code only: an approval kind, a decider class or a verdict. */
  detail: z.string().regex(/^[a-z_]{0,32}$/),
});
export type TrajectoryEntry = z.infer<typeof TrajectoryEntry>;

export const TrajectoryDigest = z.strictObject({
  goal: z.string().max(GUARD_LIMITS.goalChars),
  mode: ApprovalMode,
  allowedOrigins: z.array(Origin).max(GUARD_LIMITS.origins),
  entries: z.array(TrajectoryEntry).max(GUARD_LIMITS.digestEntries),
  signals: z.array(WatcherSignal).max(WATCHER_SIGNALS.length),
});
export type TrajectoryDigest = z.infer<typeof TrajectoryDigest>;

export const TRAJECTORY_MAX = 200;
export const WATCHER_REVIEW_EVERY = 10;
export const WATCHER_RULES = {
  originFanout: { distinct: 5, window: 20 },
  personDenials: { count: 2, window: 10 },
  egressFlows: { count: 2, window: 20 },
  guardFlags: { count: 3, window: 20 },
  errorBurst: { count: 5, window: 20 },
} as const;

/** Durable, bounded metadata for the in-agent Guard; never sent as a model input. */
export const GuardHold = z.strictObject({
  verdict: z.enum(["escalate", "block"]),
  category: GuardCategory,
  /** Cleaned model warning for the person's card only. */
  rationale: z.string().max(GUARD_LIMITS.rationaleChars),
});
export type GuardHold = z.infer<typeof GuardHold>;
export const TrajectoryState = z.strictObject({
  entries: z.array(TrajectoryEntry).max(TRAJECTORY_MAX),
  flows: z.array(Count).max(WATCHER_RULES.egressFlows.window),
  fired: z.array(WatcherSignal).max(WATCHER_SIGNALS.length),
  guardReviews: Count,
});
export type TrajectoryState = z.infer<typeof TrajectoryState>;
export const GuardState = z.strictObject({
  turns: Count,
  initialOrigins: Count,
  injectionAt: Count.nullable(),
  injectionSignals: Count,
  actuatedOrigins: z.array(Origin).max(10_000),
  ledger: GuardLedgerState,
  trajectory: TrajectoryState,
  reviewDue: z.boolean(),
  hold: GuardHold.nullable(),
});
export type GuardState = z.infer<typeof GuardState>;

/** Retained per-item tightening decisions and accounting across a turn's approval cards. */
export const GuardItemOutcome = GuardHold.extend({ effect: z.enum(["ask", "deny"]) });
export type GuardItemOutcome = z.infer<typeof GuardItemOutcome>;
export const GuardTurnState = z.strictObject({
  outcomes: z.array(GuardItemOutcome.extend({ item: z.string().max(512) })).max(10_000),
  ledgerBefore: GuardLedgerState.nullable(),
  blocked: Count,
});
export type GuardTurnState = z.infer<typeof GuardTurnState>;

/* ---------------------------------- Copilot ---------------------------------- */

export const COPILOT_TOOL_NAMES = [
  "metrics_query",
  "telemetry_search",
  "runs_find",
  "run_detail",
  "run_traces",
  "code_search",
  "code_read",
  "render_chart",
] as const;
export const CopilotToolName = z.enum(COPILOT_TOOL_NAMES);
export type CopilotToolName = z.infer<typeof CopilotToolName>;

export const COPILOT_TOOL_OUTCOMES = ["ok", "invalid", "limit", "timeout", "error"] as const;
export const CopilotToolOutcome = z.enum(COPILOT_TOOL_OUTCOMES);
export type CopilotToolOutcome = z.infer<typeof CopilotToolOutcome>;

export const COPILOT_ERROR_CODES = [
  "rate_limited",
  "daily_cap",
  "model_unavailable",
  "internal",
] as const;
export const CopilotErrorCode = z.enum(COPILOT_ERROR_CODES);
export type CopilotErrorCode = z.infer<typeof CopilotErrorCode>;

export const ResultId = z.string().regex(/^Q[1-9][0-9]{0,2}$/);
export type ResultId = z.infer<typeof ResultId>;

export const CHART_KINDS = ["line", "bar", "table"] as const;
export const ChartSpec = z.strictObject({
  resultId: ResultId,
  kind: z.enum(CHART_KINDS),
  x: z.string().min(1).max(64),
  y: z.array(z.string().min(1).max(64)).min(1).max(4),
  title: z.string().max(80),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export const CopilotAsk = z.strictObject({
  threadId: Uuid.nullable().default(null),
  text: z.string().trim().min(1).max(2_000),
  /** "Ask about this run" / "Why did this fire?": resolved to handles by the service. */
  context: z
    .strictObject({ runId: Uuid.optional(), alertId: Uuid.optional() })
    .nullable()
    .default(null),
  /** Per-question opt-in for run goals, captions and page origins (D52, spec §7.5). */
  includeUntrusted: z.boolean().default(false),
});
export type CopilotAsk = z.infer<typeof CopilotAsk>;

export const CopilotEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("thread"), threadId: Uuid }),
  z.strictObject({ type: z.literal("text"), delta: z.string().max(4_000) }),
  z.strictObject({
    type: z.literal("tool_started"),
    resultId: ResultId,
    tool: CopilotToolName,
    summary: z.string().max(200),
  }),
  z.strictObject({
    type: z.literal("tool_done"),
    resultId: ResultId,
    rowCount: z.number().int().min(0),
    tookMs: z.number().int().min(0),
    outcome: CopilotToolOutcome,
  }),
  z.strictObject({ type: z.literal("chart"), spec: ChartSpec }),
  z.strictObject({
    type: z.literal("done"),
    citations: z.array(ResultId),
    removed: z.array(ResultId),
    usd: z.number().min(0),
  }),
  z.strictObject({ type: z.literal("error"), code: CopilotErrorCode }),
]);
export type CopilotEvent = z.infer<typeof CopilotEvent>;

const Cell = z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]);
export const CopilotResultView = z.strictObject({
  resultId: ResultId,
  tool: CopilotToolName,
  summary: z.string().max(200),
  columns: z.array(z.string().max(64)).max(32),
  rows: z.array(z.array(Cell).max(32)).max(200),
  rowCount: z.number().int().min(0),
  truncated: z.boolean(),
  tookMs: z.number().int().min(0),
  /** Resolved on the server from handles: same-origin app paths and OpenObserve deep links. */
  links: z.strictObject({
    app: z.string().max(512).nullable(),
    o2: z.string().max(4_096).nullable(),
  }),
  /** Rows carry untrusted text (opt-in run detail, container logs, traces): shown as text only. */
  tainted: z.boolean(),
});
export type CopilotResultView = z.infer<typeof CopilotResultView>;

export const CopilotThreadSummary = z.strictObject({
  id: Uuid,
  title: z.string().max(80),
  updatedAt: IsoDateTime,
});
export type CopilotThreadSummary = z.infer<typeof CopilotThreadSummary>;

export const CopilotThreadView = z.strictObject({
  id: Uuid,
  title: z.string().max(80),
  messages: z.array(
    z.strictObject({
      role: z.enum(["user", "assistant"]),
      text: z.string().max(40_000),
      citations: z.array(ResultId),
    }),
  ),
  results: z.array(CopilotResultView),
});
export type CopilotThreadView = z.infer<typeof CopilotThreadView>;

export const COPILOT_LIMITS = {
  questionsPerWindow: 20,
  windowMinutes: 10,
  toolRounds: 8,
  parallelCalls: 4,
  maxOutputTokens: 2_000,
  inputTokens: 60_000,
  storedRows: 200,
  modelRows: 50,
  series: 20,
  points: 300,
  metricDefaultHours: 7 * 24,
  metricMaxHours: 90 * 24,
  searchDefaultHours: 24,
  searchMaxHours: 7 * 24,
  queryTimeoutMs: 10_000,
  codeMatches: 50,
  codeReadLines: 200,
  retentionDays: 30,
  dailyUsdDefault: 3,
} as const;

/* ---------------------------------- routing ---------------------------------- */

/** Traefik sends /api/observer/* to the observer service (spec §7.2). */
export const OBSERVER_API_PREFIX = "/api/observer";
/** web's ForwardAuth answer: outside OBSERVER_API_PREFIX so the router never proxies it. */
export const OBSERVER_AUTH_PATH = "/api/observer-auth";
export const OBSERVER_PORT = 4_000;
export const OBSERVER_INTERNAL_URL = `http://observer:${OBSERVER_PORT}`;
/** Headers only ForwardAuth's answer sets (authResponseHeaders replace the browser's). */
export const OBSERVER_HEADERS = { user: "x-mt-user", workspace: "x-mt-workspace" } as const;
/** Replaces the browser's cookies upstream: no MasterTutor cookie reaches the observer. */
export const OBSERVER_UPSTREAM_COOKIE = "mt_observer=1";

const validHost = (host: string) => {
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new TypeError("Invalid router host");
  return host;
};

export function observerRouterRule(appHost: string): string {
  return `Host(\`${validHost(appHost)}\`) && PathPrefix(\`${OBSERVER_API_PREFIX}/\`)`;
}

export function observerForwardAuthAddress(
  cdpSubnetPrefix: string = DEFAULT_CDP_SUBNET_PREFIX,
): string {
  return `${webCdpOrigin(cdpSubnetPrefix)}${OBSERVER_AUTH_PATH}`;
}

/**
 * The only links an answer may render (spec §7.11): relative, same-origin app paths. Everything
 * else (absolute, protocol-relative, other paths, reference-style) renders as plain text.
 */
const ANSWER_LINK = /^\/(?:runs|observer|settings\/alerts)(?:[/?#]|$)/;
export function isAllowedAnswerLink(href: string | null | undefined): boolean {
  return (
    typeof href === "string" &&
    !href.startsWith("//") &&
    !/[\s\\]/.test(href) &&
    ANSWER_LINK.test(href)
  );
}
