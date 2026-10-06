import { FIXTURE_AUTH_COOKIE } from "../lib/fixtures/cookies.ts";
import type { Page } from "@playwright/test";
import { RECORDED_RUN_ID, rec, recordedDetail } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const overlay = (page: Page) => page.getByRole("button", { name: "Take control of the browser" });
const userHeld = () =>
  recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover" });

test.describe("Takeover and hand back", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "behaviour checks run once");

  test("clicking into the preview takes control optimistically, once, and focuses the stream (Review Focus 2)", async ({
    page,
  }) => {
    const calls = await gotoRun(page);
    await overlay(page).dblclick();
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect
      .poll(() => rpcCalls(calls, "runs/takeControl"))
      .toEqual([{ runId: RECORDED_RUN_ID }]);
    await emit(page, [rec({ type: "control", holder: "user" })]);
    await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
    await expect(page.locator("iframe")).toBeFocused();
  });

  test("reverts when control isn't confirmed within 2s, then re-applies a late control event (B6 E5)", async ({
    page,
  }) => {
    await page.clock.install();
    await gotoRun(page);
    await overlay(page).click();
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await page.clock.runFor(2_100);
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect(
      page.getByText("The browser didn't respond, so the agent still has control."),
    ).toBeVisible();
    await emit(page, [rec({ type: "control", holder: "user" })]);
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect(page.getByText("You're in control now.")).toBeVisible();
  });

  test("reverts at once when the agent reports takeover_failed (B6 §3, A6)", async ({ page }) => {
    await gotoRun(page);
    await overlay(page).click();
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await emit(page, [
      rec({ type: "error", code: "takeover_failed", message: "The live view was not connected" }),
      rec({ type: "control", holder: "agent" }),
    ]);
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect(page.getByText("Couldn't take control. The agent kept it.")).toBeVisible();
  });

  test("names another member's control when takeControl is FORBIDDEN", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/takeControl": () => {
          throw new RpcFailure("FORBIDDEN", 403);
        },
      },
    });
    await overlay(page).click();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect(page.getByText("Someone else is in control of this browser.")).toBeVisible();
  });

  test("an ended session goes through the shared RPC link to sign-in (E3, R29-4)", async ({
    page,
    context,
    baseURL,
  }) => {
    await gotoRun(page, {
      handlers: {
        "runs/takeControl": () => {
          throw new RpcFailure("UNAUTHORIZED", 401);
        },
      },
    });
    // The session has ended (the fixture's sign-in page would otherwise send a signed-in user on).
    await context.addCookies([
      { name: FIXTURE_AUTH_COOKIE, value: "signed-out", url: baseURL ?? "http://localhost:3100" },
    ]);
    await overlay(page).click();
    await expect(page).toHaveURL(
      new RegExp(`/sign-in\\?next=${encodeURIComponent(`/runs/${RECORDED_RUN_ID}`)}$`),
    );
  });

  test("hands back with a note", async ({ page }) => {
    const calls = await gotoRun(page, { detail: userHeld() });
    await frame(page).getByRole("button", { name: "Hand back" }).click();
    const dialog = page.getByRole("dialog", { name: "Hand back to the agent" });
    await dialog
      .getByLabel("Note to the agent (optional)")
      .fill("I closed the survey. Carry on from the quiz page.");
    await dialog.getByRole("button", { name: "Hand back" }).click();
    await expect(frame(page)).not.toHaveAttribute("data-state", "control");
    await expect
      .poll(() => rpcCalls(calls, "runs/handBack"))
      .toEqual([
        { runId: RECORDED_RUN_ID, note: "I closed the survey. Carry on from the quiz page." },
      ]);
  });

  test("a hand back whose control event never comes re-reads the run after 5s (A6)", async ({
    page,
  }) => {
    await page.clock.install();
    const calls = await gotoRun(page, { detail: userHeld() });
    await frame(page).getByRole("button", { name: "Hand back" }).click();
    await page
      .getByRole("dialog", { name: "Hand back to the agent" })
      .getByRole("button", { name: "Hand back" })
      .click();
    await expect(frame(page)).not.toHaveAttribute("data-state", "control");
    const gets = rpcCalls(calls, "runs/get").length;
    await page.clock.runFor(5_100);
    await expect.poll(() => rpcCalls(calls, "runs/get").length).toBe(gets + 1);
    await expect(frame(page)).toHaveAttribute("data-state", "control");
  });

  test("taking over a sleeping run wakes it, then hands over", async ({ page }) => {
    const calls = await gotoRun(page, {
      detail: recordedDetail({ status: "sleeping", slotName: null }),
    });
    await overlay(page).click();
    await expect(page.getByText("Waking the browser so you can take control…")).toBeVisible();
    await expect.poll(() => rpcCalls(calls, "runs/takeControl").length).toBe(1);
    await emit(page, [
      rec({ type: "slot", slotName: "browser-1" }),
      rec({ type: "control", holder: "user" }),
    ]);
    await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
  });

  test("Full screen requests full screen and locks the keyboard", async ({ page }) => {
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __fs: string[] }).__fs = log;
      Element.prototype.requestFullscreen = async function () {
        log.push("fullscreen");
      };
      Object.defineProperty(navigator, "keyboard", {
        value: { lock: async () => void log.push("lock"), unlock: () => log.push("unlock") },
      });
    });
    await gotoRun(page);
    await page.getByRole("button", { name: "Full screen" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __fs: string[] }).__fs))
      .toEqual(["fullscreen", "lock"]);
  });
});
