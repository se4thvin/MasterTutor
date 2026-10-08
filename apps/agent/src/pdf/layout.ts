import { escapeMarkdownText, type BBox } from "@mastertutor/contracts";
import type { PdfPageText, PdfTextItem } from "./worker/protocol.ts";

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

function lines(items: readonly PdfTextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: (Line & { items: PdfTextItem[] })[] = [];
  for (const item of sorted) {
    const line = out.find((l) => Math.abs(l.top - item.y) < Math.max(item.height, 1) * 0.5);
    if (line) line.items.push(item);
    else
      out.push({
        text: "",
        size: 0,
        top: item.y,
        bottom: item.y + item.height,
        left: item.x,
        right: item.x + item.width,
        items: [item],
      });
  }
  return out.map((line) => {
    const parts = line.items.sort((a, b) => a.x - b.x);
    let text = "";
    let prevRight = -Infinity;
    for (const part of parts) {
      const gap = part.x - prevRight;
      if (text && gap > part.height * 0.25 && !text.endsWith(" ") && !part.str.startsWith(" "))
        text += " ";
      text += part.str;
      prevRight = part.x + part.width;
    }
    return {
      text: text.replace(/\s+/g, " ").trim(),
      size: Math.max(...parts.map((p) => p.height)),
      top: Math.min(...parts.map((p) => p.y)),
      bottom: Math.max(...parts.map((p) => p.y + p.height)),
      left: Math.min(...parts.map((p) => p.x)),
      right: Math.max(...parts.map((p) => p.x + p.width)),
    };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 11;
}

const union = (ls: readonly Line[]): BBox => {
  const x = Math.min(...ls.map((l) => l.left));
  const y = Math.min(...ls.map((l) => l.top));
  return {
    x,
    y,
    width: Math.max(...ls.map((l) => l.right)) - x,
    height: Math.max(...ls.map((l) => l.bottom)) - y,
  };
};

/** pdf.js path (spec §7.6): lines → headings by size, paragraphs by gap, lists by marker. */
export function pdfBlocks(pages: readonly PdfPageText[]): PdfBlock[] {
  const all = pages.flatMap((p) => lines(p.items));
  const body = median(
    all.flatMap((l) => Array(Math.max(1, l.text.length)).fill(l.size) as number[]),
  );
  const blocks: PdfBlock[] = [];
  for (const page of pages) {
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
                .map((l) =>
                  /^\d/.test(l.text)
                    ? l.text.replace(/^(\d{1,3})[.)]\s+/, "$1. ")
                    : `- ${escapeMarkdownText(l.text.replace(LIST, ""))}`,
                )
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
    for (const line of lines(page.items)) {
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
