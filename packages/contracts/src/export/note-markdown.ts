import type { NoteDetail } from "../api/dto.ts";
import { replaceAssetUris } from "../asset-uri.ts";
import type { NoteBlock } from "../note.ts";
import { REVIEW_REASON } from "../review-reason.ts";
import { formatTimecode } from "../timecode.ts";

/** Where an asset lives in the export; null when it was not exported. */
export type AssetPath = (assetId: string) => string | null;
const byId: AssetPath = (assetId) => `assets/${assetId}`;

/** YAML double-quoted scalar (JSON strings are valid YAML, and escape newlines). */
const q = (value: string) => JSON.stringify(value);
/** Titles and ledes come from untrusted pages: keep them on one line so they cannot open new structure. */
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
/** Source text cannot pose as our provenance comments: `<!-- mt:` becomes `<!-- mt-src:`. */
const neutralise = (value: string) => value.replace(/<!--(\s*)mt:/gi, "<!--$1mt-src:");
const MEDIA = new Set(["image", "figure", "keyframe"]);

function blockBody(block: NoteBlock, assetPath: AssetPath): string {
  const markdown = replaceAssetUris(block.markdown, (id) => assetPath(id) ?? "#missing-asset");
  const time = block.anchor?.tStart !== undefined ? `${formatTimecode(block.anchor.tStart)} ` : "";
  if (MEDIA.has(block.type)) {
    const first = block.markdown.split("\n")[0] ?? "";
    const alt =
      first
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[[\]*_`\\]/g, "")
        .trim() || "image";
    const path = block.assetId ? assetPath(block.assetId) : null;
    const image = path ? `![${oneLine(alt)}](${path})` : "";
    if (block.type === "image") return image;
    return `${image}\n\n${time}${markdown}`;
  }
  if (block.type === "transcript") return `${time}${markdown}`;
  if (block.origin === "model") {
    return `> [!note] Agent's note\n${markdown
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}`;
  }
  if (!block.verified)
    return `> [!warning] Needs review\n> ${REVIEW_REASON[block.origin]}\n\n${markdown}`;
  return markdown;
}

/** Obsidian-compatible Markdown with provenance (spec §1 v1 defaults). */
export function buildNoteMarkdown(
  detail: NoteDetail,
  folderPath: readonly string[] = [],
  assetPath: AssetPath = byId,
): string {
  const { note, blocks, sources } = detail;
  const title = neutralise(oneLine(note.title));
  const front = [
    "---",
    `title: ${q(title)}`,
    `note_id: ${note.id}`,
    `fidelity: ${note.fidelity}`,
    `coverage: ${note.coverage ?? "null"}`,
    ...(folderPath.length ? [`folder: ${q(folderPath.join("/"))}`] : []),
    `filed_by: ${note.filedBy}`,
    `created: ${note.createdAt}`,
    "sources:",
    ...sources.flatMap((s) => [
      `  - url: ${q(s.url)}`,
      `    origin: ${q(s.origin)}`,
      `    captured_at: ${s.capturedAt}`,
    ]),
    "---",
    "",
    `# ${title}`,
    "",
    ...(note.lede ? [`> ${neutralise(oneLine(note.lede))}`, ""] : []),
  ];
  // Blocks arrive in position (byte) order; re-sorting here would add a second rule.
  const body = blocks.map(
    (block) =>
      `<!-- mt:block id=${block.id} origin=${block.origin} sha256=${block.contentSha256 ?? "none"} -->\n${neutralise(blockBody(block, assetPath))}`,
  );
  return `${[...front, body.join("\n\n")].join("\n")}\n`;
}
