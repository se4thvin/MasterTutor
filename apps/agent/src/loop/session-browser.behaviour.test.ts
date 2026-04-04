import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@mastertutor/contracts/server";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  BEHAVIOUR_DOWNLOADS,
  OTHER,
  SITE,
  SLOT_CDP,
  cdpBaseUrlForTests,
} from "../../../../tests/behaviour/constants.ts";
import { ControlGuard } from "../browser/guard.ts";
import { downloadRequest, needsApproval } from "../guardrails/policy.ts";
import { instantClock } from "../runtime/clock.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { SlotPool } from "../slots/pool.ts";
import { waitFor } from "../testing/wait.ts";
import { SECRET_REDACTION, type MaskSources } from "../browser/masking.ts";
import { withHooks, type RunHooks } from "./hooks.ts";
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

let runId = "";
async function connect(hooks: RunHooks = withHooks()) {
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
    hooks,
    clock: instantClock(),
    config: { ...runtimeConfig(), downloadsDir: BEHAVIOUR_DOWNLOADS },
    testMode: true,
    log,
  });
  runId = randomUUID();
  const run = { id: runId, allowedOrigins: [SITE] } as RunSnapshot;
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
      null,
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
      (
        await browser.runFunction(
          "capture",
          { scope: "page", selector: null, kind: null },
          signal,
          null,
        )
      ).output,
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

  it("classifies clicks, Enter and Space inside cross-origin frames, in and out of process (R29-1)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/frame-host.html`, signal);
    await browser.observe(signal);
    const frames = [
      { origin: "http://other.fixtures.test", top: 40 },
      { origin: "http://other.fixtures-isolated.test", top: 200 },
    ];
    const paths: string[] = [];
    for (const frame of frames) {
      const click = { type: "click" as const, x: 140, y: frame.top + 40, button: "left" as const };
      const target = await browser.targetFor(click, null);
      expect(target).toMatchObject({ label: "Delete account", tag: "button" });
      // The path names the frame element and its origin before the element inside it.
      expect(target!.path).toMatch(/iframe(:\d+)?@/);
      expect(target!.path).toContain(`@${frame.origin}>`);
      paths.push(target!.path);
      expect(needsApproval(click, target)?.kind).toBe("risky_click");
      // Focus the in-frame button (a click focuses it; the fixture's handler is harmless).
      await browser.runComputer([click], signal, async () => true);
      for (const keys of [["ENTER"], ["SPACE"]]) {
        const key = { type: "keypress" as const, keys };
        const focused = await browser.targetFor(key, null);
        expect(focused).toMatchObject({ label: "Delete account" });
        expect(needsApproval(key, focused)?.kind).toBe("risky_click");
      }
    }
    // An approval for one frame's button cannot transfer to the other's.
    expect(paths[0]).not.toBe(paths[1]);
  });

  it("fails closed when a frame chain is too deep to inspect (R29-1)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/nest.html?d=2`, signal);
    await browser.observe(signal);
    const reachable = {
      type: "click" as const,
      x: 10 * 2 + 85,
      y: 10 * 2 + 30,
      button: "left" as const,
    };
    expect(await browser.targetFor(reachable, null)).toMatchObject({ label: "Delete account" });
    await browser.navigate(`${SITE}/nest.html?d=6`, signal);
    await browser.observe(signal);
    const deep = {
      type: "click" as const,
      x: 10 * 6 + 85,
      y: 10 * 6 + 30,
      button: "left" as const,
    };
    const target = await browser.targetFor(deep, null);
    expect(target).toMatchObject({ opaqueFrame: true });
    expect(needsApproval(deep, target)?.kind).toBe("form_submit");
  });

  it("finds Space's real target after Tab, for every modifier (R29-2)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/save-form.html`, signal);
    await browser.observe(signal);
    await browser.runComputer(
      [
        { type: "click", x: 80, y: 30, button: "left" },
        { type: "keypress", keys: ["TAB"] },
      ],
      signal,
      async () => true,
    );
    for (const keys of [["SPACE"], ["SHIFT", "SPACE"], ["CTRL", "SPACE"], ["ALT", "SPACE"]]) {
      const key = { type: "keypress" as const, keys };
      const target = await browser.targetFor(key, null);
      expect(target).toMatchObject({
        label: "Save",
        tag: "button",
        isFormSubmit: true,
        formKind: "other",
      });
      expect(needsApproval(key, target)?.kind).toBe("form_submit");
    }
  });

  it("binds a target to its record and URL, which the DOM hash does not see (R29-3)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/record.html`, signal);
    const before = await browser.observe(signal);
    const click = { type: "click" as const, x: 100, y: 120, button: "left" as const };
    const alice = await browser.targetFor(click, null);
    expect(alice).toMatchObject({ label: "Delete" });
    const remote = await chromium.connectOverCDP(SLOT_CDP["browser-1"]!);
    const page = remote
      .contexts()[0]!
      .pages()
      .find((p) => p.url().includes("record.html"))!;
    // A live clock ticking does not change the record context.
    await page.evaluate(() => {
      document.querySelector("time")!.textContent = "12:01";
    });
    expect((await browser.targetFor(click, null))?.context).toBe(alice!.context);
    await page.evaluate(() => {
      document.getElementById("record")!.textContent = "Bobby";
    });
    const after = await browser.observe(signal);
    const bobby = await browser.targetFor(click, null);
    await remote.close();
    expect(after.domHash).toBe(before.domHash);
    expect(bobby!.path).toBe(alice!.path);
    expect(bobby!.context).not.toBe(alice!.context);
    expect(bobby!.context).toMatch(/^[0-9a-f]{64}$/);
  });

  it("maps a click into a scaled, bordered, padded frame by its real transform (N1)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/scaled-frame.html`, signal);
    await browser.observe(signal);
    // Outer (98,108) lands on "Delete account" (inner ~101,121); an unscaled mapping would read
    // "Cancel" (inner ~50,60).
    const click = { type: "click" as const, x: 98, y: 108, button: "left" as const };
    const target = await browser.targetFor(click, null);
    expect(target).toMatchObject({ label: "Delete account" });
    expect(needsApproval(click, target)?.kind).toBe("risky_click");
  });

  it("treats a cross-origin <object> as a frame: never an ungated click inside (N1)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/object-frame.html`, signal);
    await browser.observe(signal);
    const click = { type: "click" as const, x: 140, y: 80, button: "left" as const };
    const target = await browser.targetFor(click, null);
    expect(target?.tag).not.toBe("object");
    expect(needsApproval(click, target)).not.toBeNull();
  });

  it("gates a typed carriage return, which really submits the form (N2)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/save-form.html`, signal);
    await browser.observe(signal);
    await browser.runComputer(
      [{ type: "click", x: 80, y: 30, button: "left" }],
      signal,
      async () => true,
    );
    const typed = { type: "type" as const, text: "hello\r" };
    expect(needsApproval(typed, await browser.targetFor(typed, null))?.kind).toBe("form_submit");
    for (const keys of [["\r"], ["NumpadEnter"]]) {
      const key = { type: "keypress" as const, keys };
      expect(needsApproval(key, await browser.targetFor(key, null))?.kind).toBe("form_submit");
    }
    // What the gate prevents: "\r" is Enter to the browser and sends the form.
    await browser.runComputer([typed], signal, async () => true);
    expect((await browser.observe(signal)).title).toBe("Order placed");
  });

  it("hashes only the nearest row for the record context, bounded and deterministic (N4)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/long-table.html`, signal);
    await browser.observe(signal);
    const { output } = await browser.runFunction(
      "read_page",
      { mode: "interactive", sinceHash: null },
      signal,
      null,
    );
    const json = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)) as {
      elements: Array<{ name: string; point: { x: number; y: number } | null }>;
    };
    const [first, second] = json.elements.filter((e) => e.name === "Delete" && e.point);
    const at = (point: { x: number; y: number }) => ({
      type: "click" as const,
      ...point,
      button: "left" as const,
    });
    const row1 = (await browser.targetFor(at(first!.point!), null))!.context;
    expect((await browser.targetFor(at(first!.point!), null))!.context).toBe(row1);
    expect((await browser.targetFor(at(second!.point!), null))!.context).not.toBe(row1);
    const remote = await chromium.connectOverCDP(SLOT_CDP["browser-1"]!);
    const page = remote
      .contexts()[0]!
      .pages()
      .find((p) => p.url().includes("long-table"))!;
    await page.evaluate(() => {
      document.getElementById("banner")!.textContent = "Banner changed";
      document.getElementById("name-900")!.textContent = "Somebody else";
    });
    // Text outside the row does not move its context...
    expect((await browser.targetFor(at(first!.point!), null))!.context).toBe(row1);
    await page.evaluate(() => {
      document.getElementById("name-1")!.textContent = "Bobby";
    });
    await remote.close();
    // ...the row's own record does.
    expect((await browser.targetFor(at(first!.point!), null))!.context).not.toBe(row1);
  });

  // Every frame is mapped through its real geometry, level by level (fix round 4). Ground truth is a
  // real click: at points inside the widget's "Delete account" the agent must classify that button
  // (mapped variants) or at least gate the click (variants that are not a plain rectangle).
  it.each([
    ...[
      "scale",
      "object",
      "embed",
      "zoom",
      "padding",
      "ancestor-zoom",
      "shadow-scale",
      "cross-origin-scale",
      "nested",
      "scroll-page",
      "scroll-container",
      "scroll-inside",
    ].map((variant) => [variant, "mapped"] as const),
    ...[
      "flip",
      "rotate",
      "ancestor-rotate",
      "offset-rotate",
      "shadow-flip",
      "shadow-rotate",
      "flip-3d",
      "cross-origin-flip",
    ].map((variant) => [variant, "gated"] as const),
  ])(
    "frame geometry %s: a click inside is %s, never classified as another element",
    async (variant, expected) => {
      const browser = await connect();
      await browser.navigate(`${SITE}/frame-geometry.html?variant=${variant}`, signal);
      await browser.observe(signal);
      const remote = await chromium.connectOverCDP(SLOT_CDP["browser-1"]!);
      try {
        const page = remote
          .contexts()[0]!
          .pages()
          .find((p) => p.url().includes("frame-geometry"))!;
        // Frames already out of process when this connection attached are not fully known to it:
        // reload so it sees every frame load, then find the widget by its content.
        await page.reload();
        const widget = await waitFor(
          async () => {
            for (const frame of page.frames().slice(1))
              if (
                await frame
                  .locator("#delete")
                  .isVisible()
                  .catch(() => false)
              )
                return frame;
            return null;
          },
          { label: "widget frame" },
        );
        await page.waitForTimeout(200); // scroll positions are set on load
        let outer = widget;
        while (outer.parentFrame() !== page.mainFrame()) outer = outer.parentFrame()!;
        const box = (await (await outer.frameElement()).boundingBox())!;
        /** What a real click at the point hits in the widget: "cancel", "delete" or null. */
        const realHit = async (x: number, y: number) => {
          await page.mouse.click(x, y);
          return widget.evaluate(() => {
            const holder = window as { __clicked?: string };
            const clicked = holder.__clicked ?? null;
            holder.__clicked = undefined;
            return clicked;
          });
        };
        // Each button is an axis-aligned rectangle on screen: find it by real clicks down a column
        // of the outermost frame, then along a row through the button's middle (the hits found are
        // inside the button, so points between them are too).
        const STEP = 8; // every button is at least 20 px tall on screen
        const rects = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
        for (const fx of [0.5, 0.25]) {
          const x = Math.round(box.x + box.width * fx);
          const column = new Map<string, number[]>();
          for (let y = Math.max(0, Math.ceil(box.y)); y < box.y + box.height; y += STEP) {
            const hit = await realHit(x, y);
            if (hit) column.set(hit, [...(column.get(hit) ?? []), y]);
          }
          if (!column.has("delete") || !column.has("cancel")) continue;
          for (const [id, ys] of column) {
            const y = ys[Math.floor(ys.length / 2)]!;
            const xs: number[] = [];
            for (let i = 1; i < 12; i++) {
              const rowX = Math.round(box.x + (box.width * i) / 12);
              if ((await realHit(rowX, y)) === id) xs.push(rowX);
            }
            rects.set(id, { x0: xs[0]!, x1: xs.at(-1)!, y0: ys[0]!, y1: ys.at(-1)! });
          }
          break;
        }
        expect([...rects.keys()].sort()).toEqual(["cancel", "delete"]);
        for (const [id, rect] of rects) {
          // Nine points inside "Delete account", four inside "Cancel".
          const fractions = id === "delete" ? [0.2, 0.5, 0.8] : [0.25, 0.75];
          for (const fx of fractions) {
            for (const fy of fractions) {
              const point = {
                x: Math.round(rect.x0 + (rect.x1 - rect.x0) * fx),
                y: Math.round(rect.y0 + (rect.y1 - rect.y0) * fy),
              };
              const at = `${variant} ${id} at ${point.x},${point.y}`;
              const click = { type: "click" as const, ...point, button: "left" as const };
              const target = await browser.targetFor(click, null);
              expect(await realHit(point.x, point.y), at).toBe(id);
              const need = needsApproval(click, target);
              if (id === "delete") expect(need, at).not.toBeNull();
              if (expected === "mapped") {
                expect(target?.label, at).toBe(id === "delete" ? "Delete account" : "Cancel");
                if (id === "cancel") expect(need, at).toBeNull();
              }
            }
          }
        }
      } finally {
        await remote.close();
      }
    },
  );

  it("binds a lone form's button to the record around it, not just its label (N4 minor)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/button-to.html`, signal);
    await browser.observe(signal);
    const click = { type: "click" as const, x: 100, y: 120, button: "left" as const };
    const alice = await browser.targetFor(click, null);
    expect(alice).toMatchObject({ label: "Delete" });
    const remote = await chromium.connectOverCDP(SLOT_CDP["browser-1"]!);
    const page = remote
      .contexts()[0]!
      .pages()
      .find((p) => p.url().includes("button-to"))!;
    await page.evaluate(() => {
      document.getElementById("record")!.textContent = "Bobby";
    });
    await remote.close();
    expect((await browser.targetFor(click, null))!.context).not.toBe(alice!.context);
  });

  it("redacts registered secrets from the page title, read_page and the record excerpt (M13, A3a)", async () => {
    const mask: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text) =>
        text.replaceAll("Alice", SECRET_REDACTION).replaceAll("User record", SECRET_REDACTION),
    };
    const browser = await connect(withHooks({ maskSources: () => mask }));
    await browser.navigate(`${SITE}/record.html?who=Alice`, signal);
    const observed = await browser.observe(signal);
    expect(observed.title).toBe(SECRET_REDACTION);
    expect(observed.url).toBe(`${SITE}/record.html?who=${SECRET_REDACTION}`);
    const { output } = await browser.runFunction(
      "read_page",
      { mode: "text", sinceHash: null },
      signal,
      null,
    );
    expect(output).not.toContain("Alice");
    expect(output).toContain(SECRET_REDACTION);
    const target = await browser.targetFor({ type: "click", x: 100, y: 120, button: "left" }, null);
    expect(target?.label).toBe("Delete");
    expect(target?.excerpt).toContain(SECRET_REDACTION);
    expect(target?.excerpt).not.toContain("Alice");
  });

  it("redacts registered secrets from blocked navigation URLs, shown on new_origin approvals (M10)", async () => {
    const mask: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text) => text.replaceAll("hunter2", SECRET_REDACTION),
    };
    const browser = await connect(withHooks({ maskSources: () => mask }));
    expect(await browser.navigate(`${OTHER}/steal?pw=hunter2`, signal)).toBe(false);
    expect(browser.drainBlockedNavigations()).toEqual([
      { url: `${OTHER}/steal?pw=${SECRET_REDACTION}`, origin: OTHER },
    ]);
  });

  it("saves an approved script download (a new blob URL each time) as the card showed it, once (I4)", async () => {
    const browser = await connect();
    await browser.navigate(`${SITE}/download.html`, signal);
    await browser.observe(signal);
    const exportTable = { type: "click", x: 80, y: 140, button: "left" } as const;
    const gate = async () => ({
      target: await browser.targetFor(exportTable, null),
      personApproved: false,
    });
    await browser.runComputer([exportTable], signal, gate);
    const [attempt] = await waitFor(
      () => {
        const drained = browser.drainBlockedDownloads();
        return drained.length > 0 ? drained : null;
      },
      { label: "blocked export" },
    );
    expect(attempt!.url.startsWith("blob:")).toBe(true);
    const card = downloadRequest(attempt!.url, attempt!.filename);
    if (card.kind !== "download") throw new Error("not a download card");
    await browser.allowDownload(card);
    // The model repeats it: the page makes a new blob URL, the same card.
    await browser.runComputer([exportTable], signal, gate);
    const folder = join(BEHAVIOUR_DOWNLOADS, runId);
    const saved = await waitFor(
      async () => {
        const files = await readdir(folder).catch(() => [] as string[]);
        return files.length > 0 ? files : null;
      },
      { label: "saved", timeoutMs: 10_000 },
    );
    expect(saved).toHaveLength(1);
    expect(browser.drainBlockedDownloads()).toEqual([]);
  });
});
