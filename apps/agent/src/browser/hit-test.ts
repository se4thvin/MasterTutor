import { createHash, randomUUID } from "node:crypto";
import type { IsolatedWorlds } from "./isolated-world.ts";
import { FRAME_OWNERS, type PageHelpers, type TargetDescription } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

export interface HitTest {
  target: TargetDescription | null;
  /** A better click point when the point missed every interactive element but one is within the radius. */
  snap: { x: number; y: number } | null;
}

export interface ScrollState {
  /** Every scrollable ancestor of the point and each document's scroller, with scroll offsets. */
  chain: Array<{ key: string; top: number; left: number }>;
}

/** One document's view of a point, or of focus. */
interface Scan {
  origin: string;
  /** The document's scroll offset: CDP hit tests take document coordinates. */
  scroll: { x: number; y: number };
  /** The walk stopped at a frame owner (target describes it); its document is scanned next. */
  owner: boolean;
  target: TargetDescription | null;
  snap: { x: number; y: number } | null;
  chain: ScrollState["chain"];
}

/**
 * The element at a point (in this document's viewport) or with focus, through open shadow roots.
 * A frame owner ends the walk: the agent maps into the frame over CDP, never by page arithmetic.
 * The element found is kept under `key` for the CDP steps that follow.
 */
export function scanScript(
  arg: {
    point: { x: number; y: number } | null;
    key: string;
    owners: string[];
    snap: boolean;
    scroll: boolean;
  },
  h: PageHelpers,
): Scan {
  const SELECTOR =
    "a[href], button, input, select, textarea, summary, label, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [onclick]";
  const isOwner = (el: Element) => arg.owners.includes(el.tagName);
  const at = (x: number, y: number): Element | null => {
    let root: Document | ShadowRoot = document;
    let found: Element | null = null;
    for (let depth = 0; depth < 32; depth++) {
      const hit: Element | null = root.elementFromPoint(x, y);
      if (!hit || hit === found) break;
      found = hit;
      if (!hit.shadowRoot || isOwner(hit)) break;
      root = hit.shadowRoot;
    }
    return found;
  };
  let el: Element | null;
  if (arg.point) el = at(arg.point.x, arg.point.y);
  else {
    el = document.activeElement;
    while (el && !isOwner(el) && el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    if (el === document.body || el === document.documentElement) el = null;
  }
  const keep = (found: Element) => {
    (globalThis as unknown as { __mtFound?: unknown }).__mtFound = { key: arg.key, el: found };
  };
  // Scroll chaining counts as an effect: every scrollable ancestor, then the document's scroller.
  const chain: ScrollState["chain"] = [];
  if (arg.scroll) {
    for (let node: Element | null = el; node;) {
      const style = getComputedStyle(node);
      const scrollable =
        node !== document.documentElement &&
        node !== document.body &&
        ((/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) ||
          (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth));
      if (scrollable)
        chain.push({
          key: `${node.tagName}#${node.id}.${String(node.className)}`,
          top: node.scrollTop,
          left: node.scrollLeft,
        });
      const root = node.getRootNode();
      node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    const scroller = document.scrollingElement ?? document.documentElement;
    chain.push({ key: "document", top: scroller.scrollTop, left: scroller.scrollLeft });
  }
  const scan: Scan = {
    origin: location.origin,
    scroll: { x: scrollX, y: scrollY },
    owner: false,
    target: null,
    snap: null,
    chain,
  };
  if (!el) return scan;
  keep(el);
  const target = h.describeTarget(el);
  if (isOwner(el)) return { ...scan, owner: true, target };
  if (!arg.snap || !arg.point || target.interactive) return { ...scan, target };
  // cursor:pointer elements count as interactive (matching read_page), where the pointer starts.
  const { x, y } = arg.point;
  const radius = 12;
  const near = [...document.querySelectorAll("*")].filter((candidate) => {
    if (!candidate.matches(SELECTOR)) {
      if (getComputedStyle(candidate).cursor !== "pointer" || candidate.closest(SELECTOR))
        return false;
      const parent = candidate.parentElement;
      if (parent && getComputedStyle(parent).cursor === "pointer") return false;
    }
    const r = candidate.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      x >= r.left - radius &&
      x <= r.right + radius &&
      y >= r.top - radius &&
      y <= r.bottom + radius
    );
  });
  if (near.length !== 1) return { ...scan, target };
  const only = near[0]!;
  const r = only.getBoundingClientRect();
  const center = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const check = at(center.x, center.y);
  if (!check || (check !== only && !only.contains(check))) return { ...scan, target };
  keep(only);
  return { ...scan, target: h.describeTarget(only), snap: center };
}

/** Whether a node from the browser's own hit test is (inside) the element kept under `key`. */
const IS_KEPT = `function (key) {
  const kept = globalThis.__mtFound;
  if (!kept || kept.key !== key) return false;
  let node = this instanceof Node ? this : this.element ?? null; // a ::before box is its element's
  for (; node; node = node.parentNode ?? node.host ?? null) if (node === kept.el) return true;
  return false;
}`;

const MAX_FRAME_DEPTH = 4;
/** A frame that does not answer within this is uninspectable, so a hung frame never stalls a step. */
const FRAME_BUDGET_MS = 1_000;
const OPAQUE_FRAME_LABEL = "Embedded page that could not be inspected";

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
 * Classifies the element at a point, or with focus, through every kind of frame (R29-1, N1, N5).
 * Each document is scanned by the same page script, which stops at a frame owner. The point is then
 * mapped into the frame through the owner's real content quad (CDP), one level at a time, and the
 * frame's document is scanned in its own world (the parent session with the frame id in process,
 * the frame's own session out of process). Before trusting a session's answer, the browser's own
 * hit test at the point (DOM.getNodeForLocation) must land on the same element. Any doubt (a quad
 * that is not a plain rectangle, a disagreement, a failure, a frame too deep or too slow) yields
 * an opaque target, which needs approval.
 */
async function resolve(
  session: BrowserSession,
  point: { x: number; y: number } | null,
  options: { scroll: boolean },
): Promise<HitTest & ScrollState> {
  const topUrl = session.page.url();
  let worlds = await session.worlds();
  let frameId: string | undefined;
  let base = point; // in the viewport of the current CDP session's root frame
  let local = point; // in the viewport of the current frame
  let rootScroll = { x: 0, y: 0 };
  let path = "";
  let ownSession: string | null = null; // the out-of-process frame we are inside, if any
  const chain: ScrollState["chain"] = [];
  let late: Promise<never> | null = null;
  const inTime = <T>(work: Promise<T>): Promise<T> => {
    late ??= new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("frame did not answer in time")), FRAME_BUDGET_MS).unref();
    });
    late.catch(() => undefined);
    return Promise.race([work, late]);
  };
  const opaque = () => {
    if (ownSession) void session.forgetFrame(ownSession);
    return { target: opaqueTarget(path, topUrl), snap: null, chain };
  };
  const confirm = async (at: { x: number; y: number }, key: string) => {
    const { backendNodeId } = await worlds.cdp.send("DOM.getNodeForLocation", {
      x: Math.round(at.x + rootScroll.x),
      y: Math.round(at.y + rootScroll.y),
    });
    if (!(await worlds.callOnNode(backendNodeId, IS_KEPT, key, frameId)))
      throw new Error("the browser's own hit test disagrees");
  };
  for (let depth = 0; ; depth++) {
    const key = randomUUID();
    let scan: Scan;
    try {
      const scanning = worlds.evaluate(
        scanScript,
        { point: local, key, owners: FRAME_OWNERS, snap: depth === 0, scroll: options.scroll },
        frameId,
      );
      scan = depth === 0 ? await scanning : await inTime(scanning);
    } catch (error) {
      // The top page itself failing is a real error; a frame failing is uninspectable (N3).
      if (depth === 0) throw error;
      return opaque();
    }
    if (frameId === undefined) rootScroll = scan.scroll;
    if (depth > 0) path += `@${scan.origin}>`;
    chain.push(...scan.chain.map((entry) => ({ ...entry, key: `${depth}:${entry.key}` })));
    const confirming = base !== null && !options.scroll;
    try {
      if (!scan.owner) {
        // Inside a frame, nothing at the mapped point means the mapping cannot be trusted (N1).
        if (depth > 0 && local && !scan.target) return opaque();
        if (confirming && scan.target) await inTime(confirm(scan.snap ?? base!, key));
        const target = scan.target && {
          ...scan.target,
          path: `${path}${scan.target.path}`,
          context: digest(path, scan.target.context, topUrl),
        };
        // A snap point is only meaningful in the top frame's coordinates.
        return { target, snap: depth === 0 ? scan.snap : null, chain };
      }
      path += scan.target!.path;
      if (depth >= MAX_FRAME_DEPTH) return opaque();
      const objectId = await inTime(
        worlds.evaluateHandle(
          `(() => { const kept = globalThis.__mtFound; return kept && kept.key === ${JSON.stringify(key)} ? kept.el : null; })()`,
          frameId,
        ),
      );
      if (!objectId) throw new Error("frame element gone");
      const { node } = await inTime(worlds.cdp.send("DOM.describeNode", { objectId }));
      const child = node.frameId;
      if (!child) throw new Error("no content frame");
      const inner = base && (await inTime(intoFrame(worlds, objectId, base)));
      if (base && !inner) throw new Error("the point cannot be mapped into the frame");
      const own = await inTime(session.frameWorlds(child));
      if (!own) {
        frameId = child;
        local = inner;
        continue;
      }
      // Leaving this session: its own hit test must land on the frame owner first.
      if (confirming) await inTime(confirm(base!, key));
      worlds = own;
      ownSession = child;
      frameId = undefined;
      base = inner;
      local = inner;
    } catch {
      return opaque();
    }
  }
}

/**
 * Maps a point (in the session root's viewport) into the frame's own document through its real
 * geometry: the owner's content quad from DOM.getBoxModel is post-transform (border, padding, CSS
 * scale, zoom and ancestor frames included), and its untransformed content size gives the scale.
 * Unless the quad is an axis-aligned, non-flipped rectangle (no rotation, flip, skew or 3D) and the
 * point inside it, this returns null and the caller fails closed.
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
  const { target, snap } = await resolve(session, point, { scroll: false });
  return { target, snap };
}

export async function focusTarget(session: BrowserSession): Promise<TargetDescription | null> {
  return (await resolve(session, null, { scroll: false })).target;
}

export async function scrollState(
  session: BrowserSession,
  point: { x: number; y: number },
): Promise<ScrollState | null> {
  return resolve(session, point, { scroll: true }).then(
    ({ chain }) => ({ chain }),
    () => null,
  );
}
