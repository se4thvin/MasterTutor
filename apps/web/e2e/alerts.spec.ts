import { randomUUID } from "node:crypto";
import { FIXTURE_NS_COOKIE } from "../lib/fixtures/cookies.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

/** The fixture's seeded alert (lib/fixtures/seed.ts), which starts acknowledged. */
const SEEDED = "a1e7a1e7-0000-4000-8000-000000000001";
const ACTIVE = {
  id: "a1e7a1e7-0000-4000-8000-000000000002",
  rule: "slot_crash_loop",
  label: "A browser slot keeps crashing",
  firedAt: "2026-10-08T10:00:00.000Z",
  acknowledgedAt: null,
};

test("an active alert shows the banner, which links to that alert", async ({ page }) => {
  await page.route("**/api/rpc/alerts/active", (route) =>
    route.fulfill({ json: { json: { items: [ACTIVE] } } }),
  );
  await page.goto("/library");
  const banner = page.getByRole("status").filter({ hasText: "A browser slot keeps crashing." });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Alerts" })).toHaveAttribute(
    "href",
    `/settings/alerts#alert-${ACTIVE.id}`,
  );
  await expectCleanScreen(page);
});

test("no banner without active alerts", async ({ page }) => {
  const answered = page.waitForResponse("**/api/rpc/alerts/active");
  await page.goto("/library");
  await answered;
  await expect(page.locator(".alert-banner")).toHaveCount(0);
});

test("the Alerts page lists past alerts and links to the dashboards", async ({ page }) => {
  await page.goto("/settings/alerts");
  await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Alerts" }).getByText("A run failed")).toBeVisible();
  await expect(page.getByText("Acknowledged")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open dashboards" })).toHaveAttribute(
    "href",
    "/api/observability/enter",
  );
  await expectCleanScreen(page);
});

test("a push's deep link lights its alert, and Acknowledge settles it", async ({ page }) => {
  // The first list shows the seeded alert as not yet acknowledged; the refetch is the fixture's.
  await page.route(
    "**/api/rpc/alerts/list",
    (route) =>
      route.fulfill({
        json: {
          json: {
            items: [{ ...ACTIVE, id: SEEDED, rule: "run_failed", label: "A run failed" }],
            nextCursor: null,
          },
        },
      }),
    { times: 1 },
  );
  await page.goto(`/settings/alerts#alert-${SEEDED}`);
  const row = page.locator(`#alert-${SEEDED}`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".alert-row[aria-current]")).toHaveCount(1);
  await row.getByRole("button", { name: "Acknowledge" }).click();
  await expect(row.getByText("Acknowledged")).toBeVisible();
  await expect(row.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
});

test("on a plain-http origin, Notifications says phone alerts need the HTTPS site (degradation)", async ({
  page,
}) => {
  // The fixture server is 127.0.0.1, which browsers treat as secure; the local stack at
  // http://<host> is not. Simulate that origin's isSecureContext.
  await page.addInitScript(() =>
    Object.defineProperty(window, "isSecureContext", { value: false }),
  );
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(
    page.getByText(
      "Phone alerts need the deployed HTTPS site. Alerts still appear here in the app.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Phone alerts" })).toHaveCount(0);
});

test("on an iPhone browser tab, Notifications asks to add the app to the Home Screen first", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  try {
    await context.addCookies([{ name: FIXTURE_NS_COOKIE, value: randomUUID(), url: baseURL! }]);
    const page = await context.newPage();
    await page.goto("/settings");
    await expect(
      page.getByText(
        "On iPhone, add MasterTutor to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on phone alerts.",
      ),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("without VAPID keys, Notifications says phone alerts aren't set up (fixture server)", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByText("Phone alerts aren't set up on this server.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Phone alerts" })).toHaveCount(0);
});

test("the app is installable: manifest, icons and service worker are served", async ({
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    name: "MasterTutor",
    display: "standalone",
    start_url: "/library",
  });
  for (const path of ["/icon/192", "/icon/512", "/apple-icon"]) {
    const icon = await request.get(path);
    expect(icon.status(), path).toBe(200);
    expect(icon.headers()["content-type"], path).toContain("image/png");
  }
  const sw = await request.get("/sw.js");
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).toContain("notificationclick");
});
