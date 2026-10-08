import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { NoteDetail } from "../api/dto.ts";
import {
  archiveFileName,
  buildNoteArchive,
  buildNoteMarkdown,
  markdownFileName,
  noteAssetIds,
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
  it("zips the Markdown with its assets", () => {
    const out = buildNoteArchive({
      detail,
      folderPath: [],
      assets: [
        { id: asset, sha256: "a".repeat(64), mime: "image/png", bytes: new Uint8Array([1]) },
        { id: inline, sha256: "b".repeat(64), mime: "image/svg+xml", bytes: new Uint8Array([2]) },
      ],
    });
    expect(out.fileName.endsWith(".zip")).toBe(true);
    const files = unzipSync(out.bytes);
    expect(Object.keys(files).sort()).toEqual(
      [
        `assets/${"a".repeat(64)}.png`,
        `assets/${"b".repeat(64)}.svg`,
        markdownFileName(detail.note.title),
      ].sort(),
    );
  });
});
