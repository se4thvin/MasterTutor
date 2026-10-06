import type { ComputerAction, ReadPageElement } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { OTHER, SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { hitTest } from "../browser/hit-test.ts";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import { captureModelScreenshot } from "../browser/screenshot.ts";
import { BrowserSession } from "../browser/session.ts";
import { instantClock } from "../runtime/clock.ts";
import { ControlHeld, Interrupted } from "../runtime/errors.ts";
import { waitFor } from "../testing/wait.ts";
import { ComputerExecutor, FOCUS_MOVED_REFUSAL, SECRET_FIELD_REFUSAL } from "./computer.ts";
import { readPage } from "./read-page.ts";

const log = createLogger({ service: "test", level: "silent" });
const signal = new AbortController().signal;
let session: BrowserSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function setup(path = "/interactive.html") {
  session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP["browser-1"] ?? "",
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
  });
  await session.goto(`${SITE}${path}`, signal);
  await captureModelScreenshot(session, NO_MASK_SOURCES, signal);
  const executor = new ComputerExecutor(session, { clock: instantClock(), waitActionMs: 1_000 });
  return { s: session, executor };
}

async function point(s: BrowserSession, name: string): Promise<{ x: number; y: number }> {
  const result = await readPage(s, { mode: "interactive", sinceHash: null });
  if (!("elements" in result)) throw new Error("expected elements");
  const element = result.elements.find(
    (candidate: ReadPageElement) => candidate.tag !== "label" && candidate.name.startsWith(name),
  );
  if (!element?.point) throw new Error(`${name} has no point`);
  return element.point;
}

const click = (p: { x: number; y: number }): ComputerAction => ({
  type: "click",
  x: p.x,
  y: p.y,
  button: "left",
});
const text = (s: BrowserSession, selector: string) => s.page.locator(selector).textContent();

