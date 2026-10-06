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

    // scrollWidth also counts ::before/::after overflow (the 44px hit areas), which is not text spilling.
    // Measuring the real content with a Range ignores pseudo-elements.
    const contentSpills = (el: Element, style: CSSStyleDeclaration): boolean => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const content = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return content.right > box.right - Number.parseFloat(style.borderRightWidth) + TOL;
    };

    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + TOL) {
      issues.push(`page scrolls sideways (${root.scrollWidth}px > ${root.clientWidth}px)`);
    }

    const elements = Array.from(document.body.querySelectorAll("*")).filter(
      (el) =>
        !el.closest("[data-qa-allow-clip]") &&
        !el.parentElement?.closest("svg") &&
        // Base UI renders a hidden native input beside its custom controls; it is never seen.
        !el.matches('input[aria-hidden="true"]') &&
        visible(el),
    );
    for (const el of elements) {
      const style = getComputedStyle(el);
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
        const clipX = ps.overflowX !== "visible";
        const clipY = ps.overflowY !== "visible";
        if (!clipX && !clipY) continue;
        const box = parent.getBoundingClientRect();
        const scrollable = /(auto|scroll)/.test(`${ps.overflowX} ${ps.overflowY}`);
        if (scrollable || ps.textOverflow === "ellipsis" || box.width <= TOL || box.height <= TOL)
          break;
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
