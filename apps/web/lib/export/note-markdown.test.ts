import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { ids } from "../fixtures/ids.ts";
import { fixtureRouter } from "../fixtures/router.ts";
import { buildNoteMarkdown, exportFileName } from "./note-markdown.ts";

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

  it("is served by the fixture notes.export as a data URL", async () => {
    const result = await api.notes.export({ noteId: ids.note(1) });
    expect(result.downloadUrl.startsWith("data:text/markdown;charset=utf-8,")).toBe(true);
  });
});
