import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { SITE, cdpBaseUrlForTests } from "../../../../tests/behaviour/constants.ts";
import { ControlGuard } from "../browser/guard.ts";
import { instantClock } from "../runtime/clock.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { SlotPool } from "../slots/pool.ts";
import { withHooks } from "./hooks.ts";
import type { AttachedBrowser } from "./loop-browser.ts";
import type { RunSnapshot } from "./run-state.ts";
import { slotBrowserConnector } from "./session-browser.ts";

const log = createLogger({ service: "test", level: "silent" });
const signal = new AbortController().signal;
let attached: AttachedBrowser | undefined;
afterEach(async () => {
  await attached?.close();
  attached = undefined;
});

async function connect() {
  const pool = new SlotPool({
    store: {
      markIdle: async () => true,
      reclaimExpired: async () => [],
      listRestarting: async () => [],
    },
    slots: ["browser-1"],
    cdpBaseUrl: cdpBaseUrlForTests,
    config: runtimeConfig(),
    log,
  });
  const connector = slotBrowserConnector({
    cdpBaseUrl: cdpBaseUrlForTests,
    pool,
    hooks: withHooks(),
    clock: instantClock(),
    config: runtimeConfig(),
    testMode: true,
    log,
  });
  const run = { allowedOrigins: [SITE] } as RunSnapshot;
  attached = await connector({ slotName: "browser-1", run: () => run, guard: new ControlGuard() });
  return attached.browser;
}

describe("SessionLoopBrowser", () => {
  it("observes a stable DOM hash and detects only visible CAPTCHAs (Review Focus 4)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/interactive.html`, signal);
    const a = await browser.observe(signal);
    const b = await browser.observe(signal);
    expect(a.domHash).toBe(b.domHash);
    expect(a.title).toBe("Interactive fixture");
    expect(a.captcha).toBe(false);
    await browser.navigate(`${SITE}/captcha-invisible.html`, signal);
    expect((await browser.observe(signal)).captcha).toBe(false);
    await browser.navigate(`${SITE}/captcha.html`, signal);
    expect((await browser.observe(signal)).captcha).toBe(true);
  });

  it("classifies targets for the policy and runs read_page through the registry", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/injection.html`, signal);
    await browser.observe(signal);
    const { output } = await browser.runFunction(
      "read_page",
      { mode: "interactive", sinceHash: null },
      signal,
    );
    expect(output.startsWith('<untrusted_page_content origin="http://site.fixtures.test">')).toBe(
      true,
    );
    const json = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)) as {
      elements: Array<{ name: string; point: { x: number; y: number } }>;
    };
    const del = json.elements.find((element) => element.name === "Delete account")!;
    const target = await browser.targetFor(
      { type: "click", x: del.point.x, y: del.point.y, button: "left" },
      null,
    );
    expect(target?.label).toBe("Delete account");
    expect(
      (await browser.runFunction("capture", { scope: "page", selector: null, kind: null }, signal))
        .output,
    ).toBe('{"error":"tool_unavailable"}');
  });
});
