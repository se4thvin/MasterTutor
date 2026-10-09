// The owner's browser into OpenObserve (D50 ruling I-2), run by 1-access.int.test.ts inside the
// e2e image in Traefik's network namespace, like the e2e suite: on the shared host the runner's
// network changes whenever another stack starts, which aborts a host-network Chromium.
// Env: APP (https app origin), OBS (obs origin), OWNER_COOKIE (the owner's app session cookies).
import { chromium } from "@playwright/test";

const { APP, OBS, OWNER_COOKIE } = process.env;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addCookies(
    OWNER_COOKIE.split("; ").map((pair) => {
      const at = pair.indexOf("=");
      return {
        name: pair.slice(0, at),
        value: pair.slice(at + 1),
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      };
    }),
  );
  const page = await context.newPage();
  await page.goto(`${APP}/observability`);
  await page.waitForURL(/obs\.localhost.*\/observability\/web\//, { timeout: 30_000 });
  await page.goto(`${OBS}/observability/web/dashboards?org_identifier=default`);
  try {
    await page.getByText("MasterTutor · Runs and agent").first().waitFor({ timeout: 30_000 });
  } catch (error) {
    const text = (await page.locator("body").innerText()).slice(0, 400);
    throw new Error(`${String(error)}\nat ${page.url()}\n${text}`, { cause: error });
  }
  if (/\/login/.test(page.url())) throw new Error(`landed on the login form: ${page.url()}`);
  console.log(`UI OK ${page.url()}`);
} finally {
  await browser.close();
}