describe("ComputerExecutor", () => {
  it("clicks read_page points and snaps a near miss onto a tiny target", async () => {
    const { s, executor } = await setup();
    await executor.run([click(await point(s, "Increment"))], signal);
    expect(await text(s, "#count")).toBe("1");
    const tiny = await point(s, "Tiny");
    expect(await executor.execute(click({ x: tiny.x + 11, y: tiny.y }), signal)).toBeNull();
    expect(await text(s, "#tiny-count")).toBe("1");
  });

  it("refuses points outside the viewport (Review Focus 2)", async () => {
    const { s, executor } = await setup();
    const note = await executor.execute({ type: "click", x: 10, y: 799, button: "left" }, signal);
    expect(note).toMatch(/outside the visible page/);
    expect(await text(s, "#count")).toBe("0");
  });

  it("scrolls the page or the inner list under the pointer, and reports a scroll with no effect", async () => {
    const { s, executor } = await setup();
    const list = await point(s, "Item 1");
    expect(
      await executor.execute(
        { type: "scroll", x: list.x, y: list.y, scroll_x: 0, scroll_y: 600 },
        signal,
      ),
    ).toBeNull();
    expect(
      await s.page.evaluate(() => [document.getElementById("list")!.scrollTop, scrollY]),
    ).toEqual([expect.any(Number), 0]);
    expect(await s.page.evaluate(() => document.getElementById("list")!.scrollTop)).toBeGreaterThan(
      0,
    );
    await executor.execute(
      { type: "scroll", x: 900, y: 300, scroll_x: 0, scroll_y: 2_000 },
      signal,
    );
    await captureModelScreenshot(s, NO_MASK_SOURCES, signal);
    await executor.execute(click(await point(s, "Far button")), signal);
    expect(await text(s, "#far-count")).toBe("1");
    const note = await executor.execute(
      { type: "scroll", x: 900, y: 300, scroll_x: 0, scroll_y: -10_000 },
      signal,
    );
    expect(note).toBeNull();
    expect(
      await executor.execute(
        { type: "scroll", x: 900, y: 300, scroll_x: 0, scroll_y: -500 },
        signal,
      ),
    ).toMatch(/no effect/);
  });

  it("types into focused fields, refuses secret fields and unfocused typing", async () => {
    const { s, executor } = await setup();
    expect(await executor.execute({ type: "type", text: "stray" }, signal)).toMatch(
      /Nothing editable/,
    );
    await executor.run(
      [click(await point(s, "Name")), { type: "type", text: "Ada Lovelace" }],
      signal,
    );
    expect(await s.page.inputValue("#name")).toBe("Ada Lovelace");
    await executor.execute({ type: "keypress", keys: ["CTRL", "A"] }, signal);
    await executor.execute({ type: "type", text: "Grace" }, signal);
    expect(await s.page.inputValue("#name")).toBe("Grace");
    const run = await executor.run(
      [click(await point(s, "Password")), { type: "type", text: "hunter2" }],
      signal,
    );
    expect(run.notes).toContain(SECRET_FIELD_REFUSAL);
    expect(await s.page.inputValue("#pw")).toBe("");
  });

  it("waits for delayed content and navigations, and emulates back and the address bar", async () => {
    const { s, executor } = await setup();
    await executor.execute(click(await point(s, "Load later")), signal);
    expect(await s.page.locator("#late").count()).toBe(1);
    await executor.execute(click(await point(s, "Go to page two")), signal);
    expect(s.page.url()).toBe(`${SITE}/page2`);
    await executor.execute({ type: "keypress", keys: ["ALT", "LEFT"] }, signal);
    expect(s.page.url()).toBe(`${SITE}/interactive.html`);
    expect(await executor.execute({ type: "keypress", keys: ["CTRL", "L"] }, signal)).toMatch(
      /Address bar/,
    );
    await executor.execute({ type: "type", text: `${SITE}/page2` }, signal);
    await executor.execute({ type: "keypress", keys: ["ENTER"] }, signal);
    expect(s.page.url()).toBe(`${SITE}/page2`);
    await executor.execute({ type: "keypress", keys: ["CTRL", "L"] }, signal);
    await executor.execute({ type: "type", text: `${OTHER}/` }, signal);
    expect(await executor.execute({ type: "keypress", keys: ["ENTER"] }, signal)).toMatch(
      /Could not open/,
    );
    expect(s.drainBlockedNavigations()).toEqual([{ url: `${OTHER}/`, origin: OTHER }]);
  });

  it("follows a new tab (Review Focus 1) and stops the batch after navigation (Review Focus 3)", async () => {
    const { s, executor } = await setup();
    await executor.execute(click(await point(s, "Open in new tab")), signal);
    expect(s.page.url()).toBe(`${SITE}/page2?tab=1`);
    await s.goto(`${SITE}/interactive.html`, signal);
    await captureModelScreenshot(s, NO_MASK_SOURCES, signal);
    const run = await executor.run(
      [click(await point(s, "Go to page two")), click(await point(s, "Increment"))],
      signal,
    );
    expect(run.executed).toBe(1);
    expect(run.notes.join(" ")).toMatch(/remaining 1 action/);
  });

  it("drags a slider and stops a batch the gate refuses", async () => {
    const { s, executor } = await setup();
    const slider = await point(s, "Volume");
    await executor.execute(
      {
        type: "drag",
        path: [
          { x: slider.x - 90, y: slider.y },
          { x: slider.x + 90, y: slider.y },
        ],
      },
      signal,
    );
    expect(Number(await s.page.inputValue("#volume"))).toBeGreaterThan(80);
    const run = await executor.run(
      [click(await point(s, "Delete account"))],
      signal,
      async () => false,
    );
    expect(run.executed).toBe(0);
    expect(
      await s.page.evaluate(() => (window as unknown as { __deleted?: boolean }).__deleted),
    ).toBeUndefined();
  });

  it("aborts long typing between chunks and refuses everything while control is held", async () => {
    const { s, executor } = await setup();
    await executor.execute(click(await point(s, "Notes")), signal);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Interrupted("takeover")), 150);
    const started = Date.now();
    await expect(
      executor.execute({ type: "type", text: "x".repeat(5_000) }, controller.signal),
    ).rejects.toBeInstanceOf(Interrupted);
    // Spec target: abort within 300 ms of the signal (450 ms from the start). CI bound is generous.
    const elapsed = Date.now() - started;
    console.info(JSON.stringify({ metric: "type_abort_ms", elapsed, specTargetMs: 450 }));
    expect(elapsed).toBeLessThan(2_000);
    expect((await s.page.inputValue("#notes")).length).toBeLessThan(5_000);
    s.guard.hold();
    await expect(
      executor.execute({ type: "click", x: 50, y: 50, button: "left" }, signal),
    ).rejects.toBeInstanceOf(ControlHeld);
  });
});

