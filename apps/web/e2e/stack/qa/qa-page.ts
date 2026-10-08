import { controlHandlers, mockRpc, stubLiveFrame } from "../../helpers/run.ts";
import type { Page } from "@playwright/test";
import type { Screen } from "./screens.ts";
import { QA_NOW } from "./seed.ts";

/**
 * Opens one catalog screen on the seeded QA stack, deterministic and ready to check or shoot.
 * Plain Playwright waits only (no test-runner `expect`), so the standalone shooter can use it.
 */
export async function openScreen(page: Page, screen: Screen): Promise<void> {
  await page.clock.setFixedTime(QA_NOW);
  // The QA stack runs no slots (P8-13): the live view is fe's fixed frame, and openLive is
  // answered in the page with fe's handler. Every other RPC reaches the real router.
  await stubLiveFrame(page);
  const openLive = controlHandlers()["runs/openLive"];
  if (!openLive) throw new Error("fe's controlHandlers() no longer answers runs/openLive");
  await mockRpc(page, { "runs/openLive": openLive });
  if (screen.routes) await screen.routes(page);
  await page.goto(screen.path);
  await page.locator("main").first().waitFor();
  if (screen.frameState) {
    await page
      .locator(`[data-testid="browser-frame"][data-state="${screen.frameState}"]`)
      .waitFor();
  }
  for (const text of screen.expectTexts) {
    await page.getByText(text).filter({ visible: true }).first().waitFor();
  }
  if (screen.prepare) await screen.prepare(page);
}
