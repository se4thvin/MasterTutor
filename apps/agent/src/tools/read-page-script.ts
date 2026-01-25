import type { PageHelpers } from "../browser/page-helpers.ts";

export interface RawElement {
  tag: string;
  role: string | null;
  name: string;
  attrs: Record<string, string>;
  point: { x: number; y: number } | null;
  inViewport: boolean;
}

export interface RawPage {
  url: string;
  title: string;
  elements: RawElement[] | null;
  text: string | null;
}

/**
 * Runs in the isolated world. Lists visible interactive elements in document order (through
 * same-origin iframes and open shadow roots) with CSS-pixel click points; stores the element
 * list as globalThis.__mtRefs (isolated world only) so refs resolve later. Read-only.
 */
export function readPageScript(
  arg: { mode: "interactive" | "text"; attrs: readonly string[]; max: number; maxText: number },
  h: PageHelpers,
): RawPage {
  const clean = (value: string | null | undefined, max: number) =>
    (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  if (arg.mode === "text") {
    const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").slice(0, arg.maxText);
    return { url: location.href, title: document.title, elements: null, text };
  }
  const SELECTOR =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, label, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="switch"], [role="combobox"], [role="textbox"], [role="slider"], [role="spinbutton"], [role="treeitem"], [onclick], [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"]';
  const IMPLICIT: Record<string, string> = {
    A: "link",
    BUTTON: "button",
    SELECT: "combobox",
    TEXTAREA: "textbox",
    SUMMARY: "button",
    LABEL: "label",
  };
  const INPUT_ROLES: Record<string, string> = {
    checkbox: "checkbox",
    radio: "radio",
    range: "slider",
    button: "button",
    submit: "button",
    reset: "button",
    image: "button",
    search: "searchbox",
    number: "spinbutton",
  };
  const NON_TEXT = [
    "checkbox",
    "radio",
    "submit",
    "button",
    "reset",
    "image",
    "range",
    "file",
    "color",
  ];
  const vw = innerWidth;
  const vh = innerHeight;
  const found: Array<{ el: Element; raw: RawElement }> = [];
  const seen = new Set<Element>();

  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.slice(0, 64);
    if (el.tagName === "INPUT")
      return INPUT_ROLES[(el.getAttribute("type") ?? "text").toLowerCase()] ?? "textbox";
    return IMPLICIT[el.tagName] ?? null;
  };

  const nameOf = (el: Element, root: Document | ShadowRoot): string => {
    const aria = clean(el.getAttribute("aria-label"), 200);
    if (aria) return aria;
    const ids = el.getAttribute("aria-labelledby");
    if (ids) {
      const text = clean(
        ids
          .split(/\s+/)
          .map((id) => {
            const target = root.getElementById(id);
            // An editable element must never name itself with its own (typed) content.
            return target && !target.contains(el) ? (target.textContent ?? "") : "";
          })
          .join(" "),
        200,
      );
      if (text) return text;
    }
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      const id = el.getAttribute("id");
      const forLabel = id ? root.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const fromLabel = clean((forLabel ?? el.closest("label"))?.textContent, 200);
      if (fromLabel) return fromLabel;
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      if (["submit", "button", "reset"].includes(type))
        return clean((el as HTMLInputElement).value, 200);
      return clean(
        el.getAttribute("placeholder") ?? el.getAttribute("title") ?? el.getAttribute("name"),
        200,
      );
    }
    if (el.tagName === "IMG") return clean(el.getAttribute("alt"), 200);
    // Editable elements hold typed content (possibly secrets): never use their text as a name.
    if (
      (el as HTMLElement).isContentEditable === true ||
      /^(textbox|combobox|searchbox)$/i.test(el.getAttribute("role") ?? "")
    ) {
      return clean(
        el.getAttribute("placeholder") ??
          el.getAttribute("data-placeholder") ??
          el.getAttribute("title"),
        200,
      );
    }
    const EDITABLE =
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]';
    if (el.querySelector(EDITABLE)) {
      // A wrapper (label, clickable div) around an editable: name it from its own text only.
      const own = clean(el.getAttribute("title"), 200);
      if (own) return own;
      const copy = el.cloneNode(true) as Element;
      for (const inner of copy.querySelectorAll(EDITABLE)) inner.remove();
      return clean(copy.textContent, 200);
    }
    const text = clean((el as HTMLElement).innerText ?? el.textContent, 200);
    if (text) return text;
    return clean(
      el.getAttribute("title") ?? el.querySelector("img[alt]")?.getAttribute("alt"),
      200,
    );
  };

  const stateOf = (el: Element): string => {
    const parts: string[] = [];
    const input = el as HTMLInputElement;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (
      (el.tagName === "INPUT" && (type === "checkbox" || type === "radio") && input.checked) ||
      el.getAttribute("aria-checked") === "true"
    )
      parts.push("checked");
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true")
      parts.push("disabled");
    if (el.getAttribute("aria-expanded") === "true") parts.push("expanded");
    if (el.getAttribute("aria-selected") === "true") parts.push("selected");
    if (el.tagName === "SELECT") {
      const option = (el as HTMLSelectElement).selectedOptions[0];
      if (option) parts.push(`value: ${clean(option.textContent, 60)}`);
    }
    if (
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA") &&
      !NON_TEXT.includes(type) &&
      !h.isSecretField(el) &&
      (input.value ?? "") !== ""
    ) {
      parts.push("filled");
    }
    return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
  };

  const pointOf = (
    el: Element,
    r: DOMRect,
    root: Document | ShadowRoot,
    ox: number,
    oy: number,
  ) => {
    // Clamp to the visible part so elements straddling the fold still get a point.
    const left = Math.max(r.left, -ox);
    const right = Math.min(r.right, vw - ox);
    const top = Math.max(r.top, -oy);
    const bottom = Math.min(r.bottom, vh - oy);
    if (right - left < 1 || bottom - top < 1) return null;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const inset = (extent: number) => Math.min(4, extent / 2);
    const probes: Array<[number, number]> = [
      [cx, cy],
      [left + inset(right - left), cy],
      [right - inset(right - left), cy],
      [cx, top + inset(bottom - top)],
      [cx, bottom - inset(bottom - top)],
    ];
    for (const [x, y] of probes) {
      const px = x + ox;
      const py = y + oy;
      if (px < 0 || py < 0 || px >= vw || py >= vh) continue;
      const hit = root.elementFromPoint(x, y);
      if (
        hit &&
        (hit === el || el.contains(hit) || (el.tagName === "LABEL" && hit.closest("label") === el))
      ) {
        return { x: Math.round(px), y: Math.round(py) };
      }
    }
    return null;
  };

  const visit = (root: Document | ShadowRoot, ox: number, oy: number, depth: number) => {
    if (depth > 6) return;
    for (const el of root.querySelectorAll("*")) {
      if (seen.has(el)) continue;
      const view = el.ownerDocument.defaultView ?? window;
      const style = view.getComputedStyle(el);
      if (!el.matches(SELECTOR)) {
        // Clickable divs: computed cursor:pointer where the pointer starts, outside listed controls.
        if (style.cursor !== "pointer" || el.closest(SELECTOR)) continue;
        const parent = el.parentElement;
        if (parent && view.getComputedStyle(parent).cursor === "pointer") continue;
      }
      seen.add(el);
      if (
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.display === "none" ||
        Number(style.opacity) === 0
      )
        continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const left = r.left + ox;
      const top = r.top + oy;
      const inViewport = left < vw && top < vh && left + r.width > 0 && top + r.height > 0;
      const attrs: Record<string, string> = {};
      for (const name of arg.attrs) {
        const value = el.getAttribute(name);
        if (value !== null && value !== "") attrs[name] = value.slice(0, 2000);
      }
      found.push({
        el,
        raw: {
          tag: el.tagName.toLowerCase().slice(0, 32),
          role: roleOf(el),
          name: (nameOf(el, root) + stateOf(el)).slice(0, 500),
          attrs,
          point: inViewport ? pointOf(el, r, root, ox, oy) : null,
          inViewport,
        },
      });
    }
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) visit(host.shadowRoot, ox, oy, depth + 1);
    }
    for (const frame of root.querySelectorAll("iframe, frame")) {
      try {
        const doc = (frame as HTMLIFrameElement).contentDocument;
        if (!doc) continue;
        const r = frame.getBoundingClientRect();
        visit(
          doc,
          ox + r.left + (frame as HTMLElement).clientLeft,
          oy + r.top + (frame as HTMLElement).clientTop,
          depth + 1,
        );
      } catch {
        // Cross-origin frames are not readable; the screenshot still shows them.
      }
    }
  };
  visit(document, 0, 0, 0);

  // A label is redundant when its control is itself listed with a point (opacity:0 custom
  // checkboxes are not listed, so their label stays as the only target).
  const listed = new Map(found.map((entry) => [entry.el, entry.raw]));
  const entries = found.filter((entry) => {
    if (entry.el.tagName !== "LABEL") return true;
    const control = (entry.el as HTMLLabelElement).control;
    return !(control && listed.get(control)?.point);
  });
  let kept = entries;
  if (kept.length > arg.max) {
    kept = entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (a, b) =>
          Number(b.entry.raw.inViewport) - Number(a.entry.raw.inViewport) || a.index - b.index,
      )
      .slice(0, arg.max)
      .sort((a, b) => a.index - b.index)
      .map(({ entry }) => entry);
  }
  (globalThis as unknown as { __mtRefs?: Element[] }).__mtRefs = kept.map((entry) => entry.el);
  return {
    url: location.href,
    title: document.title,
    elements: kept.map((entry) => entry.raw),
    text: null,
  };
}
