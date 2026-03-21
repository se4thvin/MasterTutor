import {
  POLICY_DECIDER,
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
  partsFor,
  releaseTargets,
  type FillOutcome,
  type GroupBox,
} from "./dom.ts";
import { fieldAccepts } from "./field-rules.ts";
import { approvedBy, credentialApproval } from "./grants.ts";
import type { ToolContext } from "./runtime.ts";
import { obtainOtp } from "./otp.ts";
import { NOT_STORED, withItemSecret } from "./secrets.ts";
import { msUntilFreshWindow, totpCode } from "./totp.ts";

/** Refusals that are policy decisions (audited as `denied`); the rest are `fill` failures. */
const DENIALS: ReadonlySet<CredentialErrorCode> = new Set([
  "unknown_alias",
  "origin_mismatch",
  "frame_mismatch",
  "field_type_mismatch",
  "approval_required",
  "needs_human",
]);

/** Stored secrets a page might echo; usernames and one-time codes are masked by box only (deviation 7, S5). */
const SECRET_FIELDS: ReadonlySet<CredentialField> = new Set(["password", "pin"]);

const offsiteKey = (runId: string, alias: string) => `${runId}\u0000${alias}`;

/**
 * RunHooks.functionApproval for fill_credential (spec §5.5 credential_first_use). A fill refused
 * because its form posts off the item's origin asks again, naming the destination, even for a
 * granted alias, so a person can approve that one use (carry-over 1).
 */
export async function fillApproval(
  deps: VaultDeps,
  run: { id: string; workspaceId: string },
  url: string,
  args: FillCredentialArgs,
): Promise<ApprovalRequest | null> {
  const item = await findVaultItemByAlias(deps.db, run.workspaceId, args.alias);
  if (!item) return null;
  const postsTo = deps.offsiteForms.get(offsiteKey(run.id, item.alias));
  if (postsTo !== undefined && toOrigin(url) === item.origin)
    return { kind: "credential_first_use", alias: item.alias, origin: item.origin, postsTo };
  return credentialApproval(deps, url, item);
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
  // Nothing is written when the value does not fit the boxes, so nothing is masked either (N2).
  if (partsFor(group, text) === null) return "length_mismatch";
  if (forcePassword) await disableRevealToggles(first.node);
  // Masks and redaction first (I2): once a value is written, a failed fill may still leave some of
  // it in the page. A stale mask is harmless; a missing one is not.
  deps.fingerprints.remember(ctx.runId, {
    filled: {
      cdp: first.node.cdp,
      frameId: first.node.frameId,
      loaderId: first.node.loaderId,
      backendNodeIds: group.map((box) => box.backendNodeId),
    },
    secret: SECRET_FIELDS.has(field) ? text : null,
  });
  return fillGroup(group, text, { forcePassword, pinnedOrigin });
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
    case "totp": {
      const result = await withItemSecret(
        deps,
        ctx.workspaceId,
        item,
        "totp",
        async (seed): Promise<FillOutcome | CredentialErrorCode> => {
          const wait = msUntilFreshWindow(seed, deps.now());
          if (wait === null) return "fill_failed";
          if (wait > 0) await deps.sleep(wait, ctx.signal);
          const code = totpCode(seed, deps.now());
          return code === null ? "fill_failed" : use(code);
        },
      );
      return result === NOT_STORED ? "field_not_stored" : result;
    }
    case "otp": {
      const otp = await obtainOtp(deps, ctx, item);
      if (!otp) {
        // Task 0 seam: the loop enters waiting(otp) once this act commits; CodeSlots appears.
        ctx.requestWait("otp");
        return "otp_unavailable";
      }
      await appendVaultAudit(deps.db, {
        workspaceId: ctx.workspaceId,
        itemId: item.id,
        alias: item.alias,
        origin: item.origin,
        field: "otp",
        action: "otp_received",
        runId: ctx.runId,
        approvedBy: null,
        outcome: otp.source,
      });
      return use(otp.code);
    }
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

  // Spec §5.3 and M8: a held or aborted run never reaches a decryption.
  ctx.session.guard.assertAgent(ctx.signal);
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
    // A form that submits anywhere but the item's origin needs a person's approval of this very
    // call (M4). The policy never clears it: auto mode hands over to a person instead.
    const postsTo = group
      .flatMap((box) => box.info.formOrigins)
      .find((origin) => origin !== item.origin);
    if (postsTo !== undefined) {
      if (
        ctx.approval?.kind === "credential_first_use" &&
        ctx.approval.decidedBy === POLICY_DECIDER
      )
        return refuse("needs_human", "form_action_offsite");
      if (ctx.approval?.kind !== "credential_first_use") {
        deps.offsiteForms.set(offsiteKey(ctx.runId, item.alias), postsTo);
        return refuse("approval_required", "form_action_offsite");
      }
    }
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
    deps.offsiteForms.delete(offsiteKey(ctx.runId, item.alias));
    await record("fill", "ok", approver);
    deps.logins.noteLogin(ctx.runId, item.alias, item.origin);
    deps.log.info({ alias: item.alias, field: args.field }, "fill_credential ok");
    return { ok: true };
  } finally {
    await releaseTargets(target.cdp);
  }
}
