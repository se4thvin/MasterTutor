import {
  toOrigin,
  type ApprovalRequest,
  type CredentialErrorCode,
  type CredentialField,
  type FillCredentialArgs,
  type FillCredentialResult,
} from "@mastertutor/contracts";
import { appendVaultAudit, findVaultItemByAlias, type VaultItemRecord } from "@mastertutor/db";
import { SealError } from "@mastertutor/sealing";
import type { VaultDeps } from "./context.ts";
import {
  describeGroup,
  disableRevealToggles,
  fillGroup,
  openTarget,
  releaseTargets,
  type FillOutcome,
  type GroupBox,
} from "./dom.ts";
import { fieldAccepts } from "./field-rules.ts";
import { approvedBy, credentialApproval } from "./grants.ts";
import type { ToolContext } from "./runtime.ts";
import { NOT_STORED, withItemSecret } from "./secrets.ts";

/** Refusals that are policy decisions (audited as `denied`); the rest are `fill` failures. */
const DENIALS: ReadonlySet<CredentialErrorCode> = new Set([
  "unknown_alias",
  "origin_mismatch",
  "frame_mismatch",
  "field_type_mismatch",
  "approval_required",
]);

/** Stored secrets a page might echo; usernames and one-time codes are masked by box only (deviation 7, S5). */
const SECRET_FIELDS: ReadonlySet<CredentialField> = new Set(["password", "pin"]);

/** RunHooks.functionApproval for fill_credential (spec §5.5 credential_first_use). */
export async function fillApproval(
  deps: VaultDeps,
  run: { workspaceId: string },
  url: string,
  args: FillCredentialArgs,
): Promise<ApprovalRequest | null> {
  const item = await findVaultItemByAlias(deps.db, run.workspaceId, args.alias);
  return item ? credentialApproval(deps, url, item) : null;
}

async function fillInto(
  deps: VaultDeps,
  ctx: ToolContext,
  group: readonly GroupBox[],
  field: CredentialField,
  text: string,
  pinnedOrigin: string,
): Promise<FillOutcome> {
  // Spec §5.3: abort and the control lock are checked before each field, never mid-field.
  ctx.session.guard.assertAgent(ctx.signal);
  const forcePassword = field === "password" || field === "pin";
  const first = group[0];
  if (!first) return "failed";
  if (forcePassword) await disableRevealToggles(first.node);
  const outcome = await fillGroup(group, text, { forcePassword, pinnedOrigin });
  if (outcome === "ok") {
    deps.fingerprints.remember(ctx.runId, {
      filled: {
        cdp: first.node.cdp,
        frameId: first.node.frameId,
        backendNodeIds: group.map((box) => box.backendNodeId),
      },
      secret: SECRET_FIELDS.has(field) ? text : null,
    });
  }
  return outcome;
}

/** Opens (or produces) the value for `field` only for the duration of `use`. */
async function withCredentialValue(
  deps: VaultDeps,
  ctx: ToolContext,
  item: VaultItemRecord,
  field: CredentialField,
  use: (text: string) => Promise<FillOutcome>,
): Promise<FillOutcome | CredentialErrorCode> {
  switch (field) {
    case "username":
    case "password":
    case "pin": {
      const result = await withItemSecret(deps, ctx.workspaceId, item, field, use);
      return result === NOT_STORED ? "field_not_stored" : result;
    }
    case "totp":
    case "otp":
      return "field_not_stored";
  }
}

/** Spec §9 fill_credential: every check runs in code, in order; the model sees only a code. */
export async function fillCredential(
  deps: VaultDeps,
  ctx: ToolContext,
  args: FillCredentialArgs,
): Promise<FillCredentialResult> {
  const item = await findVaultItemByAlias(deps.db, ctx.workspaceId, args.alias);
  const record = (action: "fill" | "denied", outcome: string, approver: string | null) =>
    appendVaultAudit(deps.db, {
      workspaceId: ctx.workspaceId,
      itemId: item?.id ?? null,
      alias: args.alias,
      origin: item?.origin ?? null,
      field: args.field,
      action,
      runId: ctx.runId,
      approvedBy: approver,
      outcome,
    });
  const refuse = async (
    code: CredentialErrorCode,
    outcome: string = code,
  ): Promise<FillCredentialResult> => {
    await record(DENIALS.has(code) ? "denied" : "fill", outcome, null);
    deps.log.info({ alias: args.alias, field: args.field, outcome }, "fill_credential refused");
    return { error: code };
  };

  if (!item) return refuse("unknown_alias");
  if (toOrigin(ctx.session.page.url()) !== item.origin) return refuse("origin_mismatch");
  const ref = await deps.resolveRef(ctx.session, args.target);
  if (!ref) return refuse("fill_failed", "target_not_found");
  const target = await openTarget(ref.cdp, ref.backendNodeId);
  if (!target) return refuse("fill_failed", "target_not_found");
  try {
    const group = await describeGroup(target);
    if (group.length === 0) return refuse("fill_failed", "target_not_found");
    if (group.some((box) => box.info.origin !== item.origin)) return refuse("frame_mismatch");
    if (!group.every((box) => fieldAccepts(args.field, box.info)))
      return refuse("field_type_mismatch");
    const approver = await approvedBy(deps, ctx.approval, item, ctx.session.page.url());
    if (approver === null) return refuse("approval_required");

    let outcome: FillOutcome | CredentialErrorCode;
    try {
      outcome = await withCredentialValue(deps, ctx, item, args.field, (text) =>
        fillInto(deps, ctx, group, args.field, text, item.origin),
      );
    } catch (error) {
      // A tampered or foreign ciphertext leaves an audit row, never a bare tool_failed (F16).
      if (error instanceof SealError) return refuse("fill_failed", error.code);
      throw error;
    }
    switch (outcome) {
      case "ok":
        break;
      case "navigated":
        return refuse("origin_mismatch", "navigated_mid_fill");
      case "length_mismatch":
        return refuse("fill_failed", "length_mismatch");
      case "failed":
        return refuse("fill_failed");
      default:
        return refuse(outcome);
    }
    await record("fill", "ok", approver);
    deps.logins.noteLogin(ctx.runId, item.alias, item.origin);
    deps.log.info({ alias: item.alias, field: args.field }, "fill_credential ok");
    return { ok: true };
  } finally {
    await releaseTargets(target.cdp);
  }
}
