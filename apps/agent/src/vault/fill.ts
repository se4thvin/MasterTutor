import {
  isPersonDecider,
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
import type { ApprovalContext, ToolContext } from "./runtime.ts";
import { codeFirstSignInStart, obtainOtp } from "./otp.ts";
import { NOT_STORED, withItemSecret } from "./secrets.ts";
import { msUntilFreshWindow, totpCode, totpStep } from "./totp.ts";

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

/** ApprovalRequest credential_first_use.postsTo's limit. */
const MAX_POSTS_TO = 4_096;

/** Per-run, per-alias fill state lives in VaultDeps maps under this key. */
const runAliasKey = (runId: string, alias: string) => `${runId}\u0000${alias}`;

/** Drops a finished run's fill state (RunHooks.onReleased, Task 13). */
export function forgetFillState(
  deps: Pick<VaultDeps, "signInStarted" | "totpSteps">,
  runId: string,
): void {
  const prefix = `${runId}\u0000`;
  for (const map of [deps.signInStarted, deps.totpSteps])
    for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
}

/**
 * Every place but the item's origin the target's form could send the value (its action and each
 * submit button's formaction), sorted and joined, so a card and its check name all of them (N7).
 * Undefined when the form posts home only.
 */
function offsiteDestination(group: readonly GroupBox[], origin: string): string | undefined {
  const offsite = new Set(
    group.flatMap((box) => box.info.formOrigins).filter((destination) => destination !== origin),
  );
  return offsite.size > 0 ? [...offsite].sort().join(", ") : undefined;
}

/** The page's current answer for `ref`; undefined when the form posts home or the ref is gone. */
async function currentDestination(
  deps: VaultDeps,
  ctx: ApprovalContext,
  ref: string,
  origin: string,
): Promise<string | undefined> {
  const resolved = await deps.resolveRef(ctx.session, ref);
  const target = resolved && (await openTarget(resolved.cdp, resolved.backendNodeId));
  if (!target) return undefined;
  try {
    return offsiteDestination(await describeGroup(target), origin);
  } finally {
    await releaseTargets(target.cdp);
  }
}

/**
 * fill_credential's approve phase (spec §5.5 credential_first_use). The card names where the
 * target's form posts whenever that is off the item's origin, for every call and even for a
 * granted alias (carry-over 1): the act phase fills only while the form still posts to the
 * destination this very card showed (T10-12 I1). A page it cannot inspect gets a plain card, and
 * the act phase refuses any off-origin form that card did not name.
 */
export async function fillApproval(
  deps: VaultDeps,
  ctx: ApprovalContext,
  args: FillCredentialArgs,
): Promise<ApprovalRequest | null> {
  const item = await findVaultItemByAlias(deps.db, ctx.workspaceId, args.alias);
  if (!item) return null;
  const url = ctx.session.page.url();
  if (toOrigin(url) !== item.origin) return null;
  const postsTo = await currentDestination(deps, ctx, args.target, item.origin).catch(
    (error: unknown) => {
      ctx.signal.throwIfAborted();
      deps.log.warn({ alias: item.alias, reason: (error as Error).name }, "form check failed");
      return undefined;
    },
  );
  // A list too long for a card is cut: the act-time check then never matches (fails closed).
  if (postsTo !== undefined)
    return {
      kind: "credential_first_use",
      alias: item.alias,
      origin: item.origin,
      postsTo: postsTo.slice(0, MAX_POSTS_TO),
    };
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
      // Never the code this sign-in already typed: the next time step instead (RFC 6238 §5.2).
      // The wait (up to a period) happens with the seed closed (N5).
      const key = runAliasKey(ctx.runId, item.alias);
      const wait = await withItemSecret(deps, ctx.workspaceId, item, "totp", async (seed) =>
        msUntilFreshWindow(seed, deps.now(), deps.totpSteps.get(key)),
      );
      if (wait === NOT_STORED) return "field_not_stored";
      if (wait === null) return "fill_failed";
      if (wait > 0) await deps.sleep(wait, ctx.signal);
      ctx.session.guard.assertAgent(ctx.signal);
      const result = await withItemSecret(
        deps,
        ctx.workspaceId,
        item,
        "totp",
        async (seed): Promise<FillOutcome | CredentialErrorCode> => {
          const now = deps.now();
          const code = totpCode(seed, now);
          const step = totpStep(seed, now);
          if (code === null || step === null) return "fill_failed";
          const outcome = await use(code);
          if (outcome === "ok") deps.totpSteps.set(key, step);
          return outcome;
        },
      );
      return result === NOT_STORED ? "field_not_stored" : result;
    }
    case "otp": {
      const started = deps.signInStarted.get(runAliasKey(ctx.runId, item.alias)) ?? deps.now();
      const otp = await obtainOtp(deps, ctx, item, started);
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
  // This sign-in started at its first fill (or shortly before, when that fill is the code
  // itself): one-time codes mailed earlier never count.
  const signIn = runAliasKey(ctx.runId, item.alias);
  if (!deps.signInStarted.has(signIn))
    deps.signInStarted.set(
      signIn,
      args.field === "otp" ? await codeFirstSignInStart(deps, ctx) : deps.now(),
    );
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
    // A form that submits anywhere but the item's origin needs a person's approval of a card that
    // named that very destination (M4, T10-12 I1). The policy never clears it: auto mode hands
    // over to a person instead.
    const postsTo = offsiteDestination(group, item.origin);
    if (postsTo !== undefined) {
      const approval = ctx.approval?.kind === "credential_first_use" ? ctx.approval : null;
      if (approval?.label !== postsTo) return refuse("approval_required", "form_action_offsite");
      if (!isPersonDecider(approval.decidedBy)) {
        ctx.requestHandOver(
          `This sign-in form sends the credential to ${postsTo}, not ${item.origin}: a person must decide.`,
        );
        return refuse("needs_human", "form_action_offsite");
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
    await record("fill", "ok", approver);
    deps.logins.noteLogin(ctx.runId, item.alias, item.origin);
    deps.log.info({ alias: item.alias, field: args.field }, "fill_credential ok");
    return { ok: true };
  } finally {
    await releaseTargets(target.cdp);
  }
}
