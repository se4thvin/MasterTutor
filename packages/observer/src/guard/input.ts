import {
  GUARD_LIMITS,
  GuardInput,
  redactForTitle,
  type ApprovalMode,
  type GuardItem,
  type TargetRole,
} from "@mastertutor/contracts";

export type GuardItemDraft = Omit<GuardItem, "key">;

const ROLE_BY_TAG: Readonly<Record<string, TargetRole>> = {
  a: "link",
  button: "button",
  input: "input",
  select: "select",
  textarea: "textarea",
  iframe: "frame",
  frame: "frame",
  history: "history",
};

/** A role from the element's tag: never its label or text (spec §6.4). */
export function targetRole(tag: string | null | undefined, opaqueFrame: boolean): TargetRole {
  if (opaqueFrame) return "frame";
  return (tag ? ROLE_BY_TAG[tag.toLowerCase()] : undefined) ?? "other";
}

export interface GuardInputDraft {
  goal: string;
  mode: ApprovalMode;
  allowedOrigins: readonly string[];
  page: { origin: string | null; inAllowed: boolean };
  items: readonly GuardItemDraft[];
  run: GuardInput["run"];
}

/**
 * The one way a GuardInput is made: items keyed i1…i20 in the caller's order, the goal scrubbed
 * (redactForTitle), and the strict schema applied, so any extra field throws. The caller then runs
 * assertRedacted on the serialized input before sending it.
 */
export function buildGuardInput(draft: GuardInputDraft): GuardInput {
  return GuardInput.parse({
    goal: redactForTitle(draft.goal).slice(0, GUARD_LIMITS.goalChars),
    mode: draft.mode,
    allowedOrigins: draft.allowedOrigins.slice(0, GUARD_LIMITS.origins),
    page: draft.page,
    items: draft.items
      .slice(0, GUARD_LIMITS.items)
      .map((item, i) => ({ ...item, key: `i${i + 1}` })),
    run: draft.run,
  });
}