describe("ComputerExecutor review gaps (group C fix round)", () => {
  it("refuses a tab character in typed text so focus cannot reach a password field", async () => {
    const { s, executor } = await setup("/gaps.html");
    await executor.execute(click(await point(s, "First")), signal);
    const note = await executor.execute({ type: "type", text: "x\tsecret" }, signal);
    expect(note).toMatch(/Tab/);
    expect(await s.page.inputValue("#first")).toBe("");
    expect(await s.page.inputValue("#second")).toBe("");
  });

  it("refuses printable single keys while a secret field has focus", async () => {
    const { s, executor } = await setup("/gaps.html");
    await executor.execute(click(await point(s, "Second")), signal);
    for (const key of ["h", "H", "7"]) {
      expect(await executor.execute({ type: "keypress", keys: [key] }, signal)).toBe(
        SECRET_FIELD_REFUSAL,
      );
    }
    expect(await s.page.inputValue("#second")).toBe("");
    // Non-printing keys still work in a secret field.
    expect(await executor.execute({ type: "keypress", keys: ["BACKSPACE"] }, signal)).toBeNull();
  });

  it("never types into a password field the page focuses mid-string", async () => {
    const { s, executor } = await setup("/gaps.html");
    await executor.execute(click(await point(s, "Code part")), signal);
    const run = await executor.run(
      [{ type: "type", text: "abcdefghijklmnopqrstuvwxyz0123" }],
      signal,
    );
    expect(await s.page.inputValue("#adv")).toBe("ab");
    expect(await s.page.inputValue("#adv-pw")).toBe("");
    expect(run.notes.join(" ")).toContain(SECRET_FIELD_REFUSAL);
  });

  it("stops a batch after a refusal or no-op instead of running later actions", async () => {
    const { s, executor } = await setup("/gaps.html");
    const target = click(await point(s, "Pointer div"));
    const run = await executor.run([{ type: "type", text: "stray" }, target], signal);
    expect(run.executed).toBe(1);
    expect(run.notes.join(" ")).toMatch(/Nothing editable/);
    expect(run.notes.join(" ")).toMatch(/remaining 1 action/);
    expect(await text(s, "#cdiv-count")).toBe("0");
    const outside = await executor.run(
      [{ type: "click", x: 10, y: 799, button: "left" }, target],
      signal,
    );
    expect(outside.executed).toBe(1);
    expect(await text(s, "#cdiv-count")).toBe("0");
    // Informational notes (address bar) do not stop a batch.
    const bar = await executor.run(
      [
        { type: "keypress", keys: ["CTRL", "L"] },
        { type: "type", text: `${SITE}/page2` },
        { type: "keypress", keys: ["ENTER"] },
      ],
      signal,
    );
    expect(bar.executed).toBe(3);
    expect(s.page.url()).toBe(`${SITE}/page2`);
  });

  it("counts scroll chaining as an effect when the inner box is already at its edge", async () => {
    const { s, executor } = await setup("/gaps.html");
    const box = await point(s, "Row 1");
    await s.page.evaluate(() => {
      const el = document.getElementById("box")!;
      el.scrollTop = el.scrollHeight;
    });
    expect(
      await executor.execute(
        { type: "scroll", x: box.x, y: box.y, scroll_x: 0, scroll_y: 200 },
        signal,
      ),
    ).toBeNull();
    expect(await s.page.evaluate(() => scrollY)).toBeGreaterThan(0);
  });

  it("releases the mouse button when a drag fails midway", async () => {
    const { s, executor } = await setup("/gaps.html");
    let ups = 0;
    const mouse = s.page.mouse;
    const realUp = mouse.up.bind(mouse);
    const realMove = mouse.move.bind(mouse);
    let moves = 0;
    mouse.up = async (...args) => {
      ups += 1;
      return realUp(...args);
    };
    mouse.move = async (...args) => {
      moves += 1;
      if (moves === 2) throw new Error("boom");
      return realMove(...args);
    };
    await expect(
      executor.execute(
        {
          type: "drag",
          path: [
            { x: 10, y: 10 },
            { x: 50, y: 50 },
            { x: 90, y: 90 },
          ],
        },
        signal,
      ),
    ).rejects.toThrow("boom");
    expect(ups).toBe(1);
  });

  it("refuses multi-key presses that would type into a secret field", async () => {
    const { s, executor } = await setup("/gaps.html");
    await executor.execute(click(await point(s, "Second")), signal);
    for (const keys of [
      ["A", "B"],
      ["SHIFT", "A", "B"],
      ["SPACE", "A"],
      ["1", "2"],
    ]) {
      expect(await executor.execute({ type: "keypress", keys }, signal)).toBe(SECRET_FIELD_REFUSAL);
    }
    expect(await s.page.inputValue("#second")).toBe("");
    // Shortcuts with Ctrl/Meta and non-printing combos stay allowed.
    expect(await executor.execute({ type: "keypress", keys: ["CTRL", "A"] }, signal)).toBeNull();
    // An editable field still takes multi-key presses.
    await executor.execute(click(await point(s, "First")), signal);
    await executor.execute({ type: "keypress", keys: ["A", "B"] }, signal);
    expect(await s.page.inputValue("#first")).toBe("ab");
  });

  it("snaps near misses onto cursor:pointer divs like read_page lists them", async () => {
    const { s, executor } = await setup("/gaps.html");
    const rect = await s.page.evaluate(() => {
      const r = document.getElementById("cdiv")!.getBoundingClientRect();
      return { right: r.right, midY: r.top + r.height / 2 };
    });
    const miss = {
      x: Math.round((rect.right + 8) * s.lastScale),
      y: Math.round(rect.midY * s.lastScale),
    };
    expect(await executor.execute(click(miss), signal)).toBeNull();
    expect(await text(s, "#cdiv-count")).toBe("1");
  });
});

