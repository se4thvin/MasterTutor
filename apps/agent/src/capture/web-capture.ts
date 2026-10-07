import {
  assetUri,
  escapeMarkdownText,
  VERIFIED_COVERAGE,
  type BlockType,
} from "@mastertutor/contracts";
import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import { PageScriptError } from "../browser/isolated-world.ts";
import { containsSecretText } from "../browser/masking.ts";
import { captureMaskedRegion } from "../browser/region-capture.ts";
import type { LibraryServices } from "../library.ts";
import { sha256Hex } from "../notes/hash.ts";
import { NoteWriteError, screenText, screenValue, type BlockDraft } from "../notes/note-writer.ts";
import { ToolError, type ToolContext } from "../tools/types.ts";
import { fetchInBrowser } from "./fetch-resource.ts";
import {
  blockPlainText,
  limitBlockSize,
  splitMarkdown,
  texOf,
  textToMarkdown,
} from "./markdown-blocks.ts";
import { storeMedia, type StoredMedia } from "./media.ts";
import { pageExtract } from "./page/extract.ts";
import { pageLocateBlocks } from "./page/locate.ts";
import { pageSanitizeSvg } from "./page/svg.ts";
import type { PageExtract } from "./page/types.ts";
import { pixelsAreClean } from "./local-ocr.ts";
import { preparePage } from "./prepare.ts";
import { registerClosedShadowRoots } from "./shadow.ts";
import { takeSnapshot, type Snapshot } from "./snapshot.ts";
import { blockPrecision, coverageOf, mergeReferences, tokens } from "./text.ts";
import { textFragment } from "./text-fragment.ts";
import { captureWorlds } from "./worlds.ts";

export interface CaptureScope {
  scope: "page" | "selection" | "element";
  selector: string | null;
}

export interface WebCapture {
  url: string;
  title: string;
  description: string | null;
  canonicalUrl: string | null;
  faviconUrl: string | null;
  language: string | null;
  engine: PageExtract["engine"] | "opaque";
  blocks: BlockDraft[];
  /** Page coverage (decision 12). */
  coverage: number;
  contentSha256: string;
  snapshot: Snapshot;
  /** rootCoverage, pageCoverage, rootTokens, pageTokens, mediaLost, figuresWithheld. */
  meta: Record<string, unknown>;
}

export type AssembledBlock =
  | {
      kind: "block";
      block: { type: BlockType; markdown: string };
      assetId: string | null;
      selector: string | null;
    }
  | { kind: "frame"; index: number };

const MEDIA_TOKEN = /!\[([^\]]*)\]\(https:\/\/mt-media\.invalid\/(\d+)\)/g;
const ONLY_MEDIA = /^\s*(?:!\[[^\]]*\]\(https:\/\/mt-media\.invalid\/\d+\)\s*)+$/;
const OPAQUE_TILES = 3;

/**
 * Resolves the extraction placeholders into blocks (pure). A block made only of images becomes one
 * image or figure block per stored image, with the image in `assetId` and only the caption in the
 * Markdown (decision 14). Images inside text stay inline as `![alt](asset:<id>)`.
 */
export function assembleBlocks(
  extract: PageExtract,
  stored: ReadonlyMap<number, StoredMedia>,
): AssembledBlock[] {
  const out: AssembledBlock[] = [];
  for (const block of splitMarkdown(extract.markdown)) {
    const trimmed = block.markdown.trim();
    const table = /^MTRAWTABLE(\d+)$/.exec(trimmed);
    if (table) {
      const html = extract.rawTables[Number(table[1])];
      if (html)
        out.push({
          kind: "block",
          block: { type: "table", markdown: html },
          assetId: null,
          selector: null,
        });
      continue;
    }
    const frame = /^MTFRAME(\d+)$/.exec(trimmed);
    if (frame) {
      out.push({ kind: "frame", index: Number(frame[1]) });
      continue;
    }
    if (ONLY_MEDIA.test(trimmed)) {
      for (const match of trimmed.matchAll(MEDIA_TOKEN)) {
        const index = Number(match[2]);
        const media = stored.get(index);
        const item = extract.media.find((m) => m.index === index);
        const assetId = media?.assetId ?? media?.screenshotAssetId ?? null;
        if (!assetId) continue;
        const caption = escapeMarkdownText((match[1] ?? "").trim());
        const both = item?.figure && media?.assetId && media.screenshotAssetId;
        const markdown = both
          ? `${caption ? `${caption}\n\n` : ""}[Rendered view](${assetUri(media.screenshotAssetId!)})`
          : caption;
        out.push({
          kind: "block",
          block: { type: item?.figure ? "figure" : "image", markdown },
          assetId,
          selector: item?.selector ?? null,
        });
      }
      continue;
    }
    const markdown = block.markdown
      .replace(MEDIA_TOKEN, (_match, alt: string, index: string) => {
        const media = stored.get(Number(index));
        const id = media?.assetId ?? media?.screenshotAssetId;
        return id ? `![${alt}](${assetUri(id)})` : "";
      })
      .replace(/ {2,}/g, " ")
      .trim();
    if (markdown)
      out.push({
        kind: "block",
        block: { type: block.type, markdown },
        assetId: null,
        selector: null,
      });
  }
  return out;
}

