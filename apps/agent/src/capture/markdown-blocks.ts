import { NoteBlock } from "@mastertutor/contracts";
import { normalizeText } from "./text.ts";

export type MarkdownBlockType =
  "heading" | "paragraph" | "list" | "quote" | "code" | "table" | "math" | "image";
export interface MarkdownBlock {
  type: MarkdownBlockType;
  markdown: string;
}

/** One source of truth for the block size limit: the NoteBlock contract. */
export const MAX_BLOCK_CHARS = NoteBlock.shape.markdown.maxLength ?? 200_000;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const QUOTE = /^\s{0,3}>/;
const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const RAW_TABLE = /^\s*<table[\s>]/i;
const IMAGES_ONLY = /^(\s*(\[\s*)?!\[[^\]]*\]\([^)]+\)(\s*\]\([^)]+\))?\s*)+$/;

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    RAW_TABLE.test(line) ||
    line.trim().startsWith("$$") ||
    (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next))
  );
}

export function splitMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  const push = (type: MarkdownBlockType, from: number, to: number) => {
    const text = lines.slice(from, to).join("\n").replace(/\s+$/, "");
    if (text.trim()) blocks.push({ type, markdown: text });
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const start = i;
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const close = new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
      i++;
      while (i < lines.length && !close.test(lines[i]!)) i++;
      push("code", start, Math.min(i + 1, lines.length));
      i++;
      continue;
    }
    if (line.trim().startsWith("$$")) {
      const single = line.trim().length > 4 && line.trim().endsWith("$$");
      if (!single) {
        i++;
        while (i < lines.length && !lines[i]!.trim().endsWith("$$")) i++;
      }
      push("math", start, Math.min(i + 1, lines.length));
      i++;
      continue;
    }
    if (RAW_TABLE.test(line)) {
      while (i < lines.length && !/<\/table>/i.test(lines[i]!)) i++;
      push("table", start, Math.min(i + 1, lines.length));
      i++;
      continue;
    }
    if (HEADING.test(line)) {
      push("heading", start, start + 1);
      i++;
      continue;
    }
    if (line.includes("|") && TABLE_SEPARATOR.test(lines[i + 1] ?? "")) {
      i += 2;
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.includes("|")) i++;
      push("table", start, i);
      continue;
    }
    if (QUOTE.test(line)) {
      while (i < lines.length && QUOTE.test(lines[i]!)) i++;
      push("quote", start, i);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      i++;
      while (i < lines.length) {
        const current = lines[i]!;
        if (current.trim() === "") {
          const next = lines[i + 1] ?? "";
          if (/^\s{2,}\S/.test(next)) {
            i++;
            continue;
          }
          break;
        }
        if (LIST_ITEM.test(current) || /^\s{2,}\S/.test(current)) {
          i++;
          continue;
        }
        break;
      }
      push("list", start, i);
      continue;
    }
    i++;
    while (i < lines.length && lines[i]!.trim() !== "" && !startsBlock(lines[i]!, lines[i + 1]))
      i++;
    const text = lines.slice(start, i).join("\n");
    push(IMAGES_ONLY.test(text) ? "image" : "paragraph", start, i);
  }
  return blocks;
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** Media captions and math are compared by other means (assets stored, TeX annotations), never as text. */
const NO_PLAIN_TEXT = new Set(["math", "image", "figure", "keyframe"]);

/** Visible text of a block, matching what innerText shows (no syntax, no math, no media captions). */
export function blockPlainText(block: { type: string; markdown: string }): string {
  if (NO_PLAIN_TEXT.has(block.type)) return "";
  if (block.type === "code")
    return normalizeText(block.markdown.replace(/^\s{0,3}(`{3,}|~{3,}).*$/gm, ""));
  const text = block.markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/(?<![\\$\w])\$(?=\S)([^$\n]+?)(?<=\S)\$(?![\d$])/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*+]|\d{1,9}[.)])\s+/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!|$])/g, "$1")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[|*_`~]/g, " ");
  return normalizeText(text);
}

/** The TeX of a `$$…$$` block with all whitespace removed, for comparison with the page's annotations (Q3). */
export function texOf(markdown: string): string | null {
  const match = /^\s*\$\$([\s\S]*?)\$\$\s*$/.exec(markdown);
  return match ? (match[1] ?? "").replace(/\s+/g, "") : null;
}

/** Splits a block that exceeds the contract limit at line boundaries; code parts are re-fenced. */
export function limitBlockSize<B extends { type: string; markdown: string }>(
  block: B,
  max: number = MAX_BLOCK_CHARS,
): B[] {
  if (block.markdown.length <= max) return [block];
  const fenced =
    block.type === "code"
      ? /^(\s*(`{3,}|~{3,})[^\n]*)\n([\s\S]*?)\n\s*\2\s*$/.exec(block.markdown)
      : null;
  const open = fenced?.[1] ?? "";
  const close = fenced?.[2] ?? "";
  const body = fenced ? fenced[3]! : block.markdown;
  const budget = fenced ? max - open.length - close.length - 2 : max;
  const parts: string[] = [];
  let current = "";
  for (const line of body.split("\n")) {
    for (let offset = 0; offset < Math.max(line.length, 1); offset += budget) {
      const piece = line.slice(offset, offset + budget);
      const candidate = current === "" ? piece : `${current}\n${piece}`;
      if (candidate.length > budget && current !== "") {
        parts.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current !== "") parts.push(current);
  return parts.map((part) => ({
    ...block,
    markdown: fenced ? `${open}\n${part}\n${close}` : part,
  }));
}

/** Escapes text so Markdown renders it literally. */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/[\\`*_[\]<>]/g, (char) => `\\${char}`)
    .replace(/^(\s{0,3})([#>+-]|\d{1,9}[.)])(?=\s)/gm, (_m, space: string, mark: string) =>
      /\d/.test(mark) ? `${space}${mark.slice(0, -1)}\\${mark.slice(-1)}` : `${space}\\${mark}`,
    );
}

/** Plain text (paragraphs separated by blank lines) to escaped Markdown paragraphs. */
export function textToMarkdown(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => escapeMarkdownText(paragraph.replace(/\s*\n\s*/g, " ").trim()))
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}
