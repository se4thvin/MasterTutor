import { randomUUID } from "node:crypto";
import {
  CAPTURED_ORIGINS,
  CaptureArgs,
  CaptureResult,
  noteFidelity,
  type BlockOrigin,
  type Fidelity,
  type SourceKind,
} from "@mastertutor/contracts";
import { ATTR } from "@mastertutor/contracts/telemetry";
import type { LibraryServices } from "../library.ts";
import { sha256Hex } from "../notes/hash.ts";
import {
  NoteWriteError,
  screenValue,
  writeContext,
  type BlockDraft,
} from "../notes/note-writer.ts";
import { capturePdf } from "../pdf/pdf-capture.ts";
import { type Tool, type ToolContext, ToolError } from "../tools/types.ts";
import { fetchInBrowser } from "./fetch-resource.ts";
import { imageInfo, sniffSvg } from "./images.ts";
import { pageContentType } from "./page/prepare.ts";
import { snapshotKeys, uploadSnapshot, type Snapshot } from "./snapshot.ts";
import { captureWeb } from "./web-capture.ts";

export interface PersistDraft {
  kind: SourceKind;
  url: string;
  canonicalUrl: string | null;
  title: string;
  lede: string | null;
  faviconUrl: string | null;
  blocks: BlockDraft[];
  coverage: number;
  contentSha256: string;
  snapshot: Snapshot | null;
  meta: Record<string, unknown>;
  /** Page-scope captures of an unchanged page return the earlier blocks instead of duplicating them. */
  dedupe: boolean;
}

const MESSAGES: Record<string, string> = {
  secret_on_page: "The page shows a saved secret; nothing was stored",
  foreign_note: "That note belongs to another run",
  unknown_block: "That block is not in this note",
  block_too_large: "A block is too large to store",
  unsupported_url: "Only http(s) pages can be captured",
  run_missing: "The run no longer exists",
};

const captured = new Set<BlockOrigin>(CAPTURED_ORIGINS);

function captureFidelity(draft: PersistDraft): Fidelity {
  return noteFidelity({
    coverage: draft.coverage,
    unverifiedCaptured: draft.blocks.filter((b) => captured.has(b.origin) && !b.verified).length,
    missingMedia: Number(draft.meta.mediaLost ?? 0),
  });
}

/** Writes one capture into the run's note in the step (B5 reuses it). Screening happens before any upload. */
export async function persistCapture(
  services: LibraryServices,
  ctx: ToolContext,
  draft: PersistDraft,
): Promise<CaptureResult> {
  const w = writeContext(ctx);
  return asToolErrors(async () => {
    // Everything the source row and blocks will hold, screened before the first object is written.
    screenValue(w.secrets, [
      draft.url,
      draft.canonicalUrl,
      draft.title,
      draft.lede,
      draft.meta,
      draft.blocks.map((block) => [block.markdown, block.anchor]),
    ]);
    const noteId = await services.writer.ensureNote(w, {
      title: draft.title,
      lede: draft.lede,
      document: { kind: draft.kind, url: draft.url },
    });
    if (draft.dedupe) {
      const existing = await services.writer.findSource(w.scope, noteId, draft.kind, draft.url);
      if (existing && existing.meta.contentSha256 === draft.contentSha256) {
        return {
          noteId,
          blockIds: existing.blockIds,
          coverage: Number(existing.meta.coverage ?? draft.coverage),
          fidelity: (existing.meta.fidelity as Fidelity | undefined) ?? captureFidelity(draft),
        };
      }
    }
    const sourceId = randomUUID();
    const fidelity = captureFidelity(draft);
    const keys = draft.snapshot
      ? snapshotKeys(sourceId, draft.snapshot)
      : { mhtmlKey: null, screenshotKey: null };
    const faviconAssetId = await storeFavicon(services, ctx, draft.faviconUrl);
    services.writer.stageSource(
      w,
      {
        noteId,
        kind: draft.kind,
        url: draft.url,
        canonicalUrl: draft.canonicalUrl,
        title: draft.title,
        faviconAssetId,
        mhtmlKey: keys.mhtmlKey,
        screenshotKey: keys.screenshotKey,
        snapshotSha256: draft.snapshot?.mhtmlSha256 ?? draft.snapshot?.pngSha256 ?? null,
        meta: {
          ...draft.meta,
          coverage: draft.coverage,
          fidelity,
          contentSha256: draft.contentSha256,
          snapshot: draft.snapshot
            ? {
                mhtmlSha256: draft.snapshot.mhtmlSha256,
                pngSha256: draft.snapshot.pngSha256,
                skipped: draft.snapshot.skipped,
              }
            : null,
        },
      },
      sourceId,
    );
    const blockIds = await services.writer.appendBlocks(w, {
      noteId,
      sourceId,
      afterBlockId: null,
      blocks: draft.blocks,
    });
    services.writer.stageQuality(w, noteId, draft.coverage);
    if (draft.snapshot) await uploadSnapshot(services.storage, ctx.step, keys, draft.snapshot);
    return { noteId, blockIds, coverage: draft.coverage, fidelity };
  });
}

