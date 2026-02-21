import type { Locator, Page } from "@playwright/test";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const CANARY = "canary-pw-7f3a9c51";

/** Native dialogs (window.confirm/alert/prompt) are never used: every confirm is in-app. */
function forbidNativeDialogs(page: Page): void {
  page.on("dialog", (dialog) => {
    throw new Error(`native ${dialog.type()} dialog opened`);
  });
}

/** Secret inputs never invite autofill, spellcheck or a password manager, and never pre-fill. */
async function expectWriteOnly(input: Locator): Promise<void> {
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveAttribute("autocomplete", "new-password");
  await expect(input).toHaveAttribute("spellcheck", "false");
  await expect(input).toHaveAttribute("data-1p-ignore", "true");
  await expect(input).toHaveAttribute("data-lpignore", "true");
  await expect(input).toHaveValue("");
}

/** The canary must not be in the DOM, browser storage, the URL or the console. */
async function expectNoCanary(page: Page, consoleText: string[]): Promise<void> {
  expect(await page.content()).not.toContain(CANARY);
  expect(page.url()).not.toContain(CANARY);
  const storage = await page.evaluate(
    () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
  );
  expect(storage).not.toContain(CANARY);
  expect(consoleText.join("\n")).not.toContain(CANARY);
}

test("adds a sign-in without the secret persisting anywhere client-side (Review Focus 2)", async ({
  page,
}) => {
  forbidNativeDialogs(page);
  const consoleText: string[] = [];
  page.on("console", (m) => consoleText.push(m.text()));
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  await sheet.getByLabel("Website").fill("learn.zybooks.com");
  await sheet.getByLabel("Website").blur();
  await expect(sheet.getByLabel("Alias")).toHaveValue("zybooks");
  await sheet.getByLabel("Name", { exact: true }).fill("zyBooks");
  await sheet.getByLabel("Username or email").fill("someone@example.test");
  const pw = sheet.getByLabel("Password", { exact: true }).last();
  await expectWriteOnly(pw);
  await pw.fill(CANARY);
  await expectCleanScreen(page);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("group").filter({ hasText: "Saved. Values are sealed." }),
  ).toBeVisible();
  await expect(page.locator(".vrow").filter({ hasText: "zybooks" })).toContainText("sealed");

  await expectNoCanary(page, consoleText);
  // page.request shares the test's fixture namespace cookie, so this reads the same store.
  const list = await page.request.post("/api/rpc/vault/list", { data: { json: {} } });
  expect(list.ok()).toBe(true);
  const listed = await list.text();
  expect(listed).toContain("zybooks");
  expect(listed).not.toContain(CANARY);

  await page.getByRole("button", { name: "Add sign-in" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Add sign-in" })
      .getByLabel("Password", { exact: true })
      .last(),
  ).toHaveValue("");
});

test("every secret input is write-only: masked, no autofill, never pre-filled", async ({
  page,
}) => {
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  for (const toggle of ["Authenticator (TOTP)", "PIN", "Email codes (IMAP)"]) {
    await sheet.getByRole("checkbox", { name: toggle }).check();
  }
  const secrets = sheet.locator("input:not([type=checkbox])").and(sheet.locator("[type=password]"));
  await expect(secrets).toHaveCount(4);
  for (const label of ["Authenticator setup key", "Mail password"]) {
    await expectWriteOnly(sheet.getByLabel(label));
  }
  await expectWriteOnly(sheet.getByLabel("Password", { exact: true }).last());
  await expectWriteOnly(sheet.getByLabel("PIN", { exact: true }).last());
  await sheet.getByRole("button", { name: "Cancel" }).click();

  const row = page.locator(".vrow").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Actions for github" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  await expectWriteOnly(
    page.getByRole("dialog", { name: "Replace or add a value" }).getByLabel("New value"),
  );
});

test("a typed secret never reaches the DOM while the sheet is open", async ({ page }) => {
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  for (const toggle of ["Authenticator (TOTP)", "PIN", "Email codes (IMAP)"]) {
    await sheet.getByRole("checkbox", { name: toggle }).check();
  }
  const secrets = [
    sheet.getByLabel("Password", { exact: true }).last(),
    sheet.getByLabel("Authenticator setup key"),
    sheet.getByLabel("PIN", { exact: true }).last(),
    sheet.getByLabel("Mail password"),
  ];
  for (const input of secrets) {
    await input.fill(CANARY);
    await expect(input).toHaveValue(CANARY);
    expect(await input.getAttribute("value")).toBeNull();
  }
  expect(await page.content()).not.toContain(CANARY);
  await sheet.getByRole("button", { name: "Cancel" }).click();

  const row = page.locator(".vrow").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Actions for github" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  const value = page
    .getByRole("dialog", { name: "Replace or add a value" })
    .getByLabel("New value");
  await value.fill(CANARY);
  expect(await value.getAttribute("value")).toBeNull();
  expect(await page.content()).not.toContain(CANARY);
});

