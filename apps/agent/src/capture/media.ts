import type { Box } from "../browser/masking.ts";
import type { AssetStore } from "../notes/assets.ts";
import { decodeDataUrl, type FetchedResource } from "./fetch-resource.ts";
import { imageInfo, isSafeSvg, sniffSvg } from "./images.ts";
import type { PageMedia } from "./page/types.ts";

export interface MediaContext {
  workspaceId: string;
  assets: AssetStore;
  /** fetchInBrowser bound to the item's frame (network policy applies). */
  fetch(url: string): Promise<FetchedResource | null>;
  /** pageSanitizeSvg in the capture world; null when nothing safe is left. */
  sanitizeSvg(text: string): Promise<string | null>;
  /** captureMaskedRegion bound to the page; null for child frames (their rects are not page coordinates). */
  shoot: ((clip: Box, scale: number) => Promise<Uint8Array | null>) | null;
  signal: AbortSignal;
}

export interface StoredMedia {
  /** The original (img bytes, sanitized SVG or canvas PNG). */
  assetId: string | null;
  /** Element screenshot at clip.scale 2: always for charts/diagrams, else only when the original failed. */
  screenshotAssetId: string | null;
}

export interface MediaReport {
  stored: Map<number, StoredMedia>;
  /** Rendered items with neither an original nor a screenshot (the note cannot be verified). */
  lost: number;
  /** Screenshots withheld by the masker (Q6). */
  withheld: number;
}

const CONCURRENCY = 4;
const ELEMENT_SCALE = 2;

interface Original {
  bytes: Uint8Array;
  mime: string;
  width: number | null;
  height: number | null;
}

async function svgOriginal(text: string): Promise<Original | null> {
  if (!isSafeSvg(text)) return null;
  const bytes = new TextEncoder().encode(text);
  const info = await imageInfo(bytes);
  return info ? { bytes, mime: "image/svg+xml", width: info.width, height: info.height } : null;
}

async function original(ctx: MediaContext, item: PageMedia): Promise<Original | null> {
  if (item.kind === "svg") return item.svg ? svgOriginal(item.svg) : null;
  let raw: FetchedResource | null = null;
  if (item.kind === "canvas") raw = item.dataUrl ? decodeDataUrl(item.dataUrl) : null;
  else if (item.url)
    raw = item.url.startsWith("data:") ? decodeDataUrl(item.url) : await ctx.fetch(item.url);
  if (!raw) return null;
  if (sniffSvg(raw.bytes)) {
    // Sanitize before any parser (librsvg via sharp) touches page-supplied SVG (preflight S2).
    const clean = await ctx.sanitizeSvg(new TextDecoder().decode(raw.bytes));
    return clean ? svgOriginal(clean) : null;
  }
  const info = await imageInfo(raw.bytes);
  return info && info.mime !== "image/svg+xml" ? { bytes: raw.bytes, ...info } : null;
}

async function storeOne(
  ctx: MediaContext,
  item: PageMedia,
  report: MediaReport,
): Promise<StoredMedia> {
  ctx.signal.throwIfAborted();
  let assetId: string | null = null;
  const found = await original(ctx, item).catch((error: unknown) => {
    if (ctx.signal.aborted) throw error;
    return null;
  });
  if (found) {
    assetId = (
      await ctx.assets.put(ctx.workspaceId, {
        bytes: found.bytes,
        mime: found.mime,
        width: found.width ?? (item.rect ? Math.round(item.rect.width) : null),
        height: found.height ?? (item.rect ? Math.round(item.rect.height) : null),
        sourceUrl: item.url,
      })
    ).assetId;
  }
  let screenshotAssetId: string | null = null;
  if (ctx.shoot && item.rect && (item.figure || assetId === null)) {
    const png = await ctx.shoot(item.rect, ELEMENT_SCALE);
    const shot = png ? await imageInfo(png) : null;
    if (png && shot) {
      screenshotAssetId = (
        await ctx.assets.put(ctx.workspaceId, {
          bytes: png,
          mime: shot.mime,
          width: shot.width,
          height: shot.height,
          sourceUrl: null,
        })
      ).assetId;
    } else {
      report.withheld++;
    }
  }
  if (item.rect && assetId === null && screenshotAssetId === null) report.lost++;
  return { assetId, screenshotAssetId };
}

/** Stores every media item (spec §7.4). A failure loses that image and is counted; it never aborts the capture. */
export async function storeMedia(
  ctx: MediaContext,
  media: readonly PageMedia[],
): Promise<MediaReport> {
  const report: MediaReport = { stored: new Map(), lost: 0, withheld: 0 };
  let next = 0;
  const worker = async () => {
    while (next < media.length) {
      const item = media[next++];
      if (item) report.stored.set(item.index, await storeOne(ctx, item, report));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, media.length) }, worker));
  return report;
}
