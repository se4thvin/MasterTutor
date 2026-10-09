/**
 * Product telemetry names (D50, spec §5): the one source for span, attribute and metric names used
 * by @mastertutor/telemetry, infra/otel/collector.yaml, the dashboards and the alerts. Renaming one
 * breaks dashboards and alerts; tests pin the collector YAML and the provisioning code to this file.
 * Plain constants and types only: no runtime dependency.
 */
import type { AlertRule } from "./alerts.ts";
import type {
  ApprovalKind,
  ApprovalMode,
  ApprovalStatus,
  BlockOrigin,
  BlockType,
  Controller,
  Fidelity,
  FiledBy,
  ObserverMode,
  RunStatus,
  SlotState,
  StepPhase,
} from "./enums.ts";
import type { GuardCategory, GuardStage, GuardVerdictName } from "./guard-codes.ts";
import type { CopilotToolName } from "./observer.ts";
import type { ObserverRole } from "./observer-roles.ts";
import type { ToolName } from "./tool-call.ts";

export const TRACER_NAME = "mastertutor";
export const METER_NAME = "mastertutor";

export const SPAN = {
  step: "mt.step",
  modelRequest: "mt.model.request",
  tool: "mt.tool",
  stepCommit: "mt.step.commit",
  slotReset: "mt.slot.reset",
  takeover: "mt.takeover",
  alertDelivery: "mt.alert.delivery",
  observerReview: "mt.observer.review",
  observerTurn: "mt.observer.turn",
  observerTool: "mt.observer.tool",
} as const;
export type SpanName = (typeof SPAN)[keyof typeof SPAN];

export const ATTR = {
  runId: "mt.run.id",
  stepPhase: "mt.step.phase",
  stepOutcome: "mt.step.outcome",
  interruption: "mt.interruption",
  modelName: "mt.model.name",
  modelFallback: "mt.model.fallback",
  modelAttempts: "mt.model.attempts",
  tokensInput: "mt.model.tokens.input",
  tokensCached: "mt.model.tokens.cached",
  tokensOutput: "mt.model.tokens.output",
  costUsd: "mt.model.cost_usd",
  tokenType: "mt.model.token_type",
  toolName: "mt.tool.name",
  toolOutcome: "mt.tool.outcome",
  actionTypes: "mt.action.types",
  errorCode: "mt.error.code",
  approvalKind: "mt.approval.kind",
  approvalStatus: "mt.approval.status",
  approvalDecider: "mt.approval.decider",
  approvalMode: "mt.approval.mode",
  sendMode: "mt.send.mode",
  vaultAlias: "mt.vault.alias",
  captureFidelity: "mt.capture.fidelity",
  captureCoverage: "mt.capture.coverage",
  slotName: "mt.slot.name",
  slotOutcome: "mt.slot.outcome",
  takeoverOutcome: "mt.takeover.outcome",
  controlHolder: "mt.control.holder",
  runStatus: "mt.run.status",
  blockType: "mt.block.type",
  blockOrigin: "mt.block.origin",
  downloadState: "mt.download.state",
  filedBy: "mt.filed_by",
  alertRule: "mt.alert.rule",
  pushOutcome: "mt.push.outcome",
  slotState: "mt.slot.state",
  telemetrySignal: "mt.telemetry.signal",
  dropReason: "mt.telemetry.drop_reason",
  /** Set by the collector's transform/product only (spec §10). */
  dependency: "mt.dependency",
  /** Set by the collector on container log lines (browser-N, pdf-worker, audio-capture, docling). */
  service: "mt.service",
  observerRole: "mt.observer.role",
  observerStage: "mt.observer.stage",
  observerVerdict: "mt.observer.verdict",
  observerCategory: "mt.observer.category",
  observerRollout: "mt.observer.rollout",
  observerOutcome: "mt.observer.outcome",
  observerTool: "mt.observer.tool",
  spendPurpose: "mt.spend.purpose",
} as const;
export type AttributeName = (typeof ATTR)[keyof typeof ATTR];

