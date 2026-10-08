import { defineConfig } from "@playwright/test";
import { QA_VIEWPORTS } from "./e2e/helpers/breakpoints.ts";
import { AUTH_STATE, BASE_URL } from "./e2e/stack/support/env.ts";

const [desktop] = QA_VIEWPORTS;

/**
 * The full-stack suite (spec §12) against compose.test.yml, run by scripts/e2e.sh inside the e2e
 * container (Traefik's network namespace). playwright.config.ts is the fixture-mode UI suite.
 * Phase 8 adds its qa and motion projects here.
 */
export default defineConfig({
  testDir: "./e2e/stack",
  outputDir: "./e2e/.out/stack/results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Pristine output (D39): a flaky spec is a finding, never retried green.
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "./e2e/.out/stack/report" }]],
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        // No non-proxied UDP: WebRTC must use n.eko's TCP mux (spec §10.2, §12).
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "e2e",
      testMatch: /specs\/.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        browserName: "chromium",
        viewport: { width: desktop.width, height: desktop.height },
        storageState: AUTH_STATE,
      },
    },
    // Phase 8 real-stack wiring smoke (P8-12): the widest and narrowest QA widths, from
    // QA_VIEWPORTS only (P8-16). Group filter: --grep "G3 ".
    ...QA_VIEWPORTS.filter((vp) => vp.name === "w1440" || vp.name === "w390").map((vp) => ({
      name: `qa-${vp.name}`,
      testMatch: /qa\/wiring\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        browserName: "chromium" as const,
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.width <= 820,
        storageState: AUTH_STATE,
      },
    })),
  ],
});
