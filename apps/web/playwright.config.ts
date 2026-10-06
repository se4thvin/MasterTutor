import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "@playwright/test";
import { QA_VIEWPORTS } from "./e2e/helpers/breakpoints.ts";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const testEnv = parseEnv(readFileSync(new URL("../../.env.test", import.meta.url), "utf8"));

/** WebEnv for the fixture server. The DB and S3 addresses are never contacted in fixture mode. */
const serverEnv: Record<string, string> = {
  DATABASE_URL: "postgres://web:unused@127.0.0.1:1/mastertutor",
  BETTER_AUTH_SECRET: testEnv["BETTER_AUTH_SECRET"] ?? "",
  BETTER_AUTH_URL: baseURL,
  VAULT_PUBLIC_KEY: testEnv["VAULT_PUBLIC_KEY"] ?? "",
  NEKO_MEMBER_SECRET: testEnv["NEKO_MEMBER_SECRET"] ?? "",
  LIVE_COOKIE_SECRET: testEnv["LIVE_COOKIE_SECRET"] ?? "",
  TURN_SECRET: testEnv["TURN_SECRET"] ?? "",
  OPENAI_EMBEDDINGS_KEY: testEnv["OPENAI_EMBEDDINGS_KEY"] ?? "",
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_ACCESS_KEY_ID: testEnv["S3_WEB_ACCESS_KEY_ID"] ?? "",
  S3_SECRET_ACCESS_KEY: testEnv["S3_WEB_SECRET_ACCESS_KEY"] ?? "",
  WEB_FIXTURE_API: "1",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
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
    // Wait on the port, not a page: /healthz checks the database (503 in fixture mode) and
    // /sign-in does not exist until Task 12. `next start` only listens once it can serve.
    port: PORT,
    // Never reuse: a stale server on this port would silently test an old build.
    reuseExistingServer: false,
    timeout: 300_000,
    env: serverEnv,
  },
});
