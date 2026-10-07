import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { dropFiles } from "../../apps/web/lib/live/upload.ts";
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

/** n.eko's file-chooser endpoint, called raw: the web offers no dialog upload in v1. */
async function dialogStatus(token: string): Promise<number> {
  const form = new FormData();
  form.append("files", new File(["hello"], "notes.txt", { type: "text/plain" }), "notes.txt");
  const response = await fetch(`${base}/api/room/upload/dialog`, {
    method: "POST",
    body: form,
    headers: { authorization: `Bearer ${token}` },
  });
  await response.body?.cancel();
  return response.status;
}

describe("user uploads through n.eko (spec §10.2.8)", () => {
  it("accepts a drop only while the user holds control, before and after", async () => {
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
    await page.goto(`${SITE}/upload`);
    await page.bringToFront();
    // The file input's centre on the 1280×800 remote screen, where a drop lands.
    const point = await page.evaluate(() => {
      const box = document.querySelector("#file")!.getBoundingClientRect();
      return {
        x: window.screenX + box.left + box.width / 2,
        y: window.screenY + window.outerHeight - window.innerHeight + box.top + box.height / 2,
      };
    });
    const fileInInput = () =>
      page.evaluate(
        () => (document.querySelector("#file") as HTMLInputElement).files?.[0]?.name ?? null,
      );

    // Before the give: the agent hosts, so n.eko refuses the user's drop (I4).
    await admin("POST", "/api/room/control/take");
    expect(await dropFiles(runId, [file()], point, options)).toBe("not_in_control");
    expect(await dropFiles(runId, [file()], point, { base: `${base}/` })).toBe("signed_out");
    expect(await fileInInput()).toBeNull();

    await admin("POST", "/api/members/user", { can_host: true });
    await admin("POST", "/api/room/control/give/user");
    expect(await dropFiles(runId, [file()], point, options)).toBe("uploaded");
    expect(await waitFor(fileInInput, { label: "file in the input", timeoutMs: 5_000 })).toBe(
      "notes.txt",
    );

    // After the hand back (the agent takes the host back and revokes can_host): refused again.
    await admin("POST", "/api/room/control/take");
    await admin("POST", "/api/members/user", { can_host: false });
    await page.reload();
    expect(await dropFiles(runId, [file()], point, options)).toBe("not_in_control");
    expect(await fileInInput()).toBeNull();

    // Upstream pin: n.eko detects an open native chooser (no longer 422) but cannot fill it in this
    // image (500); see the A9–A12 report. When this starts answering 2xx, revisit the dialog path.
    await admin("POST", "/api/members/user", { can_host: true });
    await admin("POST", "/api/room/control/give/user");
    expect(await dialogStatus(token)).toBe(422);
    await page.click("#file");
    const detected = await waitFor(
      async () => {
        const status = await dialogStatus(token);
        return status === 422 ? null : status;
      },
      { label: "n.eko detected the open file chooser", timeoutMs: 15_000, intervalMs: 500 },
    );
    expect(detected).toBe(500);
  });
});
