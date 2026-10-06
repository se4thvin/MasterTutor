import { toOrigin } from "@mastertutor/contracts";
import type { CDPSession } from "playwright-core";
import { z } from "zod";

/**
 * All credential DOM work runs in the vault's own CDP isolated world: page scripts cannot see
 * the values, observe our calls, or patch the DOM prototypes we use (planning verification 2).
 */
const WORLD = "mastertutor-vault";
const OBJECT_GROUP = "mastertutor-vault";
const MAX_GROUP = 12;

export const TargetInfo = z.object({
  tag: z.string(),
  type: z.string(),
  autocomplete: z.array(z.string()),
  inputMode: z.string(),
  hints: z.string(),
  hasPasswordInScope: z.boolean(),
  visible: z.boolean(),
  editable: z.boolean(),
  maxLength: z.number(),
  origin: z.string(),
});
export type TargetInfo = z.infer<typeof TargetInfo>;

export interface TargetNode {
  readonly cdp: CDPSession;
  readonly objectId: string;
  readonly frameId: string;
  /** The document the node belongs to (CDP loaderId of its frame). */
  readonly loaderId: string;
}

export interface GroupBox {
  readonly node: TargetNode;
  readonly info: TargetInfo;
  readonly backendNodeId: number;
}

export type FillOutcome = "ok" | "navigated" | "length_mismatch" | "failed";

const INSPECT_FN = `function () {
  const e = this;
  const tag = e.localName;
  const scope = e.form || e.closest("form");
  const labels = e.labels ? Array.from(e.labels, (l) => l.textContent || "").join(" ") : "";
  const hints = [e.getAttribute("aria-label"), labels, e.getAttribute("placeholder"), e.getAttribute("name"), e.id]
    .filter(Boolean).join(" ").slice(0, 300).toLowerCase();
  const rect = e.getBoundingClientRect();
  const style = getComputedStyle(e);
  return {
    tag,
    type: tag === "input" ? e.type : "",
    autocomplete: (e.getAttribute("autocomplete") || "").toLowerCase().split(/\\s+/).filter(Boolean),
    inputMode: (e.getAttribute("inputmode") || "").toLowerCase(),
    hints,
    hasPasswordInScope: scope ? Array.from(scope.querySelectorAll("input")).some((x) => x.type === "password") : false,
    visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
    editable: !(e.disabled || e.readOnly),
    maxLength: tag === "input" ? e.maxLength : -1,
    origin: self.origin,
  };
}`;

const GROUP_FN = `function () {
  const isBox = (x) => x instanceof HTMLInputElement && x.maxLength === 1 && x.type !== "hidden" && !x.disabled;
  if (!isBox(this)) return [this];
  let scope = this.parentElement;
  for (let depth = 0; depth < 4 && scope; depth++, scope = scope.parentElement) {
    const boxes = Array.from(scope.querySelectorAll("input")).filter(isBox);
    if (boxes.length >= 2) return boxes.slice(boxes.indexOf(this), boxes.indexOf(this) + ${MAX_GROUP});
  }
  return [this];
}`;

/** The same events Playwright's fill() produces, so React, Vue, Ember and plain forms see the value. */
const SET_VALUE_FN = `function (value, forcePassword) {
  if (!this.isConnected) return false;
  if (forcePassword && this.type !== "password") this.type = "password";
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(this, value);
  this.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return this.value === value;
}`;

/** Show/hide-password controls next to the field: parent and grandparent only, by visible name (S4). */
const DISABLE_TOGGLES_FN = `function () {
  const scope = (this.parentElement && this.parentElement.parentElement) || this.parentElement;
  if (!scope) return 0;
  let disabled = 0;
  for (const b of scope.querySelectorAll("button, [role=button], input[type=checkbox]")) {
    const hint = [b.getAttribute("aria-label"), b.getAttribute("title"), b.textContent].join(" ");
    if (/\\b(show|reveal|hide|toggle)\\b/i.test(hint)) {
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
      b.style.pointerEvents = "none";
      disabled++;
    }
  }
  return disabled;
}`;

interface FrameTree {
  frame: { id: string; loaderId: string };
  childFrames?: FrameTree[];
}

function frames(tree: FrameTree): FrameTree["frame"][] {
  return [tree.frame, ...(tree.childFrames ?? []).flatMap(frames)];
}

async function isolatedContext(cdp: CDPSession, frameId: string): Promise<number> {
  const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
    frameId,
    worldName: WORLD,
    grantUniveralAccess: false,
  });
  return executionContextId;
}

/** Resolves a backend node in the vault world of whichever frame owns it (verification 3). */
export async function openTarget(
  cdp: CDPSession,
  backendNodeId: number,
): Promise<TargetNode | null> {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  for (const { id: frameId, loaderId } of frames(frameTree as FrameTree)) {
    const executionContextId = await isolatedContext(cdp, frameId);
    const resolved = await cdp
      .send("DOM.resolveNode", { backendNodeId, executionContextId, objectGroup: OBJECT_GROUP })
      .catch(() => null);
    const objectId = resolved?.object.objectId;
    if (objectId) return { cdp, objectId, frameId, loaderId };
  }
  return null;
}

