import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { FIXTURE_AUTH_COOKIE, FIXTURE_NS_COOKIE } from "../../lib/fixtures/cookies.ts";

export const test = base.extend<{ signedOut: boolean }>({
  signedOut: [false, { option: true }],
  context: async ({ context, baseURL, signedOut }, provide) => {
    const url = baseURL ?? "http://127.0.0.1:3100";
    const cookies: Array<{ name: string; value: string; url: string }> = [
      { name: FIXTURE_NS_COOKIE, value: randomUUID(), url },
    ];
    if (signedOut) cookies.push({ name: FIXTURE_AUTH_COOKIE, value: "signed-out", url });
    await context.addCookies(cookies);
    await provide(context);
  },
});

export { expect };
export { expectCleanScreen } from "./clean-screen.ts";

export const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) <= 820;
export const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) > 1180;
