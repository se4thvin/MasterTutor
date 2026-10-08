import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { NoteDetail } from "../api/dto.ts";
import {
  EXPORT_LIMITS,
  archiveFileName,
  buildNoteArchive,
  buildNoteMarkdown,
  exportTooLarge,
  markdownFileName,
  noteAssetIds,
  streamNoteArchive,
} from "./index.ts";

const asset = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const inline = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const at = "2026-10-05T00:00:00.000Z";
const block = (over: Partial<NoteDetail["blocks"][number]>): NoteDetail["blocks"][number] => ({
  id: crypto.randomUUID(),
  noteId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
  position: "a0",
  type: "paragraph",
  markdown: "",
  assetId: null,
  sourceId: null,
  origin: "dom",
  anchor: null,
  contentSha256: null,
  verified: true,
  edited: false,
  originalMarkdown: null,
  createdAt: at,
  ...over,
});
const detail: NoteDetail = {
  note: {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
    folderId: null,
    title: '"x: y" ../../a',
    lede: null,
    fidelity: "verified",
    coverage: 1,
    filedBy: "agent",
    runId: null,
    sourceKinds: ["youtube"],
    createdAt: at,
    updatedAt: at,
  },
  blocks: [
    block({
      type: "figure",
      markdown: `Chart\n\n[Rendered view](asset:${inline})`,
      assetId: asset,
    }),
    block({
      type: "transcript",
      markdown: "Hello there",
      origin: "captions",
      anchor: {
        selector: null,
        xpath: null,
        start: null,
        end: null,
        textFragment: null,
        tStart: 65,
        tEnd: 70,
      },
    }),
    block({ markdown: `See ![inline](asset:${inline}).` }),
  ],
  sources: [],
};

describe("the export (decision 18)", () => {
  it("names the archive .zip and the note inside it .md, with no path tricks", () => {
    expect(archiveFileName('"x: y" ../../a')).toBe("x y ....a.zip");
    expect(markdownFileName("Plants")).toBe("Plants.md");
    expect(archiveFileName("   ")).toBe("note.zip");
  });
  it("maps assets to content-addressed paths and adds times to transcripts", () => {
    const md = buildNoteMarkdown(detail, [], (id) =>
      id === asset ? "assets/aa.png" : id === inline ? "assets/bb.png" : null,
    );
    expect(md).toContain("![Chart](assets/aa.png)");
    expect(md).toContain("[Rendered view](assets/bb.png)");
    expect(md).toContain("[01:05] Hello there");
    expect(md).toContain("![inline](assets/bb.png)");
    expect(noteAssetIds(detail).sort()).toEqual([asset, inline].sort());
  });
  const source = (sha: string, mime: string, bytes: number, opened: string[]) => ({
    sha256: sha,
    mime,
    bytes,
    open: async () => {
      opened.push(sha);
      return new Blob([new Uint8Array(bytes).fill(7)]).stream();
    },
  });

  it("streams the Markdown and its assets, opening each asset only when the zip reaches it", async () => {
    const opened: string[] = [];
    const out = streamNoteArchive({
      detail,
      folderPath: [],
      assets: [
        { id: asset, ...source("a".repeat(64), "image/png", 3, opened) },
        { id: inline, ...source("b".repeat(64), "image/svg+xml", 2, opened) },
      ],
    });
    expect(out.fileName.endsWith(".zip")).toBe(true);
    const reader = out.body.getReader();
    const chunks: Uint8Array[] = [];
    const first = await reader.read(); // the Markdown entry comes first
    if (!first.done) chunks.push(first.value);
    expect(opened.length).toBeLessThan(2);
    for (let next = await reader.read(); !next.done; next = await reader.read())
      chunks.push(next.value);
    expect(opened).toEqual(["a".repeat(64), "b".repeat(64)]);
    const files = unzipSync(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    expect(files[`assets/${"a".repeat(64)}.png`]).toEqual(new Uint8Array([7, 7, 7]));
    expect(Object.keys(files)).toContain(markdownFileName(detail.note.title));
  });

  it("collects the same zip in memory for small exports (fixture API)", async () => {
    const opened: string[] = [];
    const bytes = await buildNoteArchive({
      detail,
      folderPath: [],
      assets: [
        { id: asset, ...source("a".repeat(64), "image/png", 1, opened) },
        { id: inline, ...source("b".repeat(64), "image/svg+xml", 1, opened) },
      ],
    });
    expect(bytes.fileName.endsWith(".zip")).toBe(true);
    const files = unzipSync(bytes.bytes);
    expect(Object.keys(files).sort()).toEqual(
      [
        `assets/${"a".repeat(64)}.png`,
        `assets/${"b".repeat(64)}.svg`,
        markdownFileName(detail.note.title),
      ].sort(),
    );
  });

  it("refuses an export over the count or size cap, with a clear reason", () => {
    expect(exportTooLarge([{ bytes: 10 }])).toBeNull();
    expect(
      exportTooLarge(Array.from({ length: EXPORT_LIMITS.maxAssets + 1 }, () => ({ bytes: 1 }))),
    ).toMatch(/assets/);
    expect(exportTooLarge([{ bytes: EXPORT_LIMITS.maxBytes + 1 }])).toMatch(/MB/);
  });
});