/** Per-block verification (Q2, Q3): text comes from the page, math equals a TeX annotation, media was stored. */
export function verifyBlock(
  block: { type: string; markdown: string },
  plain: string,
  reference: string,
  tex: ReadonlySet<string>,
): boolean {
  if (block.type === "math") {
    const own = texOf(block.markdown);
    return own !== null && tex.has(own);
  }
  if (block.type === "image" || block.type === "figure") return true;
  return plain === "" || blockPrecision(plain, reference) >= VERIFIED_COVERAGE;
}

interface DocumentCapture {
  extract: PageExtract;
  /** Blocks in document order, each frame's blocks in its placeholder's place. */
  blocks: BlockDraft[];
  /** Text the document shows (the page minus chrome; a frame's body), its frames' included. */
  pageTexts: string[];
  /** Text of the content roots, for diagnosis only. */
  rootTexts: string[];
  mediaLost: number;
  figuresWithheld: number;
  /** Same-process frames that could not be matched or read: their text is missing (I4). */
  framesMissing: number;
  framesSkipped: number;
}

/** Nested frames beyond this depth are counted missing rather than captured. */
const MAX_FRAME_DEPTH = 3;

async function extractIn(
  worlds: IsolatedWorlds,
  frameId: string,
  scope: CaptureScope,
): Promise<PageExtract> {
  await registerClosedShadowRoots(worlds, frameId);
  let extract: PageExtract;
  try {
    extract = await worlds.call(pageExtract, [scope], frameId);
  } catch (error) {
    const code = /selector_not_found|no_selection/.exec(
      error instanceof PageScriptError ? error.message : "",
    )?.[0];
    if (code)
      throw new ToolError(
        code,
        code === "no_selection" ? "Nothing is selected" : "No element matches the selector",
      );
    throw error;
  }
  if (extract.engine === "none" && extract.sourceText.trim()) {
    extract = {
      ...extract,
      engine: "text",
      markdown: textToMarkdown(extract.sourceText.replace(/\n/g, "\n\n")),
    };
  }
  return extract;
}

/** The CDP frame id of the iframe behind placeholder `index` (null when it is gone). */
async function frameIdOf(
  worlds: IsolatedWorlds,
  index: number,
  parentFrameId: string,
): Promise<string | null> {
  const objectId = await worlds
    .evaluateHandle(`globalThis.__mtCapture?.frames[${index}] ?? null`, parentFrameId)
    .catch(() => null);
  if (!objectId) return null;
  try {
    const { node } = await worlds.cdp.send("DOM.describeNode", { objectId });
    return node.frameId ?? null;
  } catch {
    return null;
  } finally {
    await worlds.cdp.send("Runtime.releaseObject", { objectId }).catch(() => undefined);
  }
}

