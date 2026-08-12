import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "@playwright/test";
import { QA_VIEWPORTS } from "./e2e/helpers/breakpoints.ts";

// WEB_UI_PORT: the shared CI host gives each concurrent run its own (scripts/remote-test/slots.sh).
const PORT = Number(process.env["WEB_UI_PORT"] || 3100);
const baseURL = `http://localhost:${PORT}`;
const testEnv = parseEnv(readFileSync(new URL("../../.env.test", import.meta.url), "utf8"));

/** WebEnv for the fixture server. The DB, S3 and OpenAI are never contacted in fixture mode. */
const serverEnv: Record<string, string> = {
  DATABASE_URL: "postgres://web:unused@127.0.0.1:1/mastertutor",
  BETTER_AUTH_SECRET: testEnv["BETTER_AUTH_SECRET"] ?? "",
  BETTER_AUTH_URL: baseURL,
  VAULT_PUBLIC_KEY: testEnv["VAULT_PUBLIC_KEY"] ?? "",
  NEKO_MEMBER_SECRET: testEnv["NEKO_MEMBER_SECRET"] ?? "",
  LIVE_COOKIE_SECRET: testEnv["LIVE_COOKIE_SECRET"] ?? "",
  // D36: one OPENAI_API_KEY. The fixture API never calls OpenAI, so a placeholder satisfies WebEnv.
  OPENAI_API_KEY: "unused-in-fixture-mode",
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_ACCESS_KEY_ID: testEnv["S3_WEB_ACCESS_KEY_ID"] ?? "",
  S3_SECRET_ACCESS_KEY: testEnv["S3_WEB_SECRET_ACCESS_KEY"] ?? "",
  WEB_FIXTURE_API: "1",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "./e2e",
  // The full-stack suite (playwright.stack.config.ts) runs only against compose.test.yml.
  testIgnore: ["stack/**"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries anywhere (D48): a test that passes only on retry is a failure to fix, not to hide.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, locale: "en-US", timezoneId: "UTC", trace: "retain-on-failure" },
  projects: QA_VIEWPORTS.map((vp) => ({
    name: vp.name,
    use: {
      browserName: "chromium",
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.width <= 820,
    },
  })),
  webServer: {
    command: process.env.PW_DEV
      ? `pnpm exec next dev -p ${PORT}`
      : `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    // /healthz checks the database (503 in fixture mode), so wait on /sign-in: in fixture mode
    // it redirects to /library for the default signed-in user, which still proves the app serves.
    url: `${baseURL}/sign-in`,
    // Never reuse: a stale server on this port would silently test an old build.
    reuseExistingServer: false,
    timeout: 300_000,
    env: serverEnv,
  },
});
