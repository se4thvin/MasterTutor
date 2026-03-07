import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test.use({ signedOut: true });

test("sign-in screen is clean and labelled", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCSS(
    "text-decoration-line",
    "underline",
  );
  await expectCleanScreen(page);
});

test("shows a calm error on wrong credentials and keeps the email", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 401,
      json: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    }),
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("sam@example.test");
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("That email and password don't match.");
  await expect(page.getByLabel("Email")).toHaveValue("sam@example.test");
});

test("signs in and lands in the library", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 200,
      headers: { "set-cookie": "mt_fixture_auth=signed-in; Path=/" },
      json: {
        redirect: false,
        token: "t",
        user: { id: "fixture-user", email: "sam@example.test", name: "Sam Lee" },
      },
    }),
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("sam@example.test");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test("sign-up enforces 12-character passwords and explains closed sign-up", async ({ page }) => {
  await page.route("**/api/auth/sign-up/email", (route) =>
    route.fulfill({ status: 403, json: { code: "FORBIDDEN" } }),
  );
  await page.goto("/sign-up");
  await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "12");
  await page.getByLabel("Name").fill("Sam Lee");
  await page.getByLabel("Email").fill("sam@example.test");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText(
    "Couldn't create the account. Sign-up may be closed, or this email may already be registered.",
  );
  await expectCleanScreen(page);
});

test("the first user creates the workspace account and lands in the library", async ({ page }) => {
  let sent: { email?: string; name?: string; password?: string } = {};
  await page.route("**/api/auth/sign-up/email", async (route) => {
    sent = route.request().postDataJSON() as typeof sent;
    await route.fulfill({
      status: 200,
      headers: { "set-cookie": "mt_fixture_auth=signed-in; Path=/" },
      json: {
        token: "t",
        user: { id: "first-user", email: "owner@example.test", name: "Owner" },
      },
    });
  });
  await page.goto("/sign-up");
  await expect(page.getByText("The first account owns this workspace.")).toBeVisible();
  await page.getByLabel("Name").fill("Owner");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(sent).toEqual({
    email: "owner@example.test",
    name: "Owner",
    password: "correct-horse-battery-staple",
  });
});

test("an unexpected sign-up answer is not reported as a network problem", async ({ page }) => {
  await page.route("**/api/auth/sign-up/email", (route) =>
    route.fulfill({ status: 500, json: { code: "INTERNAL" } }),
  );
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Owner");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("Couldn't create the account. Try again.");
});
