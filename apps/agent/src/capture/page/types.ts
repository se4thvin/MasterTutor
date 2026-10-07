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
  /** Allowlisted SVG markup: no script, events, animation, styles sheets or external refs; null if nothing safe is left. */
  sanitizeSvg(svg: Element): string | null;
  /** Rendered text in flat-tree order (open and closed shadow, slots); math, media and form UI skipped. */
  walkRendered(
    root: Node,
    range: Range | null,
    onText: (node: Text, text: string) => void,
    onBreak: () => void,
    skip?: (el: Element) => boolean,
  ): void;
}

declare global {
  var __mtLib: MtLib | undefined;
  var __mtClosedRoots: WeakMap<Element, ShadowRoot> | undefined;
  var __mtCapture: { root: Element; range: Range | null; frames: Element[] } | undefined;
}

export interface PageMedia {
  index: number;
  kind: "img" | "svg" | "canvas";
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
  frames: PageFrame[];
  /** Visible frames too small to capture (under 200×100): recorded, not captured (M9). */
  smallFrames: number;
}
export interface BlockSnippet {
  head: string;
  tail: string;
}
export interface LocatedBlock {
  selector: string | null;
  xpath: string | null;
  /** Offsets into the root's normalized rendered text (NFKC, lower-case, single spaces). */
  start: number | null;
  end: number | null;
}
