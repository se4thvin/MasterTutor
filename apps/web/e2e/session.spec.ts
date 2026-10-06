import { FIXTURE_AUTH_COOKIE } from "../lib/fixtures/cookies.ts";
import { expect, test } from "./helpers/test.ts";

test("an expired session returns to sign-in and comes back to the same page", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("/library");
  await expect(page.locator('[data-qa="note-card"]').first()).toBeVisible();
  // The session ends while the app is open (another tab signed out, or it expired).
  await context.addCookies([
    { name: FIXTURE_AUTH_COOKIE, value: "signed-out", url: baseURL ?? "http://localhost:3100" },
  ]);
  const nav = page.getByRole("navigation").getByRole("link", { name: "Vault" }).first();
  if (await nav.isVisible()) await nav.click();
  else await page.goto("/vault");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fvault$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  // No "Something went wrong" toasts on the way out.
  await expect(page.getByRole("group").filter({ hasText: "Something went wrong" })).toHaveCount(0);

  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 200,
      headers: { "set-cookie": `${FIXTURE_AUTH_COOKIE}=signed-in; Path=/` },
      json: { redirect: false, token: "t", user: { id: "u", email: "a@b.test", name: "A" } },
    }),
  );
  await page.getByLabel("Email").fill("sam@example.test");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/vault$/);
});

test.describe("signed out", () => {
  test.use({ signedOut: true });

  test("sign-in ignores a next that would leave the app", async ({ page }) => {
    await page.route("**/api/auth/sign-in/email", (route) =>
      route.fulfill({
        status: 200,
        headers: { "set-cookie": `${FIXTURE_AUTH_COOKIE}=signed-in; Path=/` },
        json: { redirect: false, token: "t", user: { id: "u", email: "a@b.test", name: "A" } },
      }),
    );
    await page.goto(`/sign-in?next=${encodeURIComponent("//evil.example/x")}`);
    await page.getByLabel("Email").fill("sam@example.test");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/localhost:3100\/library$/);
  });

  test("the API refuses a signed-out caller with a typed UNAUTHORIZED error", async ({ page }) => {
    const res = await page.request.post("/api/rpc/settings/get", { data: { json: {} } });
    expect(res.status()).toBe(401);
    expect(JSON.stringify(await res.json())).toContain("UNAUTHORIZED");
  });
});
