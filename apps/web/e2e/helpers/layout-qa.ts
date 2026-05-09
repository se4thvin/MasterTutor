import type { Page } from "@playwright/test";

/**
 * DOM layout detector backing the D22 swarm. Returns human-readable issues; [] means clean.
 * Opt an element out of clipping checks with [data-qa-allow-clip] (for example deliberate masks).
 */
export async function findLayoutIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
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
      /transform|filter|perspective/.test(s.willChange);
    const isFixed = (el: Element) => getComputedStyle(el).position === "fixed";

    // scrollWidth also counts ::before/::after overflow (the 44px hit areas), which is not text spilling.
    // Measuring the real content with a Range ignores pseudo-elements. Fixed descendants are not
    // this box's content (see holdsFixed), so they are measured out.
    const hasFixedInside = (el: Element) => Array.from(el.querySelectorAll("*")).some(isFixed);
    const contentRight = (el: Element): number => {
      const range = document.createRange();
      if (!hasFixedInside(el)) {
        range.selectNodeContents(el);
        return range.getBoundingClientRect().right;
      }
      let right = Number.NEGATIVE_INFINITY;
      for (const child of Array.from(el.childNodes)) {
        if (child instanceof Element && isFixed(child)) continue;
        if (child instanceof Element && hasFixedInside(child)) {
          right = Math.max(right, child.getBoundingClientRect().right, contentRight(child));
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
    const isTextOnly = (el: Element): boolean =>
      (el.textContent ?? "").trim() !== "" &&
      !el.querySelector("svg,img,input,button,canvas,video");

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
      const fixed = style.position === "fixed";
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
        if (fixed && !holdsFixed(ps)) continue;
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
    return [...new Set(issues)];
  });
}
