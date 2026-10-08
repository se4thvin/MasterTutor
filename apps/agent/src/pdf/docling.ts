import { escapeMarkdownText, type BBox } from "@mastertutor/contracts";
import { z } from "zod";
import { readCappedText } from "../runtime/read-capped.ts";

export interface DoclingBlock {
  type: "heading" | "paragraph" | "list" | "code" | "table" | "math" | "figure";
  markdown: string;
  page: number;
  bbox: BBox;
  /** Picture/formula region cropped from the page render; `markdown` is then its alt text. */
  crop: boolean;
}
export interface DoclingClient {
  convert(bytes: Uint8Array, filename: string, signal: AbortSignal): Promise<DoclingBlock[]>;
}

/** I-6: docling's answer is bounded before it is parsed, and its shape before it is used. */
export const MAX_DOCLING_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 50_000;
export const MAX_DOCLING_BLOCKS = 20_000;
export const MAX_DOCLING_CROPS = 400;
export const MAX_DOCLING_CROPS_PER_PAGE = 32;

/** docling's answer is over a cap or off-schema: the capture falls back to pdf.js. */
export class DoclingRejected extends Error {
  constructor(reason: string) {
    super(`docling answer rejected: ${reason}`);
    this.name = "DoclingRejected";
  }
}

const Ref = z.object({ $ref: z.string().max(64) });
const Prov = z.object({
  page_no: z.number().int().positive(),
  bbox: z.object({
    l: z.number(),
    t: z.number(),
    r: z.number(),
    b: z.number(),
    coord_origin: z.string().default("BOTTOMLEFT"),
  }),
});
const Common = {
  self_ref: z.string(),
  label: z.string(),
  prov: z.array(Prov).default([]),
  children: z.array(Ref).default([]),
};
const Cell = z.object({
  text: z.string().default(""),
  row_span: z.number().default(1),
  col_span: z.number().default(1),
});

export const DoclingDocument = z.object({
  body: z.object({ children: z.array(Ref).max(MAX_ITEMS) }),
  texts: z
    .array(
      z.object({
        ...Common,
        text: z.string().default(""),
        level: z.number().optional(),
        enumerated: z.boolean().optional(),
        marker: z.string().optional(),
        code_language: z.string().nullish(),
      }),
    )
    .max(MAX_ITEMS)
    .default([]),
  tables: z
    .array(
      z.object({
        ...Common,
        captions: z.array(Ref).max(MAX_ITEMS).default([]),
        data: z.object({ grid: z.array(z.array(Cell)).default([]) }),
      }),
    )
    .default([]),
  pictures: z
    .array(z.object({ ...Common, captions: z.array(Ref).default([]) }))
    .max(MAX_ITEMS)
    .default([]),
  groups: z
    .array(
      z.object({ self_ref: z.string(), label: z.string(), children: z.array(Ref).default([]) }),
    )
    .max(MAX_ITEMS)
    .default([]),
  pages: z
    .record(
      z.string(),
      z.object({ size: z.object({ width: z.number(), height: z.number() }), page_no: z.number() }),
    )
    .default({}),
});
export type DoclingDocument = z.infer<typeof DoclingDocument>;

const ConvertResponse = z.object({
  status: z.string(),
  document: z.object({ json_content: z.unknown().nullable().optional() }),
});

