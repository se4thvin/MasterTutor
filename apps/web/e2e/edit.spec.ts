import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("edits a paragraph in place and keeps the original", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("button", { name: /Provenance for block 3/ }).click();
  await page
    .getByRole("dialog", { name: "Block provenance" })
    .getByRole("button", { name: "Edit block" })
    .click();
  const editor = page.getByRole("textbox", { name: "Edit block" });
  await expect(editor).toBeVisible();
  await expectCleanScreen(page);
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("Adam rescales every step.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#main")).toContainText("Adam rescales every step.");
  await page.getByRole("button", { name: /Provenance for block 3: Edited by you/ }).click();
  await page.getByRole("button", { name: "Show original" }).click();
  await expect(page.getByRole("dialog", { name: "Block provenance" })).toContainText(
    "second moment",
  );
});

test("code blocks edit as raw text and Escape cancels", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("button", { name: /Provenance for block 8/ }).click();
  await page
    .getByRole("dialog", { name: "Block provenance" })
    .getByRole("button", { name: "Edit block" })
    .click();
  const raw = page.getByRole("textbox", { name: "Edit block" });
  await expect(raw).toHaveValue(/```python/);
  await raw.press("Escape");
  await expect(raw).toBeHidden();
});