async function captureDocument(
  services: LibraryServices,
  ctx: ToolContext,
  worlds: IsolatedWorlds,
  frameId: string,
  scope: CaptureScope,
  depth: number,
): Promise<DocumentCapture> {
  const extract = await extractIn(worlds, frameId, scope);
  // A vault secret anywhere in what was read ends the capture before any asset is stored.
  screenValue(ctx.mask, [extract.pageText, extract.sourceText]);
  // Frame ids first: a child's own extraction does not touch this document's capture state.
  const frameIds = await Promise.all(
    extract.frames.map((frame) => frameIdOf(worlds, frame.index, frameId)),
  );
  const media = await storeMedia(
    {
      workspaceId: ctx.workspaceId,
      assets: services.assets,
      secrets: ctx.mask,
      localOcr: services.localOcr,
      fetch: (url) => fetchInBrowser({ session: ctx.session, frameId, signal: ctx.signal }, url),
      sanitizeSvg: (text) => worlds.call(pageSanitizeSvg, [text], frameId),
      shoot:
        depth === 0
          ? (clip, scale) => captureMaskedRegion(ctx.session, ctx.mask, { clip, scale }, ctx.signal)
          : null,
      signal: ctx.signal,
    },
    extract.media,
  );
  const planned = assembleBlocks(extract, media.stored).flatMap((item): AssembledBlock[] =>
    item.kind === "block"
      ? limitBlockSize(item.block).map((part) => ({ ...item, block: part }))
      : [item],
  );
  const textual = planned.filter(
    (p): p is Extract<AssembledBlock, { kind: "block" }> => p.kind === "block",
  );
  const plains = textual.map((p) => blockPlainText(p.block));
  const located = await worlds.call(
    pageLocateBlocks,
    [
      plains.map((plain) => ({
        head: plain.slice(0, 60),
        tail: plain.length > 60 ? plain.slice(-60) : "",
      })),
    ],
    frameId,
  );
  const reference = mergeReferences([extract.pageText, extract.sourceText]);
  const tex = new Set(extract.mathTex.map((value) => value.replace(/\s+/g, "")));
  const own: BlockDraft[] = textual.map((p, i) => {
    const plain = plains[i] ?? "";
    const where = located[i];
    return {
      type: p.block.type,
      markdown: p.block.markdown,
      origin: "dom",
      assetId: p.assetId,
      verified: verifyBlock(p.block, plain, reference, tex),
      anchor: {
        selector: where?.selector ?? p.selector,
        xpath: where?.xpath ?? null,
        start: where?.start ?? null,
        end: where?.end ?? null,
        textFragment: plain ? textFragment(plain) : null,
      },
    };
  });

  const doc: DocumentCapture = {
    extract,
    blocks: [],
    pageTexts: [extract.pageText],
    rootTexts: [extract.sourceText],
    mediaLost: media.lost,
    figuresWithheld: media.withheld,
    framesMissing: 0,
    framesSkipped: extract.smallFrames,
  };
  const outOfProcess = (await ctx.session.frameCoverage()).outOfProcess;
  /** Child frames this document has accounted for: captured, or counted missing. */
  const seen = new Set<string>();
  let next = 0;
  for (const item of planned) {
    if (item.kind === "block") {
      const draft = own[next++];
      if (draft) doc.blocks.push(draft);
      continue;
    }
    const childId = frameIds[item.index] ?? null;
    if (childId) seen.add(childId);
    // Decision 10: an out-of-process frame cannot host this world; it is left out of coverage.
    if (childId && outOfProcess.has(childId)) continue;
    if (!childId || depth + 1 > MAX_FRAME_DEPTH) {
      doc.framesMissing++;
      continue;
    }
    let child: DocumentCapture;
    try {
      child = await captureDocument(
        services,
        ctx,
        worlds,
        childId,
        { scope: "element", selector: "body" },
        depth + 1,
      );
    } catch (error) {
      if (error instanceof ToolError || error instanceof NoteWriteError || ctx.signal.aborted)
        throw error;
      services.log.info({ errName: (error as Error).name }, "a frame could not be read");
      doc.framesMissing++;
      continue;
    }
    doc.blocks.push(...child.blocks);
    doc.pageTexts.push(...child.pageTexts);
    doc.rootTexts.push(...child.rootTexts);
    doc.mediaLost += child.mediaLost;
    doc.figuresWithheld += child.figuresWithheld;
    doc.framesMissing += child.framesMissing;
    doc.framesSkipped += child.framesSkipped;
  }
  // Every other same-process child frame, from CDP: placeholders Defuddle dropped, small frames.
  // Each is read; one that shows text the note does not hold counts missing (re-review N2).
  for (const childId of await framesInScope(worlds, frameId)) {
    if (seen.has(childId) || outOfProcess.has(childId)) continue;
    if (await showsUnreadText(ctx, worlds, childId, outOfProcess, depth + 1)) doc.framesMissing++;
  }
  return doc;
}

