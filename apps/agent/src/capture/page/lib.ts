import type { MtLib, Rect } from "./types.ts";

/** Runs inside the capture world (as part of its prelude). Must stay self-contained. */
export function pageInstallLib(): void {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "LINK",
    "META",
    "HEAD",
    "BUTTON",
    "SELECT",
    "INPUT",
    "TEXTAREA",
    "IFRAME",
    "VIDEO",
    "AUDIO",
    "OBJECT",
    "EMBED",
    "CANVAS",
  ]);
  const MATH_SELECTOR = "math, .katex, .katex-display, mjx-container, .MathJax, .MathJax_Display";
  const BLOCK_SELECTOR =
    "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, table, figure, figcaption, dt, dd";
  const CHROME_ROLES = new Set(["navigation", "banner", "contentinfo", "search"]);
  const SVG_ELEMENTS = new Set([
    "svg",
    "g",
    "defs",
    "symbol",
    "use",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "title",
    "desc",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "marker",
  ]);
  const SVG_ATTRS = new Set([
    "id",
    "class",
    "transform",
    "d",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "fx",
    "fy",
    "width",
    "height",
    "points",
    "viewBox",
    "preserveAspectRatio",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "dominant-baseline",
    "letter-spacing",
    "visibility",
    "display",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "clip-path",
    "clipPathUnits",
    "mask",
    "maskUnits",
    "marker-start",
    "marker-mid",
    "marker-end",
    "markerWidth",
    "markerHeight",
    "refX",
    "refY",
    "orient",
    "patternUnits",
    "patternTransform",
    "dx",
    "dy",
    "rotate",
    "textLength",
    "lengthAdjust",
    "startOffset",
    "version",
    "role",
    "aria-label",
  ]);
  const closedRoots = (globalThis.__mtClosedRoots ??= new WeakMap<Element, ShadowRoot>());
  const shadowOf = (el: Element): ShadowRoot | null => el.shadowRoot ?? closedRoots.get(el) ?? null;
  const visible = (el: Element): boolean =>
    el.tagName === "COL" ||
    el.tagName === "COLGROUP" ||
    el.checkVisibility({ visibilityProperty: true });
  const docRect = (el: Element): Rect | null => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  };
  const cssPath = (el: Element): string | null => {
    if (el.getRootNode() !== document) return null;
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== document.documentElement) {
      if (current.id && document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        return parts.join(" > ");
      }
      const tag = current.tagName.toLowerCase();
      const parent: Element | null = current.parentElement;
      if (!parent) break;
      const same = [...parent.children].filter((child) => child.tagName === current!.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag);
      current = parent;
    }
    return parts.length ? `html > ${parts.join(" > ")}` : null;
  };
  const xpathOf = (el: Element): string | null => {
    if (el.getRootNode() !== document) return null;
    const parts: string[] = [];
    for (let current: Element | null = el; current; current = current.parentElement) {
      const parent: Element | null = current.parentElement;
      const same = parent
        ? [...parent.children].filter((child) => child.tagName === current!.tagName)
        : [current];
      parts.unshift(`${current.tagName.toLowerCase()}[${same.indexOf(current) + 1}]`);
    }
    return `/${parts.join("/")}`;
  };
  const isChrome = (el: Element): boolean => {
    const role = el.getAttribute("role");
    if (role && CHROME_ROLES.has(role)) return true;
    if (el.tagName === "NAV") return true;
    if (el.tagName === "HEADER" || el.tagName === "FOOTER")
      return el.parentElement?.closest("article, aside, main, nav, section") == null;
    return false;
  };
  const localRef = (value: string) => /^\s*#[A-Za-z_][\w.:-]*\s*$/.test(value);
  const onlyLocalUrls = (value: string) =>
    (value.match(/url\([^)]*\)/gi) ?? []).every((url) =>
      /^url\(\s*["']?#[A-Za-z_][\w.:-]*["']?\s*\)$/i.test(url),
    );
  // image-set() and src() fetch a string URL without any url( (re-review).
  const unsafeCss =
    /@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding|image-set\s*\(|\bsrc\s*\(/i;
  const sanitizeSvg = (input: Element): string | null => {
    if (input.namespaceURI !== SVG_NS || input.localName !== "svg") return null;
    const doc = document.implementation.createDocument(SVG_NS, "svg", null);
    const copy = (node: Element): Element | null => {
      if (node.namespaceURI !== SVG_NS || !SVG_ELEMENTS.has(node.localName)) return null;
      const out = doc.createElementNS(SVG_NS, node.localName);
      for (const attr of [...node.attributes]) {
        const name = attr.localName;
        const value = attr.value;
        if (/^on/i.test(name)) continue;
        // CSS escapes (`\75 rl(` is `url(`) would hide a reference from every check below.
        if (value.includes("\\")) continue;
        if (name === "href") {
          if (localRef(value)) out.setAttribute("href", value.trim());
          continue;
        }
        if (name === "style") {
          if (!unsafeCss.test(value) && onlyLocalUrls(value)) out.setAttribute("style", value);
          continue;
        }
        if (!SVG_ATTRS.has(name) || attr.prefix === "xmlns") continue;
        // Presentation attributes (mask, fill, clip-path…) are CSS values like style (QA-079).
        if (unsafeCss.test(value) || !onlyLocalUrls(value)) continue;
        if (/javascript:|vbscript:|data:/i.test(value.replace(/[\s\0]/g, ""))) continue;
        out.setAttribute(name, value);
      }
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE)
          out.appendChild(doc.createTextNode(child.textContent ?? ""));
        else if (child.nodeType === Node.ELEMENT_NODE) {
          const kept = copy(child as Element);
          if (kept) out.appendChild(kept);
        }
      }
      return out;
    };
    const root = copy(input);
    if (!root) return null;
    root.setAttribute("xmlns", SVG_NS);
    const text = new XMLSerializer().serializeToString(root);
    return text.length <= 2_000_000 ? text : null;
  };
  const walkRendered: MtLib["walkRendered"] = (root, range, onText, onBreak, skip) => {
    const visit = (node: Node): void => {
      if (range && !range.intersectsNode(node)) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        let text = textNode.data;
        if (range) {
          const start = textNode === range.startContainer ? range.startOffset : 0;
          const end = textNode === range.endContainer ? range.endOffset : text.length;
          text = text.slice(start, end);
        }
        if (text) onText(textNode, text);
        return;
      }
      if (node instanceof Element) {
        if (
          SKIP_TAGS.has(node.tagName) ||
          node instanceof SVGElement ||
          node.matches(MATH_SELECTOR)
        )
          return;
        if (!visible(node) || skip?.(node)) return;
        if (node.tagName === "BR") {
          onBreak();
          return;
        }
        const inline = getComputedStyle(node).display.startsWith("inline");
        if (!inline) onBreak();
        if (node.tagName === "SLOT") {
          const assigned = (node as HTMLSlotElement).assignedNodes({ flatten: true });
          for (const child of assigned.length ? assigned : [...node.childNodes]) visit(child);
        } else {
          for (const child of [...(shadowOf(node) ?? node).childNodes]) visit(child);
        }
        if (!inline) onBreak();
        return;
      }
      for (const child of [...node.childNodes]) visit(child);
    };
    visit(root);
  };
  globalThis.__mtLib = {
    SKIP_TAGS,
    MATH_SELECTOR,
    BLOCK_SELECTOR,
    shadowOf,
    visible,
    docRect,
    cssPath,
    xpathOf,
    isChrome,
    sanitizeSvg,
    walkRendered,
  };
}
