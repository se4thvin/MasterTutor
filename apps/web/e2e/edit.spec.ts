import type { Page } from "@playwright/test";
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

type RpcBody = { json: { blockId: string; markdown: string } };

async function openEditor(page: Page, block: number) {
  await page.getByRole("button", { name: new RegExp(`Provenance for block ${block}:`) }).click();
  await page
    .getByRole("dialog", { name: "Block provenance" })
    .getByRole("button", { name: "Edit block" })
    .click();
  const editor = page.getByRole("textbox", { name: "Edit block" });
  await expect(editor).toBeFocused();
  return editor;
}

test("⌘↵ saves exactly what was typed, with no hard break, and returns focus", async ({ page }) => {
  await page.goto(NOTE);
  const editor = await openEditor(page, 3);
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("Adam rescales every step.");
  // Put the caret mid-text: a stray hard break there would split the sentence.
  for (let i = 0; i < 5; i += 1) await editor.press("ArrowLeft");
  const saved = page.waitForRequest("**/api/rpc/notes/updateBlock");
  await editor.press("ControlOrMeta+Enter");
  expect(((await saved).postDataJSON() as RpcBody).json.markdown).toBe("Adam rescales every step.");
  await expect(editor).toBeHidden();
  const trigger = page.getByRole("button", { name: /Provenance for block 3:/ });
  const block = page.locator(".blk").filter({ has: trigger });
  await expect(block).toContainText("Adam rescales every step.");
  await expect(block.locator("br")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Provenance for block 3:/ })).toBeFocused();
});

test("Escape in the rich editor cancels without saving and returns focus", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/rpc/notes/updateBlock")) writes.push(r.url());
  });
  await page.goto(NOTE);
  const editor = await openEditor(page, 3);
  await editor.pressSequentially(" draft");
  await editor.press("Escape");
  await expect(editor).toBeHidden();
  await expect(page.locator("#main")).not.toContainText("draft");
  await expect(page.getByRole("button", { name: /Provenance for block 3:/ })).toBeFocused();
  expect(writes).toEqual([]);
});

test("Markdown the rich editor can't represent edits raw, and an unchanged save is a no-op", async ({
  page,
}) => {
  const original = "Adam scales by $\\hat v_t$ at _each_ step[^1].";
  await page.route("**/api/rpc/notes/get", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: { blocks: Array<{ markdown: string }> } };
    const third = body.json.blocks[2];
    if (third) third.markdown = original;
    await route.fulfill({ response, json: body });
  });
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/rpc/notes/updateBlock")) writes.push(r.url());
  });
  await page.goto(NOTE);
  const editor = await openEditor(page, 3);
  await expect(editor).toHaveValue(original);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(
    page.getByRole("button", { name: /Provenance for block 3:/ }),
  ).not.toHaveAccessibleName(/Edited by you/);
  await expect(page.getByRole("button", { name: /Provenance for block 3:/ })).toBeFocused();
  expect(writes).toEqual([]);
});
