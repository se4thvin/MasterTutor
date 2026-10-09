import type { Page } from "@playwright/test";
import { rec, recordedDetail, recordedEvents } from "../../lib/fixtures/run-recording.ts";
import { emit, frame, gotoRun } from "./run.ts";
import { expect, isPhone } from "./test.ts";

export interface RunScenario {
  name: string;
  /** The browser-frame data-state once set up (a BrowserState). */
  state: string;
  setup(page: Page): Promise<void>;
}

async function openReplay(page: Page) {
  if (isPhone(page)) await page.getByRole("button", { name: /^Open thread/ }).click();
  await page.getByRole("button", { name: "Replay step: Clicked “Log in”" }).click();
  if (isPhone(page)) {
    await page.keyboard.press("Escape");
    // The tap that chose the row leaves the pointer where the frame's shield now sits (Pip in the
    // header moved it): park it off the frame, so no hover tooltip opens on the replayed screen.
    await page.mouse.move(0, 0);
    // Wait for the sheet to unmount: until then its scroll lock hides #main's scrollbar.
    await page.getByRole("dialog", { name: "Thread" }).waitFor({ state: "detached" });
    // Closing the sheet returns focus to the peek bar below the frame, which scrolls the page;
    // check the frame where a viewer sees it, not under the sticky toolbar.
    await page.locator("#main").evaluate((main) => main.scrollTo({ top: 0 }));
  }
}

/** Every run-view state in fixture mode (F3 QA, D22), shared by run-qa.spec.ts and visual.spec.ts. */
export const RUN_SCENARIOS: readonly RunScenario[] = [
  { name: "live", state: "live", setup: async (page) => void (await gotoRun(page)) },
  {
    name: "acting",
    state: "acting",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, [recordedEvents()[0]!]);
    },
  },
  {
    name: "approval",
    state: "approval",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, recordedEvents());
    },
  },
  {
    name: "control",
    state: "control",
    setup: async (page) =>
      void (await gotoRun(page, {
        detail: recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover" }),
      })),
  },
  {
    name: "paused",
    state: "paused",
    setup: async (page) =>
      void (await gotoRun(page, {
        detail: recordedDetail({ status: "sleeping", slotName: null }),
      })),
  },
  {
    name: "reconnecting",
    state: "reconnecting",
    setup: async (page) => {
      await gotoRun(page);
      await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
      await page.evaluate(() => {
        window.__sse.blockOpen = true;
        window.__sse.fail(true);
      });
    },
  },
  {
    name: "replay",
    state: "replay",
    setup: async (page) => {
      await gotoRun(page);
      await openReplay(page);
    },
  },
  {
    name: "otp",
    state: "live",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, [
        rec({ type: "status", status: "waiting", waitReason: "otp", reason: null }),
      ]);
    },
  },
  {
    // D44 carry-over: the badge and the frame chip must fit at every width, 390 included.
    name: "bypass",
    state: "live",
    setup: async (page) => {
      await gotoRun(page, { detail: recordedDetail({ approvalMode: "bypass" }) });
      await expect(page.getByRole("note", { name: "Bypass mode" })).toBeVisible();
      await expect(frame(page).getByText("Bypass", { exact: true })).toBeVisible();
    },
  },
];
