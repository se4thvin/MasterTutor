import type { Page } from "@playwright/test";
import { RECORDED_APPROVAL_ID, rec, recordedEvents } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const steps = (page: Page) => page.getByRole("complementary", { name: "Thread" });
/** FIXTURE_VIEWER.id (lib/server/viewer.ts imports server-only modules, so specs name it). */
const VIEWER_ID = "fixture-user";

test.describe("Thread", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1440,
    "content checks run once; 390 has its own test",
  );

  test("lists actions with spoken status marks, a vault-fill chip, pages, thoughts and a summary", async ({
    page,
  }) => {
    await gotoRun(page);
    await expect(steps(page).getByText("5 steps · 2 captures")).toBeVisible();
    await expect(steps(page).getByText("Filled the password for ada-learn")).toBeVisible();
    await expect(steps(page).getByText("Vault fill")).toBeVisible();
    await expect(steps(page).getByRole("img", { name: "Completed" }).first()).toBeVisible();
    await expect(steps(page).getByText("Planning the sign-in")).toBeVisible();
    await expect(
      steps(page).getByText(/^The course home wants a login before any lecture opens\./),
    ).toBeVisible();
    await expect(
      steps(page).getByRole("button", {
        name: "Replay page: learn.example.edu/course/week-2",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("ThoughtLine thinks during decide, then settles while acting", async ({ page }) => {
    await gotoRun(page);
    const decideStart = recordedEvents()[3]!;
    await emit(page, [decideStart]);
    await expect(
      page.getByRole("status").filter({ hasText: "Deciding whether to start the quiz" }),
    ).toBeAttached();
    // One voice: of every live region (status roles and aria-live), one says it (I1).
    await expect(
      page
        .locator('[aria-live]:not([aria-live="off"]), [role="status"]')
        .filter({ hasText: "Deciding whether to start the quiz" }),
    ).toHaveCount(1);
    await emit(page, [
      rec({
        type: "step",
        seq: 13,
        phase: "act",
        state: "started",
        caption: "Opening the quiz",
        url: null,
        screenshotKey: null,
        action: null,
      }),
    ]);
    await expect(page.getByRole("status").filter({ hasText: /^Thought for/ })).toBeAttached();
  });

  test("budget meters roll to new usage", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [recordedEvents()[2]!]);
    await expect(page.getByTestId("meter-steps").locator(".sr-only")).toHaveText("10");
    await expect(page.getByTestId("meter-spend").locator(".sr-only")).toHaveText("$0.44");
  });

  test("messages send optimistically, dedupe on echo, and restore on failure", async ({ page }) => {
    let fail = false;
    await gotoRun(page, {
      handlers: {
        "runs/sendMessage": () => {
          if (fail) throw new RpcFailure("INTERNAL_SERVER_ERROR", 500);
          return { ok: true };
        },
      },
    });
    const box = page.getByLabel("Message the agent");
    await box.fill("Skip the quiz");
    await box.press("Enter");
    await expect(steps(page).getByText("Skip the quiz")).toHaveCount(1);
    await emit(page, [rec({ type: "user_message", text: "Skip the quiz" })]);
    await expect(steps(page).getByText("Skip the quiz")).toHaveCount(1);
    fail = true;
    await box.fill("Second note");
    await box.press("Enter");
    await expect(page.getByText("Couldn't send your message. It's back in the box.")).toBeVisible();
    await expect(box).toHaveValue("Second note");
  });

  test("decisions name the viewer, another member and superseded approvals (A4, Review Focus 6)", async ({
    page,
  }) => {
    await gotoRun(page);
    await emit(page, [
      ...recordedEvents(),
      rec({
        type: "approval_resolved",
        approvalId: RECORDED_APPROVAL_ID,
        status: "approved",
        decidedBy: VIEWER_ID,
      }),
    ]);
    await expect(steps(page).getByText("You approved: click “Start quiz”")).toBeVisible();
    await emit(page, [
      rec({
        type: "approval_requested",
        approvalId: "00000000-0000-4000-8000-000009000008",
        request: {
          kind: "new_origin",
          origin: "https://docs.example.org",
          url: "https://docs.example.org/x",
        },
      }),
      rec({
        type: "approval_resolved",
        approvalId: "00000000-0000-4000-8000-000009000008",
        status: "superseded",
        decidedBy: "agent",
      }),
    ]);
    await expect(steps(page).getByText("No longer needed: open docs.example.org")).toBeVisible();
  });

  test("replay: a step with a screenshot opens the scrubber, play advances, Jump to live returns", async ({
    page,
  }) => {
    await gotoRun(page);
    await page.getByRole("button", { name: "Replay step: Clicked “Log in”" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "replay");
    // "Log in" replays the screen it was clicked on: the first of the run's two screenshots.
    await expect(page.getByRole("slider", { name: "Replay position" })).toHaveValue("1");
    await page.getByRole("button", { name: "Play replay" }).click();
    await expect(page.getByRole("slider", { name: "Replay position" })).toHaveValue("2", {
      timeout: 3_000,
    });
    await frame(page).getByRole("button", { name: "Jump to live" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
  });

  test("replaying one of several rows that share a screenshot selects only that row (Minor 3)", async ({
    page,
  }) => {
    await gotoRun(page);
    await page
      .getByRole("button", { name: "Replay step: Filled the password for ada-learn" })
      .click();
    await expect(frame(page)).toHaveAttribute("data-state", "replay");
    const selected = page.locator(".th-item[data-selected]");
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText("Filled the password for ada-learn");
  });
});

test("phone width: the peek bar opens the thread as a bottom sheet with the composer", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await expect(page.getByRole("complementary", { name: "Thread" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Thread/ })).toBeHidden();
  const peek = page.getByRole("button", { name: /^Open thread: / });
  await expect(peek).toContainText("5 steps · 2 captures");
  await peek.click();
  const sheet = page.getByRole("dialog", { name: "Thread" });
  await expect(sheet.getByText("Filled the password for ada-learn")).toBeInViewport();
  await expect(sheet.getByLabel("Message the agent")).toBeVisible();
});

test("tablet width: the thread sits under the browser and hides", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 820, "tablet width only");
  await gotoRun(page);
  const f = (await frame(page).boundingBox())!;
  const pane = (await steps(page).boundingBox())!;
  expect(pane.y).toBeGreaterThanOrEqual(f.y + f.height);
  await steps(page).getByRole("button", { name: "Hide thread" }).click();
  await expect(steps(page)).toHaveCount(0);
  await page.getByRole("button", { name: /^Thread/ }).click();
  await expect(steps(page)).toBeVisible();
});

test.describe("Thread pane (fe-run-chat)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "behaviour checks run once");
  const toggle = (page: Page) => page.getByRole("button", { name: /^Thread/ });

  test("hides and shows, remembers the choice per viewer, and counts what arrived meanwhile", async ({
    page,
  }) => {
    await gotoRun(page);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await steps(page).getByRole("button", { name: "Hide thread" }).click();
    await expect(steps(page)).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => localStorage.getItem("mt.run-thread"))).toBe("off");
    // The frame takes the room the pane gave up.
    const wide = (await frame(page).boundingBox())!.width;
    await page.reload();
    await expect(frame(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(steps(page)).toHaveCount(0);
    expect((await frame(page).boundingBox())!.width).toBeCloseTo(wide, 0);
    await emit(page, recordedEvents().slice(0, 2));
    await expect(toggle(page)).toContainText("1 new");
    await page.keyboard.press("t");
    await expect(steps(page)).toBeVisible();
    await expect(toggle(page)).not.toContainText("new");
    expect(await page.evaluate(() => localStorage.getItem("mt.run-thread"))).toBe("on");
    expect((await frame(page).boundingBox())!.width).toBeLessThan(wide);
  });

  test("still works when storage is blocked: shown by default, hidden in memory", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await gotoRun(page);
    await expect(steps(page)).toBeVisible();
    await steps(page).getByRole("button", { name: "Hide thread" }).click();
    await expect(steps(page)).toHaveCount(0);
  });

  test("a reasoning summary streams in as plain text, never markup", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [
      rec({
        type: "step",
        seq: 30,
        phase: "decide",
        state: "done",
        caption: "Looking for the quiz",
        url: null,
        screenshotKey: null,
        action: null,
        reasoning: "**Reading the page**\n\nIt says <img src=x onerror=alert(1)> near the top.",
      }),
    ]);
    await expect(steps(page).getByText("Reading the page")).toBeVisible();
    await expect(
      steps(page).getByText("It says <img src=x onerror=alert(1)> near the top."),
    ).toBeVisible();
    await expect(steps(page).locator("img[src='x']")).toHaveCount(0);
  });

  test("the approval card's Review moves focus to the approval sheet", async ({ page }) => {
    await gotoRun(page);
    await emit(page, recordedEvents());
    const card = steps(page).getByRole("group", { name: "Needs your approval" });
    await expect(card).toContainText("click “Start quiz”");
    await page.getByLabel("Message the agent").focus();
    await card.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("alertdialog")).toBeFocused();
  });

  test("replay sync: the scrubber moves the selection, kept in view inside the thread only", async ({
    page,
  }) => {
    await gotoRun(page);
    await emit(page, recordedEvents());
    const list = steps(page).getByRole("list", { name: "Agent activity" });
    await steps(page)
      .getByRole("button", {
        name: "Replay page: learn.example.edu/course/week-2",
        exact: true,
      })
      .click();
    const selected = page.locator(".th-item[data-selected]");
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText("course/week-2");
    const pageTop = await page.locator("#main").evaluate((main) => main.scrollTop);
    await page.getByRole("slider", { name: "Replay position" }).press("ArrowRight");
    await expect(selected).toContainText("course/week-2/lecture-3");
    await expect(selected).toBeInViewport();
    const inList = await selected.evaluate((row) => {
      const box = row.getBoundingClientRect();
      const outer = row.closest("ol")!.getBoundingClientRect();
      return box.top >= outer.top && box.bottom <= outer.bottom;
    });
    expect(inList).toBe(true);
    expect(await page.locator("#main").evaluate((main) => main.scrollTop)).toBe(pageTop);
    await expect(list).toBeVisible();
  });

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`a new entry enters on the spring, or only fades under reduced motion (${reducedMotion})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await gotoRun(page);
      await page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { __entered: string[] }).__entered = seen;
        new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes)
              if (node instanceof HTMLElement && node.matches(".alist-item[data-enter]"))
                for (const animation of node.getAnimations())
                  seen.push((animation as CSSTransition).transitionProperty);
        }).observe(document.querySelector(".alist-list")!, { childList: true });
      });
      await emit(page, [rec({ type: "user_message", text: "Skip the quiz" })]);
      await expect(steps(page).getByText("Skip the quiz")).toBeVisible();
      const entered = await page.evaluate(
        () => (window as unknown as { __entered: string[] }).__entered,
      );
      if (reducedMotion === "reduce") expect(entered).toEqual(["opacity"]);
      else expect([...entered].sort()).toEqual(["opacity", "transform"]);
      // The history that was already there never animates.
      expect(await page.locator(".alist-item[data-enter]").count()).toBe(1);
    });
  }
});