const FURNITURE = new Set(["page_header", "page_footer"]);
const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function tableMarkdown(grid: z.infer<typeof Cell>[][]): string {
  const complex = grid.some((row) => row.some((cell) => cell.row_span > 1 || cell.col_span > 1));
  if (!complex && grid.length > 0) {
    const row = (cells: z.infer<typeof Cell>[]) =>
      `| ${cells.map((c) => c.text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()).join(" | ")} |`;
    return [
      row(grid[0]!),
      `| ${grid[0]!.map(() => "---").join(" | ")} |`,
      ...grid.slice(1).map(row),
    ].join("\n");
  }
  // Docling repeats spanned cells in the grid; emit each origin cell once with its spans.
  const seen = new Set<string>();
  const rows = grid.map((cells, r) => {
    const tds = cells.flatMap((cell, c) => {
      const key = `${cell.text}|${cell.row_span}|${cell.col_span}`;
      const spanned =
        (r > 0 && cell.row_span > 1 && seen.has(`${key}@c${c}`)) ||
        (c > 0 && cell.col_span > 1 && seen.has(`${key}@r${r}`));
      if (cell.row_span > 1) seen.add(`${key}@c${c}`);
      if (cell.col_span > 1) seen.add(`${key}@r${r}`);
      if (spanned) return [];
      const attrs = `${cell.row_span > 1 ? ` rowspan="${cell.row_span}"` : ""}${cell.col_span > 1 ? ` colspan="${cell.col_span}"` : ""}`;
      return [`<td${attrs}>${escapeHtml(cell.text)}</td>`];
    });
    return `<tr>${tds.join("")}</tr>`;
  });
  return `<table>${rows.join("")}</table>`;
}

/** Walks docling's reading order (body tree) into blocks with page + top-left bbox anchors. */
export function doclingBlocks(doc: DoclingDocument): DoclingBlock[] {
  const out: DoclingBlock[] = [];
  const visited = new Set<string>();
  let list: { lines: string[]; page: number; boxes: BBox[] } | null = null;
  const bboxOf = (prov: z.infer<typeof Prov>[]): { page: number; bbox: BBox } => {
    const first = prov[0];
    if (!first) return { page: 1, bbox: { x: 0, y: 0, width: 0, height: 0 } };
    const height = doc.pages[String(first.page_no)]?.size.height ?? 792;
    const { l, t, r, b, coord_origin } = first.bbox;
    const top = coord_origin === "TOPLEFT" ? t : height - t;
    return { page: first.page_no, bbox: { x: l, y: top, width: r - l, height: Math.abs(t - b) } };
  };
  const flushList = () => {
    if (!list) return;
    const x = Math.min(...list.boxes.map((b) => b.x));
    const y = Math.min(...list.boxes.map((b) => b.y));
    const width = Math.max(...list.boxes.map((b) => b.x + b.width)) - x;
    const height = Math.max(...list.boxes.map((b) => b.y + b.height)) - y;
    out.push({
      type: "list",
      markdown: list.lines.join("\n"),
      page: list.page,
      bbox: { x, y, width, height },
      crop: false,
    });
    list = null;
  };
  const resolve = (ref: string) => {
    const match = /^#\/(texts|tables|pictures|groups)\/(\d+)$/.exec(ref);
    if (!match) return null;
    const index = Number(match[2]);
    switch (match[1]) {
      case "texts":
        return { kind: "text" as const, item: doc.texts[index] };
      case "tables":
        return { kind: "table" as const, item: doc.tables[index] };
      case "pictures":
        return { kind: "picture" as const, item: doc.pictures[index] };
      default:
        return { kind: "group" as const, item: doc.groups[index] };
    }
  };
  const visit = (ref: string): void => {
    if (visited.has(ref)) return;
    visited.add(ref);
    const node = resolve(ref);
    if (!node?.item) return;
    if (node.kind === "group") {
      for (const child of node.item.children) visit(child.$ref);
      flushList();
      return;
    }
    if (node.kind === "text") {
      const text = node.item;
      if (FURNITURE.has(text.label)) return;
      const { page, bbox } = bboxOf(text.prov);
      if (text.label === "list_item") {
        const marker = text.enumerated
          ? `${text.marker?.replace(/[^\d]/g, "") || (list?.lines.length ?? 0) + 1}. `
          : "- ";
        list ??= { lines: [], page, boxes: [] };
        list.lines.push(`${marker}${escapeMarkdownText(text.text.trim())}`);
        list.boxes.push(bbox);
      } else {
        flushList();
        if (text.label === "title")
          out.push({
            type: "heading",
            markdown: `# ${escapeMarkdownText(text.text.trim())}`,
            page,
            bbox,
            crop: false,
          });
        else if (text.label === "section_header")
          out.push({
            type: "heading",
            markdown: `${"#".repeat(Math.min(6, (text.level ?? 1) + 1))} ${escapeMarkdownText(text.text.trim())}`,
            page,
            bbox,
            crop: false,
          });
        else if (text.label === "code")
          out.push({
            type: "code",
            markdown: `\`\`\`${text.code_language ?? ""}\n${text.text}\n\`\`\``,
            page,
            bbox,
            crop: false,
          });
        else if (text.label === "formula")
          out.push(
            text.text.trim()
              ? { type: "math", markdown: `$$\n${text.text.trim()}\n$$`, page, bbox, crop: false }
              : { type: "math", markdown: "Formula", page, bbox, crop: true },
          );
        else if (text.text.trim())
          out.push({
            type: "paragraph",
            markdown: escapeMarkdownText(text.text.trim()),
            page,
            bbox,
            crop: false,
          });
      }
      for (const child of text.children) visit(child.$ref);
      return;
    }
    flushList();
    const { page, bbox } = bboxOf(node.item.prov);
    if (node.kind === "table") {
      out.push({
        type: "table",
        markdown: tableMarkdown(node.item.data.grid),
        page,
        bbox,
        crop: false,
      });
    } else {
      const caption = node.item.captions.map((c) => resolve(c.$ref)).find((n) => n?.kind === "text")
        ?.item as { text?: string } | undefined;
      out.push({
        type: "figure",
        markdown: (caption?.text ?? "Figure").trim(),
        page,
        bbox,
        crop: true,
      });
    }
    for (const caption of node.item.captions) visit(caption.$ref);
    for (const child of node.item.children) visit(child.$ref);
  };
  for (const child of doc.body.children) visit(child.$ref);
  flushList();
  return out;
}

