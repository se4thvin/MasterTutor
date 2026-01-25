import type { PageHelpers, TargetDescription } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

export interface HitTest {
  target: TargetDescription | null;
  /** A better click point when the point missed every interactive element but one is within the radius. */
  snap: { x: number; y: number } | null;
}

export interface ScrollState {
  key: string;
  top: number;
  left: number;
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
  let el: Element | null = document.elementFromPoint(arg.x, arg.y);
  while (el && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const scrollable =
      (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) ||
      (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth);
    if (scrollable) {
      return {
        key: `${el.tagName}#${el.id}.${el.className}`,
        top: el.scrollTop,
        left: el.scrollLeft,
      };
    }
    el = el.parentElement;
  }
  const root = document.scrollingElement ?? document.documentElement;
  return { key: "document", top: root.scrollTop, left: root.scrollLeft };
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