export const STEP_OUTCOMES = ["continue", "waiting", "completed", "failed", "cancelled"] as const;
export type StepOutcomeName = (typeof STEP_OUTCOMES)[number];
export const TOOL_OUTCOMES = [
  "ok",
  "tool_error",
  "stale_ref",
  "failed",
  "unavailable",
  "refused",
] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];
export const APPROVAL_DECIDERS = [
  "person",
  "policy",
  "bypass",
  "observer",
  "agent",
  "unknown",
] as const;
export type ApprovalDecider = (typeof APPROVAL_DECIDERS)[number];
export const SEND_MODES = ["queue", "interrupt"] as const;
export type SendMode = (typeof SEND_MODES)[number];
export const SLOT_OUTCOMES = ["leased", "released", "ok", "timeout"] as const;
export type SlotOutcome = (typeof SLOT_OUTCOMES)[number];
export const TAKEOVER_OUTCOMES = ["ok", "takeover_failed", "control_restore_failed"] as const;
export type TakeoverOutcome = (typeof TAKEOVER_OUTCOMES)[number];
export const DOWNLOAD_STATES = ["pending", "ready"] as const;
export type DownloadState = (typeof DOWNLOAD_STATES)[number];
export const PUSH_OUTCOMES = ["sent", "gone", "failed", "refused"] as const;
export type PushOutcome = (typeof PUSH_OUTCOMES)[number];
export const TOKEN_TYPES = ["input", "cached", "output"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];
export const TELEMETRY_SIGNALS = ["traces", "metrics", "logs"] as const;
export type TelemetrySignal = (typeof TELEMETRY_SIGNALS)[number];
export const DROP_REASONS = ["queue_full", "export_failed", "not_allowed"] as const;
export type DropReason = (typeof DROP_REASONS)[number];
export const DEPENDENCIES = [
  "openai",
  "s3",
  "docling",
  "pdf-worker",
  "audio-capture",
  "neko",
  "push",
] as const;
export type Dependency = (typeof DEPENDENCIES)[number];
export { OBSERVER_ROLES, type ObserverRole } from "./observer-roles.ts";
export const OBSERVER_OUTCOMES = [
  "ok",
  "timeout",
  "error",
  "redacted",
  "invalid",
  "limit",
  "capped",
] as const;
export type ObserverOutcome = (typeof OBSERVER_OUTCOMES)[number];
/** run: everything a run pays (agent, title, Guard, designer); copilot: the owner's chat (spec §6.11). */
export const SPEND_PURPOSES = ["run", "copilot"] as const;
export type SpendPurpose = (typeof SPEND_PURPOSES)[number];

/** A product error code: what instrument() records instead of a message (spec §7.1). */
export const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** The value type of every product attribute: the TypeScript half of the allowlist (spec §5.2). */
export interface AttributeValues {
  "mt.run.id": string;
  "mt.step.phase": StepPhase;
  "mt.step.outcome": StepOutcomeName;
  "mt.interruption": string;
  "mt.model.name": string;
  "mt.model.fallback": boolean;
  "mt.model.attempts": number;
  "mt.model.tokens.input": number;
  "mt.model.tokens.cached": number;
  "mt.model.tokens.output": number;
  "mt.model.cost_usd": number;
  "mt.model.token_type": TokenType;
  "mt.tool.name": ToolName;
  "mt.tool.outcome": ToolOutcome;
  "mt.action.types": string[];
  "mt.error.code": string;
  "mt.approval.kind": ApprovalKind;
  "mt.approval.status": ApprovalStatus;
  "mt.approval.decider": ApprovalDecider;
  "mt.approval.mode": ApprovalMode;
  "mt.send.mode": SendMode;
  "mt.vault.alias": string;
  "mt.capture.fidelity": Fidelity;
  "mt.capture.coverage": number;
  "mt.slot.name": string;
  "mt.slot.outcome": SlotOutcome;
  "mt.takeover.outcome": TakeoverOutcome;
  "mt.control.holder": Controller;
  "mt.run.status": RunStatus;
  "mt.block.type": BlockType;
  "mt.block.origin": BlockOrigin;
  "mt.download.state": DownloadState;
  "mt.filed_by": FiledBy;
  "mt.alert.rule": AlertRule;
  "mt.push.outcome": PushOutcome;
  "mt.slot.state": SlotState;
  "mt.telemetry.signal": TelemetrySignal;
  "mt.telemetry.drop_reason": DropReason;
  "mt.dependency": Dependency;
  "mt.service": string;
  "mt.observer.role": ObserverRole;
  "mt.observer.stage": GuardStage;
  "mt.observer.verdict": GuardVerdictName;
  "mt.observer.category": GuardCategory;
  "mt.observer.rollout": ObserverMode;
  "mt.observer.outcome": ObserverOutcome;
  "mt.observer.tool": CopilotToolName;
  "mt.spend.purpose": SpendPurpose;
}
export type ProductAttributes = Partial<AttributeValues>;

/** What a tool may add to its span (spec §7.5): never arguments, page text or values. */
export type ToolAttributes = Pick<
  ProductAttributes,
  "mt.vault.alias" | "mt.capture.fidelity" | "mt.capture.coverage" | "mt.error.code"
