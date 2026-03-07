import { createHash } from "node:crypto";
import { pageExpression, type IsolatedWorlds } from "./isolated-world.ts";
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
      if (["IFRAME", "FRAME", "OBJECT", "EMBED", "FENCEDFRAME", "PORTAL"].includes(hit.tagName)) {
        try {
          const doc: Document | null = (hit as HTMLIFrameElement).contentDocument ?? null;
          // Only a plain frame maps by offset; any other stops here for the CDP mapping (N5).
          if (doc && h.frameIsPlain(hit)) {
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
  if (["IFRAME", "FRAME", "OBJECT", "EMBED", "FENCEDFRAME", "PORTAL"].includes(hit.tagName)) {
    let readable: boolean;
    try {
      readable = ((hit as HTMLIFrameElement).contentDocument ?? null) !== null;
    } catch {
      readable = false;
    }
    if (!readable || !h.frameIsPlain(hit))
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
export function frameAtPointScript(arg: { x: number; y: number }, h: PageHelpers): Element | null {
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
    if (!["IFRAME", "FRAME", "OBJECT", "EMBED", "FENCEDFRAME", "PORTAL"].includes(hit.tagName))
      break;
    let doc: Document | null;
    try {
      doc = (hit as HTMLIFrameElement).contentDocument ?? null;
    } catch {
      doc = null;
    }
    if (!doc || !h.frameIsPlain(hit)) return hit;
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
    if (!["IFRAME", "FRAME", "OBJECT", "EMBED", "FENCEDFRAME", "PORTAL"].includes(active.tagName))
      return null;
    let doc: Document | null;
    try {
      doc = (active as HTMLIFrameElement).contentDocument ?? null;
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
    if (["IFRAME", "FRAME", "OBJECT", "EMBED", "FENCEDFRAME", "PORTAL"].includes(active.tagName)) {
      let doc: Document | null;
      try {
        doc = (active as HTMLIFrameElement).contentDocument ?? null;
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

export function scrollStateScript(arg: { x: number; y: number }, h: PageHelpers): ScrollState {
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
    if (["IFRAME", "FRAME", "OBJECT", "EMBED", "FENCEDFRAME", "PORTAL"].includes(hit.tagName)) {
      try {
        const doc: Document | null = (hit as HTMLIFrameElement).contentDocument ?? null;
        if (doc && h.frameIsPlain(hit)) {
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
): Promise<HitTest & { world: { worlds: IsolatedWorlds; frameId: string | undefined } }> {
  const topUrl = session.page.url();
  let worlds = await session.worlds();
  let frameId: string | undefined;
  let base = point; // the point in the coordinates of the current CDP session's root frame
  let local = point; // the point in the coordinates of the current frame
  let chain = "";
  let ownSession: string | null = null; // the cached out-of-process frame we are inside, if any
  const opaque = () => {
    if (ownSession) void session.forgetFrame(ownSession);
    return { target: opaqueTarget(chain, topUrl), snap: null, world: { worlds, frameId } };
  };
  for (let depth = 0; ; depth++) {
    let scan: FrameScan;
    try {
      scan = local
        ? await worlds.evaluate(hitTestScript, { ...local, radius: 12 }, frameId)
        : await worlds.evaluate(focusScript, null, frameId);
    } catch (error) {
      // The top page itself failing is a real error; a frame failing is uninspectable (N3).
      if (depth === 0) throw error;
      return opaque();
    }
    if (depth > 0) chain += `@${scan.origin}>`;
    if (scan.opaqueFrame === null) {
      // Inside a frame, nothing at the mapped point means the mapping cannot be trusted (N1).
      if (depth > 0 && local && scan.target === null) return opaque();
      const target = scan.target && {
        ...scan.target,
        path: `${chain}${scan.target.path}`,
        context: digest(chain, scan.target.context, topUrl),
      };
      // A snap point is only meaningful in the top frame's coordinates.
      return { target, snap: depth === 0 ? scan.snap : null, world: { worlds, frameId } };
    }
    chain += scan.opaqueFrame;
    if (depth >= MAX_FRAME_DEPTH) return opaque();
    try {
      const expression = local
        ? pageExpression(frameAtPointScript, local)
        : pageExpression(focusedFrameScript, null);
      const objectId = await worlds.evaluateHandle(expression, frameId);
      if (!objectId) throw new Error("frame element gone");
      const { node } = await worlds.cdp.send("DOM.describeNode", { objectId });
      const child = node.frameId;
      if (!child) throw new Error("no content frame");
      let inner = local;
      if (base) {
        inner = await intoFrame(worlds, objectId, base);
        if (inner === null) throw new Error("the point cannot be mapped into the frame");
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
        ownSession = child;
        frameId = undefined;
        base = inner;
        local = inner;
      }
    } catch {
      return opaque();
    }
  }
}

/**
 * Maps a point (in the session root's coordinates) into the frame's own document, through its real
 * geometry (N1): the content quad from DOM.getBoxModel is post-transform (border, padding, CSS
 * scale and ancestor frames included), and the untransformed content size gives the scale. A
 * rotated or skewed frame, or a point outside its content, returns null (the caller fails closed).
 */
async function intoFrame(
  worlds: IsolatedWorlds,
  objectId: string,
  point: { x: number; y: number },
): Promise<{ x: number; y: number } | null> {
  const { model } = await worlds.cdp.send("DOM.getBoxModel", { objectId });
  const [x0, y0, x1, y1, x2, y2, x3, y3] = model.content as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const aligned =
    Math.abs(y0 - y1) < 0.5 &&
    Math.abs(x1 - x2) < 0.5 &&
    Math.abs(y2 - y3) < 0.5 &&
    Math.abs(x3 - x0) < 0.5;
  const quadWidth = x1 - x0;
  const quadHeight = y3 - y0;
  if (!aligned || quadWidth <= 0 || quadHeight <= 0) return null;
  const { result } = await worlds.cdp.send("Runtime.callFunctionOn", {
    objectId,
    returnByValue: true,
    functionDeclaration: `function () {
      const style = getComputedStyle(this);
      const px = (value) => parseFloat(value) || 0;
      return [
        this.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
        this.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
      ];
    }`,
  });
  const [width, height] = result.value as [number, number];
  if (!(width > 0 && height > 0)) return null;
  const x = ((point.x - x0) * width) / quadWidth;
  const y = ((point.y - y0) * height) / quadHeight;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return { x, y };
}

export async function hitTest(
  session: BrowserSession,
  point: { x: number; y: number },
): Promise<HitTest> {
  const { target, snap } = await resolve(session, point);
  return { target, snap };
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
/**
 * While armed, keystrokes and text insertions are cancelled inside the page (isolated world
 * listeners, capture phase): in the document that had focus when typing began ("home"), only those
 * aimed at a secret field; in every other document, all of them, so text a page script redirects
 * mid-typing into another document (a frame's password field) is never delivered. Armed only
 * around the executor's own typing, so credential filling (B3) is unaffected.
 */
export function armSecretBlockScript(arg: { home: boolean }, h: PageHelpers): void {
  const slot = globalThis as unknown as {
    __mtSecretBlock?: BlockHandle;
    __mtStart?: Element | null;
  };
  slot.__mtSecretBlock?.remove();
  slot.__mtStart = document.activeElement;
  const guard = (event: Event) => {
    const target = event.composedPath()[0];
    if (!arg.home || (target instanceof Element && h.isSecretField(target))) {
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

const FRAME_OWNERS = ["IFRAME", "FRAME", "OBJECT", "EMBED", "FENCEDFRAME", "PORTAL"];

/** Whether this document holds the focused element itself (not just a frame that contains it). */
export function focusProbeScript(owners: string[]): { holds: boolean; focused: boolean } {
  const active = document.activeElement;
  return { holds: !!active && !owners.includes(active.tagName), focused: document.hasFocus() };
}

/** In the home document: has focus left it (into a frame, or out to another document)? */
export function focusMovedScript(owners: string[]): boolean {
  const slot = globalThis as unknown as { __mtStart?: Element | null };
  const active = document.activeElement;
  if (active && owners.includes(active.tagName)) return true;
  const idle = !active || active === document.body || active === document.documentElement;
  return idle && slot.__mtStart !== active;
}

export function disarmSecretBlockScript(): void {
  const slot = globalThis as unknown as { __mtSecretBlock?: BlockHandle };
  slot.__mtSecretBlock?.remove();
  delete slot.__mtSecretBlock;
}

/**
 * Arms the block in every document of the page (top, in-process and out-of-process frames). The
 * home is the document holding the focused element (the top document if none claims it).
 * `focusMoved()` reports whether a page script moved focus into another document since.
 */
export async function armSecretBlock(session: BrowserSession): Promise<{
  focusMoved: () => Promise<boolean>;
  disarm: () => Promise<void>;
}> {
  const documents = await session.documents();
  const probes = await Promise.all(
    documents.map((doc) =>
      doc.worlds.evaluate(focusProbeScript, FRAME_OWNERS, doc.frameId).catch(() => null),
    ),
  );
  let homeIndex = probes.findIndex((probe) => probe?.holds && probe.focused);
  if (homeIndex < 0) homeIndex = 0;
  const home = documents[homeIndex];
  await Promise.all(
    documents.map((doc, index) =>
      doc.worlds
        .evaluate(armSecretBlockScript, { home: index === homeIndex }, doc.frameId)
        .catch(() => undefined),
    ),
  );
  return {
    focusMoved: async () =>
      home
        ? home.worlds.evaluate(focusMovedScript, FRAME_OWNERS, home.frameId).catch(() => true)
        : false,
    disarm: async () => {
      await Promise.all(
        documents.map((doc) =>
          doc.worlds.evaluate(disarmSecretBlockScript, null, doc.frameId).catch(() => undefined),
        ),
      );
    },
  };
}
