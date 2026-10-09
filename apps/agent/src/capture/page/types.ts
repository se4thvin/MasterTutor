export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Helpers installed once per capture-world context by pageInstallLib (shared by every page function). */
export interface MtLib {
  SKIP_TAGS: Set<string>;
  MATH_SELECTOR: string;
  BLOCK_SELECTOR: string;
  shadowOf(el: Element): ShadowRoot | null;
  visible(el: Element): boolean;
  docRect(el: Element): Rect | null;
  cssPath(el: Element): string | null;
  xpathOf(el: Element): string | null;
  /** Navigation, banner, footer and search landmarks: not content (decision 12). */
  isChrome(el: Element): boolean;
  /** A single token drawn as one icon glyph (Private Use Area codepoint or ligature), not text. */
  isIconGlyph(el: Element): boolean;
  /** Allowlisted SVG markup: no script, events, animation, styles sheets or external refs; null if nothing safe is left. */
  sanitizeSvg(svg: Element): string | null;
  /** Rendered text in flat-tree order (open and closed shadow, slots); math, media, icon glyphs and form UI skipped. */
  walkRendered(
    root: Node,
    range: Range | null,
    onText: (node: Text, text: string) => void,
    onBreak: () => void,
    skip?: (el: Element) => boolean,
  ): void;
}

/** What pageInstallStructure found on a page (see page/structure.ts). */
export interface PageStructure {
  /** App UI before the main heading: left out of the note, still counted in page coverage. */
  excluded: Set<Element>;
  /** Positioned-text drawings: kept as an element screenshot, their labels left out. */
  drawings: Set<Element>;
  /** Interactive activities: rendered as one callout with a link back. */
  activities: Set<Element>;
  /** Choice options: each option's box, mapped to its parts (the box, then any `label[for]` beside it). */
  options: Map<Element, Element[]>;
  hiddenParts(drawing: Element): Element[];
}
export interface MtStructure {
  analyse(root: Element): PageStructure;
}

declare global {
  var __mtLib: MtLib | undefined;
  var __mtStructure: MtStructure | undefined;
  var __mtClosedRoots: WeakMap<Element, ShadowRoot> | undefined;
  var __mtCapture: { root: Element; range: Range | null; frames: Element[] } | undefined;
}

export interface PageMedia {
  index: number;
  /** "element": no original, only an element screenshot (a positioned-text drawing). */
  kind: "img" | "svg" | "canvas" | "element";
  url: string | null;
  /** Sanitized inline SVG markup. */
  svg: string | null;
  dataUrl: string | null;
  alt: string;
  /** Document coordinates (CSS px); null when not rendered. */
  rect: Rect | null;
  selector: string | null;
  /** Charts and diagrams: also kept as an element screenshot (spec §7.4). */
  figure: boolean;
  /** Fixed or sticky: its document rect moves with scrolling, so no element shot is taken. */
  fixed: boolean;
}
export interface PageActivity {
  title: string;
  url: string | null;
}
export interface PageFrame {
  index: number;
  url: string | null;
  name: string | null;
}
export interface ExtractOptions {
  scope: "page" | "selection" | "element";
  selector: string | null;
}
export interface PageExtract {
  engine: "defuddle" | "readability" | "text" | "none";
  title: string;
  description: string | null;
  canonicalUrl: string | null;
  faviconUrl: string | null;
  language: string | null;
  markdown: string;
  /** Rendered text of Defuddle's content root (or the scope); blocks separated by "\n". */
  sourceText: string;
  /** Rendered text of the whole body minus page chrome; equals sourceText for element/selection scopes. */
  pageText: string;
  /** TeX of every in-scope MathML `annotation[encoding="application/x-tex"]` (Q3). */
  mathTex: string[];
  media: PageMedia[];
  rawTables: string[];
  /** Each activity placeholder's title text and the page it links back to (http/https only). */
  activities: PageActivity[];
  /** This capture's activity placeholder prefix (random): `<token><index>` marks activity `index`. */
  activityToken: string;
  /** Text of the app UI left out of the note (still counted in pageText), for audit. */
  excludedText: string;
  frames: PageFrame[];
  /** Visible frames too small to capture (under 200×100): recorded, not captured (M9). */
  smallFrames: number;
}
export interface BlockSnippet {
  selector?: string | null;
  head: string;
  tail: string;
}
export interface LocatedBlock {
  selector: string | null;
  xpath: string | null;
  domOrder?: number[];
  /** Offsets into the target element's normalized rendered text (NFKC, lower-case, single spaces). */
  start: number | null;
  end: number | null;
}