test("the secret is sent only in the body of the sealing requests", async ({ page }) => {
  const carriers: string[] = [];
  page.on("request", (request) => {
    const leaked = [request.url(), request.postData() ?? "", JSON.stringify(request.headers())];
    if (leaked.some((part) => part.includes(CANARY)))
      carriers.push(new URL(request.url()).pathname);
  });
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  await sheet.getByLabel("Website").fill("example.com");
  await sheet.getByLabel("Name", { exact: true }).fill("Example");
  await sheet.getByLabel("Alias").fill("example");
  await sheet.getByLabel("Username or email").fill("someone@example.test");
  await sheet.getByLabel("Password", { exact: true }).last().fill(CANARY);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  const row = page.locator(".vrow").filter({ hasText: "example" });
  await row.getByRole("button", { name: "Actions for example" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  const secretSheet = page.getByRole("dialog", { name: "Replace or add a value" });
  await secretSheet.getByLabel("Field").selectOption("password");
  await secretSheet.getByLabel("New value").fill(CANARY);
  await secretSheet.getByRole("button", { name: "Save" }).click();
  await expect(secretSheet).toBeHidden();
  await page.reload();
  expect(carriers).toEqual(["/api/rpc/vault/create", "/api/rpc/vault/setSecret"]);
});

test("a failed submit announces one alert, not one per field", async ({ page }) => {
  await page.route("**/api/rpc/vault/create", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  await sheet.getByRole("checkbox", { name: "PIN" }).check();
  await sheet.getByLabel("Website").fill("example.com");
  await sheet.getByLabel("Name", { exact: true }).fill("Example");
  await sheet.getByLabel("Alias").fill("example");
  await sheet.getByLabel("Username or email").fill("someone@example.test");
  await sheet.getByLabel("Password", { exact: true }).last().fill(CANARY);
  await sheet.getByLabel("PIN", { exact: true }).last().fill("4821");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("Couldn't save. Try again.")).toBeVisible();
  await expect(sheet.getByText("Enter it again.")).toHaveCount(2);
  await expect(sheet.getByRole("alert")).toHaveCount(1);
});

test("a failed save clears every secret and shows fixed copy that never echoes it", async ({
  page,
}) => {
  forbidNativeDialogs(page);
  const consoleText: string[] = [];
  page.on("console", (m) => consoleText.push(m.text()));
  await page.route("**/api/rpc/vault/create", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  await sheet.getByLabel("Website").fill("example.com");
  await sheet.getByLabel("Name", { exact: true }).fill("Example");
  await sheet.getByLabel("Alias").fill("example");
  await sheet.getByLabel("Username or email").fill("someone@example.test");
  const pw = sheet.getByLabel("Password", { exact: true }).last();
  await pw.fill(CANARY);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("Couldn't save. Try again.")).toBeVisible();
  await expect(pw).toHaveValue("");
  await expect(sheet.getByText("Enter it again.")).toBeVisible();
  // The username is not a secret: it survives so the retry needs only the password.
  await expect(sheet.getByLabel("Username or email")).toHaveValue("someone@example.test");
  await expectNoCanary(page, consoleText);
});

test("a submit that fails validation clears the typed secrets too", async ({ page }) => {
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  const pw = sheet.getByLabel("Password", { exact: true }).last();
  await pw.fill(CANARY);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("Enter a website such as example.com.")).toBeVisible();
  await expect(pw).toHaveValue("");
  await expect(sheet.getByText("Enter it again.")).toBeVisible();
  expect(await page.content()).not.toContain(CANARY);
});

test("validates on submit with field errors that never echo values", async ({ page }) => {
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  await sheet.getByLabel("Website").fill("javascript:alert(1)");
  await sheet.getByRole("checkbox", { name: "PIN" }).check();
  await sheet.getByLabel("PIN", { exact: true }).last().fill("12x");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("Enter a website such as example.com.")).toBeVisible();
  await expect(sheet.getByText("Use 4–12 digits.")).toBeVisible();
  await expect(sheet).not.toContainText("12x");
});

test("replaces a value and removes a field, with confirmation", async ({ page }) => {
  forbidNativeDialogs(page);
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Actions for github" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  const sheet = page.getByRole("dialog", { name: "Replace or add a value" });
  await sheet.getByLabel("Field").selectOption("pin");
  await sheet.getByLabel("New value").fill("4821");
  await expectCleanScreen(page);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(row).toContainText("PIN");
  expect(await page.content()).not.toContain("4821");

  await row.getByRole("button", { name: "Actions for github" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  await sheet.getByLabel("Field").selectOption("totp");
  await sheet.getByRole("button", { name: "Remove value…" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Remove Value" }).click();
  await expect(row).not.toContainText("Authenticator code");
});

test("a failed replace clears the new value and keeps the sheet open", async ({ page }) => {
  await page.route("**/api/rpc/vault/setSecret", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Actions for github" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  const sheet = page.getByRole("dialog", { name: "Replace or add a value" });
  await sheet.getByLabel("New value").fill(CANARY);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("Couldn't save. Try again.")).toBeVisible();
  await expect(sheet.getByLabel("New value")).toHaveValue("");
  expect(await page.content()).not.toContain(CANARY);
});

test("deletes a sign-in only after an explicit, non-default confirm", async ({ page }) => {
  forbidNativeDialogs(page);
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "jstor" });
  await row.getByRole("button", { name: "Actions for jstor" }).click();
  await page.getByRole("menuitem", { name: "Delete sign-in…" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Actions for jstor" }).click();
  await page.getByRole("menuitem", { name: "Delete sign-in…" }).click();
  await alert.getByRole("button", { name: "Delete Sign-in" }).click();
  await expect(row).toBeHidden();
});

test("a failed delete restores only that sign-in", async ({ page }) => {
  await page.route("**/api/rpc/vault/delete", (route) =>
    route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }),
  );
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "jstor" });
  await row.getByRole("button", { name: "Actions for jstor" }).click();
  await page.getByRole("menuitem", { name: "Delete sign-in…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete Sign-in" }).click();
  await expect(
    page.getByRole("group").filter({ hasText: "Couldn't delete the sign-in." }),
  ).toBeVisible();
  await expect(row).toBeVisible();
  await expect(page.locator(".vrow")).toHaveCount(5);
});
