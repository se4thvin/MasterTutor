import { isRiskyLabel, type ApprovalRequest, type ComputerAction } from "@mastertutor/contracts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import { normalizeCombo } from "../tools/keys.ts";

/** TargetDescription.tag of a history move (reload, back, forward) rather than a page element. */
export const HISTORY_TAG = "history";

export type ApprovalNeed =
  | { kind: "risky_click"; label: string; action: ComputerAction }
  | { kind: "form_submit"; formSummary: string; action: ComputerAction };

/**
 * Spec §5.5 approval list, for computer actions. Classification is code; the prompt never decides.
 * Downloads (B6), first credential use (B3), new origins and budgets are classified elsewhere.
 */
export function needsApproval(
  action: ComputerAction,
  target: TargetDescription | null,
): ApprovalNeed | null {
  if (!target) return null;
  // Reload/back/forward onto a page made by a form submission sends the form again (M11).
  if (target.tag === HISTORY_TAG && target.isFormSubmit)
    return { kind: "form_submit", formSummary: target.label || "Resubmit a form", action };
  switch (action.type) {
    case "click":
    case "double_click":
      if (isRiskyLabel(target.label)) return { kind: "risky_click", label: target.label, action };
      if (target.isFormSubmit && target.formKind === "other") {
        return { kind: "form_submit", formSummary: `Submit "${target.label || "form"}"`, action };
      }
      return null;
    case "keypress": {
      const combo = normalizeCombo(action.keys);
      if ((combo === "ENTER" || combo === "SPACE") && isRiskyLabel(target.label)) {
        return { kind: "risky_click", label: target.label, action };
      }
      return combo === "ENTER" && target.formKind === "other"
        ? { kind: "form_submit", formSummary: "Press Enter in a form", action }
        : null;
    }
    case "type":
      return action.text.includes("\n") && target.formKind === "other"
        ? { kind: "form_submit", formSummary: "Type a line break into a form", action }
        : null;
    default:
      return null;
  }
}

export function approvalRequestFor(
  need: ApprovalNeed,
  url: string,
  screenshotKey: string | null,
): ApprovalRequest {
  const pageUrl = url.slice(0, 4_096);
  return need.kind === "risky_click"
    ? {
        kind: "risky_click",
        action: need.action,
        label: need.label.slice(0, 500),
        url: pageUrl,
        screenshotKey,
      }
    : {
        kind: "form_submit",
        url: pageUrl,
        formSummary: need.formSummary.slice(0, 1_000),
        screenshotKey,
      };
}
