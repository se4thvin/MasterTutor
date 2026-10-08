import { APPROVAL_KINDS } from "@mastertutor/contracts";
import type { Page } from "@playwright/test";
import { SEED, goalOf, type RunKey } from "./seed.ts";

export const SCREEN_GROUPS = ["G1", "G2", "G3", "G4", "G5"] as const;
export type ScreenGroup = (typeof SCREEN_GROUPS)[number];

export interface Screen {
  id: string;
  group: ScreenGroup;
  path: string;
  /** Signed-out screens get an empty storage state (P8-7). */
  signedOut?: boolean;
  /** Seeded text that proves the page shows real data from the stack, not a fixture. */
  expectTexts: readonly string[];
  /** The run frame's data-state once ready: a BrowserState from components/run/model/browser-state.ts (P8-8). */
  frameState?: string;
  /** Routes installed before navigation (reconnecting aborts the SSE stream, P8-10). */
  routes?(page: Page): Promise<void>;
  /** Interaction after the screen is ready (a dialog, the palette, a filled form). */
  prepare?(page: Page): Promise<void>;
}

const run = (key: RunKey, frameState: string, extra: Partial<Screen> = {}): Screen => ({
  id: `run-${key}`,
  group: "G3",
  path: `/runs/${SEED.runs[key]}`,
  expectTexts: [goalOf(key)],
  frameState,
  ...extra,
});

export const SCREENS: readonly Screen[] = [
  // G1: auth and settings
  { id: "sign-in", group: "G1", path: "/sign-in", signedOut: true, expectTexts: ["Sign in"] },
  {
    id: "sign-up",
    group: "G1",
    path: "/sign-up",
    signedOut: true,
    expectTexts: ["Create account"],
  },
  { id: "settings", group: "G1", path: "/settings", expectTexts: ["Kill switch"] },
  { id: "settings-usage", group: "G1", path: "/settings/usage", expectTexts: ["30 days"] },
  {
    id: "settings-audit",
    group: "G1",
    path: "/settings/audit",
    expectTexts: ["university-portal"],
  },
  {
    id: "palette",
    group: "G1",
    path: "/settings",
    expectTexts: [],
    prepare: async (page) => {
      await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("dialog", { name: "Search notes" }).waitFor();
    },
  },
  // G2: new task and the runs list
  { id: "new-task", group: "G2", path: "/new", expectTexts: ["Take notes on"] },
  {
    id: "new-task-filled",
    group: "G2",
    path: "/new",
    expectTexts: [],
    prepare: async (page) => {
      await page
        .getByLabel("Describe the task")
        .fill("Capture the Ada Lovelace article and its diagrams into Research › Papers");
    },
  },
  { id: "runs", group: "G2", path: "/runs", expectTexts: [goalOf("completed"), goalOf("failed")] },
  // G3: every run-view state
  run("live", "live"),
  run("live", "reconnecting", {
    id: "run-reconnecting",
    routes: async (page) => {
      await page.route("**/api/runs/*/events**", (route) => route.abort());
    },
  }),
  run("takeover", "control"),
  run("sleeping", "paused"),
  run("queued", "paused"),
  run("otp", "paused"),
  run("bypass", "paused"),
  run("completed", "paused"),
  run("download", "paused", { expectTexts: [goalOf("download"), "attention-is-all-you-need.pdf"] }),
  run("failed", "paused", {
    expectTexts: [goalOf("failed"), "The site did not respond after 3 attempts."],
  }),
  run("cancelled", "paused"),
  ...APPROVAL_KINDS.map((kind): Screen => ({
    id: `run-approval-${kind}`,
    group: "G3",
    path: `/runs/${SEED.approvalRuns[kind]}`,
    expectTexts: [goalOf(`approval ${kind}`)],
    frameState: "approval",
  })),
  // G4: library and notes (empty and error states included)
  { id: "library", group: "G4", path: "/library", expectTexts: ["Research", "Ada Lovelace"] },
  {
    id: "library-folder",
    group: "G4",
    path: `/library?folder=${SEED.folders.papers}`,
    expectTexts: ["Ada Lovelace"],
  },
  {
    id: "library-empty",
    group: "G4",
    path: `/library?folder=${SEED.folders.empty}`,
    expectTexts: ["Empty folder"],
  },
  {
    id: "note-verified",
    group: "G4",
    path: `/notes/${SEED.notes.verified}`,
    // P8-11: each block type renders (heading, list, quote, table).
    expectTexts: ["Early life", "Bernoulli numbers", "merely mortal", "Notes published"],
  },
  {
    id: "note-review",
    group: "G4",
    path: `/notes/${SEED.notes.review}`,
    expectTexts: ["Diagram text transcribed from an image"],
  },
  { id: "note-missing", group: "G4", path: `/notes/${SEED.notes.missing}`, expectTexts: [] },
  // G5: vault
  { id: "vault", group: "G5", path: "/vault", expectTexts: ["University portal"] },
  {
    id: "vault-new",
    group: "G5",
    path: "/vault",
    expectTexts: [],
    prepare: async (page) => {
      await page.getByRole("button", { name: "Add sign-in" }).click();
      await page.getByRole("dialog", { name: "Add sign-in" }).waitFor();
    },
  },
];
