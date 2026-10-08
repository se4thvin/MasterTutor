import { RECORDED_RUN_ID, rec } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const otpWait = () => rec({ type: "status", status: "waiting", waitReason: "otp", reason: null });

test.describe("OTP card", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1440,
    "behaviour checks run once; 390 has its own test",
  );

  test("the code goes to submitOtp once and never stays in the page (security review, Review Focus 5)", async ({
    page,
  }) => {
    const consoleText: string[] = [];
    page.on("console", (m) => consoleText.push(m.text()));
    const calls = await gotoRun(page);
    await emit(page, [otpWait()]);
    const input = page.getByLabel("One-time code");
    await expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await input.focus();
    await page.keyboard.type("481516");
    await expect(
      page.getByText("Sent to the browser. The agent only saw “code entered”."),
    ).toBeVisible();
    expect(rpcCalls(calls, "runs/submitOtp")).toEqual([{ runId: RECORDED_RUN_ID, code: "481516" }]);
    await expect(input).toHaveValue("");
    expect(await page.content()).not.toContain("481516");
    expect(
      await page.evaluate(
        () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
      ),
    ).not.toContain("481516");
    expect(consoleText.join("\n")).not.toContain("481516");
  });

  test("the confirmation stays visible when the run resumes before submitOtp answers (review M3)", async ({
    page,
  }) => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await gotoRun(page, {
      handlers: {
        "runs/submitOtp": async () => {
          await answered;
          return { ok: true };
        },
      },
    });
    await emit(page, [otpWait()]);
    await page.getByLabel("One-time code").focus();
    await page.keyboard.type("481516");
    // The agent took the code and the run moved on: the card leaves before the RPC answers.
    await emit(page, [rec({ type: "status", status: "running", waitReason: null, reason: null })]);
    await expect(page.getByLabel("One-time code")).toHaveCount(0);
    answer();
    await expect(
      page.getByText("Sent to the browser. The agent only saw “code entered”."),
    ).toBeVisible();
  });

  test("pasting an 8-digit code with separators submits all 8", async ({ page }) => {
    const calls = await gotoRun(page);
    await emit(page, [otpWait()]);
    await page.getByLabel("One-time code").focus();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text", "1234-5678");
      document.activeElement?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
    });
    await expect
      .poll(() => rpcCalls(calls, "runs/submitOtp")[0])
      .toEqual({ runId: RECORDED_RUN_ID, code: "12345678" });
  });

  test("a failed submit clears the boxes and asks again", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/submitOtp": () => {
          throw new RpcFailure("BAD_REQUEST", 400, "expired");
        },
      },
    });
    await emit(page, [otpWait()]);
    await page.getByLabel("One-time code").focus();
    await page.keyboard.type("111111");
    await expect(page.getByText("Couldn't send the code. Enter it again.")).toBeVisible();
    await expect(page.getByLabel("One-time code")).toBeEnabled();
    await expect(page.getByTestId("otp-card").locator(".cslots-slot[data-filled]")).toHaveCount(0);
  });
});

test("six boxes fit the card at 390px (D22)", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await emit(page, [otpWait()]);
  const card = page.getByTestId("otp-card");
  const cardBox = (await card.boundingBox())!;
  const slots = card.locator(".cslots-slot");
  await expect(slots).toHaveCount(6);
  for (const box of await Promise.all((await slots.all()).map((s) => s.boundingBox()))) {
    expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
  }
});
