/**
 * The only place the vault imports B1's runtime (CLAUDE.md principle 5). Every B1 type and
 * function the vault uses is named here, so a B1 rename touches one file.
 */
import { FOCUSED_TARGET } from "@mastertutor/contracts";
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
  type ApprovalContext,
  type CallApproval,
  type RegisteredTool,
  type Tool,
  type ToolContext,
} from "../tools/types.ts";
export { BrowserSession } from "../browser/session.ts";
export { IsolatedWorlds } from "../browser/isolated-world.ts";

/** A credential target: the node and the CDP session that owns it. */
export interface ResolvedTarget {
  cdp: CDPSession;
  backendNodeId: number;
}

/**
 * The main frame's focused element, through open shadow roots. Run in our isolated world, so a page
 * script cannot fake it. A focused frame element, the body or nothing is null: a frame is never
 * entered (main frame only), and the caller's §9 checks run on whatever this returns.
 */
const FOCUSED_ELEMENT = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  if (el.tagName === "IFRAME" || el.tagName === "FRAME") return null;
  return el;
})()`;

async function resolveFocused(session: BrowserSession): Promise<ResolvedTarget | null> {
  const objectId = await (await session.worlds()).evaluateHandle(FOCUSED_ELEMENT);
  if (!objectId) return null;
  const cdp = await session.cdp();
  const { node } = await cdp.send("DOM.describeNode", { objectId });
  return { cdp, backendNodeId: node.backendNodeId };
}

/**
 * A credential target to its node in the page session (F13). It is either a read_page ref or
 * "focused" (Phase 10); both fillApproval and fillCredential come through here. A stale ref or an
 * unfocused page is null, so fill_credential answers with an audited refusal instead of throwing.
 * Refs exist only for main-frame-world elements; out-of-process iframes never get one.
 */
export async function resolveVaultTarget(
  session: BrowserSession,
  target: string,
): Promise<ResolvedTarget | null> {
  if (target === FOCUSED_TARGET) return resolveFocused(session);
  try {
    const { backendNodeId } = await resolveRef(session, target);
    return { cdp: await session.cdp(), backendNodeId };
  } catch (error) {
    if (error instanceof StaleRef) return null;
    throw error;
  }
}