>;

/** Base (non-product) attributes the SDK may export; every other key is dropped (spec §5.2). */
export const BASE_ATTRIBUTES = [
  "http.request.method",
  "http.response.status_code",
  "server.address",
  "server.port",
  "url.scheme",
  "error.type",
  "network.protocol.version",
  "http.route",
  "next.route",
  "next.span_type",
  "next.span_name",
  "exception.type",
] as const;
export const EXPORTABLE_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ATTR),
  ...BASE_ATTRIBUTES,
]);

/**
 * The fields the pino → OTel log bridge exports (spec §9, review I3): ids, codes, names and counts
 * only. Everything else (err, messages, URLs, user ids, free text) stays on stdout and is never
 * exported, the same allowlist rule spans follow.
 */
export const LOG_FIELDS: ReadonlySet<string> = new Set([
  "service",
  "module",
  "run_id",
  "runId",
  "errorCode",
  "errName",
  "reason",
  "alias",
  "field",
  "outcome",
  "origin",
  "slot",
  "slots",
  "tool",
  "signal",
  "count",
  "matches",
  "port",
  "channel",
  "noteId",
  "assetId",
  "benchmarkId",
  "approvalMode",
  "modelStatus",
  "modelErrorType",
  "modelErrorCode",
  "modelErrorParam",
  "verdict",
  "category",
  "stage",
]);

export interface MetricSpec {
  name: string;
  kind: "counter" | "histogram" | "updown" | "gauge";
  unit: string;
  description: string;
  dimensions: readonly AttributeName[];
}

const metric = (spec: MetricSpec) => spec;
export const METRIC = {
  runsEnded: metric({
    name: "mt.runs.ended",
    kind: "counter",
    unit: "{run}",
    description: "Runs that reached a terminal status",
    dimensions: [ATTR.runStatus],
  }),
  runFailures: metric({
    name: "mt.run.failures",
    kind: "counter",
    unit: "{run}",
    description: "Runs that failed, by error code",
    dimensions: [ATTR.errorCode],
  }),
  runErrors: metric({
    name: "mt.run.errors",
    kind: "counter",
    unit: "{error}",
    description: "Error events shown in a run",
    dimensions: [ATTR.errorCode],
  }),
  approvalsRequested: metric({
    name: "mt.approvals.requested",
    kind: "counter",
    unit: "{approval}",
    description: "Approvals asked for",
    dimensions: [ATTR.approvalKind],
  }),
  approvalsResolved: metric({
    name: "mt.approvals.resolved",
    kind: "counter",
    unit: "{approval}",
    description: "Approvals decided",
    dimensions: [ATTR.approvalStatus, ATTR.approvalDecider],
  }),
  approvalModeChanges: metric({
    name: "mt.approval_mode.changes",
    kind: "counter",
    unit: "{change}",
    description: "Approval modes changed mid-run, by the new mode",
    dimensions: [ATTR.approvalMode],
  }),
  runSends: metric({
    name: "mt.run.sends",
    kind: "counter",
    unit: "{message}",
    description: "Messages a person sent to a run, queued or interrupting",
    dimensions: [ATTR.sendMode],
  }),
  controlChanges: metric({
    name: "mt.control.changes",
    kind: "counter",
    unit: "{change}",
    description: "Browser control handed between agent and person",
    dimensions: [ATTR.controlHolder],
  }),
  slotLeases: metric({
    name: "mt.slot.leases",
    kind: "counter",
    unit: "{lease}",
    description: "Slot leases and releases",
    dimensions: [ATTR.slotOutcome],
  }),
  blocksAdded: metric({
    name: "mt.blocks.added",
    kind: "counter",
    unit: "{block}",
    description: "Note blocks written",
    dimensions: [ATTR.blockType, ATTR.blockOrigin],
  }),
  downloads: metric({
    name: "mt.downloads",
    kind: "counter",
    unit: "{download}",
    description: "Downloads pending or stored",
    dimensions: [ATTR.downloadState],
  }),
  downloadSize: metric({
    name: "mt.download.size",
    kind: "histogram",
    unit: "By",
    description: "Download sizes",
    dimensions: [ATTR.downloadState],
  }),
  budgetHits: metric({
    name: "mt.budget.hits",
    kind: "counter",
    unit: "{hit}",
    description: "Run budgets reached",
    dimensions: [],
  }),
  modelFallbacks: metric({
    name: "mt.model.fallbacks",
    kind: "counter",
    unit: "{fallback}",
    description: "Switches to the fallback model",
    dimensions: [ATTR.modelName],
  }),
  notesFiled: metric({
    name: "mt.notes.filed",
    kind: "counter",
    unit: "{note}",
    description: "Notes filed into a folder",
    dimensions: [ATTR.filedBy],
  }),
  modelTokens: metric({
    name: "mt.model.tokens",
    kind: "counter",
    unit: "{token}",
    description: "Agent model tokens",
    dimensions: [ATTR.modelName, ATTR.tokenType],
  }),
  spendUsd: metric({
    name: "mt.spend.usd",
    kind: "counter",
    unit: "USD",
    description: "Committed spend, by purpose",
    dimensions: [ATTR.spendPurpose],
  }),
  slots: metric({
    name: "mt.slots",
    kind: "gauge",
    unit: "{slot}",
    description: "Browser slots by state",
    dimensions: [ATTR.slotState],
  }),
  activeRuns: metric({
    name: "mt.runs.active",
    kind: "gauge",
    unit: "{run}",
    description: "Runs this agent is driving",
    dimensions: [],
  }),
  sseConnections: metric({
    name: "mt.sse.connections",
    kind: "updown",
    unit: "{connection}",
    description: "Open run event streams",
    dimensions: [],
  }),
  alertsReceived: metric({
    name: "mt.alerts.received",
    kind: "counter",
    unit: "{alert}",
    description: "Alerts received from OpenObserve",
    dimensions: [ATTR.alertRule],
  }),
  pushSends: metric({
    name: "mt.push.sends",
    kind: "counter",
    unit: "{push}",
    description: "Web Push deliveries",
    dimensions: [ATTR.pushOutcome],
  }),
  telemetryDropped: metric({
    name: "mt.telemetry.dropped",
    kind: "counter",
    unit: "{item}",
    description: "Telemetry items or attributes dropped",
    dimensions: [ATTR.telemetrySignal, ATTR.dropReason],
  }),
  observerVerdicts: metric({
    name: "mt.observer.verdicts",
    kind: "counter",
    unit: "{verdict}",
    description: "Guard and watcher verdicts",
    dimensions: [ATTR.observerVerdict, ATTR.observerCategory, ATTR.observerRollout],
  }),
  observerFailures: metric({
    name: "mt.observer.failures",
    kind: "counter",
    unit: "{failure}",
    description: "Observer reviews or turns that could not complete",
    dimensions: [ATTR.observerRole, ATTR.observerOutcome],
  }),
  observerOverrides: metric({
    name: "mt.observer.overrides",
    kind: "counter",
    unit: "{override}",
    description: "A person approved what the Guard stopped",
    dimensions: [],
  }),
  observerSpend: metric({
    name: "mt.observer.spend.usd",
    kind: "counter",
    unit: "USD",
    description: "The Observer's own model spend (a breakdown, not additive with mt.spend.usd)",
    dimensions: [ATTR.observerRole],
  }),
} as const;

