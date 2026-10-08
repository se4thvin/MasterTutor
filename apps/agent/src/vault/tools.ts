import {
  FUNCTION_TOOLS,
  type ApprovalRequest,
  type FillCredentialArgs,
  type FillCredentialResult,
  type UsePasskeyArgs,
  type UsePasskeyResult,
} from "@mastertutor/contracts";
import { ATTR, type ToolAttributes } from "@mastertutor/contracts/telemetry";
import type { ApprovalContext, Tool, ToolContext } from "./runtime.ts";

export interface CredentialActions {
  fill(ctx: ToolContext, args: FillCredentialArgs): Promise<FillCredentialResult>;
  fillApproval(ctx: ApprovalContext, args: FillCredentialArgs): Promise<ApprovalRequest | null>;
  passkey(ctx: ToolContext, args: UsePasskeyArgs): Promise<UsePasskeyResult>;
  passkeyApproval(ctx: ApprovalContext, args: UsePasskeyArgs): Promise<ApprovalRequest | null>;
}

/** Spec §7.5: the alias (a name, never a secret) and the vault's own error code, if any. */
function credentialTelemetry(
  args: { alias: string },
  result: FillCredentialResult | UsePasskeyResult,
): ToolAttributes {
  return {
    [ATTR.vaultAlias]: args.alias,
    ...("error" in result ? { [ATTR.errorCode]: result.error } : {}),
  };
}

/**
 * The two credential tools (spec §6). Schemas come from contracts, the single source. Each raises
 * its own approve-phase card from the live page. Their results are codes the vault wrote, not
 * page text, so they are not wrapped as untrusted.
 */
export function vaultTools(
  actions: CredentialActions,
): [Tool<FillCredentialArgs, FillCredentialResult>, Tool<UsePasskeyArgs, UsePasskeyResult>] {
  return [
    {
      name: "fill_credential",
      args: FUNCTION_TOOLS.fill_credential.args,
      result: FUNCTION_TOOLS.fill_credential.result,
      untrusted: false,
      approval: (ctx, args) => actions.fillApproval(ctx, args),
      run: (ctx, args) => actions.fill(ctx, args),
      telemetry: credentialTelemetry,
    },
    {
      name: "use_passkey",
      args: FUNCTION_TOOLS.use_passkey.args,
      result: FUNCTION_TOOLS.use_passkey.result,
      untrusted: false,
      approval: (ctx, args) => actions.passkeyApproval(ctx, args),
      run: (ctx, args) => actions.passkey(ctx, args),
      telemetry: credentialTelemetry,
    },
  ];
}
