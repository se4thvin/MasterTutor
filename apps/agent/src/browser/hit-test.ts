import { createHash } from "node:crypto";
import { pageExpression } from "./isolated-world.ts";
import type { PageHelpers, TargetDescription } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

export interface HitTest {
  target: TargetDescription | null;
  /** A better click point when the point missed every interactive element but one is within the radius. */
  snap: { x: number; y: number } | null;
}

/** One frame's view: either a target, or "the point/focus is inside a frame I cannot read". */
export interface FrameScan extends HitTest {
  origin: string;
  /** The path of the cross-origin frame element the scan stopped at; null when it did not stop. */
  opaqueFrame: string | null;
}

export interface ScrollState {
  /** Every scrollable ancestor of the point, innermost first, with its scroll offsets. */
  chain: Array<{ key: string; top: number; left: number }>;
}

export function hitTestScript(
  arg: { x: number; y: number; radius: number },
  h: PageHelpers,
): FrameScan {
  const SELECTOR =
    "a[href], button, input, select, textarea, summary, label, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [onclick]";
  const deep = (x: number, y: number): Element | null => {
    let root: Document | ShadowRoot = document;
    let ox = 0;
    let oy = 0;
    let found: Element | null = null;
    for (let depth = 0; depth < 10; depth++) {
      const hit: Element | null = root.elementFromPoint(x - ox, y - oy);
      if (!hit || hit === found) break;
      found = hit;
      if (hit.shadowRoot) {
        root = hit.shadowRoot;
        continue;
      }
      if (hit.tagName === "IFRAME" || hit.tagName === "FRAME") {
        try {
          const doc: Document | null = (hit as HTMLIFrameElement).contentDocument;
          if (doc) {
            const r = hit.getBoundingClientRect();
            ox += r.left + (hit as HTMLElement).clientLeft;
            oy += r.top + (hit as HTMLElement).clientTop;
            root = doc;
            continue;
          }
        } catch {
          // Cross-origin frame.
        }
      }
      break;
    }
    return found;
  };
  const origin = location.origin;
  const hit = deep(arg.x, arg.y);
  if (!hit) return { target: null, snap: null, origin, opaqueFrame: null };
  // A cross-origin frame the page script cannot read: the agent looks inside it over CDP (R29-1).
  if (hit.tagName === "IFRAME" || hit.tagName === "FRAME") {
    let readable: boolean;
    try {
      readable = (hit as HTMLIFrameElement).contentDocument !== null;
    } catch {
      readable = false;
    }
    if (!readable)
      return { target: null, snap: null, origin, opaqueFrame: h.describeTarget(hit).path };
  }
  const target = h.describeTarget(hit);
  if (target.interactive) return { target, snap: null, origin, opaqueFrame: null };
  // cursor:pointer elements count as interactive (matching read_page), where the pointer starts.
  const candidates = [...document.querySelectorAll("*")].filter((el) => {
    if (el.matches(SELECTOR)) return true;
    if (getComputedStyle(el).cursor !== "pointer" || el.closest(SELECTOR)) return false;
    const parent = el.parentElement;
    return !parent || getComputedStyle(parent).cursor !== "pointer";
  });
  const near = candidates.filter((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      arg.x >= r.left - arg.radius &&
      arg.x <= r.right + arg.radius &&
      arg.y >= r.top - arg.radius &&
      arg.y <= r.bottom + arg.radius
    );
  });
  if (near.length !== 1) return { target, snap: null, origin, opaqueFrame: null };
  const only = near[0]!;
  const r = only.getBoundingClientRect();
  const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const check = deep(center.x, center.y);
  if (!check || (check !== only && !only.contains(check)))
    return { target, snap: null, origin, opaqueFrame: null };
  return { target: h.describeTarget(only), snap: center, origin, opaqueFrame: null };
}

/** The cross-origin frame element at the point (same walk as hitTestScript), for a CDP handle. */
export function frameAtPointScript(arg: { x: number; y: number }): Element | null {
  let root: Document | ShadowRoot = document;
  let ox = 0;
  let oy = 0;
  let found: Element | null = null;
  for (let depth = 0; depth < 10; depth++) {
    const hit: Element | null = root.elementFromPoint(arg.x - ox, arg.y - oy);
    if (!hit || hit === found) break;
    found = hit;
    if (hit.shadowRoot) {
      root = hit.shadowRoot;
      continue;
    }
    if (hit.tagName !== "IFRAME" && hit.tagName !== "FRAME") break;
    let doc: Document | null;
    try {
      doc = (hit as HTMLIFrameElement).contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) return hit;
    const r = hit.getBoundingClientRect();
    ox += r.left + (hit as HTMLElement).clientLeft;
    oy += r.top + (hit as HTMLElement).clientTop;
    root = doc;
  }
  return null;
}

