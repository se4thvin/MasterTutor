import type { Page } from "@playwright/test";

/**
 * Fails every JS chunk whose source contains `marker` while `blocked()` is true, as an offline or
 * expired deployment would. Other chunks load normally.
 */
export async function failChunksContaining(
  page: Page,
  marker: string,
  blocked: () => boolean,
): Promise<void> {
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (blocked() && body.includes(marker)) return route.abort("internetdisconnected");
    return route.fulfill({ response, body });
  });
}

/** Serves every JS chunk containing `marker` with `from` replaced by `to` (all occurrences). */
export async function rewriteChunksContaining(
  page: Page,
  marker: string,
  from: string,
  to: string,
): Promise<void> {
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    return route.fulfill({
      response,
      body: body.includes(marker) ? body.split(from).join(to) : body,
    });
  });
}
