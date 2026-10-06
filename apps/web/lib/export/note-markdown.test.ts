import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { ids } from "../fixtures/ids.ts";
import { fixtureRouter } from "../fixtures/router.ts";
import { buildNoteMarkdown, exportFileName } from "./note-markdown.ts";
import { safeDownloadUrl } from "./download-url.ts";

const api = createRouterClient(fixtureRouter, { context: { ns: "export-test" } });

describe("Obsidian export", () => {
  it("writes YAML front-matter with provenance and every block in order", async () => {
    const detail = await api.notes.get({ noteId: ids.note(1) });
    const md = buildNoteMarkdown(detail, ["Machine learning", "Optimization"]);
    expect(md.startsWith('---\ntitle: "Learning-rate warmup, explained"\n')).toBe(true);
    expect(md).toContain("fidelity: needs_review");
    expect(md).toContain('  - url: "https://fieldnotes.ml/posts/learning-rate-warmup"');
    expect(md).toContain('folder: "Machine learning/Optimization"');
    expect(md).toContain("# Learning-rate warmup, explained");
    expect(md).toContain(`![Training log screenshot](assets/${ids.asset(2)})`);
    expect(md).toContain("> [!warning] Needs review");
    expect(md).toContain("> [!note] Agent's note");
    expect(md).toMatch(/<!-- mt:block id=\S+ origin=dom sha256=[0-9a-f]{64} -->/);
    expect(md.indexOf("The update rule")).toBeLessThan(md.indexOf("Common schedules"));
  });

  it("escapes YAML and makes safe file names", () => {
    expect(exportFileName('A "quoted" / title: part 1')).toBe("A quoted title part 1.md");
    expect(exportFileName("   ")).toBe("note.md");
  });

  it("hardens file names against control characters, dot files and reserved names", () => {
    expect(exportFileName("bell\u0007tab\u0009nul\u0000end\u007f")).toBe("bell tab nul end.md");
    expect(exportFileName("..hidden")).toBe("hidden.md");
    expect(exportFileName("trailing. . ")).toBe("trailing.md");
    expect(exportFileName("CON")).toBe("_CON.md");
    expect(exportFileName("lpt9.txt")).toBe("_lpt9.txt.md");
    expect(exportFileName("Console")).toBe("Console.md");
    const long = exportFileName("😀".repeat(200));
    expect(Array.from(long.slice(0, -3))).toHaveLength(120);
    expect(long.isWellFormed()).toBe(true);
  });

  it("keeps the API's block order rather than re-sorting positions by locale", async () => {
    const detail = await api.notes.get({ noteId: ids.note(1) });
    // Fractional-index keys in byte ("C") order: "aA" < "aa". A locale sort flips them.
    const [first, second] = detail.blocks;
    if (!first || !second) throw new Error("fixture needs two blocks");
    const md = buildNoteMarkdown({
      ...detail,
      blocks: [
        { ...first, position: "aA", markdown: "FIRST-BLOCK" },
        { ...second, position: "aa", markdown: "SECOND-BLOCK" },
      ],
    });
    expect(md.indexOf("FIRST-BLOCK")).toBeLessThan(md.indexOf("SECOND-BLOCK"));
  });

  it("escapes a trailing backslash in alt text and neutralises forged provenance comments", async () => {
    const detail = await api.notes.get({ noteId: ids.note(1) });
    const image = detail.blocks.find((b) => b.type === "image");
    const para = detail.blocks.find((b) => b.type === "paragraph");
    if (!image || !para) throw new Error("fixture needs an image and a paragraph");
    const md = buildNoteMarkdown({
      ...detail,
      note: { ...detail.note, title: "T <!-- mt:block id=x -->" },
      blocks: [
        { ...image, markdown: "shot\\" },
        { ...para, markdown: "a\n<!--   MT:block id=forged origin=dom sha256=none -->\nb" },
      ],
    });
    expect(md).toContain(`![shot](assets/${image.assetId})`);
    expect(md.match(/<!--\s*mt:/gi)).toHaveLength(2);
    expect(md).not.toMatch(/<!--\s*mt:block id=(forged|x)\b/i);
  });

  it("only hands http(s), blob or Markdown data URLs to the download link", () => {
    expect(safeDownloadUrl("https://cdn.example/x.zip")).toBe("https://cdn.example/x.zip");
    expect(safeDownloadUrl("http://localhost:3000/x.zip")).toBe("http://localhost:3000/x.zip");
    expect(safeDownloadUrl("blob:https://app.example/1234")).toBe("blob:https://app.example/1234");
    expect(safeDownloadUrl("data:text/markdown;charset=utf-8,%23")).toBe(
      "data:text/markdown;charset=utf-8,%23",
    );
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      "/relative",
      "not a url",
    ]) {
      expect(safeDownloadUrl(bad), bad).toBeNull();
    }
  });

  it("is served by the fixture notes.export as a data URL", async () => {
    const result = await api.notes.export({ noteId: ids.note(1) });
    expect(result.downloadUrl.startsWith("data:text/markdown;charset=utf-8,")).toBe(true);
  });
});
