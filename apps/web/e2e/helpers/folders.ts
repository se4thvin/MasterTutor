import type { Page } from "@playwright/test";
import { isWide } from "./test.ts";

/**
 * Folder names longer than a row at every QA width, even the 820px sheet (FolderName allows 120
 * characters): one with spaces, a nested one, and a space-free capitalised run with no wrap
 * point that is wider than a row at every width, even the 820px sheet (the one the glide tests use).
 */
export const LONG_FOLDER =
  "Quarterly reading list: advanced distributed systems, consensus protocols, Byzantine fault tolerance, replication papers";
export const LONG_UNBROKEN =
  "ANTIDISESTABLISHMENTARIANISM_AND_OTHER_UNBROKEN_IDENTIFIERS_THAT_NEVER_OFFER_A_LINE_BREAK_ANYWHERE_AT_ALL_V2";
export const LONG_CHILD =
  "Learning-rate schedulers that warm up, plateau for a while, then decay slowly over the remaining training steps";

/** Navigates and waits for hydration, so the first click is never dropped. */
export async function gotoReady(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
}

/** Creates a folder through the Folder actions menu: top level, or inside the current folder. */
export async function createFolder(page: Page, name: string, inCurrent = false): Promise<void> {
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: inCurrent ? "New subfolder" : "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}

/** The folder tree: the sidebar's on wide screens, else the Folders sheet's (opened here). */
export async function openFolderTree(page: Page) {
  if (!isWide(page)) await page.getByRole("button", { name: "Folders" }).click();
  const tree = page.getByRole("tree", { name: "Folders" });
  await tree.waitFor();
  return tree;
}