/** The writer's and asset store's refusals as typed tool errors. */
export async function asToolErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NoteWriteError)
      throw new ToolError(error.code, MESSAGES[error.code] ?? "The note could not be written");
    throw error;
  }
}

/** Raster favicons only, fetched under the network policy; SVG icons are skipped rather than sanitized. */
async function storeFavicon(
  services: LibraryServices,
  ctx: ToolContext,
  url: string | null,
): Promise<string | null> {
  if (!url) return null;
  try {
    const worlds = await ctx.session.worlds();
    const fetched = await fetchInBrowser(
      { session: ctx.session, frameId: await worlds.mainFrameId(), signal: ctx.signal },
      url,
      512 * 1024,
    );
    if (!fetched || sniffSvg(fetched.bytes)) return null;
    const info = await imageInfo(fetched.bytes);
    if (!info || info.mime === "image/svg+xml") return null;
    return (
      await services.assets.put(
        ctx.workspaceId,
        {
          bytes: fetched.bytes,
          mime: info.mime,
          width: info.width,
          height: info.height,
          sourceUrl: url,
        },
        ctx.mask,
      )
    ).assetId;
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return null;
  }
}

async function isPdf(ctx: ToolContext): Promise<boolean> {
  if (/\.pdf($|[?#])/i.test(ctx.session.page.url())) return true;
  return (await (await ctx.session.worlds()).call(pageContentType, [])) === "application/pdf";
}

/** The `capture` tool (spec §6). Text is never produced by the model; results carry ids only (untrusted: false). */
export function createCaptureTool(services: LibraryServices): Tool<CaptureArgs, CaptureResult> {
  return {
    name: "capture",
    args: CaptureArgs,
    result: CaptureResult,
    untrusted: false,
    telemetry: (_args, result) => ({
      [ATTR.captureFidelity]: result.fidelity,
      [ATTR.captureCoverage]: result.coverage,
    }),
    async run(ctx, args) {
      const kind = args.kind ?? ((await isPdf(ctx)) ? "pdf" : "web");
      if (kind === "pdf") {
        const pdf = await asToolErrors(() => capturePdf(services, ctx));
        return persistCapture(services, ctx, {
          kind: "pdf",
          url: pdf.url,
          canonicalUrl: null,
          title: pdf.title,
          lede: null,
          faviconUrl: null,
          blocks: pdf.blocks,
          coverage: pdf.coverage,
          contentSha256: pdf.contentSha256,
          snapshot: {
            mhtml: null,
            png: pdf.pagePng,
            mhtmlSha256: null,
            pngSha256: pdf.pagePng ? sha256Hex(pdf.pagePng) : null,
            skipped: pdf.pagePng ? ["mhtml:pdf"] : ["mhtml:pdf", "png:withheld"],
          },
          meta: {
            engine: pdf.engine,
            pages: pdf.pages,
            pdfAssetId: pdf.pdfAssetId,
            originalWithheld: pdf.originalWithheld,
            blocksTruncated: pdf.blocksTruncated,
            mediaLost: pdf.mediaLost,
          },
          dedupe: true,
        });
      }
      const web = await asToolErrors(() =>
        captureWeb(services, ctx, { scope: args.scope, selector: args.selector }),
      );
      return persistCapture(services, ctx, {
        kind: "web",
        url: web.url,
        canonicalUrl: web.canonicalUrl,
        title: web.title,
        lede: web.description,
        faviconUrl: web.faviconUrl,
        blocks: web.blocks,
        coverage: web.coverage,
        contentSha256: web.contentSha256,
        snapshot: web.snapshot,
        meta: {
          ...web.meta,
          scope: args.scope,
          selector: args.selector,
          engine: web.engine,
          language: web.language,
        },
        dedupe: args.scope === "page",
      });
    },
  };
}
