import { expect, test } from "./helpers/test.ts";

test("exports the note as Markdown", async ({ page }) => {
  await page.goto("/notes/00000000-0000-4000-8000-000002000001");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .md", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Learning-rate warmup, explained.md");
});