/** The collector's spanmetrics connector (spec §5.3, §10). */
export const SPANMETRICS_NAMESPACE = "mt.span";
export const DERIVED_METRIC = {
  spanCalls: "mt.span.calls",
  spanDuration: "mt.span.duration",
} as const;
export const SPANMETRIC_DIMENSIONS = [
  ATTR.stepPhase,
  ATTR.stepOutcome,
  ATTR.toolName,
  ATTR.toolOutcome,
  ATTR.modelName,
  ATTR.errorCode,
  ATTR.captureFidelity,
  ATTR.slotName,
  ATTR.takeoverOutcome,
  ATTR.dependency,
  ATTR.observerRole,
  ATTR.observerStage,
  ATTR.observerOutcome,
  ATTR.observerTool,
] as const satisfies readonly AttributeName[];

export const LOG_STREAMS = { app: "mastertutor", containers: "containers" } as const;
export const TRACE_STREAM = "default";
export const RETENTION_DAYS = { logs: 30, traces: 15, metrics: 90 } as const;

/** OpenObserve's names replace dots with underscores. */
export function o2StreamName(name: string): string {
  return name.replaceAll(".", "_");
}

/**
 * The second scrub pass's value patterns (spec D50 §10), for TypeScript consumers (the code index).
 * infra/otel/collector.yaml writes the same patterns in YAML; telemetry.test.ts pins both.
 */
export const SECRET_SCRUB_PATTERNS: readonly RegExp[] = [
  /bearer\s+[a-z0-9._~+/-]+=*/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /basic\s+[a-z0-9+/]{8,}=*/gi,
  /(NEKO_SESSION|live_slot|better-auth\.[a-z_]+)=[^;\s]+/g,
];
