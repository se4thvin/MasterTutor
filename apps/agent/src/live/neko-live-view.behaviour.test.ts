import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  BEHAVIOUR_NEKO_MEMBER_SECRET,
  idleUrlForTests,
  nekoBaseUrlForTests,
} from "../../../../tests/behaviour/constants.ts";
import { endNekoViewer, restartSlot, xdotool } from "../../../../tests/behaviour/slot-tools.ts";
import { waitFor } from "../testing/wait.ts";
import { createSlotIdleProbe } from "./idle-probe.ts";
import { createNekoAdmin, type NekoAdmin } from "./neko-admin.ts";
import { LiveViewError, createNekoLiveView } from "./neko-live-view.ts";

const SLOT = "browser-1";
const slot = { name: SLOT };
const base = nekoBaseUrlForTests(SLOT);
let admin: NekoAdmin;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  // A fresh boot profile, whatever earlier behaviour files did to this slot's n.eko.
  await restartSlot(SLOT);
  admin = createNekoAdmin({ adminSecret: BEHAVIOUR_NEKO_ADMIN_SECRET, baseUrl: () => base });
});
afterAll(async () => {
  for (const socket of sockets) socket.close();
  await endNekoViewer(SLOT);
});

const userToken = () =>
  loginNeko({
    baseUrl: base,
    username: "user",
    password: deriveNekoPassword(BEHAVIOUR_NEKO_MEMBER_SECRET, SLOT),
  });
const asUser = (token: string, method: "GET" | "POST", path: string) =>
  fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}` } }).then(
    (response) => response.status,
  );
async function connectUser(token: string): Promise<WebSocket> {
  const socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("n.eko websocket failed")));
  });
  return socket;
}

describe("NekoLiveView against a real slot (spec §10.1)", () => {
  it("the user member cannot host at boot (A1)", async () => {
    const token = await userToken();
    expect(await asUser(token, "GET", "/api/whoami")).toBe(200);
    expect(await asUser(token, "POST", "/api/room/control/request")).toBe(403);
  });

  it("refuses to give control while the user's live view is not connected", async () => {
    await userToken(); // the session exists, as after openLive, but no websocket is open
    const view = createNekoLiveView({ admin, giveTimeoutMs: 500 });
    const started = Date.now();
    await expect(view.giveControl(slot, "user_1")).rejects.toBeInstanceOf(LiveViewError);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(await admin.request(SLOT, "GET", "/api/members/user")).toMatchObject({
      can_host: false,
    });
  });

  it("moves the n.eko host and the user's rights both ways once connected", async () => {
    const token = await userToken();
    const socket = await connectUser(token);
    const view = createNekoLiveView({ admin });
    await view.takeControl(slot);
    expect(await admin.request(SLOT, "GET", "/api/room/control")).toMatchObject({
      host_id: "agent",
    });

    await view.giveControl(slot, "user_1");
    await view.setClipboardAccess(slot, true);
    expect(await admin.request(SLOT, "GET", "/api/room/control")).toMatchObject({
      host_id: "user",
    });
    expect(await admin.request(SLOT, "GET", "/api/members/user")).toMatchObject({
      can_host: true,
      can_access_clipboard: true,
    });
    // The clipboard right works: the user writes it, then reads it back (an empty X clipboard
    // answers 500, so a bare read would not show the right).
    const clipboard = (method: "GET" | "POST") =>
      fetch(`${base}/api/room/clipboard`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ text: "from the user" }) } : {}),
      });
    expect((await clipboard("POST")).ok).toBe(true);
    const read = await clipboard("GET");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ text: "from the user" });

    await view.takeControl(slot);
    await view.setClipboardAccess(slot, false);
    expect(await admin.request(SLOT, "GET", "/api/room/control")).toMatchObject({
      host_id: "agent",
    });
    expect(await admin.request(SLOT, "GET", "/api/members/user")).toMatchObject({
      can_host: false,
      can_access_clipboard: false,
    });
    expect(await asUser(token, "POST", "/api/room/control/request")).toBe(403);
    socket.close();
  });

  it("reads the X idle time, which XTest input resets", async () => {
    const probe = createSlotIdleProbe({ url: () => idleUrlForTests(SLOT) });
    const before = await waitFor(
      async () => {
        const idleMs = await probe.userIdleMs(SLOT);
        // The X sample preceded the response, so this bounds the last input from above.
        return idleMs >= 1_000 ? { latestInputAt: performance.now() - idleMs } : null;
      },
      { label: "X idle grows without input", timeoutMs: 10_000, intervalMs: 200 },
    );
    // Two positions ensure a real move even if the pointer already starts at the first one.
    await xdotool(SLOT, "mousemove", "211", "157", "mousemove", "--sync", "212", "157");
    await waitFor(
      async () => {
        const readStartedAt = performance.now();
        const idleMs = await probe.userIdleMs(SLOT);
        // Bound the new input from below; a reset stays observable even after driver latency.
        return readStartedAt - idleMs > before.latestInputAt;
      },
      { label: "XTest input resets X idle", timeoutMs: 5_000, intervalMs: 100 },
    );
  });
});
