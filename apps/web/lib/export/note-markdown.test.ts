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
  });

  it("caps file names at 255 UTF-8 bytes (NAME_MAX), not characters, without splitting one", () => {
    const bytes = (name: string) => new TextEncoder().encode(name).length;
    const ascii = exportFileName("a".repeat(400));
    expect(bytes(ascii)).toBe(255);
    expect(ascii.endsWith(".md")).toBe(true);
    const emoji = exportFileName("😀".repeat(200));
    expect(bytes(emoji)).toBeLessThanOrEqual(255);
    expect(emoji).toBe(`${"😀".repeat(63)}.md`);
    expect(emoji.isWellFormed()).toBe(true);
    // A ZWJ family is one grapheme: it is kept whole or dropped, never cut into its parts.
    const family = "👨‍👩‍👧";
    const families = exportFileName(family.repeat(40));
    expect(bytes(families)).toBeLessThanOrEqual(255);
    expect(families.slice(0, -3).replaceAll(family, "")).toBe("");
    expect(exportFileName("é".repeat(200))).toBe(`${"é".repeat(126)}.md`);
  });

  it("checks reserved names after the cap, so a cut cannot expose one", () => {
    // One grapheme of 261 bytes (e + 130 combining acutes) cannot fit, leaving only "CON".
    expect(exportFileName(`CON ${"e" + "\u0301".repeat(130)}`)).toBe("_CON.md");
    // A long reserved-looking name keeps its prefix and still fits NAME_MAX.
    const long = exportFileName(`lpt9.${"a".repeat(300)}`);
    expect(long.startsWith("_lpt9.")).toBe(true);
    expect(new TextEncoder().encode(long).length).toBe(255);
  });

  it("strips bidi controls so a name cannot display as something else", () => {
    expect(exportFileName("invoice\u202Egpj.exe")).toBe("invoicegpj.exe.md");
    const bidi = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    // LRM, RLM and ALM are bidi controls too.
    for (const cp of [...bidi, 0x200e, 0x200f, 0x061c]) {
      expect(exportFileName(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toBe("ab.md");
    }
    expect(exportFileName("\u2067\u2069")).toBe("note.md");
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

  it("only hands same-origin, https, blob or Markdown data URLs to the download link", () => {
    const origin = "https://app.example";
    // Phase 7's notes.export answers with a same-origin relative path.
    expect(safeDownloadUrl("/api/notes/n1/export", origin)).toBe(
      "https://app.example/api/notes/n1/export",
    );
    expect(safeDownloadUrl("relative/x.zip", origin)).toBe("https://app.example/relative/x.zip");
    expect(safeDownloadUrl("http://localhost:3000/x.zip", "http://localhost:3000")).toBe(
      "http://localhost:3000/x.zip",
    );
    expect(safeDownloadUrl("https://cdn.example/x.zip", origin)).toBe("https://cdn.example/x.zip");
    expect(safeDownloadUrl("blob:https://app.example/1234", origin)).toBe(
      "blob:https://app.example/1234",
    );
    expect(safeDownloadUrl("data:text/markdown;charset=utf-8,%23", origin)).toBe(
      "data:text/markdown;charset=utf-8,%23",
    );
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      // Cross-origin plain http would downgrade the download.
      "http://evil.example/x.zip",
    ]) {
      expect(safeDownloadUrl(bad, origin), bad).toBeNull();
    }
  });

  it("is served by the fixture notes.export as a data URL", async () => {
    const result = await api.notes.export({ noteId: ids.note(1) });
    expect(result.downloadUrl.startsWith("data:text/markdown;charset=utf-8,")).toBe(true);
  });
});