/** The focused cross-origin frame element (same walk as focusScript), for a CDP handle. */
export function focusedFrameScript(): Element | null {
  let active: Element | null = document.activeElement;
  for (let depth = 0; depth < 10 && active; depth++) {
    if (active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
      continue;
    }
    if (active.tagName !== "IFRAME" && active.tagName !== "FRAME") return null;
    let doc: Document | null;
    try {
      doc = (active as HTMLIFrameElement).contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) return active;
    active = doc.activeElement;
  }
  return null;
}

export function focusScript(_arg: null, h: PageHelpers): FrameScan {
  let active: Element | null = document.activeElement;
  for (let depth = 0; depth < 10 && active; depth++) {
    if (active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
      continue;
    }
    if (active.tagName === "IFRAME" || active.tagName === "FRAME") {
      let doc: Document | null;
      try {
        doc = (active as HTMLIFrameElement).contentDocument;
      } catch {
        doc = null;
      }
      // Focus inside a cross-origin frame: the agent looks inside it over CDP (R29-1).
      if (!doc)
        return {
          target: null,
          snap: null,
          origin: location.origin,
          opaqueFrame: h.describeTarget(active).path,
        };
      const inner = doc.activeElement;
      if (inner && inner.tagName !== "BODY") {
        active = inner;
        continue;
      }
    }
    break;
  }
  const none = { target: null, snap: null, origin: location.origin, opaqueFrame: null };
  if (!active || active === document.body || active === document.documentElement) return none;
  return { ...none, target: h.describeTarget(active) };
}

export function scrollStateScript(arg: { x: number; y: number }): ScrollState {
  // Deepest element at the point through open shadow roots and same-origin frames.
  let root: Document | ShadowRoot = document;
  let ox = 0;
  let oy = 0;
  let el: Element | null = null;
  for (let depth = 0; depth < 10; depth++) {
    const hit: Element | null = root.elementFromPoint(arg.x - ox, arg.y - oy);
    if (!hit || hit === el) break;
    el = hit;
    if (hit.shadowRoot) {
      root = hit.shadowRoot;
      continue;
    }
    if (hit.tagName === "IFRAME" || hit.tagName === "FRAME") {
      try {
        const doc: Document | null = (hit as HTMLIFrameElement).contentDocument;
        if (doc) {
          const r = hit.getBoundingClientRect();
          ox += r.left + (hit as HTMLElement).clientLeft;
          oy += r.top + (hit as HTMLElement).clientTop;
          root = doc;
          continue;
        }
      } catch {
        // Cross-origin frame.
      }
    }
    break;
  }
  // Every scrollable ancestor (shadow hosts and frame elements included) plus each frame's
  // scrolling element, so scroll chaining counts as an effect.
  const chain: ScrollState["chain"] = [];
  const docs = new Set<Document>();
  let index = 0;
  while (el) {
    const doc: Document = el.ownerDocument;
    if (el === doc.documentElement || el === doc.body) {
      if (!docs.has(doc)) {
        docs.add(doc);
        const scroller = doc.scrollingElement ?? doc.documentElement;
        chain.push({ key: `doc${index}`, top: scroller.scrollTop, left: scroller.scrollLeft });
      }
    } else {
      const style = (doc.defaultView ?? window).getComputedStyle(el);
      const scrollable =
        (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) ||
        (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth);
      if (scrollable) {
        chain.push({
          key: `${el.tagName}#${el.id}.${String(el.className)}`,
          top: el.scrollTop,
          left: el.scrollLeft,
        });
      }
    }
    index += 1;
    let next: Element | null = el.parentElement;
    if (!next) {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) next = rootNode.host;
    }
    if (!next) {
      try {
        next = doc.defaultView?.frameElement ?? null;
      } catch {
        next = null;
      }
    }
    el = next;
  }
  if (chain.length === 0) {
    const scroller = document.scrollingElement ?? document.documentElement;
    chain.push({ key: "doc0", top: scroller.scrollTop, left: scroller.scrollLeft });
  }
  return { chain };
}

const MAX_FRAME_DEPTH = 4;
export const OPAQUE_FRAME_LABEL = "Embedded page that could not be inspected";

