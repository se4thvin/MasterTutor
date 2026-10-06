import type { NoteBlock, NoteDetail } from "@mastertutor/contracts";

/** YAML double-quoted scalar (JSON strings are valid YAML, and escape newlines). */
const q = (value: string) => JSON.stringify(value);
/** Titles and ledes come from untrusted pages: keep them on one line so they cannot open new structure. */
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Device names Windows reserves, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_NAME_CHARS = 120;

export function exportFileName(title: string): string {
  const clean = title
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  // Cap by code point so a surrogate pair is never split.
  const capped = Array.from(clean)
    .slice(0, MAX_NAME_CHARS)
    .join("")
    .replace(/[\s.]+$/, "");
  const name = WINDOWS_RESERVED.test(capped) ? `_${capped}` : capped;
  return `${name || "note"}.md`;
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
    return `> [!warning] Needs review\n> Read from an image by the model.\n\n${block.markdown}`;
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