async function callOn<T>(
  node: TargetNode,
  fn: string,
  args: readonly unknown[],
  schema: z.ZodType<T>,
): Promise<T> {
  const { result, exceptionDetails } = await node.cdp.send("Runtime.callFunctionOn", {
    objectId: node.objectId,
    functionDeclaration: fn,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
    objectGroup: OBJECT_GROUP,
  });
  if (exceptionDetails) throw new Error("vault DOM call failed");
  return schema.parse(result.value);
}

export async function describeGroup(target: TargetNode): Promise<GroupBox[]> {
  const { result } = await target.cdp.send("Runtime.callFunctionOn", {
    objectId: target.objectId,
    functionDeclaration: GROUP_FN,
    returnByValue: false,
    objectGroup: OBJECT_GROUP,
  });
  if (!result.objectId) return [];
  const { result: properties } = await target.cdp.send("Runtime.getProperties", {
    objectId: result.objectId,
    ownProperties: true,
  });
  const nodes = properties
    .filter((p) => /^\d+$/.test(p.name) && p.value?.objectId)
    .sort((a, b) => Number(a.name) - Number(b.name))
    .map((p) => ({
      cdp: target.cdp,
      objectId: p.value!.objectId!,
      frameId: target.frameId,
      loaderId: target.loaderId,
    }));
  return Promise.all(
    nodes.map(async (node) => {
      const info = await callOn(node, INSPECT_FN, [], TargetInfo);
      const { node: described } = await node.cdp.send("DOM.describeNode", {
        objectId: node.objectId,
      });
      return { node, info, backendNodeId: described.backendNodeId };
    }),
  );
}

async function clearBoxes(boxes: readonly GroupBox[]): Promise<void> {
  await Promise.all(
    boxes.map((box) => callOn(box.node, SET_VALUE_FN, ["", false], z.boolean()).catch(() => false)),
  );
}

/**
 * Fills the boxes in order. The write is bound to each element, so it can never land in a
 * document that replaced this one. Any navigation before the last box, or a cross-origin one at
 * any time, stops the fill (spec §12 mid-fill redirect). A same-origin navigation fired by the
 * last box is an auto-submit and counts as success (Review Focus 3).
 */
export async function fillGroup(
  group: readonly GroupBox[],
  text: string,
  options: { forcePassword: boolean; pinnedOrigin: string },
): Promise<FillOutcome> {
  const first = group[0];
  if (!first) return "failed";
  const parts = group.length === 1 ? [text] : Array.from(text);
  if (parts.length !== group.length) return "length_mismatch";
  const { cdp } = first.node;
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const watched = new Set([frameTree.frame.id, first.node.frameId]);
  const last = parts.length - 1;
  let index = 0;
  let leftPage = false;
  const onRequested = (event: { frameId: string; url: string }) => {
    if (
      watched.has(event.frameId) &&
      (toOrigin(event.url) !== options.pinnedOrigin || index < last)
    )
      leftPage = true;
  };
  const onLoading = (event: { frameId: string }) => {
    if (watched.has(event.frameId) && index < last) leftPage = true;
  };
  await cdp.send("Page.enable");
  cdp.on("Page.frameRequestedNavigation", onRequested);
  cdp.on("Page.frameStartedLoading", onLoading);
  try {
    for (; index < parts.length && !leftPage; index++) {
      const box = group[index];
      const part = parts[index];
      if (!box || part === undefined) return "failed";
      const ok = await callOn(
        box.node,
        SET_VALUE_FN,
        [part, options.forcePassword],
        z.boolean(),
      ).catch(() => false);
      if (!ok && !leftPage) return "failed";
    }
    if (leftPage) {
      await clearBoxes(group.slice(0, index + 1));
      return "navigated";
    }
    return "ok";
  } finally {
    cdp.off("Page.frameRequestedNavigation", onRequested);
    cdp.off("Page.frameStartedLoading", onLoading);
  }
}

export function disableRevealToggles(node: TargetNode): Promise<number> {
  return callOn(node, DISABLE_TOGGLES_FN, [], z.number());
}

export async function releaseTargets(cdp: CDPSession): Promise<void> {
  await cdp
    .send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP })
    .catch(() => undefined);
}

/** Runs `fn` with `args` in the vault world of the main frame (no element needed). */
export async function callInMainFrame<T>(
  cdp: CDPSession,
  fn: string,
  args: readonly unknown[],
  schema: z.ZodType<T>,
): Promise<T> {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const executionContextId = await isolatedContext(cdp, frameTree.frame.id);
  const { result, exceptionDetails } = await cdp.send("Runtime.callFunctionOn", {
    executionContextId,
    functionDeclaration: fn,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error("vault main-frame call failed");
  return schema.parse(result.value);
}
