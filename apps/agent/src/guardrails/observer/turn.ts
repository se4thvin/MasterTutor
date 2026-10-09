import { Alias, toOrigin, type ActionClass, type GuardItem } from "@mastertutor/contracts";
import { targetRole, triggersFor, type GuardItemDraft } from "@mastertutor/observer/guard";
import { normalizeCombo } from "../../tools/keys.ts";
import type { SeenItem, TurnFacts } from "./types.ts";

const SAFETY_CODE = /^[a-z_]{1,64}$/;

/** What kind of act an item is, from its type and target flags only (spec §6.2). */
export function actionClassOf(seen: SeenItem): ActionClass | null {
  if (seen.tool === "fill_credential") return "vault_fill";
  if (seen.tool === "use_passkey") return "passkey";
  if (seen.tool !== null) return null;
  if (seen.request?.kind === "new_origin") return "navigate";
  if (seen.request?.kind === "download" && seen.action === null) return "download";
  const action = seen.action;
  if (!action) return seen.request ? "other" : null;
  const submits = seen.target?.isFormSubmit === true;
  switch (action.type) {
    case "click":
    case "double_click":
      return submits ? "submit" : "click";
    case "type":
      return "type";
    case "keypress": {
      const key = normalizeCombo(action.keys).split("+").at(-1);
      if (key !== "ENTER" && key !== "SPACE") return seen.request ? "other" : null;
      return submits || seen.target?.formKind === "other" ? "submit" : "keypress";
    }
    case "drag":
      return "other";
    default:
      return seen.request ? "other" : null;
  }
}

function destinationOf(seen: SeenItem): GuardItem["destination"] {
  const request = seen.request;
  if (request?.kind !== "new_origin" && request?.kind !== "download") return null;
  const origin = request.kind === "new_origin" ? request.origin : toOrigin(request.url);
  if (!origin) return null;
  let carriesQuery: boolean;
  try {
    const url = new URL(request.url);
    carriesQuery = url.search.length > 1 || url.hash.length > 1;
  } catch {
    carriesQuery = true;
  }
  return { origin, inAllowed: false, carriesQuery };
}

function vaultOf(seen: SeenItem): GuardItem["vault"] {
  if (seen.tool !== "fill_credential" && seen.tool !== "use_passkey") return null;
  const alias = Alias.safeParse((seen.args as { alias?: unknown } | null)?.alias);
  if (!alias.success) return null;
  const firstUse = seen.request?.kind === "credential_first_use";
  return {
    alias: alias.data,
    itemOrigin: seen.request?.kind === "credential_first_use" ? seen.request.origin : null,
    firstUse,
  };
}

function postsToOf(seen: SeenItem): string | null {
  if (seen.request?.kind !== "credential_first_use" || !seen.request.postsTo) return null;
  return toOrigin(seen.request.postsTo.split(",")[0]!.trim());
}

/**
 * A reviewed item's metadata, or null when no trigger applies (spec §6.2). Copies flags and codes
 * only: never TargetDescription.label, excerpt, path, context or ancestors, never typed text, never
 * function arguments beyond a vault alias (spec §6.4).
 */
export function guardItemOf(seen: SeenItem, facts: TurnFacts): GuardItemDraft | null {
  const actionClass = actionClassOf(seen);
  if (actionClass === null) return null;
  const sent =
    seen.action?.type === "type" ? facts.label(seen.action.text, facts.pageOrigin) : null;
  const triggers = triggersFor({
    risky: seen.request !== null,
    actionClass,
    provenance: sent?.provenance ?? null,
    pageOrigin: facts.pageOrigin,
    allowedOrigins: facts.allowedOrigins,
    firstActuationHere: facts.pageOrigin !== null && !facts.actuatedOrigins.has(facts.pageOrigin),
    injectionWindow: facts.injectionWindow,
    riskLevel: facts.riskLevel,
  });
  if (triggers.length === 0) return null;
  const target = seen.target;
  const checks =
    seen.request?.kind === "risky_click"
      ? (seen.request.safetyChecks ?? []).flatMap((check) =>
          check.code && SAFETY_CODE.test(check.code) ? [check.code] : [],
        )
      : [];
  return {
    actionClass,
    triggers,
    policyKind: seen.request && seen.request.kind !== "observer" ? seen.request.kind : null,
    policyDecision: seen.policy,
    target: target
      ? {
          role: targetRole(target.tag, target.opaqueFrame === true),
          formKind: target.formKind,
          isFormSubmit: target.isFormSubmit,
          isSecretField: target.isSecretField,
          opaqueFrame: target.opaqueFrame === true,
          hasDownload: target.download !== undefined,
          formPostsTo: postsToOf(seen),
        }
      : null,
    destination: destinationOf(seen),
    sent: sent
      ? { provenance: sent.provenance, sourceOrigin: sent.sourceOrigin, chars: sent.chars }
      : null,
    vault: vaultOf(seen),
    safetyChecks: checks.slice(0, 20),
  };
}
