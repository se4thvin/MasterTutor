import { createLogger } from "@mastertutor/contracts/server";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { SITE, SLOT_CDP, cdpBaseUrlForTests } from "../../../../tests/behaviour/constants.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { SlotPool } from "../slots/pool.ts";
import { BrowserSession } from "./session.ts";
import { applyStorageState, collectStorageState } from "./storage-state.ts";

const log = createLogger({ service: "test", level: "silent" });
const signal = new AbortController().signal;
const connect = (slot: string) =>
  BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP[slot] ?? "",
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
  });
const pageState = async (session: BrowserSession) =>
  JSON.parse((await session.page.locator("#state").textContent()) ?? "{}") as {
    cookie: string;
    token: string | null;
  };

describe("storage state", () => {
  it("collects without opening tabs and restores cookies and localStorage into another browser (set-if-absent, removable)", async () => {
    const source = await connect("browser-1");
    await source.goto(`${SITE}/storage.html?set=1`, signal);
    const tabs = source.context.pages().length;
    const { state, page } = await collectStorageState(source);
    expect(page).toEqual({ origin: SITE, passwordFieldVisible: false });
    expect(source.context.pages().length).toBe(tabs);
    expect(state.cookies.some((cookie) => cookie.name === "mt_session")).toBe(true);
    expect(state.origins).toContainEqual({
      origin: SITE,
      localStorage: [{ name: "mt_token", value: "xyz" }],
    });
    await source.goto(`${SITE}/masking-reveal.html`, signal);
    expect((await collectStorageState(source)).page.passwordFieldVisible).toBe(true);
    await source.close();

    const target = await connect("browser-2");
    const remove = await applyStorageState(target, state);
    await target.goto(`${SITE}/storage.html`, signal);
    expect(await pageState(target)).toEqual({ cookie: "mt_session=abc", token: "xyz" });
    await remove();
    await target.page.evaluate(() => localStorage.removeItem("mt_token"));
    await target.goto(`${SITE}/storage.html`, signal);
    expect((await pageState(target)).token).toBeNull();
    await target.close();
  });

  it("a reset slot comes back with an empty profile (spec §12 slot reset)", async () => {
    const dirty = await connect("browser-1");
    await dirty.goto(`${SITE}/storage.html?set=1`, signal);
    await dirty.close();
    const idle: string[] = [];
    const pool = new SlotPool({
      store: {
        markIdle: async (name) => (idle.push(name), true),
        reclaimExpired: async () => [],
        listRestarting: async () => [],
      },
      slots: ["browser-1"],
      cdpBaseUrl: cdpBaseUrlForTests,
      config: runtimeConfig(),
      log,
    });
    await pool.reset("browser-1");
    expect(idle).toEqual(["browser-1"]);
    const browser = await chromium.connectOverCDP(SLOT_CDP["browser-1"] ?? "");
    const context = browser.contexts()[0]!;
    expect(await context.cookies()).toEqual([]);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${SITE}/storage.html`);
    expect(JSON.parse((await page.locator("#state").textContent()) ?? "{}")).toEqual({
      cookie: "",
      token: null,
    });
    await browser.close();
  });
});
