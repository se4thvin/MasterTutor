/**
 * The only place the vault imports B1's runtime (CLAUDE.md principle 5). Every B1 type and
 * function the vault uses is named here, so a B1 rename touches one file.
 */
import type { CDPSession } from "playwright-core";
import type { BrowserSession } from "../browser/session.ts";
import { StaleRef } from "../runtime/errors.ts";
import { resolveRef } from "../tools/read-page.ts";

export { SECRET_REDACTION, type MaskSources } from "../browser/masking.ts";
export { isPrivateAddress } from "../browser/network-policy.ts";
export { captureModelScreenshot } from "../browser/screenshot.ts";
export {
  BrowserStorageState,
  applyStorageState,
  collectStorageState,
  type CollectedStorage,
} from "../browser/storage-state.ts";
export type { RunHooks } from "../loop/hooks.ts";
export type { RunSnapshot } from "../loop/run-state.ts";
export type { SessionStore } from "../loop/step-store.ts";
export { ControlHeld, StaleRef } from "../runtime/errors.ts";
export type { Log, Tx } from "../runtime/types.ts";
export {
  register,
  type CallApproval,
  type RegisteredTool,
  type Tool,
  type ToolContext,
} from "../tools/types.ts";
export { BrowserSession } from "../browser/session.ts";

/** A credential target: the node and the CDP session that owns it. */
export interface ResolvedTarget {
  cdp: CDPSession;
  backendNodeId: number;
}

/**
 * A read_page ref to its node in the page session (F13). A stale ref is null, so fill_credential
 * answers an audited fill_failed instead of throwing. Refs exist only for main-frame-world
 * elements; out-of-process iframes never get one.
 */
export async function resolveVaultTarget(
  session: BrowserSession,
  ref: string,
): Promise<ResolvedTarget | null> {
  try {
    const { backendNodeId } = await resolveRef(session, ref);
    return { cdp: await session.cdp(), backendNodeId };
  } catch (error) {
    if (error instanceof StaleRef) return null;
    throw error;
  }
}
