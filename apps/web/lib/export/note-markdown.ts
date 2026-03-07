import type { NoteBlock, NoteDetail } from "@mastertutor/contracts";
import { REVIEW_REASON } from "../notes/provenance.ts";

/** YAML double-quoted scalar (JSON strings are valid YAML, and escape newlines). */
const q = (value: string) => JSON.stringify(value);
/** Titles and ledes come from untrusted pages: keep them on one line so they cannot open new structure. */
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Device names Windows reserves, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const EXTENSION = ".md";
/** NAME_MAX on Linux and macOS is 255 bytes for the whole name, extension included. */
const MAX_NAME_BYTES = 255 - EXTENSION.length;

const utf8 = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The longest prefix of whole graphemes that fits in `maxBytes` of UTF-8. */
function capBytes(value: string, maxBytes: number): string {
  let out = "";
  let used = 0;
  for (const { segment } of graphemes.segment(value)) {
    used += utf8.encode(segment).length;
    if (used > maxBytes) break;
    out += segment;
  }
  return out;
}

export function exportFileName(title: string): string {
  const clean = title
    // Bidi controls (RLO and friends) make a name display as something it is not.
    .replace(/\p{Bidi_Control}/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  const fit = (value: string) => capBytes(value, MAX_NAME_BYTES).replace(/[\s.]+$/, "");
  // Test after the cap: a cut can expose a reserved name. "_…" can never be one, so one refit is enough.
  const capped = fit(clean);
  const name = WINDOWS_RESERVED.test(capped) ? fit(`_${capped}`) : capped;
  return `${name || "note"}${EXTENSION}`;
}

/** Source text cannot pose as our provenance comments: `<!-- mt:` becomes `<!-- mt-src:`. */
const neutralise = (value: string) => value.replace(/<!--(\s*)mt:/gi, "<!--$1mt-src:");

function blockBody(block: NoteBlock): string {
  if (block.type === "image" || block.type === "figure" || block.type === "keyframe") {
    const alt = block.markdown.replace(/[[\]*_`\\]/g, "").trim() || "image";
    const image = block.assetId ? `![${oneLine(alt)}](assets/${block.assetId})` : "";
    return block.type === "image" ? image : `${image}\n\n${block.markdown}`;
  }
  if (block.origin === "model") {
    const quoted = block.markdown
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    return `> [!note] Agent's note\n${quoted}`;
  }
  if (!block.verified) {
    return `> [!warning] Needs review\n> ${REVIEW_REASON[block.origin]}\n\n${block.markdown}`;
  }
  return block.markdown;
}

/** Obsidian-compatible Markdown with provenance (spec §1 v1 defaults). Assets are referenced as assets/<id>. */
export function buildNoteMarkdown(detail: NoteDetail, folderPath: readonly string[] = []): string {
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
  // The API returns blocks in position order (byte order); re-sorting here would add a second rule.
  const body = blocks.map(
    (block) =>
      `<!-- mt:block id=${block.id} origin=${block.origin} sha256=${block.contentSha256 ?? "none"} -->\n${neutralise(blockBody(block))}`,
  );
  return `${[...front, body.join("\n\n")].join("\n")}\n`;
}
