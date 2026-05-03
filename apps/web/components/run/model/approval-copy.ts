import type { ApprovalRequest, ComputerAction } from "@mastertutor/contracts";
import { hostAndPath, pageHost } from "./copy.ts";
import { untrustedText } from "./untrusted-text.ts";

/** Page-derived labels are untrusted (spec §5.5): cleaned and capped. */
export const MAX_LABEL = 120;
/** The record excerpt the agent read under the target (R29-3, B3 E R-E14). */
const MAX_CONTEXT = 240;
/** The safety-check code for a page that may be steering the agent (prompt injection). */
const INJECTION_CHECK = "malicious_instructions";

interface ApprovalCopy {
  title: string;
  body: string;
  tone: "signal" | "warn";
  risk: string | null;
  /** The model's safety-check messages, cleaned; empty unless the request is a safety check. */
  checks: readonly string[];
  /** "On this record": the cleaned excerpt, or null. */
  context: string | null;
  details: readonly (readonly [string, string])[];
  /** In 1280×800 viewport space; only for actions that point somewhere. */
  spotlight: { x: number; y: number } | null;
  budget: boolean;
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ENTER: "Enter",
  RETURN: "Enter",
  SPACE: "Space",
  TAB: "Tab",
  ESC: "Esc",
  ESCAPE: "Esc",
  BACKSPACE: "Backspace",
  DELETE: "Delete",
};
const keyName = (key: string) => KEY_NAMES[key.toUpperCase()] ?? untrustedText(key, 16);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** What the action does, verb first ("Click “Delete”", "Press Enter"). Labels are page text. */
function actionPhrase(action: ComputerAction, label: string | null): string {
  const target = label ? ` “${untrustedText(label, MAX_LABEL)}”` : "";
  switch (action.type) {
    case "click":
    case "double_click":
      return `Click${target}`;
    case "keypress":
      return `Press ${action.keys.map(keyName).join("+")}`;
    case "type":
      return "Type into the page";
    case "scroll":
      return "Scroll the page";
    case "drag":
      return "Drag on the page";
    case "move":
      return "Move the pointer";
    case "wait":
    case "screenshot":
      return "Continue";
  }
}

/** Only actions aimed at one point are spotlit (A2). */
function pointOf(action: ComputerAction | undefined): { x: number; y: number } | null {
  if (!action) return null;
  switch (action.type) {
    case "click":
    case "double_click":
    case "move":
    case "scroll":
      return { x: action.x, y: action.y };
    default:
      return null;
  }
}

const EXCEEDED = { steps: "Step", usd: "Spend", minutes: "Time" } as const;
const pageDetail = (url: string) => ["Page", untrustedText(url, 300)] as const;

export function requestSummary(request: ApprovalRequest): string {
  switch (request.kind) {
    case "risky_click":
      return request.safetyChecks?.length
        ? "a step the model flagged"
        : lowerFirst(actionPhrase(request.action, request.label || null));
    case "form_submit":
      return `submit a form on ${pageHost(request.url)}`;
    case "download":
      return `download ${untrustedText(request.filename, MAX_LABEL) || "a file"}`;
    case "credential_first_use":
      return `sign in as ${untrustedText(request.alias, 64)}`;
    case "new_origin":
      return `open ${pageHost(request.origin)}`;
    case "budget":
      return `${EXCEEDED[request.exceeded].toLowerCase()} budget`;
  }
}

/** The hosts a sign-in form would post to: one per listed origin, uncapped; junk is "an unknown site". */
function destinationsOf(postsTo: string): string[] {
  return postsTo.split(",").map((entry) => {
    const host = hostAndPath(entry.trim())?.host;
    return host ? host : "an unknown site";
  });
}

