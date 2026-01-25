import type { PageHelpers, TargetDescription } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

export interface HitTest {
  target: TargetDescription | null;
  /** A better click point when the point missed every interactive element but one is within the radius. */
  snap: { x: number; y: number } | null;
}

export interface ScrollState {
  /** Every scrollable ancestor of the point, innermost first, with its scroll offsets. */
  chain: Array<{ key: string; top: number; left: number }>;
}

export function hitTestScript(
  arg: { x: number; y: number; radius: number },
  h: PageHelpers,
): HitTest {
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
  const hit = deep(arg.x, arg.y);
  if (!hit) return { target: null, snap: null };
  const target = h.describeTarget(hit);
  if (target.interactive) return { target, snap: null };
  const near = [...document.querySelectorAll(SELECTOR)].filter((el) => {
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
  if (near.length !== 1) return { target, snap: null };
  const only = near[0]!;
  const r = only.getBoundingClientRect();
  const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const check = deep(center.x, center.y);
  if (!check || (check !== only && !only.contains(check))) return { target, snap: null };
  return { target: h.describeTarget(only), snap: center };
}

export function focusScript(_arg: null, h: PageHelpers): TargetDescription | null {
  let active: Element | null = document.activeElement;
  for (let depth = 0; depth < 10 && active; depth++) {
    if (active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
      continue;
    }
    if (active.tagName === "IFRAME") {
      try {
        const inner = (active as HTMLIFrameElement).contentDocument?.activeElement;
        if (inner && inner.tagName !== "BODY") {
          active = inner;
          continue;
        }
      } catch {
        // Cross-origin focus is opaque.
      }
    }
    break;
  }
  if (!active || active === document.body || active === document.documentElement) return null;
  return h.describeTarget(active);
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

export async function hitTest(
  session: BrowserSession,
  point: { x: number; y: number },
): Promise<HitTest> {
  return (await session.worlds()).evaluate(hitTestScript, { ...point, radius: 12 });
}

export async function focusTarget(session: BrowserSession): Promise<TargetDescription | null> {
  return (await session.worlds()).evaluate(focusScript, null);
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