describe("ComputerExecutor inside cross-origin frames (targeted fix)", () => {
  it("blocks auto-advanced typing into a password field inside an out-of-process frame", async () => {
    const { s, executor } = await setup("/frame-otp.html");
    // The Code field inside the frame (frame at 40,40; field at 20,20 inside, 200x30).
    expect(await executor.execute(click({ x: 100, y: 75 }), signal)).toBeNull();
    const result = await executor.execute({ type: "type", text: "1234secret" }, signal);
    expect(result).toBe(SECRET_FIELD_REFUSAL);
    const frame = s.page.frames().find((candidate) => candidate.url().includes("otp-advance"))!;
    expect(
      await frame.evaluate(() => (document.getElementById("code") as HTMLInputElement).value),
    ).toBe("1234");
    expect(
      await frame.evaluate(() => (document.getElementById("pw") as HTMLInputElement).value),
    ).toBe("");
  });

  it("returns the uninspectable-frame target when a frame lookup throws, and forgets the frame (N3)", async () => {
    const { s } = await setup("/frame-host.html");
    const forgotten: string[] = [];
    const broken = s as unknown as {
      frameWorlds(frameId: string): Promise<unknown>;
      forgetFrame(frameId: string): Promise<void>;
    };
    broken.frameWorlds = async () => ({
      evaluate: async () => {
        throw new Error("Target closed");
      },
      evaluateHandle: async () => {
        throw new Error("Target closed");
      },
      cdp: { send: async () => ({}) },
    });
    broken.forgetFrame = async (frameId) => void forgotten.push(frameId);
    // The out-of-process frame (other.fixtures-isolated.test) at top 200.
    const hit = await hitTest(s, { x: 140, y: 240 });
    expect(hit.target).toMatchObject({ opaqueFrame: true });
    expect(forgotten).toHaveLength(1);
  });

  it.each(["pw", "note"])(
    "stops typing when a page script moves focus into another document mid-chunk (into %s)",
    async (into) => {
      const { s, executor } = await setup(`/advance-into-frame.html?into=${into}`);
      expect(await executor.execute(click({ x: 100, y: 35 }), signal)).toBeNull();
      const result = await executor.execute({ type: "type", text: "1234abcdef" }, signal);
      expect(result).toBe(FOCUS_MOVED_REFUSAL);
      const frame = s.page.frames().find((candidate) => candidate !== s.page.mainFrame())!;
      expect(
        await frame.evaluate((id) => (document.getElementById(id) as HTMLInputElement).value, into),
      ).toBe("");
    },
  );

  it("closes the CDP session of a forgotten out-of-process frame (N3 minor)", async () => {
    const { s } = await setup("/frame-host.html");
    const oopif = await waitFor(
      () => s.page.frames().find((f) => f.url().includes("fixtures-isolated")),
      { label: "oopif" },
    );
    const own = await s.context.newCDPSession(oopif);
    const id = (await own.send("Page.getFrameTree")).frameTree.frame.id;
    await own.detach();
    const worlds = (await s.frameWorlds(id))!;
    expect(await worlds.cdp.send("Runtime.evaluate", { expression: "1" })).toBeTruthy();
    await s.forgetFrame(id);
    await expect(worlds.cdp.send("Runtime.evaluate", { expression: "1" })).rejects.toThrow();
  });
});
