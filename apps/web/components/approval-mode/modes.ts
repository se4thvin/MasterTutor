import { APPROVAL_MODES, type ApprovalMode } from "@mastertutor/contracts";

/** The one vocabulary for approval modes: New task, the run's mode control and its thread. */
export const APPROVAL_MODE_LABEL: Record<ApprovalMode, string> = {
  ask: "Ask me",
  auto_within_allowlist: "Auto in allowed domains",
  bypass: "Bypass approvals",
};

/** The short name, where space is tight (the toolbar control, the thread line). */
export const APPROVAL_MODE_SHORT: Record<ApprovalMode, string> = {
  ask: "Ask",
  auto_within_allowlist: "Auto",
  bypass: "Bypass",
};

export const APPROVAL_MODE_TEXT: Record<ApprovalMode, string> = {
  ask: "Risky clicks, form submits, downloads, first sign-ins and new domains always ask you first.",
  auto_within_allowlist:
    "Risky clicks, forms and first sign-ins in your allowed domains go ahead and are logged.",
  bypass:
    "Steps go ahead without asking, except budget limits and prompt-injection warnings; each one is logged.",
};

export const APPROVAL_MODE_ITEMS = APPROVAL_MODES.map((value) => ({
  value,
  label: APPROVAL_MODE_LABEL[value],
}));
