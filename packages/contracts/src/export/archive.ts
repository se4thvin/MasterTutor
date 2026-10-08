import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import type { NoteDetail } from "../api/dto.ts";
import { assetIdsIn } from "../asset-uri.ts";
import { isAssetMimeType, type AssetMimeType } from "../constants.ts";
import { Sha256Hex } from "../primitives.ts";
import { archiveFileName, markdownFileName } from "./file-name.ts";
import { buildNoteMarkdown } from "./note-markdown.ts";

/** One asset in the archive: its bytes are opened only when the zip reaches it. */
export interface ArchiveAsset {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
  /** The bytes, or null when the object is missing: the note then links it as #missing-asset. */
  open(): Promise<ReadableStream<Uint8Array> | null>;
}

/** One extension per stored asset type (ASSET_MIME_TYPES, the allow-list `put` enforces). */
const EXTENSIONS: Record<AssetMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};
const extensionOf = (mime: string) => (isAssetMimeType(mime) ? EXTENSIONS[mime] : "bin");

/** Bounds on one export: it streams, but a huge note is refused up front, never cut short. */
export const EXPORT_LIMITS = { maxAssets: 500, maxBytes: 512 * 1024 * 1024 } as const;

/** Why this export is too large (a message for the reader), or null when it fits. */
export function exportTooLarge(assets: ReadonlyArray<{ bytes: number }>): string | null {
  if (assets.length > EXPORT_LIMITS.maxAssets)
    return `This note has ${assets.length} images and files; an export holds at most ${EXPORT_LIMITS.maxAssets} assets.`;
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const mb = (bytes: number) => Math.ceil(bytes / (1024 * 1024));
  if (total > EXPORT_LIMITS.maxBytes)
    return `This note's images and files total ${mb(total)} MB; an export holds at most ${mb(EXPORT_LIMITS.maxBytes)} MB.`;
  return null;
}

/** Every asset a note shows: media blocks' `assetId` and inline `asset:` references. */
export function noteAssetIds(detail: NoteDetail): string[] {
  const ids = new Set<string>();
  for (const block of detail.blocks) {
    if (block.assetId) ids.add(block.assetId);
    for (const id of assetIdsIn(block.markdown)) ids.add(id);
  }
  return [...ids];
}

interface ArchiveInput {
  detail: NoteDetail;
  folderPath: readonly string[];
  assets: readonly ArchiveAsset[];
}

/**
 * The zip's chunks in order: each asset, read as it streams, then the Markdown. The Markdown goes
 * last so it links only what the zip really holds: a missing object becomes #missing-asset instead
 * of failing the whole export (QA-097).
 */
async function* zipChunks(input: ArchiveInput): AsyncGenerator<Uint8Array> {
  const ready: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else ready.push(chunk);
  });
  function* drain(): Generator<Uint8Array> {
    if (failure) throw failure;
    while (ready.length > 0) yield ready.shift()!;
  }
  const exported = new Map<string, string>();
  const tried = new Set<string>();
  for (const asset of input.assets) {
    // The hash becomes a path inside the zip: only a real SHA-256 may, never `../` (QA-095).
    if (!Sha256Hex.safeParse(asset.sha256).success) continue;
    const path = `assets/${asset.sha256}.${extensionOf(asset.mime)}`;
    if (tried.has(path)) continue;
    tried.add(path);
    const body = await asset.open();
    if (!body) continue;
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    const reader = body.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      entry.push(next.value);
      yield* drain();
    }
    entry.push(new Uint8Array(0), true);
    yield* drain();
    exported.set(asset.id, path);
  }
  const markdown = new ZipDeflate(markdownFileName(input.detail.note.title), { level: 6 });
  zip.add(markdown);
  markdown.push(
    new TextEncoder().encode(
      buildNoteMarkdown(input.detail, input.folderPath, (id) => exported.get(id) ?? null),
    ),
    true,
  );
  zip.end();
  yield* drain();
}

/** Decision 18: `<title>.md` plus `assets/<sha256>.<ext>`, zipped as a stream; named `<title>.zip`. */
export function streamNoteArchive(input: ArchiveInput): {
  fileName: string;
  body: ReadableStream<Uint8Array>;
} {
  const chunks = zipChunks(input);
  // highWaterMark 0: nothing is pulled, so no asset is opened, until the response is read.
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      async cancel() {
        await chunks.return(undefined);
      },
    },
    { highWaterMark: 0 },
  );
  return { fileName: archiveFileName(input.detail.note.title), body };
}

/** The same zip collected in memory: for small exports only (the fixture API). */
export async function buildNoteArchive(
  input: ArchiveInput,
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const { fileName, body } = streamNoteArchive(input);
  return { fileName, bytes: new Uint8Array(await new Response(body).arrayBuffer()) };
}
