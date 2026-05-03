import {
  CreateRunInput,
  DEFAULT_BUDGET,
  toOrigin,
  type ApprovalMode,
  type Budget,
  type SourceKind,
} from "@mastertutor/contracts";
import { errorCode, errorCopy } from "@/lib/api/errors.ts";

export interface SourceChip {
  url: string;
  kind: SourceKind;
  host: string;
  label: string;
  origin: string;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function parseSource(input: string): SourceChip | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const origin = toOrigin(url.toString());
  if (origin === null) return null;
  const host = url.hostname.replace(/^www\./, "");
  const kind: SourceKind = /(^|\.)youtube\.com$|^youtu\.be$/.test(host)
    ? "youtube"
    : /\.pdf$/i.test(url.pathname)
      ? "pdf"
      : "web";
  const path = url.pathname === "/" ? "" : url.pathname;
  return { url: url.toString(), kind, host, label: `${host}${path}${url.search}`, origin };
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Sites bounce between apex and www; allow both so the first redirect isn't a new-origin approval. */
export function originVariants(origin: string): string[] {
  const url = new URL(origin);
  const host = url.hostname;
  if (host === "localhost" || IPV4.test(host) || host.includes(":") || !host.includes("."))
    return [origin];
  const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [origin, `${url.protocol}//${twin}${url.port ? `:${url.port}` : ""}`];
}

export const BUDGET_PRESETS = {
  quick: { maxSteps: 50, maxUsd: 1.5, maxActiveMinutes: 20 },
  standard: DEFAULT_BUDGET,
  deep: { maxSteps: 300, maxUsd: 10, maxActiveMinutes: 120 },
} as const satisfies Record<string, Budget>;
export type BudgetPreset = keyof typeof BUDGET_PRESETS;

export interface TaskDraft {
  goal: string;
  sources: SourceChip[];
  /** Normalized origins typed into 01 Allowed domains. */
  domains: string[];
  budget: BudgetPreset;
  /** settings.defaultBudget; used for the Standard preset. */
  standardBudget: Budget;
  approvalMode: ApprovalMode;
  targetFolderId: string | null;
  /** The user ticked the bypass warning (D44); only sent with bypass mode. */
  bypassAcknowledged: boolean;
}

const GOAL_MAX = 4_000;
const ORIGINS_MAX = 50;

export function buildCreateRunInput(draft: TaskDraft): CreateRunInput | { error: string } {
  const text = draft.goal.trim();
  if (!text && draft.sources.length === 0) return { error: "Describe the task or add a source." };
  const list = draft.sources.map((s) => `- ${s.url}`).join("\n");
  const goal = draft.sources.length
    ? `${text || "Take notes on these sources."}\n\nSources:\n${list}`
    : text;
  if (goal.length > GOAL_MAX)
    return { error: "That's too long. Keep the task under 4,000 characters." };
  const origins = [
    ...new Set([...draft.sources.map((s) => s.origin), ...draft.domains].flatMap(originVariants)),
  ];
  if (origins.length === 0) return { error: "Add a source or an allowed domain." };
  if (origins.length > ORIGINS_MAX) return { error: "Too many allowed domains (50 at most)." };
  const bypass = draft.approvalMode === "bypass";
  // D44: bypass is an explicit opt-in; the server refuses it without the acknowledgement too.
  if (bypass && !draft.bypassAcknowledged) {
    return { error: "Confirm that you understand bypass mode before starting." };
  }
  return CreateRunInput.parse({
    goal,
    allowedOrigins: origins,
    budget: draft.budget === "standard" ? draft.standardBudget : BUDGET_PRESETS[draft.budget],
    targetFolderId: draft.targetFolderId,
    approvalMode: draft.approvalMode,
    ...(bypass ? { bypassAcknowledged: true } : {}),
  });
}

/** Copy for a failed runs.create. Server messages are never shown (they may echo input). */
export function startErrorCopy(error: unknown): string {
  const code = errorCode(error);
  if (code === "BAD_REQUEST") return "Check the task details and try again.";
  if (code === "TOO_MANY_REQUESTS") return errorCopy(error);
  return "Couldn't start the task. Try again.";
}