export function approvalCopy(request: ApprovalRequest): ApprovalCopy {
  const none = {
    tone: "signal",
    risk: null,
    checks: [],
    context: null,
    spotlight: null,
    budget: false,
  } as const;
  switch (request.kind) {
    case "risky_click": {
      const host = pageHost(request.url);
      const context = untrustedText(request.context, MAX_CONTEXT) || null;
      const spotlight = pointOf(request.action);
      if (request.safetyChecks?.length) {
        const injected = request.safetyChecks.some((c) => c.code === INJECTION_CHECK);
        return {
          ...none,
          title: "The model flagged this step",
          body: `It wants to ${lowerFirst(actionPhrase(request.action, null))} on ${host}. Read the warning before you decide.`,
          tone: "warn",
          risk: injected
            ? "The page may be trying to steer the agent. Deny unless you expected this."
            : "Check the warning before you approve.",
          checks: request.safetyChecks
            .map((c) => untrustedText(c.message ?? c.code, 300))
            .filter((text) => text !== ""),
          context,
          details: [pageDetail(request.url)],
          spotlight: null,
        };
      }
      return {
        ...none,
        title: `${actionPhrase(request.action, request.label || null)} on ${host}?`,
        body: "This could buy, send, delete or submit something on your behalf.",
        risk: "It might not be undoable.",
        context,
        details: [pageDetail(request.url)],
        spotlight,
      };
    }
    case "form_submit": {
      const details: (readonly [string, string])[] = [pageDetail(request.url)];
      if (request.action) details.push(["Trigger", actionPhrase(request.action, null)]);
      return {
        ...none,
        title: `Submit a form on ${pageHost(request.url)}?`,
        body: untrustedText(request.formSummary, 300) || "The agent wants to submit this form.",
        context: untrustedText(request.context, MAX_CONTEXT) || null,
        details,
        spotlight: pointOf(request.action),
      };
    }
    case "download":
      return {
        ...none,
        title: `Download ${untrustedText(request.filename, MAX_LABEL) || "a file"}?`,
        body: `From ${pageHost(request.url)}. Downloads are kept with the run, not on your computer.`,
        details: [["Link", untrustedText(request.url, 300)]],
      };
    case "credential_first_use": {
      const alias = untrustedText(request.alias, 64);
      const details: (readonly [string, string])[] = [
        ["Site", request.origin],
        ["Alias", alias],
      ];
      const body = "The vault fills the sign-in. The agent only sees the alias, never the values.";
      // The form posts elsewhere: where the credential would go is the fact to decide on (I1).
      // The vault lists every off-site origin joined by ", "; each is shown whole, never cut.
      if (request.postsTo) {
        const hosts = destinationsOf(request.postsTo);
        return {
          ...none,
          tone: "warn",
          title: `Send your ${alias} sign-in to ${
            hosts.length === 1 ? hosts[0] : `${hosts.length} other sites`
          }?`,
          body,
          risk: "This form sends your sign-in to a different site than the one you're on. Deny unless you trust it.",
          details: [...details, ...hosts.map((host) => ["Sends to", host] as const)],
        };
      }
      return {
        ...none,
        title: `Sign in to ${pageHost(request.origin)} as ${alias}?`,
        body,
        details,
      };
    }
    case "new_origin":
      return {
        ...none,
        title: `Open ${pageHost(request.origin)}?`,
        body: "It's outside the domains you allowed for this run.",
        details: [["Origin", request.origin], pageDetail(request.url)],
      };
    case "budget": {
      const { usage, budget } = request;
      const used =
        request.exceeded === "steps"
          ? `${usage.steps} of ${budget.maxSteps} steps`
          : request.exceeded === "usd"
            ? `$${usage.usd.toFixed(2)} of $${budget.maxUsd.toFixed(2)}`
            : `${Math.round(usage.activeMs / 60_000)} of ${budget.maxActiveMinutes} minutes`;
      return {
        ...none,
        title: `${EXCEEDED[request.exceeded]} limit reached`,
        body: `Used ${used}. Extend by 50%, finish with what's captured, or cancel the run.`,
        details: [],
        budget: true,
      };
    }
  }
}
