import { assetUri, VERIFIED_COVERAGE, type BlockType } from "@mastertutor/contracts";
import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import { PageScriptError } from "../browser/isolated-world.ts";
import { captureMaskedRegion } from "../browser/region-capture.ts";
import type { LibraryServices } from "../library.ts";
import { sha256Hex } from "../notes/hash.ts";
import type { BlockDraft } from "../notes/note-writer.ts";
import { ToolError, type ToolContext } from "../tools/types.ts";
import { fetchInBrowser } from "./fetch-resource.ts";
import {
  blockPlainText,
  escapeMarkdownText,
  limitBlockSize,
  splitMarkdown,
  texOf,
  textToMarkdown,
} from "./markdown-blocks.ts";
import { storeMedia, type MediaReport, type StoredMedia } from "./media.ts";
import { pageExtract } from "./page/extract.ts";
import { pageLocateBlocks } from "./page/locate.ts";
import { pageSanitizeSvg } from "./page/svg.ts";
import type { PageExtract } from "./page/types.ts";
import { preparePage } from "./prepare.ts";
import { registerClosedShadowRoots } from "./shadow.ts";
import { takeSnapshot, type Snapshot } from "./snapshot.ts";
import { blockPrecision, combineCoverage, type Coverage, coverageOf, tokens } from "./text.ts";
import { textFragment } from "./text-fragment.ts";
import { captureWorlds, childFrames } from "./worlds.ts";

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
const OPAQUE_TOKENS = 30;
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
  blocks: BlockDraft[];
  root: Coverage;
  page: Coverage;
  media: MediaReport;
}

async function captureDocument(
  services: LibraryServices,
  ctx: ToolContext,
  worlds: IsolatedWorlds,
  frameId: string,
  scope: CaptureScope,
  isMain: boolean,
): Promise<{ doc: DocumentCapture; planned: AssembledBlock[] }> {
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
  const media = await storeMedia(
    {
      workspaceId: ctx.workspaceId,
      assets: services.assets,
      fetch: (url) => fetchInBrowser({ session: ctx.session, frameId, signal: ctx.signal }, url),
      sanitizeSvg: (text) => worlds.call(pageSanitizeSvg, [text], frameId),
      shoot: isMain
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
  const reference = `${extract.pageText}\n${extract.sourceText}`;
  const tex = new Set(extract.mathTex.map((value) => value.replace(/\s+/g, "")));
  const blocks: BlockDraft[] = textual.map((p, i) => {
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
  const captured = plains.join("\n");
  return {
    doc: {
      extract,
      blocks,
      root: coverageOf(extract.sourceText, captured),
      page: coverageOf(extract.pageText, captured),
      media,
    },
    planned,
  };
}

async function opaqueBlocks(
  services: LibraryServices,
  ctx: ToolContext,
): Promise<{ blocks: BlockDraft[]; withheld: number }> {
  const metrics = await (await ctx.session.cdp()).send("Page.getLayoutMetrics");
  const viewport = metrics.cssVisualViewport;
  const tiles = Math.min(
    OPAQUE_TILES,
    Math.ceil(metrics.cssContentSize.height / viewport.clientHeight),
  );
  const blocks: BlockDraft[] = [];
  let withheld = 0;
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
    const asset = await services.assets.put(ctx.workspaceId, {
      bytes: png,
      mime: "image/png",
      width: clip.width,
      height: clip.height,
      sourceUrl: null,
    });
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
    const text = await services.ocr.transcribe(png, { signal: ctx.signal, step: ctx.step });
    if (text)
      blocks.push({
        type: "paragraph",
        markdown: text,
        origin: "ocr_model",
        assetId: null,
        anchor,
        verified: false,
      });
  }
  return { blocks, withheld };
}

/** Spec §7 for a web page: prepare → snapshot → extract (main + same-process frames) → assets → verify. */
export async function captureWeb(
  services: LibraryServices,
  ctx: ToolContext,
  scope: CaptureScope,
): Promise<WebCapture> {
  if (scope.scope === "page") await preparePage(ctx.session, ctx.signal);
  ctx.signal.throwIfAborted();
  const snapshot = await takeSnapshot(ctx.session, ctx.mask, ctx.signal);
  const worlds = await captureWorlds(ctx.session);
  const frameId = await worlds.mainFrameId();
  const main = await captureDocument(services, ctx, worlds, frameId, scope, true);
  const frameDocs = new Map<number, DocumentCapture>();
  if (main.doc.extract.frames.length > 0) {
    const children = await childFrames(worlds.cdp);
    for (const frame of main.doc.extract.frames) {
      const child =
        children.find((c) => c.url === frame.url) ??
        children.find((c) => frame.name !== null && c.name === frame.name);
      if (!child) continue;
      try {
        const sub = await captureDocument(
          services,
          ctx,
          worlds,
          child.frameId,
          { scope: "element", selector: "body" },
          false,
        );
        frameDocs.set(frame.index, sub.doc);
      } catch (error) {
        if (error instanceof ToolError || ctx.signal.aborted) throw error;
        // Decision 10: out-of-process frames cannot host this world; their text is excluded from coverage.
        services.log.info(
          { errName: (error as Error).name },
          "skipping a frame that cannot host the capture world",
        );
      }
    }
  }
  const blocks: BlockDraft[] = [];
  let next = 0;
  for (const item of main.planned) {
    if (item.kind === "frame") blocks.push(...(frameDocs.get(item.index)?.blocks ?? []));
    else {
      const draft = main.doc.blocks[next++];
      if (draft) blocks.push(draft);
    }
  }
  const frames = [...frameDocs.values()];
  const root = combineCoverage([main.doc.root, ...frames.map((d) => d.root)]);
  const page = combineCoverage([main.doc.page, ...frames.map((d) => d.root)]);
  let mediaLost = main.doc.media.lost + frames.reduce((sum, d) => sum + d.media.lost, 0);
  let figuresWithheld =
    main.doc.media.withheld + frames.reduce((sum, d) => sum + d.media.withheld, 0);
  let engine: WebCapture["engine"] = main.doc.extract.engine;
  let finalBlocks = blocks;
  const capturedTokens = tokens(blocks.map((b) => blockPlainText(b)).join(" ")).length;
  if (
    scope.scope === "page" &&
    page.sourceTokens < OPAQUE_TOKENS &&
    capturedTokens < OPAQUE_TOKENS
  ) {
    engine = "opaque";
    const opaque = await opaqueBlocks(services, ctx);
    finalBlocks = opaque.blocks;
    figuresWithheld += opaque.withheld;
    if (opaque.blocks.length === 0) mediaLost += 1;
  }
  const { extract } = main.doc;
  return {
    url: ctx.session.page.url(),
    title: extract.title,
    description: extract.description,
    canonicalUrl: extract.canonicalUrl,
    faviconUrl: extract.faviconUrl,
    language: extract.language,
    engine,
    blocks: finalBlocks,
    coverage: page.coverage,
    contentSha256: sha256Hex(finalBlocks.map((b) => b.markdown).join("\n\n")),
    snapshot,
    meta: {
      rootCoverage: root.coverage,
      pageCoverage: page.coverage,
      rootTokens: root.sourceTokens,
      pageTokens: page.sourceTokens,
      mediaLost,
      figuresWithheld,
    },
  };
}
