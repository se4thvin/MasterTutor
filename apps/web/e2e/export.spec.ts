import { readFile } from "node:fs/promises";
import { ids } from "../lib/fixtures/ids.ts";
import { expect, test } from "./helpers/test.ts";

test("exports the note as faithful Obsidian Markdown", async ({ page }) => {
  await page.goto(`/notes/${ids.note(1)}`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .md", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Learning-rate warmup, explained.md");

  const path = await file.path();
  const md = await readFile(path, "utf8");
  // Front-matter with provenance.
  expect(md.startsWith('---\ntitle: "Learning-rate warmup, explained"\n')).toBe(true);
  expect(md).toContain(`note_id: ${ids.note(1)}`);
  expect(md).toMatch(/^fidelity: (verified|partial|needs_review)$/m);
  expect(md).toContain('  - url: "https://fieldnotes.ml/posts/learning-rate-warmup"');
  expect(md).toMatch(/\n---\n\n# Learning-rate warmup, explained\n/);
  // Every block, in reader order, each with its provenance comment.
  const blocks = await page.locator(".reader-content .blk").count();
  expect(
    md.match(/<!-- mt:block id=[0-9a-f-]+ origin=\w+ sha256=([0-9a-f]{64}|none) -->/g),
  ).toHaveLength(blocks);
  expect(md.indexOf("The update rule")).toBeLessThan(md.indexOf("Common schedules"));
  // Review and agent notes as Obsidian callouts; assets referenced, never inlined.
  expect(md).toContain("> [!warning] Needs review");
  expect(md).toContain("> [!note] Agent's note");
  expect(md).toContain(`(assets/${ids.asset(2)})`);
  expect(md).not.toMatch(/data:image|<script/i);
  expect(md.endsWith("\n")).toBe(true);
});
