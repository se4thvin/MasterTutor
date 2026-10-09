import {
  isPersonDecider,
  toOrigin,
  type ApprovalRequest,
  type Decider,
} from "@mastertutor/contracts";
import { getVaultGrantApprover, insertVaultGrant, type VaultItemRecord } from "@mastertutor/db";
import type { VaultDeps } from "./context.ts";
import type { CallApproval } from "./runtime.ts";

/**
 * Approve phase (each credential tool's own approval): a credential_first_use request when the
 * page is on the item's pinned origin and no grant exists yet. Elsewhere the fill is refused
 * anyway.
 */
export async function credentialApproval(
  deps: Pick<VaultDeps, "db">,
  url: string,
  item: VaultItemRecord,
): Promise<ApprovalRequest | null> {
  if (toOrigin(url) !== item.origin) return null;
  if ((await getVaultGrantApprover(deps.db, item.id, item.origin)) !== null) return null;
  return { kind: "credential_first_use", alias: item.alias, origin: item.origin };
}

/**
 * Act phase: who authorized this use, or null (refuse). `approval` is the decision for exactly
 * this call (R-E7). A person's approval becomes a lasting grant; a policy one authorizes this call
 * only (deviation 5, Review Focus 4). A grant is the item's pinned origin's alone: for a page on
 * any other origin nothing is used and nothing is written, whoever approved.
 */
export async function approvedBy(
  deps: Pick<VaultDeps, "db">,
  approval: CallApproval | null,
  item: VaultItemRecord,
  pageUrl: string,
): Promise<Decider | null> {
  if (toOrigin(pageUrl) !== item.origin) return null;
  if (approval?.kind === "credential_first_use") {
    // Only a person's approval is a lasting grant; a policy (auto or bypass) one is for this call.
    if (isPersonDecider(approval.decidedBy)) {
      await insertVaultGrant(deps.db, {
        itemId: item.id,
        origin: item.origin,
        approvedBy: approval.decidedBy,
      });
    }
    return approval.decidedBy;
  }
  return getVaultGrantApprover(deps.db, item.id, item.origin);
}
