import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { dropFiles, uploadToFileDialog } from "../../apps/web/lib/live/upload.ts";
import {
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  BEHAVIOUR_NEKO_MEMBER_SECRET,
  SITE,
  SLOT_CDP,
  nekoBaseUrlForTests,
} from "./constants.ts";

const SLOT = "browser-2";
const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const base = nekoBaseUrlForTests(SLOT);
let adminToken = "";
let browser: Browser;
let page: Page;
let socket: WebSocket | undefined;

/** Raw n.eko admin calls: a web-side test never imports the agent's NekoLiveView (E7). */
async function admin(method: "GET" | "POST", path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`n.eko ${path} answered HTTP ${response.status}`);
}

beforeAll(async () => {
  adminToken = await loginNeko({
    baseUrl: base,
    username: "agent",
    password: deriveNekoPassword(BEHAVIOUR_NEKO_ADMIN_SECRET, SLOT),
  });
  browser = await chromium.connectOverCDP(SLOT_CDP[SLOT]!);
  const context = browser.contexts()[0]!;
  page = context.pages()[0] ?? (await context.newPage());
});
afterAll(async () => {
  await admin("POST", "/api/room/control/take").catch(() => undefined);
  await admin("POST", "/api/members/user", { can_host: false }).catch(() => undefined);
  socket?.close();
  await browser?.close(); // connectOverCDP: disconnects Playwright, the slot browser keeps running
});

describe("user uploads through n.eko (spec §10.2.8)", () => {
  it("fills an open file chooser only while the user holds control", async () => {
    const token = await loginNeko({
      baseUrl: base,
      username: "user",
      password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, SLOT),
    });
    socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve());
      socket!.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
    });
    const options = { base: `${base}/`, headers: { authorization: `Bearer ${token}` } };
    const file = () => new File(["hello"], "notes.txt", { type: "text/plain" });

    await admin("POST", "/api/room/control/take");
    expect(await uploadToFileDialog(runId, [file()], options)).toBe("not_in_control");
    expect(await uploadToFileDialog(runId, [file()], { base: `${base}/` })).toBe("signed_out");

    await admin("POST", "/api/members/user", { can_host: true });
    await admin("POST", "/api/room/control/give/user");
    expect(await uploadToFileDialog(runId, [file()], options)).toBe("no_file_dialog");

    await page.goto(`${SITE}/upload`);
    await page.bringToFront();
    // A trusted CDP click opens Chromium's native chooser (Playwright intercepts only with a
    // filechooser listener); n.eko detects the dialog itself, so no window title is matched.
    await page.click("#file");
    // n.eko 3.1.6 sees the dialog (no longer 422) but its xdotool fill fails with this image's GTK
    // chooser (BadWindow after the first Return, HTTP 500): see the A9–A12 report. Uploads go
    // through drop until that is fixed upstream; this pins the detection.
    const dialogOutcome = await waitFor(
      async () => {
        const outcome = await uploadToFileDialog(runId, [file()], options);
        return outcome === "no_file_dialog" ? null : outcome;
      },
      { label: "n.eko detected the open file chooser", timeoutMs: 15_000, intervalMs: 500 },
    );
    expect(["uploaded", "failed"]).toContain(dialogOutcome);
    await page.reload();

    // Drop onto the file input, at its position on the 1280×800 remote screen.
    const point = await page.evaluate(() => {
      const box = document.querySelector("#file")!.getBoundingClientRect();
      return {
        x: window.screenX + box.left + box.width / 2,
        y: window.screenY + window.outerHeight - window.innerHeight + box.top + box.height / 2,
      };
    });
    expect(await dropFiles(runId, [file()], point, options)).toBe("uploaded");
    expect(
      await waitFor(
        () =>
          page.evaluate(
            () => (document.querySelector("#file") as HTMLInputElement).files?.[0]?.name ?? null,
          ),
        { label: "file in the input", timeoutMs: 5_000 },
      ),
    ).toBe("notes.txt");
  });
});