/** Runs in the parent's capture world with `this` = the frame's owner element (A-I1). */
const OWNER_IN_SCOPE = `function () {
  const state = globalThis.__mtCapture;
  const lib = globalThis.__mtLib;
  if (!state || !lib) return true;
  // Composed containment: an owner inside a shadow root still belongs to its host's subtree.
  let inRoot = false;
  for (let at = this; at; at = at.parentNode ?? (at instanceof ShadowRoot ? at.host : null))
    if (at === state.root) { inRoot = true; break; }
  if (!inRoot) return false;
  if (state.range && !state.range.intersectsNode(this)) return false;
  return lib.visible(this);
}`;

/**
 * The same-process child frames of `frameId` the reader can see inside the capture scope: each
 * frame's owner element must lie in the scope's root (and selection) and be visible. Hidden or
 * out-of-scope frames never block `verified`; an owner that cannot be checked counts (fail closed).
 */
async function framesInScope(worlds: IsolatedWorlds, frameId: string): Promise<string[]> {
  interface Tree {
    frame: { id: string };
    childFrames?: Tree[];
  }
  const { frameTree } = (await worlds.cdp.send("Page.getFrameTree")) as unknown as {
    frameTree: Tree;
  };
  const find = (tree: Tree): Tree | null =>
    tree.frame.id === frameId ? tree : ((tree.childFrames ?? []).map(find).find(Boolean) ?? null);
  const children = (find(frameTree)?.childFrames ?? []).map((child) => child.frame.id);
  const kept: string[] = [];
  for (const childId of children) {
    let inScope: boolean;
    try {
      const { backendNodeId } = await worlds.cdp.send("DOM.getFrameOwner", { frameId: childId });
      inScope = await worlds.callOnNode<boolean>(backendNodeId, OWNER_IN_SCOPE, null, frameId);
    } catch {
      inScope = true;
    }
    if (inScope) kept.push(childId);
  }
  return kept;
}

/**
 * True when a frame the note does not hold renders text (in itself or its own frames), or cannot
 * be read at all. Its text is screened like any other: a vault secret refuses the capture.
 */
async function showsUnreadText(
  ctx: ToolContext,
  worlds: IsolatedWorlds,
  frameId: string,
  outOfProcess: ReadonlyMap<string, unknown>,
  depth: number,
): Promise<boolean> {
  if (depth > MAX_FRAME_DEPTH) return true;
  let extract: PageExtract;
  try {
    extract = await extractIn(worlds, frameId, { scope: "element", selector: "body" });
  } catch (error) {
    if (error instanceof ToolError || ctx.signal.aborted) throw error;
    return true;
  }
  screenValue(ctx.mask, [extract.pageText, extract.sourceText]);
  if (tokens(extract.sourceText).length > 0) return true;
  for (const childId of await framesInScope(worlds, frameId)) {
    if (outOfProcess.has(childId)) continue;
    if (await showsUnreadText(ctx, worlds, childId, outOfProcess, depth + 1)) return true;
  }
  return false;
}

/** The full-page PNG holds canvas pixels no text screen sees: screened locally like them (A-M2). */
async function screenedSnapshot(
  services: LibraryServices,
  ctx: ToolContext,
  snapshot: Snapshot,
): Promise<Snapshot> {
  if (
    !snapshot.png ||
    (await pixelsAreClean(services.localOcr, ctx.mask, snapshot.png, ctx.signal))
  )
    return snapshot;
  return {
    ...snapshot,
    png: null,
    pngSha256: null,
    skipped: [...snapshot.skipped, "png:withheld"],
  };
}

