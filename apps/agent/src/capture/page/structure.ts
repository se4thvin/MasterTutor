import type { MtStructure, PageStructure } from "./types.ts";

/**
 * Runs inside the capture world after pageInstallLib. Must stay self-contained. Finds the parts of
 * an application page that are not prose: app UI before the main heading, drawings made of
 * positioned text, interactive activities and choice options. Every rule reads generic markup
 * (headings, form controls, ARIA roles, layout), never a site's class names.
 */
export function pageInstallStructure(): void {
  const lib = globalThis.__mtLib;
  if (!lib) throw new Error("lib_missing");
  const MAIN = "main, [role=main]";
  const HEADING = "h1, h2, h3, h4, h5, h6";
  /** Anything a reader operates rather than reads. */
  const CONTROL =
    "button, select, textarea, input:not([type=hidden]), [role=button], [role=combobox], [role=listbox], [role=menu], [role=menubar], [role=tablist], [role=switch], [aria-haspopup]:not([aria-haspopup=false])";
  /** Controls that take an answer (a button alone does not make an activity). */
  const FIELD =
    "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), textarea, select, [role=radio], [role=checkbox], [role=textbox], [role=spinbutton], [role=slider], [contenteditable=''], [contenteditable=true]";
  const CHOICE = "input[type=radio], input[type=checkbox], [role=radio], [role=checkbox]";
  /** Drawings: at least this many positioned text boxes, each a short label. */
  const MIN_PIECES = 6;
  const MAX_PIECE_CHARS = 40;
  const MAX_DRAWING_CHARS = 3000;
  const MAX_OPTION_CHARS = 300;
  /** What makes a subtree content, never UI: media, figures, headings, tables, code, quotes, math. */
  const CONTENT =
    "img, picture, video, audio, canvas, iframe, figure, figcaption, h1, h2, h3, h4, h5, h6, table, pre, blockquote, math";
  /** A text run this long is prose (a sentence), not a control's label. */
  const PROSE_CHARS = 60;
  /** Positioned layouts that are lists or grids of text (virtualized rows, data grids): never drawings. */
  const LIST_LIKE =
    "table, ul, ol, [role=grid], [role=row], [role=gridcell], [role=table], [role=list], [role=listitem], [role=listbox], [role=option]";

  const inChrome = (el: Element): boolean => {
    for (let at: Element | null = el; at; at = at.parentElement) if (lib.isChrome(at)) return true;
    return false;
  };
  const hasVisible = (el: Element, selector: string): boolean =>
    (el.matches(selector) && lib.visible(el)) ||
    [...el.querySelectorAll(selector)].some((match) => lib.visible(match));
  /** Visually hidden (screen-reader-only) boxes: clipped to a pixel or less. */
  const srOnly = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width <= 1 || r.height <= 1;
  };
  /** `el` or an ancestor below `stop` is screen-reader-only. */
  const hiddenWithin = (el: Element, stop: Element): boolean => {
    for (let at: Element | null = el; at && at !== stop; at = at.parentElement)
      if (srOnly(at)) return true;
    return false;
  };
  const ownText = (el: Element): boolean =>
    [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
  const commonAncestor = (elements: Element[]): Element | null => {
    let ancestor: Element | null = elements[0] ?? null;
    while (ancestor && !elements.every((el) => ancestor!.contains(el)))
      ancestor = ancestor.parentElement;
    return ancestor;
  };

  /** The page's first visible H1 outside chrome, in the main landmark when there is one. */
  const mainHeading = (): Element | null => {
    const container = document.querySelector(MAIN) ?? document.body;
    for (const h1 of container.querySelectorAll("h1"))
      if (lib.visible(h1) && !inChrome(h1)) return h1;
    return null;
  };

  /** Media of a size worth keeping, a figure, heading, table, code, quote or math, or a sentence. */
  const holdsContent = (el: Element): boolean => {
    for (const match of [el, ...el.querySelectorAll(`${CONTENT}, svg`)]) {
      if (!match.matches(`${CONTENT}, svg`) || !lib.visible(match)) continue;
      if (match.tagName.toLowerCase() !== "svg") return true;
      const r = match.getBoundingClientRect();
      if (r.width >= 48 && r.height >= 48) return true;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if ((node.textContent ?? "").trim().length > PROSE_CHARS) return true;
    return false;
  };

  /**
   * App UI above the main heading: every earlier sibling, along the heading's ancestor path up to
   * body, that holds a control and no content (holdsContent). A dek or eyebrow label has no
   * control and stays; a hero figure with an "Enlarge" button is content and stays; a toolbar, a
   * collapsible table of contents or a status box with a dropdown is UI. It leaves the note but
   * still counts in page coverage: nothing proves it is not content.
   */
  const leadingChrome = (heading: Element): Element[] => {
    const out: Element[] = [];
    for (let at: Element | null = heading; at && at !== document.body; at = at.parentElement)
      for (let sib = at.previousElementSibling; sib; sib = sib.previousElementSibling)
        if (lib.visible(sib) && hasVisible(sib, CONTROL) && !holdsContent(sib)) out.push(sib);
    return out;
  };

  /**
   * Drawings built from absolutely positioned text (animation frames, diagrams of divs): read in
   * DOM order their labels are noise, so each is kept as a picture instead. A drawing is the
   * nearest common ancestor of at least MIN_PIECES positioned text boxes sharing one containing
   * block, where every visible text in it sits in one of those boxes.
   */
  const drawings = (root: Element): Element[] => {
    const piecesByBlock = new Map<Element, Set<Element>>();
    for (const el of root.querySelectorAll("*")) {
      if (el instanceof SVGElement || lib.SKIP_TAGS.has(el.tagName) || !ownText(el)) continue;
      if (!lib.visible(el)) continue;
      let box: Element | null = null;
      for (let at: Element | null = el, depth = 0; at && depth < 3; at = at.parentElement, depth++)
        if (getComputedStyle(at).position === "absolute") {
          box = at;
          break;
        }
      if (!box || srOnly(box) || !(box instanceof HTMLElement) || !box.offsetParent) continue;
      const pieces = piecesByBlock.get(box.offsetParent) ?? new Set<Element>();
      pieces.add(box);
      piecesByBlock.set(box.offsetParent, pieces);
    }
    const out: Element[] = [];
    for (const set of piecesByBlock.values()) {
      const pieces = [...set];
      if (pieces.length < MIN_PIECES) continue;
      if (pieces.some((piece) => (piece.textContent ?? "").trim().length > MAX_PIECE_CHARS))
        continue;
      const drawing = commonAncestor(pieces);
      if (!drawing || drawing === root || drawing === document.body) continue;
      if ((drawing.textContent ?? "").length > MAX_DRAWING_CHARS) continue;
      if (drawing.matches(LIST_LIKE) || drawing.querySelector(LIST_LIKE)) continue;
      const inPiece = (el: Element) => pieces.some((piece) => piece.contains(el));
      const stray = [...drawing.querySelectorAll("*")].some(
        (el) => ownText(el) && lib.visible(el) && !inPiece(el) && !hiddenWithin(el, drawing),
      );
      if (!stray && !drawing.querySelector(HEADING)) out.push(drawing);
    }
    return out;
  };

  /** A drawing's top-most screen-reader-only parts (a static description): kept as text beside its picture. */
  const hiddenParts = (drawing: Element): Element[] =>
    [...drawing.querySelectorAll("*")].filter(
      (el) =>
        srOnly(el) &&
        (el.textContent ?? "").trim() !== "" &&
        !(el.parentElement && hiddenWithin(el.parentElement, drawing)),
    );

  /**
   * Interactive activities: the nearest ancestor of an answer field (or a drawing) that holds a
   * heading, when it holds exactly one, the heading comes first, and it is not the page's main
   * content (main landmark, article, body or anything holding the main heading).
   */
  const activities = (root: Element, heading: Element | null, drawn: Element[]): Element[] => {
    const found = new Set<Element>();
    const triggers = [...root.querySelectorAll(FIELD), ...drawn];
    for (const trigger of triggers) {
      if (inChrome(trigger)) continue;
      for (let at = trigger.parentElement; at && at !== root; at = at.parentElement) {
        if (at.matches(MAIN) || at.tagName === "ARTICLE" || at === document.body) break;
        const headings = at.querySelectorAll(HEADING);
        if (headings.length === 0) continue;
        const title = headings[0]!;
        const first =
          (title.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        if (headings.length === 1 && first && !(heading && at.contains(heading)) && lib.visible(at))
          found.add(at);
        break;
      }
    }
    return [...found].filter((a) => ![...found].some((b) => b !== a && b.contains(a)));
  };

  /**
   * Choice options (radio buttons, checkboxes): each control's largest ancestor holding no other
   * choice, plus the `label[for]` beside it when the control stands bare in its group, when at
   * least two such options share a parent. Each option maps to its parts in document order, so
   * the note clones them (math, code and images inside a label survive).
   */
  const options = (root: Element): Map<Element, Element[]> => {
    const found: { control: Element; box: Element }[] = [];
    for (const control of root.querySelectorAll(CHOICE)) {
      let box: Element = control;
      while (
        box.parentElement &&
        box.parentElement !== root &&
        box.parentElement.querySelectorAll(CHOICE).length === 1
      )
        box = box.parentElement;
      found.push({ control, box });
    }
    const out = new Map<Element, Element[]>();
    for (const { control, box } of found) {
      if (found.filter((other) => other.box.parentElement === box.parentElement).length < 2)
        continue;
      const labels =
        box === control && control instanceof HTMLInputElement
          ? [...(control.labels ?? [])].filter(
              (label) => label.parentElement === box.parentElement && !label.contains(box),
            )
          : [];
      const parts = [box, ...labels];
      const text = parts
        .map((part) => part.textContent ?? "")
        .join(" ")
        .trim();
      const named = text !== "" || control.getAttribute("aria-label");
      if (named && text.length <= MAX_OPTION_CHARS) out.set(box, parts);
    }
    return out;
  };

  const analyse: MtStructure["analyse"] = (root) => {
    const heading = mainHeading();
    const excluded = new Set(heading ? leadingChrome(heading) : []);
    const drawn = drawings(root).filter((d) => ![...excluded].some((e) => e.contains(d)));
    const structure: PageStructure = {
      excluded,
      drawings: new Set(drawn),
      activities: new Set(activities(root, heading, drawn)),
      options: options(root),
      hiddenParts,
    };
    return structure;
  };
  globalThis.__mtStructure = { analyse };
}
