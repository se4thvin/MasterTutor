import { escapeMarkdownText, type BBox } from "@mastertutor/contracts";
import type { PdfPageText, PdfTextItem } from "../protocol.ts";

export interface PdfBlock {
  type: "heading" | "paragraph" | "list";
  markdown: string;
  text: string;
  page: number;
  bbox: BBox;
}

interface Line {
  text: string;
  size: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const LIST = /^\s*([•◦▪‣\-–*]|\d{1,3}[.)])\s+/;

/**
 * Items into lines in O(n log n): sorted top-to-bottom, an item joins the line being built when its
 * top is within half its height of that line's top (the only line it can belong to once sorted).
 */
function lines(items: readonly PdfTextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: PdfTextItem[][] = [];
  let current: PdfTextItem[] | null = null;
  let top = 0;
  for (const item of sorted) {
    if (current && Math.abs(top - item.y) < Math.max(item.height, 1) * 0.5) current.push(item);
    else {
      current = [item];
      top = item.y;
      groups.push(current);
    }
  }
  return groups.map((group) => {
    const parts = group.sort((a, b) => a.x - b.x);
    let text = "";
    let prevRight = -Infinity;
    let size = 0;
    let lineTop = Infinity;
    let bottom = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (const part of parts) {
      const gap = part.x - prevRight;
      if (text && gap > part.height * 0.25 && !text.endsWith(" ") && !part.str.startsWith(" "))
        text += " ";
      text += part.str;
      prevRight = part.x + part.width;
      size = Math.max(size, part.height);
      lineTop = Math.min(lineTop, part.y);
      bottom = Math.max(bottom, part.y + part.height);
      left = Math.min(left, part.x);
      right = Math.max(right, part.x + part.width);
    }
    return { text: text.replace(/\s+/g, " ").trim(), size, top: lineTop, bottom, left, right };
  });
}

/** The size most characters are set in: a median weighted by line length, without one entry per character. */
function bodySize(all: readonly Line[]): number {
  const sorted = [...all].sort((a, b) => a.size - b.size);
  const total = sorted.reduce((sum, line) => sum + Math.max(1, line.text.length), 0);
  let seen = 0;
  for (const line of sorted) {
    seen += Math.max(1, line.text.length);
    if (seen > total / 2) return line.size;
  }
  return 11;
}

const union = (ls: readonly Line[]): BBox => {
  let x = Infinity;
  let y = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const l of ls) {
    x = Math.min(x, l.left);
    y = Math.min(y, l.top);
    right = Math.max(right, l.right);
    bottom = Math.max(bottom, l.bottom);
  }
  return { x, y, width: right - x, height: bottom - y };
};

/** pdf.js path (spec §7.6): lines → headings by size, paragraphs by gap, lists by marker. */
export function pdfBlocks(pages: readonly PdfPageText[]): PdfBlock[] {
  const perPage = pages.map((page) => ({ page, lines: lines(page.items) }));
  const body = bodySize(perPage.flatMap((p) => p.lines));
  const blocks: PdfBlock[] = [];
  for (const { page, lines: pageLines } of perPage) {
    let group: Line[] = [];
    let kind: PdfBlock["type"] = "paragraph";
    const flush = () => {
      if (group.length === 0) return;
      const text =
        kind === "list"
          ? group.map((l) => l.text).join("\n")
          : group
              .map((l) => l.text)
              .join(" ")
              .replace(/- (?=\p{Ll})/gu, "-");
      const markdown =
        kind === "heading"
          ? `${"#".repeat(group[0]!.size >= body * 1.6 ? 1 : group[0]!.size >= body * 1.35 ? 2 : 3)} ${escapeMarkdownText(text)}`
          : kind === "list"
            ? group
                .map((l) => {
                  if (!/^\d/.test(l.text))
                    return `- ${escapeMarkdownText(l.text.replace(LIST, ""))}`;
                  // The marker is ours; the item's text is page text like any other (QA-104).
                  const marker = /^(\d{1,3})[.)]\s+/.exec(l.text);
                  return marker
                    ? `${marker[1]}. ${escapeMarkdownText(l.text.slice(marker[0].length))}`
                    : escapeMarkdownText(l.text);
                })
                .join("\n")
            : escapeMarkdownText(text);
      blocks.push({
        type: kind,
        markdown,
        text: group.map((l) => l.text).join(" "),
        page: page.page,
        bbox: union(group),
      });
      group = [];
    };
    for (const line of pageLines) {
      if (!line.text) continue;
      const lineKind: PdfBlock["type"] =
        line.size >= body * 1.2 && line.text.length < 200
          ? "heading"
          : LIST.test(line.text)
            ? "list"
            : "paragraph";
      const prev = group.at(-1);
      const sameRun =
        prev !== undefined &&
        lineKind === kind &&
        kind !== "heading" &&
        Math.abs(line.size - prev.size) < 0.5 &&
        line.top - prev.bottom < prev.size * 1.0 &&
        (kind !== "list" || /^\d/.test(line.text) === /^\d/.test(group[0]!.text));
      if (!sameRun) {
        flush();
        kind = lineKind;
      }
      group.push(line);
    }
    flush();
  }
  return blocks;
}

/** The verification reference (spec §7.6): every pdf.js text item, in order. */
export function pdfReferenceText(pages: readonly PdfPageText[]): string {
  return pages.map((page) => page.items.map((item) => item.str).join(" ")).join("\n");
}
