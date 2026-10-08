import type { Box, MaskSources } from "../browser/masking.ts";
import { AssetRejected, type AssetInput, type AssetStore } from "../notes/assets.ts";
import { screenText } from "../notes/note-writer.ts";
import { pixelsAreClean, type LocalOcr } from "../browser/local-ocr.ts";
import { decodeDataUrl, type FetchedResource } from "./fetch-resource.ts";
import { imageInfo, isSafeSvg, sniffSvg } from "./images.ts";
import type { PageMedia } from "./page/types.ts";

export interface MediaContext {
  workspaceId: string;
  assets: AssetStore;
  /** The run's vault: an asset's source URL is screened before it is stored. */
  secrets: MaskSources;
  /** Local OCR: canvas pixels are screened for vault secrets on this host before storage. */
  localOcr: Pick<LocalOcr, "text">;
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

async function svgOriginal(ctx: MediaContext, text: string): Promise<Original | null> {
  if (!isSafeSvg(text)) return null;
  // SVG <text> is page text the vault screen must see before it is stored (5-8 review I1).
  screenText(ctx.secrets, text);
  const bytes = new TextEncoder().encode(text);
  const info = await imageInfo(bytes);
  return info ? { bytes, mime: "image/svg+xml", width: info.width, height: info.height } : null;
}

async function original(ctx: MediaContext, item: PageMedia): Promise<Original | null> {
  if (item.kind === "svg") return item.svg ? svgOriginal(ctx, item.svg) : null;
  let raw: FetchedResource | null = null;
  if (item.kind === "canvas") raw = item.dataUrl ? decodeDataUrl(item.dataUrl) : null;
  else if (item.url)
    raw = item.url.startsWith("data:") ? decodeDataUrl(item.url) : await ctx.fetch(item.url);
  if (!raw) return null;
  if (sniffSvg(raw.bytes)) {
    // Sanitize before any parser (librsvg via sharp) touches page-supplied SVG (preflight S2).
    const clean = await ctx.sanitizeSvg(new TextDecoder().decode(raw.bytes));
    return clean ? svgOriginal(ctx, clean) : null;
  }
  const info = await imageInfo(raw.bytes);
  return info && info.mime !== "image/svg+xml" ? { bytes: raw.bytes, ...info } : null;
}

/** Errors that end the whole capture: an interruption, or a vault secret about to be stored. */
function isFatal(ctx: MediaContext, error: unknown): boolean {
  return ctx.signal.aborted || (error as { code?: unknown } | null)?.code === "secret_on_page";
}

/** `work`'s result, or null when it fails for a reason that loses only this image. */
async function orLost<T>(ctx: MediaContext, work: () => Promise<T | null>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (isFatal(ctx, error)) throw error;
    return null;
  }
}

/** Canvas pixels are invisible to every text screen: screened locally while the run holds secrets. */
const canvasIsClean = (ctx: MediaContext, png: Uint8Array) =>
  pixelsAreClean(ctx.localOcr, ctx.secrets, png, ctx.signal);

async function storeOne(
  ctx: MediaContext,
  item: PageMedia,
  report: MediaReport,
): Promise<StoredMedia> {
  ctx.signal.throwIfAborted();
  const assetId = await orLost(ctx, async () => {
    const found = await original(ctx, item);
    if (!found) return null;
    if (item.kind === "canvas" && !(await canvasIsClean(ctx, found.bytes))) return null;
    return put(ctx, {
      bytes: found.bytes,
      mime: found.mime,
      width: found.width ?? (item.rect ? Math.round(item.rect.width) : null),
      height: found.height ?? (item.rect ? Math.round(item.rect.height) : null),
      sourceUrl: item.url,
    });
  });
  let screenshotAssetId: string | null = null;
  // A fixed or sticky element moves with scrolling: its rect would shoot the wrong region (M8).
  if (ctx.shoot && item.rect && !item.fixed && (item.figure || assetId === null)) {
    const shoot = ctx.shoot;
    const rect = item.rect;
    const png = await orLost(ctx, () => shoot(rect, ELEMENT_SCALE));
    const shot = png ? await imageInfo(png) : null;
    const clean = png && item.kind === "canvas" ? await canvasIsClean(ctx, png) : true;
    if (png && shot && clean) {
      screenshotAssetId = await orLost(ctx, () =>
        put(ctx, {
          bytes: png,
          mime: shot.mime,
          width: shot.width,
          height: shot.height,
          sourceUrl: null,
        }),
      );
    } else {
      report.withheld++;
    }
  }
  if (item.rect && assetId === null && screenshotAssetId === null) report.lost++;
  return { assetId, screenshotAssetId };
}

/** A rejected type or size loses that one image; anything else (a secret, an outage) fails the capture. */
async function put(ctx: MediaContext, input: AssetInput): Promise<string | null> {
  try {
    return (await ctx.assets.put(ctx.workspaceId, input, ctx.secrets)).assetId;
  } catch (error) {
    if (error instanceof AssetRejected) return null;
    throw error;
  }
}

function serialized<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const run = tail.then(() => fn(...args));
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Stores every media item (spec §7.4). A failure loses that image and is counted; only an
 * interruption or a vault secret ends the capture, and then no worker starts another item.
 */
export async function storeMedia(
  ctx: MediaContext,
  media: readonly PageMedia[],
): Promise<MediaReport> {
  const report: MediaReport = { stored: new Map(), lost: 0, withheld: 0 };
  // Fetches run in parallel, element screenshots one at a time: each scrolls the same page.
  const serial = ctx.shoot ? serialized(ctx.shoot) : null;
  const itemCtx: MediaContext = { ...ctx, shoot: serial };
  let next = 0;
  let fatal = false;
  const worker = async () => {
    while (!fatal && next < media.length) {
      const item = media[next++];
      if (!item) continue;
      try {
        report.stored.set(item.index, await storeOne(itemCtx, item, report));
      } catch (error) {
        fatal = true; // no worker starts another item
        throw error;
      }
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(CONCURRENCY, media.length) }, worker),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return report;
}
