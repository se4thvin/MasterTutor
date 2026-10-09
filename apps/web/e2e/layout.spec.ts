import type { Page } from "@playwright/test";
import { recordedEvents } from "../lib/fixtures/run-recording.ts";
import { emit, frame, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const steps = (page: Page) => page.getByRole("complementary", { name: "Thread" });
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const intersects = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("1440: thread beside the browser; the callout and leader stay in the frame, clear of the thread (D22)", async ({
  page,
}) => {
  test.skip(width(page) !== 1440, "wide layout");
  await gotoRun(page);
  await emit(page, [recordedEvents()[0]!]);
  const f = (await frame(page).boundingBox())!;
  const s = (await steps(page).boundingBox())!;
  expect(s.x).toBeGreaterThanOrEqual(f.x + f.width);
  const label = page.locator(".run-callout");
  await expect(label).toBeVisible();
  const c = (await label.boundingBox())!;
  expect(c.x + c.width).toBeLessThanOrEqual(f.x + f.width + 0.5);
  const leader = (await page.locator(".run-leader line").boundingBox())!;
  expect(intersects(leader, s)).toBe(false);
  await page.getByRole("button", { name: "Callouts" }).click();
  await expect(page.getByTestId("step-callout")).toHaveCount(0);
});

for (const w of [1180, 1024] as const) {
  test(`${w}: thread beside the browser; callouts become gutter badges and the leader is hidden (D22)`, async ({
    page,
  }) => {
    test.skip(width(page) !== w, "icon-rail layout");
    await gotoRun(page);
    await emit(page, [recordedEvents()[0]!]);
    const f = (await frame(page).boundingBox())!;
    const s = (await steps(page).boundingBox())!;
    expect(s.x).toBeGreaterThanOrEqual(f.x + f.width);
    await expect(page.getByTestId("gutter-badge")).toBeVisible();
    await expect(page.locator(".run-leader")).toBeHidden();
    await expect(page.getByRole("button", { name: "Callouts" })).toBeHidden();
  });
}

for (const w of [1440, 1180, 1024] as const) {
  test(`${w}: the browser is the hero: the whole frame and the thread fit the first screen`, async ({
    page,
  }) => {
    test.skip(width(page) !== w, "pane layouts");
    await gotoRun(page);
    const viewport = page.viewportSize()!;
    const f = (await frame(page).boundingBox())!;
    const s = (await steps(page).boundingBox())!;
    expect(f.y + f.height).toBeLessThanOrEqual(viewport.height);
    expect(s.y + s.height).toBeLessThanOrEqual(viewport.height);
    // The frame takes most of the content width beside the pane.
    expect(f.width).toBeGreaterThan(s.width * 1.5);
  });
}

test("390: the path is trimmed and the approval is a bottom sheet", async ({ page }) => {
  test.skip(width(page) !== 390, "phone layout");
  await gotoRun(page);
  await emit(page, recordedEvents());
  const sheet = (await page.getByRole("alertdialog").boundingBox())!;
  expect(Math.round(sheet.y + sheet.height)).toBeGreaterThanOrEqual(843);
  await expect(page.getByTestId("origin-pill").locator(".run-path")).toBeHidden();
});

test("Stop asks first, focuses Keep running, then cancels", async ({ page }) => {
  test.skip(width(page) !== 1440, "behaviour check runs once");
  const calls = await gotoRun(page);
  await page.getByRole("button", { name: "Stop" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Stop this run?" });
  await expect(dialog.getByRole("button", { name: "Keep running" })).toBeFocused();
  await dialog.getByRole("button", { name: "Stop run" }).click();
  await expect.poll(() => rpcCalls(calls, "runs/cancel").length).toBe(1);
});
