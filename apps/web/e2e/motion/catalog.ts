import type { Page } from "@playwright/test";
import { ids } from "../../lib/fixtures/ids.ts";
import { rec, recordedEvents } from "../../lib/fixtures/run-recording.ts";

export interface Motion {
  id: string;
  /** Repo-relative files whose motion this entry exercises (motion/react importers, P8-26). */
  files: readonly string[];
  /** One CSS selector: the animated subtree that trace counts are scoped to (P8-28). */
  scope: string;
  /** Brings the screen to the state just before the motion (fixture mode, no stack). */
  open(page: Page): Promise<void>;
  /**
   * Starts the motion; may navigate (mount animations, P8-27). It must not wait for the end state:
   * the trace window opens before it and the measured part starts as it returns (I6).
   */
  trigger(page: Page): Promise<void>;
  /** Waits for the motion's end state (the reduced-motion check reads it); default: nothing. */
  settled?(page: Page): Promise<void>;
  durationMs: number;
  /** A rAF spring that movingAnimations cannot see: sampled under reduced motion instead. */
  sample?: { selector: string; property: string };
}

/** Shared motion machinery: exercised by every entry, never animated on its own. */
export const MOTION_INFRASTRUCTURE = [
  "apps/web/components/motion/layout-features.ts",
  "apps/web/components/motion/layout-motion.tsx",
  "apps/web/components/motion/motion-provider.tsx",
] as const;

const run = async () => import("../helpers/run.ts");
const folders = async () => import("../helpers/folders.ts");
const longRow = async (page: Page) =>
  page
    .locator(".sidebar")
    .getByRole("treeitem", { name: (await folders()).LONG_UNBROKEN, exact: true });
/** The library with a folder name wider than its sidebar row (1440: the sidebar's tree). */
const openLongFolder = async (page: Page) => {
  const { LONG_UNBROKEN, createFolder, gotoReady } = await folders();
  await gotoReady(page, "/library");
  await createFolder(page, LONG_UNBROKEN);
  await (await longRow(page)).locator(".marquee[data-overflow]").waitFor();
};
const openRun = async (page: Page) => void (await (await run()).gotoRun(page));
const emitNow = async (
  page: Page,
  events: Parameters<Awaited<ReturnType<typeof run>>["emit"]>[1],
) => (await run()).emit(page, events);