/** The record context leaves the browser module only as a digest (R29-3). */
function digest(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function opaqueTarget(path: string, topUrl: string): TargetDescription {
  return {
    label: OPAQUE_FRAME_LABEL,
    tag: "iframe",
    path: `${path}>opaque`,
    context: digest(path, "opaque", topUrl),
    isFormSubmit: false,
    formKind: null,
    isSecretField: false,
    editable: false,
    interactive: true,
    opaqueFrame: true,
  };
}

/**
 * Classifies the element at a point, or with focus, through cross-origin frames (R29-1): the page
 * script stops at a frame it cannot read, and the same script runs again inside that frame over
 * CDP (the parent session with the frame id when in process, the frame's own session when out of
 * process). The path carries the frame chain with origins; any failure yields an opaque target
 * that needs approval (fail closed). Same-origin pages pay nothing extra.
 */
async function resolve(
  session: BrowserSession,
  point: { x: number; y: number } | null,
): Promise<HitTest> {
  const topUrl = session.page.url();
  let worlds = await session.worlds();
  let frameId: string | undefined;
  let base = point; // the point in the coordinates of the current CDP session's root frame
  let local = point; // the point in the coordinates of the current frame
  let chain = "";
  for (let depth = 0; ; depth++) {
    const scan: FrameScan = local
      ? await worlds.evaluate(hitTestScript, { ...local, radius: 12 }, frameId)
      : await worlds.evaluate(focusScript, null, frameId);
    if (depth > 0) chain += `@${scan.origin}>`;
    if (scan.opaqueFrame === null) {
      const target = scan.target && {
        ...scan.target,
        path: `${chain}${scan.target.path}`,
        context: digest(chain, scan.target.context, topUrl),
      };
      // A snap point is only meaningful in the top frame's coordinates.
      return { target, snap: depth === 0 ? scan.snap : null };
    }
    chain += scan.opaqueFrame;
    if (depth >= MAX_FRAME_DEPTH) return { target: opaqueTarget(chain, topUrl), snap: null };
    let child: string | undefined;
    try {
      const expression = local
        ? pageExpression(frameAtPointScript, local)
        : pageExpression(focusedFrameScript, null);
      const objectId = await worlds.evaluateHandle(expression, frameId);
      if (!objectId) throw new Error("frame element gone");
      const { node } = await worlds.cdp.send("DOM.describeNode", { objectId });
      child = node.frameId;
      if (!child) throw new Error("no content frame");
      let inner = local;
      if (base) {
        const { model } = await worlds.cdp.send("DOM.getBoxModel", { objectId });
        inner = { x: base.x - model.content[0]!, y: base.y - model.content[1]! };
      }
      const inProcess = await worlds
        .evaluate(() => true, null, child)
        .then(() => true)
        .catch(() => false);
      if (inProcess) {
        frameId = child;
        local = inner;
      } else {
        const own = await session.frameWorlds(child);
        if (!own) throw new Error("no session for the frame");
        worlds = own;
        frameId = undefined;
        base = inner;
        local = inner;
      }
    } catch {
      if (child) session.forgetFrame(child);
      return { target: opaqueTarget(chain, topUrl), snap: null };
    }
  }
}

export function hitTest(
  session: BrowserSession,
  point: { x: number; y: number },
): Promise<HitTest> {
  return resolve(session, point);
}

export async function focusTarget(session: BrowserSession): Promise<TargetDescription | null> {
  return (await resolve(session, null)).target;
}

export async function scrollState(
  session: BrowserSession,
  point: { x: number; y: number },
): Promise<ScrollState | null> {
  return (await session.worlds()).evaluate(scrollStateScript, point).catch(() => null);
}

type BlockHandle = { remove(): void };

/**
 * While armed, printable keystrokes and text insertions aimed at a secret field are cancelled
 * inside the page (isolated world listeners, capture phase), so focus that moves mid-typing
 * (auto-advance, Tab) can never deliver model-typed text to a password, OTP or PIN input.
 * Armed only around the executor's own typing, so credential filling (B3) is unaffected.
 */
export function armSecretBlockScript(_arg: null, h: PageHelpers): void {
  const slot = globalThis as unknown as { __mtSecretBlock?: BlockHandle };
  slot.__mtSecretBlock?.remove();
  const guard = (event: Event) => {
    const target = event.composedPath()[0];
    if (target instanceof Element && h.isSecretField(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onKey = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key.length === 1 && !key.ctrlKey && !key.metaKey) guard(event);
  };
  const onInput = (event: Event) => {
    if ((event as InputEvent).inputType.startsWith("insert")) guard(event);
  };
  addEventListener("keydown", onKey, true);
  addEventListener("keypress", onKey, true);
  addEventListener("beforeinput", onInput, true);
  slot.__mtSecretBlock = {
    remove() {
      removeEventListener("keydown", onKey, true);
      removeEventListener("keypress", onKey, true);
      removeEventListener("beforeinput", onInput, true);
    },
  };
}

export function disarmSecretBlockScript(): void {
  const slot = globalThis as unknown as { __mtSecretBlock?: BlockHandle };
  slot.__mtSecretBlock?.remove();
  delete slot.__mtSecretBlock;
}

export async function armSecretBlock(session: BrowserSession): Promise<void> {
  await (await session.worlds()).evaluate(armSecretBlockScript, null);
}

export async function disarmSecretBlock(session: BrowserSession): Promise<void> {
  await (await session.worlds()).evaluate(disarmSecretBlockScript, null).catch(() => undefined);
}
