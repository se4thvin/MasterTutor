import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { SITE, cdpBaseUrlForTests } from "../../../../tests/behaviour/constants.ts";
import { ControlGuard } from "../browser/guard.ts";
import { needsApproval } from "../guardrails/policy.ts";
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

  it("needs approval to reload or go back onto a page made by a form POST (no silent resubmit)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/form-post.html`, signal);
    const reload = { type: "keypress" as const, keys: ["F5"] };
    const back = { type: "keypress" as const, keys: ["ALT", "ARROWLEFT"] };
    expect(needsApproval(reload, await browser.targetFor(reload, null))).toBeNull();
    await browser.observe(signal);
    const run = await browser.runComputer(
      [{ type: "click", x: 100, y: 90, button: "left" }],
      signal,
      async () => true,
    );
    expect(run.executed).toBe(1);
    expect((await browser.observe(signal)).title).toBe("Order placed");
    // Reloading the POST result would send the order again.
    expect(needsApproval(reload, await browser.targetFor(reload, null))?.kind).toBe("form_submit");
    // Going back lands on the plain form page: no resubmission.
    expect(needsApproval(back, await browser.targetFor(back, null))).toBeNull();
    await browser.navigate(`${SITE}/index.html`, signal);
    // Going back onto the POST result would resubmit it too.
    expect(needsApproval(back, await browser.targetFor(back, null))?.kind).toBe("form_submit");
    const mouseBack = { type: "click" as const, x: 10, y: 10, button: "back" as const };
    expect(needsApproval(mouseBack, await browser.targetFor(mouseBack, null))?.kind).toBe(
      "form_submit",
    );
  });
});