export const MOTIONS: readonly Motion[] = [
  {
    id: "otp-code-slots",
    files: ["apps/web/components/bits/code-slots.tsx"],
    scope: '[data-testid="otp-card"]',
    open: async (page) => {
      await openRun(page);
      await emitNow(page, [
        rec({ type: "status", status: "waiting", waitReason: "otp", reason: null }),
      ]);
      await page.getByTestId("otp-card").waitFor();
    },
    trigger: async (page) => page.keyboard.type("4815"),
    durationMs: 600,
  },
  {
    id: "budget-rolling-number",
    files: ["apps/web/components/bits/rolling-number.tsx"],
    scope: '[data-testid="meter-steps"]',
    open: openRun,
    trigger: async (page) => emitNow(page, [recordedEvents()[2]!]),
    durationMs: 900,
  },
  {
    id: "caption-and-cursor",
    files: [
      "apps/web/components/run/browser/caption.tsx",
      "apps/web/components/run/cursor/agent-cursor.tsx",
    ],
    scope: '[data-testid="browser-frame"]',
    open: openRun,
    trigger: async (page) => emitNow(page, [recordedEvents()[0]!]),
    durationMs: 700,
  },
  {
    id: "takeover-transition",
    files: ["apps/web/components/run/browser/browser-frame.tsx"],
    scope: '[data-testid="browser-frame"]',
    open: openRun,
    trigger: async (page) => emitNow(page, [rec({ type: "control", holder: "user" })]),
    durationMs: 700,
  },
  {
    id: "pip-expand",
    files: ["apps/web/components/run/pip/run-pip.tsx"],
    scope: ".run-pip",
    open: async (page) => {
      await openRun(page);
      await page.goto("/library");
      await page.getByRole("button", { name: /Expand mini browser/ }).waitFor();
    },
    trigger: async (page) => page.getByRole("button", { name: /Expand mini browser/ }).click(),
    durationMs: 700,
    sample: { selector: ".run-pip", property: "transform" },
  },
  {
    id: "search-palette",
    files: ["apps/web/components/library/palette-body.tsx"],
    scope: '[role="dialog"]',
    open: async (page) => {
      await page.goto("/settings");
      await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
    },
    trigger: async (page) => page.keyboard.press("ControlOrMeta+k"),
    settled: async (page) => page.getByRole("dialog", { name: "Search notes" }).waitFor(),
    durationMs: 500,
  },
  {
    id: "library-layout",
    files: ["apps/web/components/library/library-view.tsx"],
    scope: "main",
    open: async (page) => {
      await page.goto("/library");
      await page.locator('[data-qa="note-card"]').first().waitFor();
    },
    trigger: async (page) =>
      page.getByRole("searchbox", { name: "Search the library" }).fill("warmup"),
    durationMs: 700,
  },
  {
    id: "move-toast",
    files: [
      "apps/web/components/bits/swipe-toast.tsx",
      "apps/web/components/toast/toast-provider.tsx",
    ],
    scope: ".toast-region",
    open: async (page) => {
      await page.goto(`/library?folder=${ids.folder(2)}`);
      const card = page
        .locator('[data-qa="note-card"]')
        .filter({ hasText: "Learning-rate warmup" });
      await card.getByRole("button", { name: /Actions for Learning-rate/ }).click();
      await page.getByRole("menuitem", { name: "Move to…" }).click();
      await page.getByRole("dialog", { name: "Move to…" }).waitFor();
    },
    trigger: async (page) =>
      page
        .getByRole("dialog", { name: "Move to…" })
        .getByRole("button", { name: "Papers" })
        .click(),
    settled: async (page) =>
      page.getByRole("group").filter({ hasText: "Moved to Papers" }).waitFor(),
    durationMs: 900,
  },
  {
    id: "verify-spring-check",
    files: ["apps/web/components/bits/spring-check.tsx"],
    scope: ".scheck",
    open: async (page) => {
      await page.goto(`/notes/${ids.note(1)}`);
      await page.getByRole("checkbox", { name: "Mark verified" }).waitFor();
    },
    trigger: async (page) => page.getByRole("checkbox", { name: "Mark verified" }).click(),
    durationMs: 600,
  },
  {
    id: "usage-rubber-segment",
    files: ["apps/web/components/bits/rubber-segment.tsx"],
    scope: '[role="radiogroup"]',
    open: async (page) => {
      await page.goto("/settings/usage");
      await page.getByRole("radiogroup", { name: "Range" }).waitFor();
    },
    trigger: async (page) => page.getByRole("radio", { name: "30 days" }).click(),
    durationMs: 600,
    sample: { selector: ".rseg-thumb", property: "transform" },
  },
  {
    // Hover glides the cut name: a transform on the text inside its fading mask, nothing else.
    id: "folder-marquee",
    files: ["apps/web/components/ui/marquee-text.tsx"],
    scope: '.sidebar [role="tree"]',
    open: openLongFolder,
    trigger: async (page) => (await longRow(page)).hover(),
    durationMs: 1500,
  },
  {
    // The Liquid Glass sidebar while a name glides inside it on keyboard focus: the glass is
    // static, so it must not repaint (a D49 allowance is for glass that appears or resizes).
    id: "sidebar-glass",
    files: ["apps/web/components/ui/liquid-glass.tsx", "apps/web/components/shell/sidebar.tsx"],
    scope: ".sidebar",
    open: async (page) => {
      await openLongFolder(page);
      await page.locator(".sidebar").getByRole("treeitem", { name: "All notes" }).focus();
    },
    trigger: async (page) => page.keyboard.press("End"),
    durationMs: 1500,
  },
  {
    id: "press-feedback",
    files: [],
    scope: "main",
    open: async (page) => {
      await page.goto("/settings");
      await page.getByRole("button", { name: "Sign out" }).waitFor();
    },
    // As press.spec.ts: press, then release away from the target, so the press never becomes a
    // click (a click on Sign out would navigate away mid-trace).
    trigger: async (page) => {
      await page.getByRole("button", { name: "Sign out" }).hover();
      await page.mouse.down();
      await page.mouse.move(1, 1);
      await page.mouse.up();
    },
    durationMs: 300,
  },
];
