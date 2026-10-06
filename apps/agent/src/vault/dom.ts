import { toOrigin } from "@mastertutor/contracts";
import type { CDPSession } from "playwright-core";
import { z } from "zod";
import { IsolatedWorlds } from "./runtime.ts";

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
  /** Origins this field's form submits to (its action, and any submit button's formaction). */
  formOrigins: z.array(z.string()),
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
  // Shown to a person: laid out, not transparent or hidden (here or up the tree), not pushed off
  // the page's top or left edge, and not clipped away (M3).
  const shown = (x) => {
    const rect = x.getBoundingClientRect();
    const style = getComputedStyle(x);
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (!x.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    if (rect.right + scrollX <= 0 || rect.bottom + scrollY <= 0) return false;
    return style.clipPath === "none" && (style.clip === "auto" || style.clip === "");
  };
  // Where submitting this form sends it: the form's action and every submitter's formaction
  // (M4), read through the prototype getters so a field named "action" or "elements" cannot
  // shadow them. The form's own elements list includes controls outside it linked by form=
  // (review I1). A non-network scheme (javascript:, about:) has origin "null": off-origin.
  const getter = (proto, name) => Object.getOwnPropertyDescriptor(proto, name).get;
  const actionOf = getter(HTMLFormElement.prototype, "action");
  const elementsOf = getter(HTMLFormElement.prototype, "elements");
  const buttonType = getter(HTMLButtonElement.prototype, "type");
  const inputType = getter(HTMLInputElement.prototype, "type");
  const hasAttr = (x, name) => Element.prototype.hasAttribute.call(x, name);
  // elements leaves out image buttons (HTML spec): those submitting this form, inside it or
  // linked by form=, are found through their own form getter (final review I1).
  const formOf = getter(HTMLInputElement.prototype, "form");
  const imageSubmitters = scope instanceof HTMLFormElement
    ? Array.from(Document.prototype.querySelectorAll.call(e.ownerDocument, "input"))
        .filter((x) => inputType.call(x) === "image" && formOf.call(x) === scope)
    : [];
  const controls = scope instanceof HTMLFormElement
    ? [...Array.from(elementsOf.call(scope)), ...imageSubmitters]
    : [];
  const isSubmitter = (x) =>
    (x instanceof HTMLButtonElement && buttonType.call(x) === "submit") ||
    (x instanceof HTMLInputElement && ["submit", "image"].includes(inputType.call(x)));
  const formActionOf = (b) =>
    getter(b instanceof HTMLButtonElement ? HTMLButtonElement.prototype : HTMLInputElement.prototype, "formAction").call(b);
  const submits = scope instanceof HTMLFormElement
    ? [actionOf.call(scope), ...controls.filter((x) => isSubmitter(x) && hasAttr(x, "formaction")).map(formActionOf)]
    : [];
  const formOrigins = Array.from(new Set(submits.map((url) => { try { return new URL(url, location.href).origin; } catch { return "invalid"; } })));
  return {
    tag,
    type: tag === "input" ? e.type : "",
    autocomplete: (e.getAttribute("autocomplete") || "").toLowerCase().split(/\\s+/).filter(Boolean),
    inputMode: (e.getAttribute("inputmode") || "").toLowerCase(),
    hints,
    hasPasswordInScope: controls.some((x) => x instanceof HTMLInputElement && inputType.call(x) === "password" && shown(x)),
    visible: shown(e),
    editable: !(e.disabled || e.readOnly),
    maxLength: tag === "input" ? e.maxLength : -1,
    origin: self.origin,
    formOrigins,
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

/**
 * Show/hide-password controls next to the field: parent and grandparent only, by visible name, and
 * only those that belong to this field (S4, M6).
 */
const DISABLE_TOGGLES_FN = `function () {
  const scope = (this.parentElement && this.parentElement.parentElement) || this.parentElement;
  if (!scope) return 0;
  let disabled = 0;
  for (const b of scope.querySelectorAll("button, [role=button], input[type=checkbox]")) {
    const hint = [b.getAttribute("aria-label"), b.getAttribute("title"), b.textContent].join(" ");
    // A reveal control for this field only (M6): it names a password, points at the field, or
    // sits right beside it. An unrelated "Show details" nearby stays clickable.
    const forField =
      /pass|pw\\b/i.test(hint) ||
      (this.id !== "" && b.getAttribute("aria-controls") === this.id) ||
      b.parentElement === this.parentElement;
    if (forField && /\\b(show|reveal|hide|toggle)\\b/i.test(hint)) {
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

/** The vault's world per CDP session, reusing B1's per-frame context cache (M2). */
const vaultWorlds = new WeakMap<CDPSession, IsolatedWorlds>();
function worldsOf(cdp: CDPSession): IsolatedWorlds {
  let worlds = vaultWorlds.get(cdp);
  if (!worlds) {
    worlds = new IsolatedWorlds(cdp, WORLD);
    vaultWorlds.set(cdp, worlds);
  }
  return worlds;
}

/** True only in the world of the node's own document (I1: a parent may resolve a child's node). */
const OWN_DOCUMENT_FN = `function () { return this.ownerDocument === document; }`;

/**
 * Resolves a backend node in the vault world of the frame whose document owns it. A same-origin
 * or document.domain-relaxed parent can resolve a child's node too, so a resolution counts only
 * where the node's ownerDocument is that world's document (I1). A frame that cannot be entered
 * (detaching) is skipped (M2); none found is null.
 */
export async function openTarget(
  cdp: CDPSession,
  backendNodeId: number,
): Promise<TargetNode | null> {
  const worlds = worldsOf(cdp);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  for (const { id: frameId, loaderId } of frames(frameTree as FrameTree)) {
    const objectId = await worlds
      .inContext(
        frameId,
        async (executionContextId) => {
          const resolved = await cdp.send("DOM.resolveNode", {
            backendNodeId,
            executionContextId,
            objectGroup: OBJECT_GROUP,
          });
          return resolved.object.objectId ?? null;
        },
        loaderId,
      )
      .catch(() => null);
    if (!objectId) continue;
    const own = await cdp
      .send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: OWN_DOCUMENT_FN,
        returnByValue: true,
      })
      .then((result) => result.result.value === true)
      .catch(() => false);
    if (own) return { cdp, objectId, frameId, loaderId };
    await cdp.send("Runtime.releaseObject", { objectId }).catch(() => undefined);
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

/** One part per box (split boxes take a character each), or null when the value does not fit. */
export function partsFor(group: readonly GroupBox[], text: string): string[] | null {
  const parts = group.length === 1 ? [text] : Array.from(text);
  return parts.length === group.length ? parts : null;
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
  const parts = partsFor(group, text);
  if (parts === null) return "length_mismatch";
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
      if (!ok && !leftPage) {
        // The page refused or rewrote the value (I2): clear everything written so far.
        await clearBoxes(group.slice(0, index + 1));
        return "failed";
      }
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
