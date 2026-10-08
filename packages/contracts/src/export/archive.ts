import { zipSync, type Zippable } from "fflate";
import type { NoteDetail } from "../api/dto.ts";
import { assetIdsIn } from "../asset-uri.ts";
import { isAssetMimeType, type AssetMimeType } from "../constants.ts";
import { archiveFileName, markdownFileName } from "./file-name.ts";
import { buildNoteMarkdown } from "./note-markdown.ts";

export interface ArchiveAsset {
  id: string;
  sha256: string;
  mime: string;
  bytes: Uint8Array;
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

/** Every asset a note shows: media blocks' `assetId` and inline `asset:` references. */
export function noteAssetIds(detail: NoteDetail): string[] {
  const ids = new Set<string>();
  for (const block of detail.blocks) {
    if (block.assetId) ids.add(block.assetId);
    for (const id of assetIdsIn(block.markdown)) ids.add(id);
  }
  return [...ids];
}

/** Decision 18: `<title>.md` plus `assets/<sha256>.<ext>`, zipped; the download is named `<title>.zip`. */
export function buildNoteArchive(input: {
  detail: NoteDetail;
  folderPath: readonly string[];
  assets: readonly ArchiveAsset[];
}): { fileName: string; bytes: Uint8Array } {
  const byId = new Map(input.assets.map((asset) => [asset.id, asset]));
  const pathOf = (id: string) => {
    const asset = byId.get(id);
    return asset ? `assets/${asset.sha256}.${extensionOf(asset.mime)}` : null;
  };
  const markdown = buildNoteMarkdown(input.detail, input.folderPath, pathOf);
  const entries: Zippable = {
    [markdownFileName(input.detail.note.title)]: [new TextEncoder().encode(markdown), { level: 6 }],
  };
  for (const asset of input.assets) {
    const path = pathOf(asset.id);
    if (path) entries[path] = [asset.bytes, { level: 0 }];
  }
  return { fileName: archiveFileName(input.detail.note.title), bytes: zipSync(entries) };
}
