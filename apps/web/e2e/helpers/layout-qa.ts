import type { Page } from "@playwright/test";

export interface LayoutQaOptions {
  /**
   * Spec §11.5 ("targets are 44px"). 0 (off) by default until Task 11 clears the Phase 8 ledger;
   * the shooter and the swarm already pass 44.
   */
  minTargetPx?: number;
}

/**
 * DOM layout detector backing the D22 swarm. Returns human-readable issues; [] means clean.
 * Opt an element out of clipping checks with [data-qa-allow-clip] (for example deliberate masks).
 * Struck-out text (D22's "model") must never wrap; with `minTargetPx`, small targets are flagged.
 */
export async function findLayoutIssues(
  page: Page,
  options: LayoutQaOptions = {},
): Promise<string[]> {
  return page.evaluate(
    ({ minTargetPx }) => {
      const TOL = 1;
      const issues: string[] = [];
      const describe = (el: Element): string => {
        const qa = el.getAttribute("data-qa");
        const cls =
          typeof el.className === "string" && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
            : "";
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${qa ? `[data-qa="${qa}"]` : cls} "${text}"`;
      };
      const visible = (el: Element): boolean => {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      // A position: fixed box is laid out against the screen, so an overflow ancestor clips it only
      // when that ancestor is its containing block (a transform, filter, contain, … on it). The
      // compact approval sheet is one: it sits inside the frame's markup but rises from the screen.
      const holdsFixed = (s: CSSStyleDeclaration): boolean =>
        s.transform !== "none" ||
        s.translate !== "none" ||
        s.scale !== "none" ||
        s.rotate !== "none" ||
        s.perspective !== "none" ||
        s.filter !== "none" ||
        s.backdropFilter !== "none" ||
        /paint|layout|strict|content/.test(s.contain) ||
        // A size container applies layout containment, so it holds fixed boxes too.
        (s.containerType !== "" && s.containerType !== "normal") ||
        /transform|filter|perspective/.test(s.willChange);
      const isFixed = (el: Element) => getComputedStyle(el).position === "fixed";
      /** A fixed box escapes `root` when nothing from its parent up to `root` (inclusive) holds it. */
      const escapes = (fixedEl: Element, root: Element): boolean => {
        for (let p = fixedEl.parentElement; p; p = p.parentElement) {
          if (holdsFixed(getComputedStyle(p))) return false;
          if (p === root) return true;
        }
        return true;
      };

      // scrollWidth also counts ::before/::after overflow (the 44px hit areas), which is not text spilling.
      // Measuring the real content with a Range ignores pseudo-elements. Fixed descendants are not
      // this box's content when they escape it (see holdsFixed), so they are measured out.
      const hasEscaping = (el: Element, root: Element) =>
        Array.from(el.querySelectorAll("*")).some((d) => isFixed(d) && escapes(d, root));
      const contentRight = (el: Element, root: Element = el): number => {
        const range = document.createRange();
        if (!hasEscaping(el, root)) {
          range.selectNodeContents(el);
          return range.getBoundingClientRect().right;
        }
        let right = Number.NEGATIVE_INFINITY;
        for (const child of Array.from(el.childNodes)) {
          if (child instanceof Element && isFixed(child) && escapes(child, root)) continue;
          if (child instanceof Element && hasEscaping(child, root)) {
            right = Math.max(right, child.getBoundingClientRect().right, contentRight(child, root));
            continue;
          }
          range.selectNode(child);
          const r = range.getBoundingClientRect();
          if (r.width > 0 || r.height > 0) right = Math.max(right, r.right);
        }
        return right;
      };
      const contentSpills = (el: Element, style: CSSStyleDeclaration): boolean => {
        const box = el.getBoundingClientRect();
        return contentRight(el) > box.right - Number.parseFloat(style.borderRightWidth) + TOL;
      };

      // Text-only content: an ellipsis ancestor truncates it on purpose; anything else it clips is a defect.
      const MEDIA_OR_CONTROL = "svg,img,input,button,select,textarea,canvas,video";
      const isTextOnly = (el: Element): boolean =>
        (el.textContent ?? "").trim() !== "" &&
        !el.matches(MEDIA_OR_CONTROL) &&
        !el.querySelector(MEDIA_OR_CONTROL);

      // The standard sr-only pattern: a 1px box that clips its text on purpose. It is still read aloud.
      const isVisuallyHidden = (el: Element): boolean => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return (
          r.width <= 1 + TOL &&
          r.height <= 1 + TOL &&
          (s.clip !== "auto" || s.clipPath !== "none") &&
          s.overflowX !== "visible"
        );
      };

      const root = document.documentElement;
      if (root.scrollWidth > root.clientWidth + TOL) {
        issues.push(`page scrolls sideways (${root.scrollWidth}px > ${root.clientWidth}px)`);
      }

      const all = Array.from(document.body.querySelectorAll("*"));
      const hiddenBoxes = new Set(all.filter(isVisuallyHidden));
      // Whatever sits inside a visually-hidden box (KaTeX's MathML copy) is hidden with it.
      const inHiddenBox = (el: Element): boolean => {
        for (let p = el.parentElement; p; p = p.parentElement) if (hiddenBoxes.has(p)) return true;
        return false;
      };

      const elements = all.filter(
        (el) =>
          !el.closest("[data-qa-allow-clip]") &&
          !inHiddenBox(el) &&
          !el.parentElement?.closest("svg") &&
          // A closed <details> does not render its content; only its summary is on screen.
          !el.closest("details:not([open]) > :not(summary)") &&
          // Base UI renders a hidden native input beside its custom controls; it is never seen.
          !el.matches('input[aria-hidden="true"]') &&
          !isVisuallyHidden(el) &&
          visible(el),
      );
      for (const el of elements) {
        const style = getComputedStyle(el);
        // Until the walk reaches a fixed box's containing block, overflow above it does not clip
        // it; from there on, every clipping ancestor does (final M1).
        let held = style.position !== "fixed";
        if (
          style.display !== "inline" &&
          style.whiteSpace === "nowrap" &&
          style.overflowX === "visible" &&
          el.clientWidth > 0 &&
          el.scrollWidth > el.clientWidth + TOL &&
          contentSpills(el, style)
        ) {
          issues.push(`text overflows its box: ${describe(el)}`);
        }
        // Text clipped by the very element that holds it (overflow hidden/clip, no ellipsis).
        if (
          style.display !== "inline" &&
          style.overflowX !== "visible" &&
          !/(auto|scroll)/.test(style.overflowX) &&
          style.textOverflow !== "ellipsis" &&
          (el.textContent ?? "").trim() !== "" &&
          el.clientWidth > 0 &&
          contentSpills(el, style)
        ) {
          issues.push(`text clipped by its own box: ${describe(el)}`);
        }
        if (el.hasAttribute("data-qa-single-line")) {
          const lineHeight =
            Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
          if (el.getBoundingClientRect().height > lineHeight * 1.5)
            issues.push(`wraps onto a second line: ${describe(el)}`);
        }
        for (
          let parent = el.parentElement;
          parent && parent !== document.body;
          parent = parent.parentElement
        ) {
          const ps = getComputedStyle(parent);
          if (!held) {
            if (!holdsFixed(ps)) continue;
            held = true;
          }
          const clipX = ps.overflowX !== "visible";
          const clipY = ps.overflowY !== "visible";
          if (!clipX && !clipY) continue;
          const box = parent.getBoundingClientRect();
          const scrollable = /(auto|scroll)/.test(`${ps.overflowX} ${ps.overflowY}`);
          const ellipsisOk = ps.textOverflow === "ellipsis" && isTextOnly(el);
          if (scrollable) {
            // Scrolling can reveal content past the end, never content before the start: an element
            // that begins left of or above the container's padding edge at scroll 0 is unreachable.
            const r = el.getBoundingClientRect();
            const unreachableX =
              /(auto|scroll)/.test(ps.overflowX) &&
              parent.scrollLeft === 0 &&
              r.left < box.left + parent.clientLeft - TOL;
            const unreachableY =
              /(auto|scroll)/.test(ps.overflowY) &&
              parent.scrollTop === 0 &&
              r.top < box.top + parent.clientTop - TOL;
            if (unreachableX || unreachableY) {
              issues.push(
                `starts before its scroll container's start: ${describe(el)} in ${describe(parent)}`,
              );
            }
            break;
          }
          if (ellipsisOk || box.width <= TOL || box.height <= TOL) break;
          const r = el.getBoundingClientRect();
          const outX = clipX && (r.left < box.left - TOL || r.right > box.right + TOL);
          const outY = clipY && (r.top < box.top - TOL || r.bottom > box.bottom + TOL);
          if (outX || outY) issues.push(`clipped by ${describe(parent)}: ${describe(el)}`);
          break;
        }
      }

      const avoid = Array.from(document.querySelectorAll("[data-qa-avoid]")).filter(visible);
      const obstacles = Array.from(document.querySelectorAll("[data-qa-obstacle]")).filter(visible);
      for (const a of avoid) {
        for (const o of obstacles) {
          if (a === o || a.contains(o) || o.contains(a)) continue;
          const r1 = a.getBoundingClientRect();
          const r2 = o.getBoundingClientRect();
          const w = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
          const h = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
          if (w > TOL && h > TOL) issues.push(`overlaps ${describe(o)}: ${describe(a)}`);
        }
      }
      // D22: a struck-out word ("the model") never wraps onto its own line. No opt-in needed.
      for (const el of elements) {
        if (!getComputedStyle(el).textDecorationLine.includes("line-through")) continue;
        const text = (el.textContent ?? "").trim();
        if (text === "" || text.length > 40) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        const lines = new Set(
          Array.from(range.getClientRects())
            .filter((r) => r.width > 0)
            .map((r) => Math.round(r.top)),
        );
        if (lines.size > 1) issues.push(`wraps onto a second line: ${describe(el)}`);
      }

      // Spec §11.5: targets are 44px. The hit area counts an absolutely positioned ::before/::after
      // (the shared `inset: -0.25rem` pattern) and the <label> around a native input. Inline links in
      // running text (WCAG 2.5.8 "inline"), disabled and inert controls are exempt.
      if (minTargetPx > 0) {
        const TARGETS =
          'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],' +
          '[role="link"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],' +
          '[role="menuitem"],[role="option"]';
        const px = (value: string) =>
          value.endsWith("px") ? Number.parseFloat(value) : Number.NaN;
        const hitBox = (el: Element) => {
          const r = el.getBoundingClientRect();
          const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
          const grow = (x1: number, y1: number, x2: number, y2: number) => {
            box.left = Math.min(box.left, x1);
            box.top = Math.min(box.top, y1);
            box.right = Math.max(box.right, x2);
            box.bottom = Math.max(box.bottom, y2);
          };
          const s = getComputedStyle(el);
          // An absolute pseudo-element is laid out against this element only if it is positioned.
          if (s.position !== "static") {
            const inner = {
              left: r.left + px(s.borderLeftWidth),
              top: r.top + px(s.borderTopWidth),
              right: r.right - px(s.borderRightWidth),
              bottom: r.bottom - px(s.borderBottomWidth),
            };
            for (const pseudo of ["::before", "::after"]) {
              const p = getComputedStyle(el, pseudo);
              if (p.content === "none" || p.content === "normal") continue;
              if (p.position !== "absolute" || p.display === "none") continue;
              const [l, t, rt, b, w, h] = [p.left, p.top, p.right, p.bottom, p.width, p.height].map(
                px,
              ) as [number, number, number, number, number, number];
              const x1 = Number.isFinite(l) ? inner.left + l : inner.right - rt - w;
              const x2 = Number.isFinite(rt) ? inner.right - rt : inner.left + l + w;
              const y1 = Number.isFinite(t) ? inner.top + t : inner.bottom - b - h;
              const y2 = Number.isFinite(b) ? inner.bottom - b : inner.top + t + h;
              if ([x1, y1, x2, y2].every(Number.isFinite)) grow(x1, y1, x2, y2);
            }
          }
          if (el instanceof HTMLInputElement) {
            for (const label of Array.from(el.labels ?? [])) {
              const lr = label.getBoundingClientRect();
              grow(lr.left, lr.top, lr.right, lr.bottom);
            }
          }
          return box;
        };
        const inlineInText = (el: Element, style: CSSStyleDeclaration) =>
          style.display === "inline" &&
          Array.from(el.parentElement?.childNodes ?? []).some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
          );
        for (const el of elements) {
          if (!el.matches(TARGETS) || el.matches(":disabled,[aria-disabled='true']")) continue;
          if (el.closest("[inert],[aria-hidden='true']")) continue;
          const style = getComputedStyle(el);
          if (style.pointerEvents === "none" || inlineInText(el, style)) continue;
          const b = hitBox(el);
          const w = b.right - b.left;
          const h = b.bottom - b.top;
          if (Math.min(w, h) < minTargetPx - 0.5) {
            issues.push(
              `target smaller than ${minTargetPx}px (${Math.round(w)}×${Math.round(h)}): ${describe(el)}`,
            );
          }
        }
      }
      return [...new Set(issues)];
    },
    { minTargetPx: options.minTargetPx ?? 0 },
  );
}