/** Spec §7.7 for pages without usable DOM text: masked viewport tiles, each transcribed by OCR. */
async function opaqueBlocks(
  services: LibraryServices,
  ctx: ToolContext,
): Promise<{ blocks: BlockDraft[]; withheld: number; lost: number }> {
  const metrics = await (await ctx.session.cdp()).send("Page.getLayoutMetrics");
  const viewport = metrics.cssVisualViewport;
  const tiles = Math.min(
    OPAQUE_TILES,
    Math.ceil(metrics.cssContentSize.height / viewport.clientHeight),
  );
  const blocks: BlockDraft[] = [];
  let withheld = 0;
  let lost = 0;
  for (let i = 0; i < tiles; i++) {
    ctx.signal.throwIfAborted();
    const clip = {
      x: 0,
      y: i * viewport.clientHeight,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    };
    const png = await captureMaskedRegion(ctx.session, ctx.mask, { clip, scale: 1 }, ctx.signal);
    if (!png) {
      withheld++;
      continue;
    }
    // Pixels reach OpenAI only after a local secret screen passes (A-M1).
    if (!(await pixelsAreClean(services.localOcr, ctx.mask, png, ctx.signal))) {
      withheld++;
      continue;
    }
    // Transcribed and screened before the tile is stored: canvas text is invisible to the AX gate.
    let text: string | null;
    try {
      text = await services.ocr.transcribe(png, { signal: ctx.signal, step: ctx.step });
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      // A transient model error loses this tile's text, not the capture (M6).
      services.log.warn({ errName: (error as Error).name }, "OCR failed for a page region");
      text = null;
    }
    if (text !== null) screenText(ctx.mask, text);
    // Unread pixels are never stored while the run holds secrets (re-review I1).
    if (text === null && ctx.mask.hasSecrets()) {
      withheld++;
      continue;
    }
    const asset = await services.assets.put(
      ctx.workspaceId,
      { bytes: png, mime: "image/png", width: clip.width, height: clip.height, sourceUrl: null },
      ctx.mask,
    );
    const anchor = {
      selector: null,
      xpath: null,
      start: null,
      end: null,
      textFragment: null,
      bbox: clip,
    };
    blocks.push({
      type: "image",
      markdown: `Page region ${i + 1}`,
      origin: "dom",
      assetId: asset.assetId,
      anchor,
      verified: true,
    });
    if (text === null) {
      lost++;
      continue;
    }
    // Headings, lists and paragraphs stay separate blocks, each within the size limit (M4).
    for (const part of splitMarkdown(text).flatMap((block) => limitBlockSize(block)))
      blocks.push({ ...part, origin: "ocr_model", assetId: null, anchor, verified: false });
  }
  return { blocks, withheld, lost };
}

/** Spec §7 for a web page: prepare → secret gate → snapshot → extract (frames too) → assets → verify. */
export async function captureWeb(
  services: LibraryServices,
  ctx: ToolContext,
  scope: CaptureScope,
): Promise<WebCapture> {
  if (scope.scope === "page") await preparePage(ctx.session, ctx.signal);
  ctx.signal.throwIfAborted();
  // D8: a page that shows a vault secret is refused before any snapshot or asset is written.
  if (ctx.mask.hasSecrets() && (await containsSecretText(ctx.session, ctx.mask, ctx.signal)))
    throw new ToolError("secret_on_page", "The page shows a saved secret; nothing was stored");
  const snapshot = await screenedSnapshot(
    services,
    ctx,
    await takeSnapshot(ctx.session, ctx.mask, ctx.signal),
  );
  const worlds = await captureWorlds(ctx.session);
  const main = await captureDocument(services, ctx, worlds, await worlds.mainFrameId(), scope, 0);
  const blocks = [...main.blocks];
  let { mediaLost, figuresWithheld } = main;
  let engine: WebCapture["engine"] = main.extract.engine;
  const pageText = main.pageTexts.join("\n");
  const domText = blocks.map((b) => blockPlainText(b)).join("\n");
  // The opaque ruling: DOM text, however short, is always used; OCR runs only when there is none.
  if (scope.scope === "page" && tokens(pageText).length === 0 && tokens(domText).length === 0) {
    engine = "opaque";
    const opaque = await opaqueBlocks(services, ctx);
    blocks.push(...opaque.blocks);
    figuresWithheld += opaque.withheld;
    mediaLost += opaque.lost + (opaque.blocks.length === 0 ? 1 : 0);
  }
  // Unread frames are missing content: the note cannot claim to be verified (I4).
  mediaLost += main.framesMissing;
  // Coverage of what the note finally holds (I2).
  const captured = blocks.map((b) => blockPlainText(b)).join("\n");
  const page = coverageOf(pageText, captured);
  const root = coverageOf(main.rootTexts.join("\n"), captured);
  const { extract } = main;
  return {
    url: ctx.session.page.url(),
    title: extract.title,
    description: extract.description,
    canonicalUrl: extract.canonicalUrl,
    faviconUrl: extract.faviconUrl,
    language: extract.language,
    engine,
    blocks,
    coverage: page.coverage,
    contentSha256: sha256Hex(blocks.map((b) => b.markdown).join("\n\n")),
    snapshot,
    meta: {
      rootCoverage: root.coverage,
      pageCoverage: page.coverage,
      rootTokens: root.sourceTokens,
      pageTokens: page.sourceTokens,
      mediaLost,
      figuresWithheld,
      framesMissing: main.framesMissing,
      framesSkipped: main.framesSkipped,
    },
  };
}
