import type { ExtractOptions, PageExtract, PageFrame, PageMedia } from "./types.ts";

declare const Defuddle: new (
  doc: Document,
  options: Record<string, unknown>,
) => {
  parse(): {
    content: string;
    title: string;
    description: string;
    language: string;
    debug?: { contentSelector?: string };
  };
};
declare const Readability: new (
  doc: Document,
  options?: Record<string, unknown>,
) => {
  parse(): { content: string | null } | null;
};

/** Capture-world extraction (spec §7.3): flatten into a detached document, then Defuddle → Readability → text. */
export function pageExtract(options: ExtractOptions): PageExtract {
  const lib = globalThis.__mtLib;
  if (!lib) throw new Error("lib_missing");
  const media: PageMedia[] = [];
  const rawTables: string[] = [];
  const frames: PageFrame[] = [];
  const out = document.implementation.createHTMLDocument(document.title);

  const abs = (
    value: string | null | undefined,
    schemes = ["http:", "https:", "data:", "blob:"],
  ): string | null => {
    if (!value) return null;
    try {
      const url = new URL(value, document.baseURI);
      return schemes.includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  const bestSrc = (img: HTMLImageElement): string | null => {
    let best: { url: string; weight: number } | null = null;
    for (const part of (img.getAttribute("srcset") ?? "").split(/,\s+/)) {
      const [url, descriptor] = part.trim().split(/\s+/);
      if (!url) continue;
      const match = /^(\d+(?:\.\d+)?)([wx])$/.exec(descriptor ?? "1x");
      const weight = match ? Number(match[1]) * (match[2] === "x" ? 10_000 : 1) : 1;
      if (!best || weight > best.weight) best = { url, weight };
    }
    return (
      abs(best?.url) ??
      abs(img.currentSrc) ??
      abs(img.getAttribute("src")) ??
      abs(img.getAttribute("data-src"))
    );
  };
  const SVG_PROPS = [
    "fill",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-dasharray",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "dominant-baseline",
    "visibility",
    "display",
  ];
  /** Computed `url(...)` values are absolute; a same-document reference becomes `url(#id)`, anything else `none`. */
  const localise = (value: string) =>
    value.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (_match, ref: string) => {
      try {
        const target = new URL(ref, document.baseURI);
        const here = new URL(location.href);
        if (
          target.hash &&
          target.origin === here.origin &&
          target.pathname === here.pathname &&
          target.search === here.search
        )
          return `url(${target.hash})`;
      } catch {
        // fall through
      }
      return "none";
    });
  const serializeSvg = (svg: SVGSVGElement): string | null => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const source = [svg, ...svg.querySelectorAll("*")];
    const target = [clone, ...clone.querySelectorAll("*")];
    source.forEach((el, i) => {
      const style = getComputedStyle(el);
      target[i]?.setAttribute(
        "style",
        SVG_PROPS.map((p) => `${p}:${localise(style.getPropertyValue(p))}`).join(";"),
      );
    });
    const r = svg.getBoundingClientRect();
    if (!clone.getAttribute("width")) clone.setAttribute("width", String(Math.round(r.width)));
    if (!clone.getAttribute("height")) clone.setAttribute("height", String(Math.round(r.height)));
    return lib.sanitizeSvg(clone);
  };
  const tableIsComplex = (table: HTMLTableElement) =>
    table.querySelector(
      "[rowspan]:not([rowspan='1']), [colspan]:not([colspan='1']), table, td ul, td ol, td pre, th ul, td p + p",
    ) !== null;
  const cleanTable = (table: HTMLTableElement): string => {
    const allowed = new Set([
      "TABLE",
      "CAPTION",
      "COLGROUP",
      "COL",
      "THEAD",
      "TBODY",
      "TFOOT",
      "TR",
      "TH",
      "TD",
      "UL",
      "OL",
      "LI",
      "P",
      "BR",
      "CODE",
      "PRE",
      "STRONG",
      "EM",
      "B",
      "I",
      "SUB",
      "SUP",
      "A",
    ]);
    const keep = new Set(["rowspan", "colspan", "scope", "span", "href"]);
    const escape = (text: string) =>
      text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? "");
      if (!(node instanceof Element) || !lib.visible(node)) return "";
      const inner = [...node.childNodes].map(walk).join("");
      if (!allowed.has(node.tagName)) return inner;
      const tag = node.tagName.toLowerCase();
      const attrs = [...node.attributes]
        .filter((a) => keep.has(a.name) && (a.name !== "href" || /^https?:/i.test(a.value)))
        .map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`)
        .join("");
      return tag === "br" || tag === "col"
        ? `<${tag}${attrs}>`
        : `<${tag}${attrs}>${inner}</${tag}>`;
    };
    return walk(table).replace(/>\s+</g, "><");
  };
  const placeholder = (parent: Node, text: string) => {
    const p = out.createElement("p");
    p.textContent = text;
    parent.appendChild(p);
  };
  const mediaImg = (parent: Node, item: PageMedia, el: Element) => {
    media.push(item);
    const img = out.createElement("img");
    img.setAttribute("src", `https://mt-media.invalid/${item.index}`);
    img.setAttribute("alt", item.alt);
    const r = el.getBoundingClientRect();
    img.setAttribute("width", String(Math.round(r.width)));
    img.setAttribute("height", String(Math.round(r.height)));
    parent.appendChild(img);
  };

  let range: Range | null = null;
  let liveRoot: Element;
  if (options.scope === "element") {
    const el = options.selector ? document.querySelector(options.selector) : null;
    if (!el) throw new Error("selector_not_found");
    liveRoot = el;
  } else if (options.scope === "selection") {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
      throw new Error("no_selection");
    range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    liveRoot = ancestor instanceof Element ? ancestor : (ancestor.parentElement ?? document.body);
  } else {
    liveRoot = document.body;
  }

  const cloneInto = (node: Node, parent: Node): void => {
    if (range && !range.intersectsNode(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      let text = textNode.data;
      if (range) {
        const start = textNode === range.startContainer ? range.startOffset : 0;
        const end = textNode === range.endContainer ? range.endOffset : text.length;
        text = text.slice(start, end);
      }
      parent.appendChild(out.createTextNode(text));
      return;
    }
    if (!(node instanceof Element)) {
      for (const child of [...node.childNodes]) cloneInto(child, parent);
      return;
    }
    const tag = node.tagName;
    if (node.matches(lib.MATH_SELECTOR)) {
      parent.appendChild(out.importNode(node, true));
      return;
    }
    if (tag === "IFRAME") {
      const r = lib.docRect(node);
      if (r && r.width >= 200 && r.height >= 100 && lib.visible(node)) {
        const index = frames.length;
        frames.push({
          index,
          url: abs(node.getAttribute("src"), ["http:", "https:"]),
          name: node.getAttribute("name"),
        });
        placeholder(parent, `MTFRAME${index}`);
      }
      return;
    }
    if (node instanceof SVGSVGElement) {
      const r = node.getBoundingClientRect();
      if (r.width < 24 || r.height < 24 || !lib.visible(node)) return;
      const alt = node.getAttribute("aria-label") ?? node.querySelector("title")?.textContent ?? "";
      mediaImg(
        parent,
        {
          index: media.length,
          kind: "svg",
          url: null,
          svg: serializeSvg(node),
          dataUrl: null,
          alt,
          rect: lib.docRect(node),
          selector: lib.cssPath(node),
          figure: r.width >= 120 && r.height >= 80,
        },
        node,
      );
      return;
    }
    if (tag === "CANVAS") {
      const canvas = node as HTMLCanvasElement;
      const r = canvas.getBoundingClientRect();
      if (r.width < 24 || r.height < 24 || !lib.visible(canvas)) return;
      let dataUrl: string | null;
      try {
        const value = canvas.toDataURL("image/png");
        dataUrl = value.length <= 15_000_000 ? value : null;
      } catch {
        dataUrl = null;
      }
      mediaImg(
        parent,
        {
          index: media.length,
          kind: "canvas",
          url: null,
          svg: null,
          dataUrl,
          alt: canvas.getAttribute("aria-label") ?? "",
          rect: lib.docRect(canvas),
          selector: lib.cssPath(canvas),
          figure: r.width >= 120 && r.height >= 80,
        },
        canvas,
      );
      return;
    }
    if (lib.SKIP_TAGS.has(tag) || node instanceof SVGElement) return;
    if (!lib.visible(node)) return;
    if (tag === "IMG") {
      const img = node as HTMLImageElement;
      mediaImg(
        parent,
        {
          index: media.length,
          kind: "img",
          url: bestSrc(img),
          svg: null,
          dataUrl: null,
          alt: img.alt ?? "",
          rect: lib.docRect(img),
          selector: lib.cssPath(img),
          figure: false,
        },
        img,
      );
      return;
    }
    if (tag === "TABLE" && tableIsComplex(node as HTMLTableElement)) {
      const index = rawTables.length;
      rawTables.push(cleanTable(node as HTMLTableElement));
      placeholder(parent, `MTRAWTABLE${index}`);
      return;
    }
    if (tag === "SLOT") {
      const assigned = (node as HTMLSlotElement).assignedNodes({ flatten: true });
      for (const child of assigned.length ? assigned : [...node.childNodes])
        cloneInto(child, parent);
      return;
    }
    const copy = out.createElement(tag.toLowerCase());
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === "style" || attr.name === "srcset") continue;
      try {
        copy.setAttribute(attr.name, attr.value);
      } catch {
        // attribute names that are invalid outside the page's framework (e.g. "@click") are dropped
      }
    }
    parent.appendChild(copy);
    for (const child of [...(lib.shadowOf(node) ?? node).childNodes]) cloneInto(child, copy);
  };

  if (liveRoot === document.body) {
    for (const child of [...document.body.childNodes]) cloneInto(child, out.body);
  } else {
    cloneInto(liveRoot, out.body);
  }

  const scoped = options.scope !== "page";
  const looseOptions = {
    contentSelector: "body",
    removeLowScoring: false,
    removeExactSelectors: false,
    removePartialSelectors: false,
    removeContentPatterns: false,
  };
  const run = (doc: Document, extra: Record<string, unknown>) =>
    new Defuddle(doc, {
      markdown: true,
      useAsync: false,
      debug: true,
      url: location.href,
      removeHiddenElements: false,
      ...extra,
    }).parse();

  let engine: PageExtract["engine"] = "none";
  let markdown = "";
  let result: ReturnType<typeof run> | null;
  try {
    result = run(out, scoped ? looseOptions : {});
    if (result.content.trim()) {
      engine = "defuddle";
      markdown = result.content;
    }
  } catch {
    result = null;
  }
  if (!markdown) {
    try {
      const article = new Readability(out.cloneNode(true) as Document, {
        charThreshold: 100,
      }).parse();
      if (article?.content) {
        const holder = document.implementation.createHTMLDocument("");
        holder.body.innerHTML = article.content;
        const second = run(holder, looseOptions);
        if (second.content.trim()) {
          engine = "readability";
          markdown = second.content;
        }
      }
    } catch {
      // fall through to the plain-text fallback assembled in Node
    }
  }

  const tidy = (parts: string[]) =>
    parts
      .join("")
      .replace(/[ \t\f\v\r]+/g, " ")
      .replace(/ *\n\s*/g, "\n")
      .trim();
  let textRoot: Element = liveRoot;
  const contentSelector = result?.debug?.contentSelector;
  if (!scoped && engine === "defuddle" && contentSelector) {
    try {
      textRoot = document.querySelector(contentSelector) ?? liveRoot;
    } catch {
      textRoot = liveRoot;
    }
  }
  const rootParts: string[] = [];
  lib.walkRendered(
    textRoot,
    range,
    (_node, text) => rootParts.push(text),
    () => rootParts.push("\n"),
  );
  const sourceText = tidy(rootParts);
  let pageText = sourceText;
  if (!scoped) {
    const pageParts: string[] = [];
    lib.walkRendered(
      document.body,
      null,
      (_node, text) => pageParts.push(text),
      () => pageParts.push("\n"),
      lib.isChrome,
    );
    pageText = tidy(pageParts);
  }
  globalThis.__mtCapture = { root: textRoot, range };
  const texScope: ParentNode = scoped ? liveRoot : document;
  const mathTex = [...texScope.querySelectorAll('annotation[encoding="application/x-tex"]')]
    .map((annotation) => (annotation.textContent ?? "").trim())
    .filter((tex) => tex.length > 0);

  const meta = (selector: string) =>
    document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || null;
  return {
    engine,
    title: (result?.title || document.title || location.href).trim(),
    description:
      result?.description?.trim() ||
      meta('meta[name="description"]') ||
      meta('meta[property="og:description"]'),
    canonicalUrl: abs(document.querySelector('link[rel="canonical"]')?.getAttribute("href"), [
      "http:",
      "https:",
    ]),
    faviconUrl: abs(
      document.querySelector('link[rel~="icon"]')?.getAttribute("href") ?? "/favicon.ico",
      ["http:", "https:"],
    ),
    language: document.documentElement.lang || result?.language || null,
    markdown,
    sourceText,
    pageText,
    mathTex,
    media,
    rawTables,
    frames,
  };
}
