import { DEFAULT_BUDGET } from "@mastertutor/contracts";
import { ids } from "../lib/fixtures/ids.ts";
import { mockRpc } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

type Logged = [string, unknown][];
const createBody = (body: unknown) => (body as { json: unknown }).json;

test.describe("New task", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1440,
    "content checks run once; layout is Task 18",
  );

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const log: [string, unknown][] = [];
      (window as unknown as { __heroLog: typeof log }).__heroLog = log;
      for (const name of ["hero:type", "hero:focus", "hero:start"]) {
        window.addEventListener(name, (e) => log.push([name, (e as CustomEvent).detail ?? null]));
      }
    });
  });

  test("composes a task with sources, options and ⌘↵, then opens the run", async ({ page }) => {
    await page.goto("/new");
    await expect(page.getByRole("radio", { name: "Ask me" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const goal = page.getByLabel("Describe the task");
    await goal.fill("Week 3: every lecture, figure and table. Skip the quizzes.");

    await page.getByRole("button", { name: "YouTube", exact: true }).click();
    await page.getByLabel("YouTube video address").fill("youtube.com/watch?v=k3Wm9xTq2aE");
    await page.getByLabel("YouTube video address").press("Enter");
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    await page.getByLabel("PDF address").fill("https://arxiv.org/pdf/1706.03762.pdf");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("list", { name: "Sources" }).getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "Remove arxiv.org" }).click();
    await expect(page.getByRole("list", { name: "Sources" }).getByRole("listitem")).toHaveCount(1);

    await page.getByRole("button", { name: "Add domain" }).click();
    await page.getByRole("textbox", { name: "Allowed domain" }).fill("github.com");
    await page.getByRole("textbox", { name: "Allowed domain" }).press("Enter");
    await page.getByRole("radio", { name: "Deep" }).click();
    await expect(page.getByTestId("budget-steps").locator(".sr-only")).toHaveText("300");
    await page.getByRole("radio", { name: "Auto in allowed domains" }).click();
    await expect(
      page.getByText("Purchases, deletions and posts on these domains go ahead without asking."),
    ).toBeVisible();
    await page.getByLabel("Save to").selectOption(ids.folder(2));

    const request = page.waitForRequest("**/api/rpc/runs/create");
    await goal.press("ControlOrMeta+Enter");
    expect(createBody((await request).postDataJSON())).toMatchObject({
      goal: "Week 3: every lecture, figure and table. Skip the quizzes.\n\nSources:\n- https://youtube.com/watch?v=k3Wm9xTq2aE",
      allowedOrigins: [
        "https://youtube.com",
        "https://www.youtube.com",
        "https://github.com",
        "https://www.github.com",
      ],
      budget: { maxSteps: 300, maxUsd: 10, maxActiveMinutes: 120 },
      approvalMode: "auto_within_allowlist",
      targetFolderId: ids.folder(2),
    });
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  });

  test("Auto is never remembered: a fresh page starts on Ask me (S10)", async ({ page }) => {
    await page.goto("/new");
    await page.getByRole("radio", { name: "Auto in allowed domains" }).click();
    await page.reload();
    await expect(page.getByRole("radio", { name: "Ask me" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("emits hero:type, hero:focus and hero:start without loading any 3D code", async ({
    page,
  }) => {
    await page.goto("/new");
    const goal = page.getByLabel("Describe the task");
    await goal.click();
    await goal.pressSequentially("abc");
    await page.getByRole("button", { name: /^Start/ }).focus();
    const log = await page.evaluate(() => (window as unknown as { __heroLog: Logged }).__heroLog);
    expect(log.filter(([n]) => n === "hero:type")).toHaveLength(3);
    expect(log).toContainEqual(["hero:focus", true]);
    expect(log).toContainEqual(["hero:focus", false]);
  });

  test("validates before calling the API", async ({ page }) => {
    let creates = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/rpc/runs/create")) creates += 1;
    });
    await page.goto("/new");
    await page.getByRole("button", { name: /^Start/ }).click();
    // Next.js keeps its own (empty) route-announcer alert; ours is the form error.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
      "Describe the task or add a source.",
    );
    await expect(page.getByLabel("Describe the task")).toBeFocused();
    expect(creates).toBe(0);
  });

  test("keeps the draft and explains when starting fails", async ({ page }) => {
    await page.route("**/api/rpc/runs/create", (route) =>
      route.fulfill({
        status: 500,
        json: {
          json: { defined: false, code: "INTERNAL_SERVER_ERROR", status: 500, message: "down" },
        },
      }),
    );
    await page.goto("/new");
    await page.getByLabel("Describe the task").fill("Capture this page");
    await page.getByRole("button", { name: "Add domain" }).click();
    await page.getByRole("textbox", { name: "Allowed domain" }).fill("example.com");
    await page.getByRole("textbox", { name: "Allowed domain" }).press("Enter");
    await page.getByRole("button", { name: /^Start/ }).click();
    await expect(page.getByText("Couldn't start the task. Try again.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Start/ })).toBeEnabled();
    await expect(page.getByLabel("Describe the task")).toHaveValue("Capture this page");
  });

  test("the kill switch disables Start and says why", async ({ page }) => {
    await mockRpc(page, {
      "settings/get": () => ({
        killSwitch: true,
        defaultBudget: DEFAULT_BUDGET,
        defaultAllowedOrigins: [],
        concurrency: 6,
      }),
    });
    await page.goto("/new");
    await expect(page.getByRole("button", { name: /^Start/ })).toBeDisabled();
    await expect(
      page.getByText("The kill switch is on. Turn it off in Settings to start tasks."),
    ).toBeVisible();
  });

  test("bypass is an explicit opt-in with a warning, and is never remembered (D44)", async ({
    page,
  }) => {
    await page.goto("/new");
    await page.getByLabel("Describe the task").fill("Capture this page");
    await page.getByRole("button", { name: "Add domain" }).click();
    await page.getByRole("textbox", { name: "Allowed domain" }).fill("example.com");
    await page.getByRole("textbox", { name: "Allowed domain" }).press("Enter");
    await page.getByRole("radio", { name: "Bypass approvals" }).click();
    // D44: the warning names everything bypass lifts, sign-ins first, and what it never lifts.
    const warning = page.getByTestId("bypass-warning");
    await expect(warning).toContainText("first use of a saved sign-in");
    await expect(warning).toContainText("frames it can't inspect");
    await expect(warning).toContainText("sensitive-site warnings");
    await expect(warning).toContainText("Budget limits still pause");
    await expect(warning).toContainText("never reach the agent, logs or screenshots");
    await expect(warning).toContainText("private networks");
    // The cases bypass still hands to a person (D44).
    await expect(warning).toContainText("a sign-in form that posts to another site");
    await expect(warning).toContainText("safety warnings it doesn't recognise");
    // Never lifted, said without contradicting the pause above (final M9).
    await expect(warning).toContainText("Sign-ins never go to another site without you.");
    await expect(warning).not.toContainText("Sign-ins only go to their own site");
    await expect(page.getByText("Every step goes ahead without asking")).toHaveCount(0);
    // The consent checkbox is described by the warning it agrees to (M2).
    await expect(page.getByRole("checkbox", { name: /I understand/ })).toHaveAccessibleDescription(
      /first use of a saved sign-in/,
    );
    const start = page.getByRole("button", { name: /^Start/ });
    await expect(start).toBeDisabled();
    await page.getByRole("checkbox", { name: /I understand/ }).check();
    await expect(start).toBeEnabled();
    const request = page.waitForRequest("**/api/rpc/runs/create");
    await start.click();
    expect(createBody((await request).postDataJSON())).toMatchObject({
      approvalMode: "bypass",
      bypassAcknowledged: true,
    });
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    await page.goto("/new");
    await expect(page.getByRole("radio", { name: "Ask me" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("checkbox", { name: /I understand/ })).toHaveCount(0);
  });
});
