import { expect, expectCleanScreen, test } from "./helpers/test.ts";
import { FIXTURE_AUTH_COOKIE } from "../lib/fixtures/cookies.ts";
import { ids } from "../lib/fixtures/ids.ts";

test("inline asset figures and links in block Markdown load from the app's own origin", async ({
  page,
}) => {
  await page.goto(`/notes/${ids.note(7)}`);
  const figure = page.getByRole("img", { name: "Cosine decay to a 10% floor" });
  await expect(figure).toBeVisible();
  await expect(figure).toHaveAttribute("src", `/api/assets/${ids.asset(1)}`);
  expect(await figure.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "full-size figure" })).toHaveAttribute(
    "href",
    `/api/assets/${ids.asset(1)}`,
  );
  await expectCleanScreen(page);
});

test("assets are session-only and served inert", async ({ page }) => {
  const res = await page.request.get(`/api/assets/${ids.asset(1)}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-security-policy"]).toContain("sandbox");
  expect((await page.request.get("/api/assets/not-a-uuid")).status()).toBe(404);
  await page
    .context()
    .addCookies([{ name: FIXTURE_AUTH_COOKIE, value: "signed-out", url: "http://localhost:3100" }]);
  expect((await page.request.get(`/api/assets/${ids.asset(1)}`)).status()).toBe(401);
});