/** Block and crop counts within bounds (I-6: each crop is an image extract and an asset write). */
export function checkedBlocks(blocks: DoclingBlock[]): DoclingBlock[] {
  if (blocks.length > MAX_DOCLING_BLOCKS) throw new DoclingRejected("too many blocks");
  const crops = new Map<number, number>();
  for (const block of blocks.filter((b) => b.crop))
    crops.set(block.page, (crops.get(block.page) ?? 0) + 1);
  const total = [...crops.values()].reduce((sum, n) => sum + n, 0);
  if (total > MAX_DOCLING_CROPS || [...crops.values()].some((n) => n > MAX_DOCLING_CROPS_PER_PAGE))
    throw new DoclingRejected("too many crops");
  return blocks;
}

export function createDoclingClient(
  baseUrl: string,
  options: { timeoutMs?: number } = {},
): DoclingClient {
  return {
    async convert(bytes, filename, signal) {
      const form = new FormData();
      // The bytes come from Buffer.concat (an ArrayBuffer), so no copy is needed.
      const pdf = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
      form.append("files", pdf, filename);
      form.append("to_formats", "json");
      form.append("image_export_mode", "placeholder");
      form.append("do_ocr", "true");
      const response = await fetch(new URL("/v1/convert/file", baseUrl), {
        method: "POST",
        body: form,
        signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 180_000)]),
      });
      if (!response.ok) throw new Error(`docling HTTP ${response.status}`);
      const text = await readCappedText(response.body, MAX_DOCLING_RESPONSE_BYTES);
      const body = ConvertResponse.safeParse(JSON.parse(text));
      if (!body.success) throw new DoclingRejected("response shape");
      if (body.data.status === "failure" || !body.data.document.json_content)
        throw new Error(`docling status ${body.data.status}`);
      const doc = DoclingDocument.safeParse(body.data.document.json_content);
      if (!doc.success) throw new DoclingRejected("document shape");
      return checkedBlocks(doclingBlocks(doc.data));
    },
  };
}
