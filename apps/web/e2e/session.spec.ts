import type { Page } from "@playwright/test";
import { FIXTURE_AUTH_COOKIE } from "../lib/fixtures/cookies.ts";
import { ids } from "../lib/fixtures/ids.ts";
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

async function expireSession(page: Page, baseURL: string | undefined) {
  await page
    .context()
    .addCookies([
      { name: FIXTURE_AUTH_COOKIE, value: "signed-out", url: baseURL ?? "http://localhost:3100" },
    ]);
}

async function signInAgain(page: Page) {
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
}

test("a block edit saved after the session ended returns to sign-in and keeps the draft", async ({
  page,
  baseURL,
}) => {
  const note = `/notes/${ids.note(1)}`;
  await page.goto(note);
  await page.getByRole("button", { name: /Provenance for block 3:/ }).click();
  await page
    .getByRole("dialog", { name: "Block provenance" })
    .getByRole("button", { name: "Edit block" })
    .click();
  const editor = page.getByRole("textbox", { name: "Edit block" });
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("Written just as the session ended.");
  await expireSession(page, baseURL);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(note)}$`));
  await expect(page.getByRole("group").filter({ hasText: "Couldn't save" })).toHaveCount(0);
  await signInAgain(page);
  await expect(page).toHaveURL(new RegExp(`${note}$`));
  const restored = page.getByRole("textbox", { name: "Edit block" });
  await expect(restored).toContainText("Written just as the session ended.");
});

test("a vault value saved after the session ended returns to sign-in", async ({
  page,
  baseURL,
}) => {
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Actions for github" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  const sheet = page.getByRole("dialog", { name: "Replace or add a value" });
  await sheet.getByLabel("New value").fill("a-new-password-value");
  await expireSession(page, baseURL);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fvault$/);
  await expect(page.getByRole("group")).toHaveCount(0);
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

  test("the API refuses a signed-out caller with a typed UNAUTHORIZED error", async ({
    page,
    baseURL,
  }) => {
    const res = await page.request.post("/api/rpc/settings/get", {
      data: { json: {} },
      headers: { origin: new URL(baseURL!).origin },
    });
    expect(res.status()).toBe(401);
    expect(JSON.stringify(await res.json())).toContain("UNAUTHORIZED");
  });
});

test("signing out drops unsaved drafts, so the next person in this tab never sees them", async ({
  page,
  baseURL,
}) => {
  const note = `/notes/${ids.note(1)}`;
  // User A's save fails, so the draft is kept (and the editor reopens with it).
  await page.route("**/api/rpc/notes/updateBlock", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto(note);
  await page.getByRole("button", { name: /Provenance for block 3:/ }).click();
  await page
    .getByRole("dialog", { name: "Block provenance" })
    .getByRole("button", { name: "Edit block" })
    .click();
  const editor = page.getByRole("textbox", { name: "Edit block" });
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("User A's private draft.");
  await editor.press("ControlOrMeta+Enter");
  await expect(page.getByRole("textbox", { name: "Edit block" })).toContainText(
    "User A's private draft.",
  );

  // A signs out from Settings.
  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({
      status: 200,
      headers: { "set-cookie": `${FIXTURE_AUTH_COOKIE}=signed-out; Path=/` },
      json: { success: true },
    }),
  );
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith("mt:block-draft:")),
    ),
  ).toEqual([]);

  // B signs in in the same tab and opens the same note: no editor, no draft.
  await signInAgain(page);
  await expect(page).toHaveURL(/\/library$/);
  await page.goto(note);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Edit block" })).toHaveCount(0);
  await expect(page.locator("#main")).not.toContainText("User A's private draft.");
  void baseURL;
});
