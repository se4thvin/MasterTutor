import type { ExtractOptions, PageActivity, PageExtract, PageFrame, PageMedia } from "./types.ts";

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
  const finder = globalThis.__mtStructure;
  if (!lib || !finder) throw new Error("lib_missing");
  const media: PageMedia[] = [];
  const rawTables: string[] = [];
  const activities: PageActivity[] = [];
  const frames: PageFrame[] = [];
  /** The live iframe behind each MTFRAME placeholder, resolved to its CDP frame id in Node. */
  const frameElements: Element[] = [];
  let smallFrames = 0;
  /** Each element of the flattened copy → the live element it came from. */
  const liveOf = new Map<Element, Element>();
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
  const isFixed = (el: Element): boolean => {
    for (let at: Element | null = el; at; at = at.parentElement) {
      const position = getComputedStyle(at).position;
      if (position === "fixed" || position === "sticky") return true;
    }
    return false;
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
      if (!(node instanceof Element) || !lib.visible(node) || isChrome(node)) return "";
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
  const squash = (value: string) => value.replace(/\s+/g, " ").trim();
  const renderedText = (el: Element) => {
    const parts: string[] = [];
    lib.walkRendered(
      el,
      null,
      (_node, text) => parts.push(text),
      () => parts.push(" "),
    );
    return squash(parts.join(""));
  };
  const NEUTRAL: Record<string, string> = {
    LABEL: "span",
    FORM: "div",
    FIELDSET: "div",
    LEGEND: "p",
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

  // Responsive platform banners often have no landmark role. Compare whole leaf blocks
  // with identical rendered blocks outside every main/article landmark. Never match inline
  // words or deduplicate repetition wholly inside the lesson. No live DOM is changed.
  const mainSelector = "main, [role=main], article";
  const repeatBlocks = "p, div, section";
  const contentObjects = `table, pre, blockquote, figure, img, svg, canvas, iframe, ${lib.MATH_SELECTOR}`;
  const substantive = `h1, h2, h3, h4, h5, h6, ul, ol, ${contentObjects}`;
  const repeatedChrome = new Set<Element>();
  if (document.querySelector(mainSelector)) {
    const candidates = [...document.querySelectorAll(repeatBlocks)].filter(
      (el) =>
        lib.visible(el) && !el.querySelector(`${repeatBlocks}, ${mainSelector}, ${substantive}`),
    );
    const signature = (el: Element) => `${el.tagName}\n${renderedText(el)}`;
    const outside = new Set(
      candidates.filter((el) => !el.closest(mainSelector) && renderedText(el)).map(signature),
    );
    const shared = new Set(
      candidates
        .filter((el) => el.closest(mainSelector) && renderedText(el) && outside.has(signature(el)))
        .map(signature),
    );
    for (const el of candidates) if (shared.has(signature(el))) repeatedChrome.add(el);
  }
  // Role-free banners can repeat inside sibling widgets rather than outside the lesson.
  // Compare whole text blocks across distinct siblings that each hold a visible control;
  // repetition in one widget or in ordinary prose is not enough. Use text only, not classes.
  const controls = "button, input:not([type=hidden]), [role=button]";
  const interactive = new WeakMap<Element, boolean>();
  const hasControl = (el: Element): boolean => {
    const cached = interactive.get(el);
    if (cached !== undefined) return cached;
    const value = [...el.querySelectorAll(controls)].some((control) => lib.visible(control));
    interactive.set(el, value);
    return value;
  };
  const widgetBlocks = new Map<Element, Map<string, Map<Element, Element[]>>>();
  for (const el of document.querySelectorAll(repeatBlocks)) {
    if (
      !lib.visible(el) ||
      el.querySelector(`${repeatBlocks}, ${mainSelector}, ${substantive}, ${controls}`)
    )
      continue;
    const text = renderedText(el);
    // A repeated question/list marker is structure, not a standalone text block.
    if (!text || /^(?:\d+|[a-zA-Z])[.)]$/.test(text)) continue;
    for (let widget: Element | null = el.parentElement; widget; widget = widget.parentElement) {
      if (widget.matches(mainSelector) || widget === document.body) break;
      const parent = widget.parentElement;
      if (!parent || !hasControl(widget)) continue;
      let texts = widgetBlocks.get(parent);
      if (!texts) widgetBlocks.set(parent, (texts = new Map()));
      let siblings = texts.get(text);
      if (!siblings) texts.set(text, (siblings = new Map()));
      let blocks = siblings.get(widget);
      if (!blocks) siblings.set(widget, (blocks = []));
      blocks.push(el);
    }
  }
  for (const texts of widgetBlocks.values())
    for (const siblings of texts.values())
      if (siblings.size >= 2)
        for (const blocks of siblings.values()) for (const el of blocks) repeatedChrome.add(el);
  const isChrome = (el: Element) => lib.isChrome(el) || repeatedChrome.has(el);

  const structure = finder.analyse(liveRoot);
  const scoped = options.scope !== "page";
  /** App UI above the main heading; only a whole-page capture leaves it out. */
  const excluded: ReadonlySet<Element> = scoped ? new Set() : structure.excluded;
  const pageUrl = abs(location.href.split("#")[0], ["http:", "https:"]);
  /** A fresh token per capture, so page text can never pose as an activity placeholder. */
  const activityToken = `MTACTIVITY${[...crypto.getRandomValues(new Uint8Array(8))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}N`;
  /** Inside an activity callout, headings become bold lines so they do not compete with the section's. */
  let activityDepth = 0;

  /** Children in order; consecutive choice options become one list of their labels. */
  /** Labels cloned as part of an option (a `label[for]` beside its bare control). */
  const optionLabels = new Set([...structure.options.values()].flatMap((parts) => parts.slice(1)));
  /** Children in order; consecutive choice options become one list, each item a clone of its parts. */
  const cloneChildren = (node: Element, into: Node): void => {
    let list: Element | null = null;
    for (const child of [...(lib.shadowOf(node) ?? node).childNodes]) {
      if (child instanceof Element && optionLabels.has(child)) continue; // cloned with its control
      const parts = child instanceof Element ? structure.options.get(child) : undefined;
      if (parts === undefined) {
        if (child instanceof Element || (child.textContent ?? "").trim()) list = null;
        cloneInto(child, into);
        continue;
      }
      if (range && !range.intersectsNode(child)) continue;
      if (!list) list = into.appendChild(out.createElement("ul"));
      const item = list.appendChild(out.createElement("li"));
      for (const part of parts) cloneInto(part, item);
      if (!(item.textContent ?? "").trim() && !item.querySelector("math, img")) {
        const control = (child as Element).matches("input, [role]")
          ? (child as Element)
          : (child as Element).querySelector("input, [role]");
        item.textContent = control?.getAttribute("aria-label") ?? "";
      }
    }
  };

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
    if (excluded.has(node) || isChrome(node)) return;
    const tag = node.tagName;
    if (node.matches(lib.MATH_SELECTOR)) {
      parent.appendChild(out.importNode(node, true));
      return;
    }
    if (tag === "IFRAME") {
      const r = lib.docRect(node);
      if (r && r.width >= 200 && r.height >= 100 && lib.visible(node)) {
        const index = frames.length;
        frameElements.push(node);
        frames.push({
          index,
          url: abs(node.getAttribute("src"), ["http:", "https:"]),
          name: node.getAttribute("name"),
        });
        placeholder(parent, `MTFRAME${index}`);
      } else if (r && lib.visible(node)) {
        smallFrames++; // not captured, but recorded so the note says so (M9)
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
          fixed: isFixed(node),
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
          fixed: isFixed(node),
        },
        canvas,
      );
      return;
    }
    // MathJax 2 keeps each formula's TeX in a script beside its render; Defuddle reads it from
    // there. A script in the detached document never runs.
    if (tag === "SCRIPT" && /^math\/tex/i.test(node.getAttribute("type") ?? "")) {
      const script = parent.appendChild(out.createElement("script"));
      script.setAttribute("type", node.getAttribute("type")!);
      script.textContent = node.textContent;
      return;
    }
    if (lib.SKIP_TAGS.has(tag) || node instanceof SVGElement) return;
    if (!lib.visible(node) || lib.isIconGlyph(node)) return;
    if (structure.drawings.has(node)) {
      const r = node.getBoundingClientRect();
      mediaImg(
        parent,
        {
          index: media.length,
          kind: "element",
          url: null,
          svg: null,
          dataUrl: null,
          alt: node.getAttribute("aria-label") ?? "",
          rect: lib.docRect(node),
          selector: lib.cssPath(node),
          figure: r.width >= 120 && r.height >= 80,
          fixed: isFixed(node),
        },
        node,
      );
      for (const part of structure.hiddenParts(node)) cloneInto(part, parent);
      return;
    }
    if (structure.activities.has(node)) {
      const heading = node.querySelector("h1, h2, h3, h4, h5, h6");
      activities.push({ title: heading ? renderedText(heading) : "", url: pageUrl });
      const quote = parent.appendChild(out.createElement("blockquote"));
      placeholder(quote, `${activityToken}${activities.length - 1}`);
      activityDepth++;
      try {
        cloneChildren(node, quote);
      } finally {
        activityDepth--;
      }
      return;
    }
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
          fixed: isFixed(img),
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
    // GFM tables have no caption: it goes just above the table as its own line.
    if (tag === "CAPTION") return;
    const caption = tag === "TABLE" ? (node as HTMLTableElement).caption : null;
    if (caption && lib.visible(caption)) {
      const line = parent.appendChild(out.createElement("p"));
      for (const child of [...caption.childNodes]) cloneInto(child, line);
    }
    if (tag === "SLOT") {
      const assigned = (node as HTMLSlotElement).assignedNodes({ flatten: true });
      for (const child of assigned.length ? assigned : [...node.childNodes])
        cloneInto(child, parent);
      return;
    }
    const asTitle = activityDepth > 0 && /^H[1-6]$/.test(tag);
    // Defuddle deletes form markup (label, form, fieldset, legend), and with it question prompts
    // and option text: neutral elements keep their content.
    const name = asTitle ? "p" : (NEUTRAL[tag] ?? tag.toLowerCase());
    const copy = out.createElement(name);
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === "style" || attr.name === "srcset") continue;
      try {
        copy.setAttribute(attr.name, attr.value);
      } catch {
        // attribute names that are invalid outside the page's framework (e.g. "@click") are dropped
      }
    }
    parent.appendChild(copy);
    liveOf.set(copy, node);
    cloneChildren(node, asTitle ? copy.appendChild(out.createElement("strong")) : copy);
  };

  if (liveRoot === document.body) {
    for (const child of [...document.body.childNodes]) cloneInto(child, out.body);
  } else {
    cloneInto(liveRoot, out.body);
  }

  if (options.scope === "page") {
    // A heading and a directory of links/controls is navigation, not a lesson. Article
    // semantics and source media protect reference lists and image-only documents.
    const links = "a[href], [role=link], button, [role=button]";
    const directory = `nav, [role=navigation], ul a[href], ol a[href], [role=list] [role=link]`;
    const hasNavigation = [...liveRoot.querySelectorAll(directory)].some((el) => lib.visible(el));
    // This document is detached, so checkVisibility/walkRendered cannot read it. The
    // clone already filtered hidden nodes, fields, icon glyphs and chrome on the live page.
    const textWithoutLinks = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (node instanceof Element && node.matches(links)) return "";
      return [...node.childNodes].map(textWithoutLinks).join("");
    };
    const MAX_LINK_METADATA_CHARS = 80;
    const navigationRows = new Set<Element>();
    const directoryLinks = new Set<Element>();
    for (const row of out.body.querySelectorAll("li, [role=listitem], div, section, p")) {
      const anchors = row.querySelectorAll("a[href]");
      const anchor = anchors[0];
      if (anchors.length !== 1 || !anchor || row.querySelector(substantive)) continue;
      const target = abs(anchor.getAttribute("href"), ["http:", "https:"]);
      if (!target || new URL(target).origin !== location.origin) continue;
      const metadata = squash(textWithoutLinks(row));
      // Scores, dates and badges can be bare text or paragraphs. Sentences and longer
      // descriptions are source content, even when they sit beside a same-origin link.
      if (metadata.length > MAX_LINK_METADATA_CHARS || /[.!?](?:\s|$)/.test(metadata)) continue;
      navigationRows.add(row);
      directoryLinks.add(anchor);
    }
    const hasLinkDirectory = directoryLinks.size >= 2;
    const isNavigationRow = (el: Element) =>
      (hasLinkDirectory && navigationRows.has(el)) ||
      (el.matches("li, [role=listitem]") &&
        el.querySelector(links) !== null &&
        ![...el.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        ) &&
        !el.querySelector(substantive));
    const prose = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (
        node instanceof Element &&
        (node.matches(`h1, h2, h3, h4, h5, h6, ${links}`) || isNavigationRow(node))
      )
        return "";
      return [...node.childNodes].map(prose).join("");
    };
    if (
      (hasNavigation || hasLinkDirectory) &&
      !prose(out.body).trim() &&
      !out.body.querySelector(`article, ${contentObjects}`)
    )
      throw new Error("navigation_only");
  }

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
    // Content patterns (bylines, read times, eyebrow labels) are page text: dropping them would
    // fail page coverage, and a faithful note keeps them.
    result = run(out, scoped ? looseOptions : { removeContentPatterns: false });
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

  // Defuddle drops the H1 that repeats the page title; that heading is page text, so the note
  // keeps it. Only that H1: rendered text only, in the main content, matching the title. Main
  // content is the main landmark or an article when the page has one; never chrome, an aside or
  // a logo (a home page's logo h1 often repeats document.title).
  if (!scoped && engine === "defuddle") {
    const fold = (value: string) => squash(value).toLocaleLowerCase();
    const titles = new Set([result?.title ?? "", document.title].map(fold).filter(Boolean));
    const MAIN = "main, [role=main], article";
    const hasMain = document.querySelector(MAIN) !== null;
    const inMainContent = (el: Element) => {
      if (el.closest("aside, [role=complementary], [class*=logo i], [id*=logo i]")) return false;
      if (hasMain && !el.closest(MAIN)) return false;
      for (let at: Element | null = el; at; at = at.parentElement) if (isChrome(at)) return false;
      return true;
    };
    for (const h1 of document.querySelectorAll("h1")) {
      if (!lib.visible(h1) || !inMainContent(h1)) continue;
      const text = renderedText(h1);
      if (!text || !titles.has(fold(text))) continue;
      // Compared with the unescaped Markdown, so `_`, `*` or `[` in a title never add it twice.
      const unescaped = markdown.replace(/\\([\\`*_{}[\]()#+\-.!|$<>~])/g, "$1");
      if (!unescaped.includes(text)) {
        // Mirrors escapeMarkdownText in @mastertutor/contracts (markdown.ts), the source of truth;
        // the capture world cannot import it.
        const escaped = text.replace(/[\\`*_[\]<>]/g, (char) => `\\${char}`);
        markdown = `# ${escaped}\n\n${markdown}`;
      }
      break;
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
    // Defuddle built the selector on the flattened copy: resolve it there, then map back to the
    // live element (the live document can match a different element, or none).
    try {
      const match = out.querySelector(contentSelector);
      textRoot = (match && liveOf.get(match)) ?? liveRoot;
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
    isChrome,
  );
  const sourceText = tidy(rootParts);
  let pageText = sourceText;
  let excludedText = "";
  if (!scoped) {
    // App UI left out of the note still counts here: nothing proves it is not content, so a note
    // that drops it can never read verified. Drawings count as their picture (media accounting).
    const pageParts: string[] = [];
    lib.walkRendered(
      document.body,
      null,
      (_node, text) => pageParts.push(text),
      () => pageParts.push("\n"),
      (el) => isChrome(el) || structure.drawings.has(el),
    );
    pageText = tidy(pageParts);
    const excludedParts: string[] = [];
    for (const el of excluded)
      lib.walkRendered(
        el,
        null,
        (_node, text) => excludedParts.push(text),
        () => excludedParts.push("\n"),
        isChrome,
      );
    excludedText = tidy(excludedParts);
  }
  // Anchors are located in the whole scope (the body for a page), not only in Defuddle's root:
  // the note keeps blocks from anywhere on the page.
  globalThis.__mtCapture = { root: liveRoot, range, frames: frameElements, chrome: repeatedChrome };
  const texScope: ParentNode = scoped ? liveRoot : document;
  const mathTex = [
    ...texScope.querySelectorAll(
      'annotation[encoding="application/x-tex"], script[type^="math/tex"]',
    ),
  ]
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
    activities,
    activityToken,
    excludedText,
    frames,
    smallFrames,
  };
}
