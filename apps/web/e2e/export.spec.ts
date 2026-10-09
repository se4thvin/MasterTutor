import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { ids } from "../lib/fixtures/ids.ts";
import { expect, test } from "./helpers/test.ts";

test("exports the note as a zip of faithful Obsidian Markdown and its assets", async ({ page }) => {
  await page.goto(`/notes/${ids.note(1)}`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  // Decision 18: the download is a zip, and its name says so.
  expect(file.suggestedFilename()).toBe("Learning-rate warmup, explained.zip");

  const zip = unzipSync(new Uint8Array(await readFile(await file.path())));
  const entry = zip["Learning-rate warmup, explained.md"];
  expect(entry).toBeDefined();
  const md = new TextDecoder().decode(entry);
  expect(Object.keys(zip).some((name) => /^assets\/[0-9a-f]{64}\.svg$/.test(name))).toBe(true);
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
  // Review warnings as Obsidian callouts; assets referenced, never inlined.
  expect(md).toContain("> [!warning] Needs review");
  expect(md).not.toContain("origin=model");
  expect(md).toMatch(/\(assets\/[0-9a-f]{64}\.svg\)/);
  expect(md).not.toMatch(/data:image|<script/i);
  expect(md.endsWith("\n")).toBe(true);
});
