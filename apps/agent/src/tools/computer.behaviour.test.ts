import type { ComputerAction, ReadPageElement } from "@mastertutor/contracts";
import type { Locator } from "playwright-core";
import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { OTHER, SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { focusTarget, hitTest } from "../browser/hit-test.ts";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import { captureModelScreenshot } from "../browser/screenshot.ts";
import { settle } from "../browser/settle.ts";
import { BrowserSession } from "../browser/session.ts";
import { ARM_BUDGET_MS, markStillUnguarded, markUnguarded } from "../browser/input-guard.ts";
import { instantClock } from "../runtime/clock.ts";
import { ControlHeld, Interrupted } from "../runtime/errors.ts";
import { waitFor } from "../testing/wait.ts";
import {
  ComputerExecutor,
  FOCUS_MOVED_REFUSAL,
  PAGE_CHANGED_REFUSAL,
  PAGE_SETTLING_REFUSAL,
  SECRET_FIELD_REFUSAL,
  PAGE_TOO_COMPLEX,
  PAGE_TOO_COMPLEX_REFUSAL,
  TARGET_MOVED_REFUSAL,
  UNGUARDED_CLICK_REFUSAL,
  UNRESPONSIVE_REFUSAL,
} from "./computer.ts";
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
  const result = await readPage(s, { mode: "interactive", sinceHash: null, offset: null });
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

  it("records what each action of a batch did: page input, navigation or the address bar (bench N1, N2)", async () => {
    const { s, executor } = await setup();
    const go = await point(s, "Go to page two");
    const batch = await executor.run(
      [{ type: "move", x: go.x, y: go.y }, { type: "wait" }, click(go)],
      signal,
    );
    expect(batch.effects).toEqual(["passive", "passive", "input"]);
    const back = await executor.run([{ type: "keypress", keys: ["ALT", "LEFT"] }], signal);
    expect(back.effects).toEqual(["navigate"]);
    const bar = (url: string): ComputerAction[] => [
      { type: "keypress", keys: ["CTRL", "L"] },
      { type: "type", text: url },
      { type: "keypress", keys: ["ENTER"] },
    ];
    const opened = await executor.run(bar(`${SITE}/page2`), signal);
    expect(s.page.url()).toBe(`${SITE}/page2`);
    expect(opened.effects).toEqual(["address_bar", "address_bar", "address_bar_landed"]);
    const blocked = await executor.run(bar(`${OTHER}/`), signal);
    expect(blocked.effects).toEqual(["address_bar", "address_bar", "address_bar"]);
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

describe("ComputerExecutor with a hung frame and frames added mid-typing (fix round 4)", () => {
  const value = (s: BrowserSession, frameSelector: string | null, id: string) =>
    frameSelector
      ? s.page.frameLocator(frameSelector).locator(`#${id}`).inputValue()
      : s.page.locator(`#${id}`).inputValue();
  /** hung-frame.html: Code (top) at 40,20; a same-origin frame with Note at 40,80; a hung advert. */
  async function hungPage() {
    // The advert hangs for 3 s, so leaving the page afterwards does not wait long.
    const { s, executor } = await setup("/hung-frame.html?ms=3000");
    await new Promise((resolve) => setTimeout(resolve, 800)); // the advert hangs once loaded
    // Clicking there fails closed too, until a person approves it (breaker fix).
    const code = { x: 100, y: 35 };
    expect(await executor.execute(click(code), signal)).toBe(UNGUARDED_CLICK_REFUSAL);
    const target = (await hitTest(s, code)).target;
    expect(markUnguarded(s, target)?.opaqueFrame).toBe(true); // so the loop asks a person
    // Approved, it runs: the hung advert is not near the point, so it cannot take the press.
    expect(
      await executor.execute(click(code), signal, {
        target: markUnguarded(s, target),
        personApproved: true,
      }),
    ).toBeNull();
    return { s, executor };
  }

  /** The advert in hung-frame.html answers again (its hang is over). */
  const advertAnswers = (s: BrowserSession) =>
    waitFor(
      () =>
        s.page
          .frames()
          .find((frame) => frame.url().includes("hang.html"))
          ?.evaluate(() => true)
          .catch(() => false),
      { label: "advert answers" },
    );
  const approvedAt = async (s: BrowserSession, at: { x: number; y: number }) => ({
    target: markUnguarded(s, (await hitTest(s, at)).target),
    personApproved: true,
  });

  it("an unarmed frame next to the point holds an approved click back until it answers", async () => {
    // The hung advert's box starts 6 px right of the point (within the 8 px margin).
    const { s, executor } = await setup("/hung-frame.html?ms=2500&ad=248");
    await new Promise((resolve) => setTimeout(resolve, 300)); // the advert hangs once loaded
    const code = { x: 242, y: 35 };
    const started = Date.now();
    expect(await executor.execute(click(code), signal, await approvedAt(s, code))).toBe(
      PAGE_SETTLING_REFUSAL,
    );
    const waited = Date.now() - started;
    console.info(JSON.stringify({ metric: "settling_refusal_ms", waited }));
    // About 1 s of re-arming, each try bounded by the budget (arm and disarm).
    expect(waited).toBeLessThan(ARM_BUDGET_MS * 8 + 1_000);
    expect(await s.page.evaluate(() => document.activeElement?.id)).not.toBe("code");
    await advertAnswers(s);
    expect(await executor.execute(click(code), signal, await approvedAt(s, code))).toBeNull();
    expect(await s.page.evaluate(() => document.activeElement?.id)).toBe("code");
  });

  it("an unarmed frame that slides under the point after arming: the approved click is refused (0/5 pressed)", async () => {
    let refused = 0;
    for (let i = 0; i < 5; i++) {
      // 100 ms after the pointer enters Code (the arm is under way), the hung advert covers it.
      const { s, executor } = await setup("/hung-frame.html?ms=3000&slide=100");
      await new Promise((resolve) => setTimeout(resolve, 300)); // the advert hangs once loaded
      await s.page.mouse.move(600, 500); // off Code, so the executor's move enters it
      const code = { x: 100, y: 35 };
      const note = await executor.execute(click(code), signal, await approvedAt(s, code));
      if (note === PAGE_SETTLING_REFUSAL || note === TARGET_MOVED_REFUSAL) refused += 1;
      expect(await s.page.evaluate(() => document.activeElement?.id)).not.toBe("code");
      await session?.close();
      session = undefined;
    }
    expect(refused).toBe(5);
  });

  it("an unarmed frame that slides under the point while the press-time checks run is refused: the geometry is the last check (I2)", async () => {
    // The advert does not hang (ms=0): it answers input. Its arm is held back past the budget
    // (its first arm command is slow), so the guard is incomplete with the advert unarmed.
    const { s, executor } = await setup("/hung-frame.html?ms=0");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [advert] = [...(await s.outOfProcessFrames()).values()];
    const advertSend = advert!.cdp.send.bind(advert!.cdp) as (
      method: string,
      params?: object,
    ) => Promise<unknown>;
    (advert!.cdp as { send: typeof advertSend }).send = async (method, params) => {
      if (method === "Page.addScriptToEvaluateOnNewDocument")
        await new Promise((resolve) => setTimeout(resolve, 2 * ARM_BUDGET_MS));
      return advertSend(method, params);
    };
    // The page-changed flush (the guard's last round trip before the geometry) slides the
    // advert over Code, as a page could at that moment, and it is painted before the press.
    const worlds = await s.worlds();
    const evaluate = worlds.evaluate.bind(worlds);
    (worlds as { evaluate: typeof evaluate }).evaluate = (async (
      ...args: Parameters<typeof evaluate>
    ) => {
      if (String(args[0]).replace(/\s/g, "") === "()=>0") {
        await s.page.evaluate(() => {
          const ad = document.getElementById("ad")!;
          ad.style.cssText += "; left: 40px; top: 20px; width: 200px; height: 30px";
        });
        await new Promise((resolve) => setTimeout(resolve, 150)); // within the flush budget
      }
      return evaluate(...args);
    }) as typeof evaluate;
    const code = { x: 100, y: 35 };
    expect(await executor.execute(click(code), signal, await approvedAt(s, code))).toBe(
      TARGET_MOVED_REFUSAL,
    );
    expect(await s.page.evaluate(() => document.activeElement?.id)).not.toBe("code");
  });

  it("a page whose frame recovered stops asking for approval: a complete arm clears the mark", async () => {
    const { s, executor } = await setup("/hung-frame.html?ms=1500");
    await new Promise((resolve) => setTimeout(resolve, 300)); // the advert hangs once loaded
    const code = { x: 100, y: 35 };
    expect(await executor.execute(click(code), signal)).toBe(UNGUARDED_CLICK_REFUSAL);
    const target = (await hitTest(s, code)).target;
    expect(markUnguarded(s, target)?.opaqueFrame).toBe(true);
    // While it still hangs, the loop's classification keeps asking a person...
    expect((await markStillUnguarded(s, target))?.opaqueFrame).toBe(true);
    await advertAnswers(s);
    // ...and once every document arms again, it no longer does: the click runs unapproved.
    const fresh = await markStillUnguarded(s, (await hitTest(s, code)).target);
    expect(fresh?.opaqueFrame).toBeFalsy();
    expect(
      await executor.execute(click(code), signal, { target: fresh, personApproved: false }),
    ).toBeNull();
    expect(await s.page.evaluate(() => document.activeElement?.id)).toBe("code");
  });

  it.each([
    [{ type: "type", text: "hello" }, "hello"],
    [{ type: "keypress", keys: ["a"] }, "a"],
  ] satisfies Array<[ComputerAction, string]>)(
    "%o fails closed within the budget, then needs approval, then runs once approved",
    async (action, typed) => {
      const { s, executor } = await hungPage();
      const started = Date.now();
      expect(await executor.execute(action, signal)).toBe(UNRESPONSIVE_REFUSAL);
      const elapsed = Date.now() - started;
      console.info(JSON.stringify({ metric: "hung_frame_fail_closed_ms", elapsed }));
      expect(elapsed).toBeLessThan(ARM_BUDGET_MS + 750);
      expect(await value(s, null, "code")).toBe("");
      // The loop's next classification asks a person first (runs.behaviour covers that flow)...
      expect(markUnguarded(s, await focusTarget(s))?.opaqueFrame).toBe(true);
      // ...and once a person approved it, it runs.
      expect(
        await executor.execute(action, signal, { target: null, personApproved: true }),
      ).toBeNull();
      expect(await value(s, null, "code")).toBe(typed);
    },
  );

  it.each(["type", "keypress"] as const)(
    "a takeover during %s on a hung page aborts at once and never drops a person's keystrokes",
    async (kind) => {
      const { s, executor } = await hungPage();
      const controller = new AbortController();
      const action: ComputerAction =
        kind === "type" ? { type: "type", text: "agent" } : { type: "keypress", keys: ["a"] };
      const running = executor.execute(action, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 40)); // mid-arm: the advert never answers
      const abortedAt = Date.now();
      controller.abort(new Interrupted("takeover"));
      await expect(running).rejects.toBeInstanceOf(Interrupted);
      const latency = Date.now() - abortedAt;
      console.info(JSON.stringify({ metric: "hung_frame_abort_ms", kind, latency }));
      expect(latency).toBeLessThan(1_000);
      // The person types into the other document (armed to cancel everything while the agent typed).
      const note = s.page.frameLocator("#widget").locator("#note");
      await note.focus();
      await s.page.keyboard.type("human");
      expect(await note.inputValue()).toBe("human");
      expect(await value(s, null, "code")).toBe("");
    },
  );

  it.each([
    ["", PAGE_CHANGED_REFUSAL],
    ["&frames=40", PAGE_CHANGED_REFUSAL],
    ["&frames=70", UNRESPONSIVE_REFUSAL],
  ])(
    "stops typing at once when a frame is added mid-typing (%s), and fails closed past the document cap",
    async (frames, refusal) => {
      // After 4 characters the page creates a frame with a password field and focuses it.
      const { s, executor } = await setup(`/advance-into-frame.html?into=new${frames}`);
      // Past the document cap a click is handed to the user (breaker fix 2): focus it as they would.
      if (frames === "&frames=70") await s.page.locator("#code").focus();
      else expect(await executor.execute(click({ x: 100, y: 35 }), signal)).toBeNull();
      expect(await executor.execute({ type: "type", text: "1234abcdef" }, signal)).toBe(refusal);
      const leaked = await s.page.evaluate(() =>
        (window as { __leaked?: () => string }).__leaked?.(),
      );
      expect(leaked ?? "").toBe("");
      expect(await value(s, null, "code")).toBe(refusal === UNRESPONSIVE_REFUSAL ? "" : "1234");
    },
  );
});

describe("ComputerExecutor on a page that changes under the pointer (fix round 5)", () => {
  it.each([
    ["/widget.html?swap=15", { x: 100, y: 70 }],
    ["/jumping-frame.html?period=15", { x: 140, y: 110 }],
  ])("%s: across 60 clicks the gate allowed on Cancel, none reaches Delete", async (path, at) => {
    const { s, executor } = await setup(path);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const hits = { cancel: 0, delete: 0, refused: 0 };
    for (let i = 0; i < 60; i++) {
      // The loop's gate: only "Cancel" runs without approval, and it hands its classification on.
      const gate = async () => {
        const { target } = await hitTest(s, at);
        return target?.label === "Cancel" && !target.opaqueFrame
          ? { target, personApproved: false }
          : false;
      };
      const run = await executor.run([click(at)], signal, gate);
      if (run.executed === 1 && run.notes.length > 0) hits.refused += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const frame of s.page.frames()) {
        const clicked = await frame
          .evaluate(() => {
            const holder = window as { __clicked?: string };
            const value = holder.__clicked;
            holder.__clicked = undefined;
            return value;
          })
          .catch(() => undefined);
        if (clicked === "cancel" || clicked === "delete") hits[clicked] += 1;
      }
    }
    console.info(JSON.stringify({ metric: "toctou_clicks", path, ...hits }));
    expect(hits.delete).toBe(0);
    expect(hits.cancel).toBeGreaterThan(0);
  });
});

describe("ComputerExecutor when the click guard is not whole (breaker fix)", () => {
  const at = { x: 100, y: 70 }; // widget.html: Cancel
  /** The loop's gate: only "Cancel" runs without approval, and it hands its classification on. */
  const cancelGate = (s: BrowserSession) => async () => {
    const { target } = await hitTest(s, at);
    return target?.label === "Cancel" && !target.opaqueFrame
      ? { target, personApproved: false }
      : false;
  };
  /** Which button a click reached, in any document of the page. */
  async function clicked(s: BrowserSession): Promise<string | undefined> {
    let found: string | undefined;
    for (const frame of s.page.frames()) {
      const value = await frame
        .evaluate(() => {
          const holder = window as { __clicked?: string };
          const result = holder.__clicked;
          holder.__clicked = undefined;
          return result;
        })
        .catch(() => undefined);
      found ??= value;
    }
    return found;
  }

  it.each(["", "open", "closed"])(
    "a same-origin frame inserted just before the press (shadow root: %s) never takes it: 0/40 reach Delete",
    async (shadow) => {
      const { s, executor } = await setup();
      const attempt = async (delay: number) => {
        await s.goto(`${SITE}/widget.html?cover=${delay}&shadow=${shadow}`, signal);
        await s.page.mouse.move(600, 500); // off Cancel, so the executor's move enters it
        const run = await executor.run([click(at)], signal, cancelGate(s));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const gap = await s.page.evaluate(() => (window as { __gap?: number }).__gap);
        return { run, reached: await clicked(s), gap };
      };
      // Aim the insertion at the window between the executor's checks and its press: first
      // measure how long the pointer rests on Cancel before the press, here (no frame comes).
      const gaps: number[] = [];
      for (let i = 0; i < 5; i++) gaps.push((await attempt(60_000)).gap ?? 0);
      const gap = gaps.sort((a, b) => a - b)[2]!;
      // The band where a frame lands after the checks but before the press is narrow and sits
      // late in the gap on a slow link (the slot), earlier on a fast one: cover both.
      const fractions = [0.5, 0.6, 0.7, 0.8, 0.9, 0.93, 0.95, 0.96, 0.97, 0.98];
      const hits = { cancel: 0, delete: 0, refused: 0 };
      for (let i = 0; i < 40; i++) {
        const { run, reached } = await attempt(Math.round(gap * fractions[i % fractions.length]!));
        if (run.notes.includes(TARGET_MOVED_REFUSAL)) hits.refused += 1;
        if (reached === "cancel" || reached === "delete") hits[reached] += 1;
      }
      console.info(JSON.stringify({ metric: "inserted_frame_clicks", shadow, gap, ...hits }));
      expect(hits.delete).toBe(0);
    },
  );

  it.each([
    ["unapproved", 30],
    ["person-approved", 60],
  ] as const)(
    "a frame showing Cancel that navigates to another site just before the press never takes it (%s): 0/%i reach Delete",
    async (approval, tries) => {
      const { s, executor } = await setup();
      const gate = async () => {
        const { target } = await hitTest(s, at);
        if (target?.label !== "Cancel") return false;
        return approval === "person-approved"
          ? { target: markUnguarded(s, target), personApproved: true }
          : target.opaqueFrame
            ? false
            : { target, personApproved: false };
      };
      const attempt = async (after: number) => {
        await s.goto(`${SITE}/frame-swap.html?after=${after}`, signal);
        // The panel's Cancel is on screen (not just its frame attached).
        await waitFor(
          () =>
            s.page
              .frames()[1]
              ?.evaluate(
                () => document.readyState === "complete" && !!document.getElementById("cancel"),
              )
              .catch(() => false),
          { label: "panel" },
        );
        // Input reaches a new frame only once it has been painted: give it a moment.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await s.page.mouse.move(600, 500); // off the frame, so the executor's move enters it
        const run = await executor.run([click(at)], signal, gate);
        await new Promise((resolve) => setTimeout(resolve, 60));
        const gap = await s.page
          .frames()[1]
          ?.evaluate(() => (window as { __gap?: number }).__gap)
          .catch(() => undefined);
        return { run, reached: await clicked(s), gap };
      };
      const gaps: number[] = [];
      while (gaps.length < 3) {
        const { gap } = await attempt(60_000);
        if (gap !== undefined) gaps.push(gap);
      }
      const gap = gaps.sort((a, b) => a - b)[1]!;
      // The new site's document commits well after its navigation starts (about a third of the
      // way into the gap in the slot): aim the commit at the moment just before the press.
      const fractions = [0.22, 0.26, 0.28, 0.3, 0.32, 0.34, 0.36, 0.38, 0.4, 0.44];
      const hits = { cancel: 0, delete: 0, refused: 0 };
      for (let i = 0; i < tries; i++) {
        const { run, reached } = await attempt(Math.round(gap * fractions[i % fractions.length]!));
        if (run.notes.length > 0) hits.refused += 1;
        if (reached === "cancel" || reached === "delete") hits[reached] += 1;
      }
      console.info(JSON.stringify({ metric: "swapped_frame_clicks", approval, gap, ...hits }));
      expect(hits.delete).toBe(0);
    },
  );

  it("on a host too slow to arm the guard in time, a person-approved click is refused, not pressed unguarded: 0/10 reach Delete", async () => {
    const { s, executor } = await setup();
    // A loaded host: the arm's CDP round trips on the page's session take longer than the budget,
    // so its frame hold and new-document script land only after the guard settled (incomplete).
    const cdp = (await s.worlds()).cdp;
    const send = cdp.send.bind(cdp) as (method: string, params?: object) => Promise<unknown>;
    (cdp as { send: typeof send }).send = async (method, params) => {
      if (method === "Page.addScriptToEvaluateOnNewDocument" || method === "Target.setAutoAttach")
        await new Promise((resolve) => setTimeout(resolve, ARM_BUDGET_MS * 0.6));
      return send(method, params);
    };
    // ...and the panel swaps to another site's Delete in the gap before the press lands (on a
    // loaded host that gap is tens of milliseconds wide).
    let swapOnPress = false;
    const down = s.page.mouse.down.bind(s.page.mouse);
    s.page.mouse.down = async (options) => {
      if (swapOnPress) {
        swapOnPress = false;
        await s.page.evaluate((url) => {
          (document.getElementById("panel") as HTMLIFrameElement).src = url;
        }, "http://other.fixtures-isolated.test/widget.html?only=delete");
        await waitFor(
          () =>
            s.page
              .frames()[1]
              ?.evaluate(
                () => document.readyState === "complete" && !!document.getElementById("delete"),
              )
              .catch(() => false),
          { label: "swapped" },
        );
        await new Promise((resolve) => setTimeout(resolve, 300)); // painted
      }
      return down(options);
    };
    const hits = { cancel: 0, delete: 0, refused: 0 };
    for (let i = 0; i < 10; i++) {
      await s.goto(`${SITE}/frame-swap.html`, signal);
      await waitFor(
        () =>
          s.page
            .frames()[1]
            ?.evaluate(
              () => document.readyState === "complete" && !!document.getElementById("cancel"),
            )
            .catch(() => false),
        { label: "panel" },
      );
      await new Promise((resolve) => setTimeout(resolve, 300)); // painted
      // A person approved Cancel (the loop's gate binds the approval to that element).
      const gate = async () => {
        const target = markUnguarded(s, (await hitTest(s, at)).target);
        if (target?.label !== "Cancel") return false;
        swapOnPress = true;
        return { target, personApproved: true };
      };
      const run = await executor.run([click(at)], signal, gate);
      if (run.notes.includes(PAGE_SETTLING_REFUSAL)) hits.refused += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      const reached = await clicked(s);
      if (reached === "cancel" || reached === "delete") hits[reached] += 1;
    }
    console.info(JSON.stringify({ metric: "slow_arm_approved_clicks", ...hits }));
    expect(hits).toEqual({ cancel: 0, delete: 0, refused: 10 });
  });

  it("a frame whose move to another site commits late is still pending when an approved click runs: 0/5 reach Delete", async () => {
    const { s, executor } = await setup();
    // The other site's renderer is kept busy 1.5 s, so the panel's Delete document commits late;
    // on a loaded host the press can land after it (here: 1.8 s after the last check).
    const down = s.page.mouse.down.bind(s.page.mouse);
    s.page.mouse.down = async (options) => {
      await new Promise((resolve) => setTimeout(resolve, 1_800));
      return down(options);
    };
    const panel = () => s.page.frames().find((frame) => frame.url().includes("widget.html"));
    const hits = { cancel: 0, delete: 0, refused: 0 };
    for (let i = 0; i < 5; i++) {
      await s.goto(`${SITE}/frame-swap.html?after=0&busy=1500`, signal);
      await waitFor(
        () =>
          panel()
            ?.evaluate(
              () => document.readyState === "complete" && !!document.getElementById("cancel"),
            )
            .catch(() => false),
        { label: "panel" },
      );
      await new Promise((resolve) => setTimeout(resolve, 300)); // painted
      await s.page.mouse.move(600, 500); // off the panel, so the executor's move enters it
      // A person approved Cancel (the loop's gate binds the approval to that element).
      const gate = async () => {
        const target = markUnguarded(s, (await hitTest(s, at)).target);
        return target?.label === "Cancel" ? { target, personApproved: true } : false;
      };
      const run = await executor.run([click(at)], signal, gate);
      if (run.executed === 1 && run.notes.length > 0) hits.refused += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_800)); // past the late commit
      const reached = await clicked(s);
      if (reached === "cancel" || reached === "delete") hits[reached] += 1;
    }
    console.info(JSON.stringify({ metric: "late_commit_approved_clicks", ...hits }));
    expect(hits).toEqual({ cancel: 0, delete: 0, refused: 5 });
  });

  it.each([
    ["src", "unapproved"],
    ["src", "person-approved"],
    ["reload", "unapproved"],
    ["reload", "person-approved"],
    ["back", "unapproved"],
    ["back", "person-approved"],
    // The frame's own live document makes a same-document move to its URL while it reloads.
    ["reload+replaceState", "unapproved"],
    ["reload+replaceState", "person-approved"],
    ["reload+hash", "unapproved"],
    ["reload+hash", "person-approved"],
  ] as const)(
    "refuses a click while a frame's navigation to another site is under way (%s, %s): 30/30",
    async (trigger, approval) => {
      const { s, executor } = await setup();
      const DELETE = "http://other.fixtures-isolated.test/widget.html?only=delete";
      const PANEL = `${SITE}/widget.html?gap`;
      // The other site's page is held back 2 s, so the navigation is pending when the click runs.
      // reload: the panel's own reload is held back, then redirected to the other site.
      let hold = false;
      await s.page.route("http://other.fixtures-isolated.test/**", async (route) => {
        if (hold) await new Promise((resolve) => setTimeout(resolve, 2_000));
        await route.fallback();
      });
      await s.page.route(PANEL, async (route) => {
        if (!hold) return route.fallback();
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await route.fulfill({ status: 302, headers: { location: DELETE } });
      });
      const panelReady = () =>
        waitFor(
          () =>
            s.page
              .frames()[1]
              ?.evaluate(
                () => document.readyState === "complete" && !!document.getElementById("cancel"),
              )
              .catch(() => false),
          { label: "panel" },
        );
      const hits = { cancel: 0, delete: 0, refused: 0 };
      for (let i = 0; i < 30; i++) {
        hold = false;
        await s.goto(`${SITE}/frame-swap.html`, signal);
        await panelReady();
        if (trigger === "back") {
          // Two entries in the panel: the other site's page, then Cancel again.
          await s.page.evaluate((url) => {
            (document.getElementById("panel") as HTMLIFrameElement).src = url;
          }, DELETE);
          await waitFor(() => s.page.frames()[1]?.url().includes("only=delete"), {
            label: "other",
          });
          await s.page.evaluate((url) => {
            (document.getElementById("panel") as HTMLIFrameElement).src = url;
          }, PANEL);
          await panelReady();
        }
        await new Promise((resolve) => setTimeout(resolve, 300)); // painted
        hold = true;
        await s.page.evaluate(
          ({ trigger, url }) => {
            const panel = document.getElementById("panel") as HTMLIFrameElement;
            if (trigger === "src") panel.src = url;
            else if (trigger === "back") history.back();
            else panel.contentWindow!.location.reload();
          },
          { trigger, url: DELETE },
        );
        await new Promise((resolve) => setTimeout(resolve, 150)); // the request is out
        if (trigger !== "src" && trigger !== "reload" && trigger !== "back")
          await s.page.evaluate((move) => {
            const inner = (document.getElementById("panel") as HTMLIFrameElement).contentWindow!;
            if (move === "reload+hash") inner.location.hash = "moved";
            else inner.history.replaceState(null, "", inner.location.href);
          }, trigger);
        const { target } = await hitTest(s, at);
        expect(target?.label).toBe("Cancel"); // still the old page
        const verdict =
          approval === "person-approved"
            ? { target: markUnguarded(s, target), personApproved: true }
            : { target, personApproved: false };
        const run = await executor.run([click(at)], signal, async () => verdict);
        // Refused: what is under the pointer moved, or the page could not be guarded.
        if (run.executed === 1 && run.notes.length > 0) hits.refused += 1;
        await new Promise((resolve) => setTimeout(resolve, 60));
        const reached = await clicked(s);
        if (reached === "cancel" || reached === "delete") hits[reached] += 1;
      }
      await s.page.unrouteAll({ behavior: "ignoreErrors" });
      console.info(
        JSON.stringify({ metric: "pending_navigation_clicks", trigger, approval, ...hits }),
      );
      // Nothing is pressed while the navigation is in flight: no click lands, on either page.
      // (A refusal is reported; rarely the press is cancelled in the page without a note.)
      expect(hits).toMatchObject({ cancel: 0, delete: 0 });
      expect(hits.refused).toBeGreaterThanOrEqual(28);
    },
    240_000,
  );

  it("tracks a new tab's frame navigation from the moment the tab opens, before it is adopted (I1-b)", async () => {
    const { s, executor } = await setup();
    // The new tab's frame (another site) is held 6 s; its slow script holds DOMContentLoaded 2 s.
    await s.context.route("http://other.fixtures-isolated.test/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      await route.fallback();
    });
    await s.context.route(`${SITE}/slow.js`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fulfill({ contentType: "text/javascript", body: "void 0;" });
    });
    await s.goto(`${SITE}/popup-frame.html?open`, signal);
    const opener = s.page;
    const link = { x: 100, y: 320 };
    await executor.run([click(link)], signal, async () => ({
      target: (await hitTest(s, link)).target,
      personApproved: false,
    }));
    await s.pendingAdoption();
    expect(s.page).not.toBe(opener);
    // Adopted after its DOMContentLoaded (2 s); the frame's navigation began before that.
    expect(s.navigationPending()).toBe(true);
    await s.context.unrouteAll({ behavior: "ignoreErrors" });
  });

  it("a page whose frames are not navigating stays clickable (30/30)", async () => {
    const { s, executor } = await setup();
    let cancels = 0;
    for (let i = 0; i < 30; i++) {
      await s.goto(`${SITE}/frame-swap.html`, signal);
      await waitFor(
        () =>
          s.page
            .frames()[1]
            ?.evaluate(
              () => document.readyState === "complete" && !!document.getElementById("cancel"),
            )
            .catch(() => false),
        { label: "panel" },
      );
      await new Promise((resolve) => setTimeout(resolve, 300)); // painted
      const { target } = await hitTest(s, at);
      const run = await executor.run([click(at)], signal, async () => ({
        target,
        personApproved: false,
      }));
      expect(run.notes).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 60));
      if ((await clicked(s)) === "cancel") cancels += 1;
    }
    expect(cancels).toBe(30);
  });

  it.each([15, 4])(
    "a page with more documents than the guard arms refuses the click: 0/60 reach Delete (swap every %i ms)",
    async (period) => {
      const { s, executor } = await setup(`/widget.html?frames=70&swap=${period}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const hits = { cancel: 0, delete: 0, refused: 0 };
      for (let i = 0; i < 60; i++) {
        const run = await executor.run([click(at)], signal, cancelGate(s));
        if (run.executed === 1 && run.notes.length > 0) hits.refused += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        const reached = await clicked(s);
        if (reached === "cancel" || reached === "delete") hits[reached] += 1;
      }
      console.info(JSON.stringify({ metric: "many_documents_clicks", period, ...hits }));
      // Fail closed: no click runs unguarded, not even on Cancel.
      expect(hits).toEqual({ cancel: 0, delete: 0, refused: expect.any(Number) });
    },
  );

  it("on a page with more documents than the guard arms, even an approved click is not run: the user is asked to take over (0/60)", async () => {
    const { s, executor } = await setup("/widget.html?frames=70&swap=15");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const hits = { cancel: 0, delete: 0, handedOver: 0 };
    for (let i = 0; i < 60; i++) {
      // A person approved Cancel (the loop's gate binds the approval to that element).
      const gate = async () => {
        const target = markUnguarded(s, (await hitTest(s, at)).target);
        return target?.label === "Cancel" ? { target, personApproved: true } : false;
      };
      const run = await executor.run([click(at)], signal, gate);
      if (run.handOver === PAGE_TOO_COMPLEX && run.notes.includes(PAGE_TOO_COMPLEX_REFUSAL))
        hits.handedOver += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const reached = await clicked(s);
      if (reached === "cancel" || reached === "delete") hits[reached] += 1;
    }
    console.info(JSON.stringify({ metric: "many_documents_approved_clicks", ...hits }));
    expect(hits).toEqual({ cancel: 0, delete: 0, handedOver: expect.any(Number) });
    expect(hits.handedOver).toBeGreaterThan(0);
  });

  it("a page with lazily loaded cross-site frames still works, and no frame stays paused", async () => {
    const { s, executor } = await setup("/lazy-frames.html");
    const gated = async (action: ComputerAction) => ({
      target:
        action.type === "click" ? (await hitTest(s, { x: action.x, y: action.y })).target : null,
      personApproved: false,
    });
    // A click that adds a cross-site embed while it is guarded: the embed still loads.
    expect(await executor.run([click({ x: 80, y: 20 })], signal, gated)).toEqual({
      executed: 1,
      notes: [],
      effects: ["input"],
      targets: [{ label: expect.any(String), ancestors: expect.any(Array) }],
      handOver: null,
    });
    expect(await text(s, "#count")).toBe("1");
    // Scroll the lazy embeds in, then click Cancel inside one (out of process).
    await executor.execute({ type: "scroll", x: 300, y: 300, scroll_x: 0, scroll_y: 600 }, signal);
    await waitFor(
      async () => {
        const urls = s.page.frames().map((frame) => frame.url());
        return urls.filter((url) => url.includes("widget.html")).length >= 3;
      },
      { label: "lazy embeds attached", timeoutMs: 10_000 },
    );
    const embed = s.page.frameLocator('iframe[title="Embed 1"]');
    const box = (await embed.locator("#cancel").boundingBox())!;
    const cancel = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    const run = await executor.run([click(cancel)], signal, gated);
    expect(run).toEqual({
      executed: 1,
      notes: [],
      effects: ["input"],
      targets: [{ label: expect.any(String), ancestors: expect.any(Array) }],
      handOver: null,
    });
    expect(
      await embed.locator("#cancel").evaluate(() => (window as { __clicked?: string }).__clicked),
    ).toBe("cancel");
    // Every frame runs script (none is left paused), well within a second.
    for (const frame of s.page.frames()) {
      const state = await Promise.race([
        frame.evaluate(() => document.readyState).catch(() => "detached"),
        new Promise((resolve) => setTimeout(() => resolve("paused"), 1_000)),
      ]);
      expect([frame.url(), state]).toEqual([
        frame.url(),
        expect.stringMatching(/complete|interactive|detached/),
      ]);
    }
  });

  it("ordinary pages still click normally: a form, a link, an SPA and a page with a few frames", async () => {
    const { s, executor } = await setup();
    const centre = async (locator: Locator) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error("not visible");
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    };
    /** One click through a gate that, like the loop's, holds it to its classification. */
    const gatedClick = async (locator: Locator) => {
      const at = await centre(locator);
      const run = await executor.run([click(at)], signal, async () => ({
        target: (await hitTest(s, at)).target,
        personApproved: false,
      }));
      expect(run).toEqual({
        executed: 1,
        notes: [],
        effects: ["input"],
        targets: [{ label: expect.any(String), ancestors: expect.any(Array) }],
        handOver: null,
      });
    };
    // interactive.html (one frame): a button, a form's submit button, the frame's button, a link.
    await gatedClick(s.page.locator("#inc"));
    expect(await text(s, "#count")).toBe("1");
    await gatedClick(s.page.locator("#search button"));
    expect(await text(s, "#searched")).toBe("searched");
    await gatedClick(s.page.frameLocator("#frame").locator("button"));
    expect(await s.page.evaluate(() => (window as { __frameClicks?: number }).__frameClicks)).toBe(
      1,
    );
    await gatedClick(s.page.getByText("Go to page two"));
    expect(s.page.url()).toBe(`${SITE}/page2`);
    // An SPA: the nav re-renders the view and pushes a URL; a click that embeds a frame is fine.
    await s.goto(`${SITE}/spa.html`, signal);
    await gatedClick(s.page.locator("#lessons"));
    expect(s.page.url()).toBe(`${SITE}/spa.html?route=lessons`);
    await gatedClick(s.page.locator("#play"));
    await gatedClick(s.page.frameLocator("#player").locator("button"));
    expect(await s.page.evaluate(() => (window as { __played?: boolean }).__played)).toBe(true);
    // A page with a few frames: same-site other-origin in process, and another site out of process.
    await s.goto(`${SITE}/frame-host.html`, signal);
    for (const id of ["inproc", "oopif"]) {
      const frame = s.page.frameLocator(`#${id}`);
      await gatedClick(frame.locator("#delete"));
      expect(
        await frame
          .locator("#delete")
          .evaluate(() => (window as { __deleted?: boolean }).__deleted),
      ).toBe(true);
    }
  });
});

describe("ComputerExecutor with frames navigating away from the point (ruling 3)", () => {
  /** loading-frames.html: Continue spans x 0–200, y 50–90; this point is 4 px from its right edge. */
  const edge = { x: 196, y: 70 };
  const centre = { x: 100, y: 70 };
  /** Holds every slow page's request (`?loading`, `?held`) until the test ends. */
  async function holdSlowPages(s: BrowserSession) {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await s.page.route(
      (url) => /[?&](loading|held)\b/.test(url.search),
      async (route) => {
        await Promise.race([held, new Promise((resolve) => setTimeout(resolve, 20_000))]);
        await route.fallback().catch(() => undefined);
      },
    );
    return release;
  }
  async function loadingPage(query: string, page = "loading-frames.html") {
    const { s, executor } = await setup();
    const release = await holdSlowPages(s);
    await s.goto(`${SITE}/${page}?${query}`, signal);
    await new Promise((resolve) => setTimeout(resolve, 300)); // the frames' requests are out
    expect(s.navigationPending()).toBe(true);
    return { s, executor, release };
  }
  const verdict = async (s: BrowserSession, at: { x: number; y: number }, approved: boolean) => ({
    target: markUnguarded(s, (await hitTest(s, at)).target),
    personApproved: approved,
  });
  const clickedGo = (s: BrowserSession) =>
    s.page.evaluate(() => {
      const holder = window as { __clicked?: string };
      const value = holder.__clicked;
      holder.__clicked = undefined;
      return value;
    });

  it.each([false, true])(
    "still-loading frames away from the button do not hold the click back (approved: %s): 5/5 clicked",
    async (approved) => {
      const { s, executor, release } = await loadingPage("ads=3");
      for (let i = 0; i < 5; i++) {
        expect(
          await executor.execute(click(centre), signal, await verdict(s, centre, approved)),
        ).toBeNull();
        expect(await clickedGo(s)).toBe("go");
      }
      expect(s.navigationPending()).toBe(true); // they were loading all along
      release();
    },
  );

  it.each([false, true])(
    "a loading frame 4 px from the point refuses the click (approved: %s)",
    async (approved) => {
      const { s, executor, release } = await loadingPage("near");
      expect(await executor.execute(click(edge), signal, await verdict(s, edge, approved))).toBe(
        PAGE_SETTLING_REFUSAL,
      );
      expect(await clickedGo(s)).toBeUndefined();
      release();
    },
  );

  it("a loading frame that grows next to the point between the checks and the press refuses the click: 5/5", async () => {
    let refused = 0;
    for (let i = 0; i < 5; i++) {
      // 50 ms after the pointer enters Continue, the far frame grows to end 4 px from the point.
      const { s, executor, release } = await loadingPage("grow=50");
      // The arm's round trips take 60 ms each (well within the budget), so the growth lands after
      // the first checks (the settle wait and the hit test) and before the press.
      const cdp = (await s.worlds()).cdp;
      const send = cdp.send.bind(cdp) as (method: string, params?: object) => Promise<unknown>;
      (cdp as { send: typeof send }).send = async (method, params) => {
        if (method === "Page.addScriptToEvaluateOnNewDocument" || method === "Target.setAutoAttach")
          await new Promise((resolve) => setTimeout(resolve, 60));
        return send(method, params);
      };
      await s.page.mouse.move(600, 200); // off Continue, so the executor's move enters it
      const note = await executor.execute(click(edge), signal, await verdict(s, edge, false));
      if (note === TARGET_MOVED_REFUSAL && (await clickedGo(s)) === undefined) refused += 1;
      release();
      await session?.close();
      session = undefined;
    }
    expect(refused).toBe(5);
  });

  it.each([false, true])(
    "a main-frame navigation refuses the click wherever it is (approved: %s)",
    async (approved) => {
      const { s, executor } = await setup();
      const release = await holdSlowPages(s);
      await s.goto(`${SITE}/loading-frames.html?leave`, signal);
      await s.page.mouse.move(600, 200); // off Continue, so the executor's move enters it
      // Refused while it is seen in the settle wait, or else at the press.
      expect([PAGE_SETTLING_REFUSAL, TARGET_MOVED_REFUSAL]).toContain(
        await executor.execute(click(centre), signal, await verdict(s, centre, approved)),
      );
      expect(await clickedGo(s)).toBeUndefined();
      release();
    },
  );

  it("a main-frame navigation that starts after the settle wait is still caught at the press (T1)", async () => {
    const { s, executor } = await setup();
    const release = await holdSlowPages(s);
    await s.goto(`${SITE}/loading-frames.html`, signal);
    // During the guard's last round trips before the press (the page-changed flush), the page
    // navigates itself (held): only the press-time check can see it.
    const worlds = await s.worlds();
    const evaluate = worlds.evaluate.bind(worlds);
    let started = false;
    (worlds as { evaluate: typeof evaluate }).evaluate = (async (
      ...args: Parameters<typeof evaluate>
    ) => {
      if (!started && String(args[0]).replace(/\s/g, "") === "()=>0") {
        started = true;
        await s.page.evaluate(() => {
          setTimeout(() => (location.href = "/interactive.html?held"));
        });
        await new Promise((resolve) => setTimeout(resolve, 100)); // its start is reported
      }
      return evaluate(...args);
    }) as typeof evaluate;
    await s.page.mouse.move(600, 200);
    expect(await executor.execute(click(centre), signal, await verdict(s, centre, false))).toBe(
      TARGET_MOVED_REFUSAL,
    );
    expect(started).toBe(true); // refused before any press (the page itself is held)
    release();
  });

  it.each([
    ["near", PAGE_SETTLING_REFUSAL],
    ["far", null],
  ] as const)(
    "a frame nested in a bordered cross-site frame, navigating since load (%s): T2",
    async (at, expected) => {
      // The cross-site frame has a 300 px top border, so its content (where the nested frame
      // is) lies 300 px below its border box's top left.
      const { s, executor, release } = await loadingPage(
        `at=${at}&border=300&inner=child`,
        "nested-frames.html",
      );
      const note = await executor.execute(click(edge), signal, await verdict(s, edge, false));
      expect(note).toBe(expected);
      expect(await clickedGo(s)).toBe(expected === null ? "go" : undefined);
      release();
    },
  );

  it.each([
    ["near", PAGE_SETTLING_REFUSAL],
    ["far", null],
  ] as const)("a navigation inside an existing cross-site frame (%s): T3", async (at, expected) => {
    const { s, executor, release } = await loadingPage(
      `at=${at}&inner=leave`,
      "nested-frames.html",
    );
    expect(await executor.execute(click(edge), signal, await verdict(s, edge, true))).toBe(
      expected,
    );
    expect(await clickedGo(s)).toBe(expected === null ? "go" : undefined);
    release();
  });

  it("a navigating frame whose box cannot be read in time fails closed, within the bounded wait (T4)", async () => {
    // A loading frame far from the point, but reading any frame box takes 300 ms (over the 250 ms
    // check budget): it counts as near, and the click is refused once the settle wait is over.
    const { s, executor, release } = await loadingPage("ads=1");
    const cdp = (await s.worlds()).cdp;
    const send = cdp.send.bind(cdp) as (method: string, params?: object) => Promise<unknown>;
    (cdp as { send: typeof send }).send = async (method, params) => {
      if (method === "DOM.getBoxModel") await new Promise((resolve) => setTimeout(resolve, 300));
      return send(method, params);
    };
    const started = Date.now();
    expect(await executor.execute(click(centre), signal, await verdict(s, centre, false))).toBe(
      PAGE_SETTLING_REFUSAL,
    );
    const waited = Date.now() - started;
    console.info(JSON.stringify({ metric: "unreadable_box_refusal_ms", waited }));
    expect(waited).toBeLessThan(1_500);
    expect(await clickedGo(s)).toBeUndefined();
    release();
  });

  /** Starts a navigation of the page itself to a page whose answer the test holds back. */
  const leaveForHeldPage = (s: BrowserSession) =>
    s.page.evaluate(() => {
      setTimeout(() => (location.href = "/interactive.html?held"));
    });

  it("a click while the page's own document waits on a navigation that never answers is refused promptly, not stalled", async () => {
    const { s, executor } = await setup();
    const release = await holdSlowPages(s);
    await s.goto(`${SITE}/loading-frames.html`, signal);
    await leaveForHeldPage(s);
    await new Promise((resolve) => setTimeout(resolve, 300)); // under way (Chromium now answers nothing about the page)
    const started = Date.now();
    expect(await executor.execute(click(centre), signal)).toBe(PAGE_SETTLING_REFUSAL);
    expect(Date.now() - started).toBeLessThan(2_000);
    release();
  });

  it("a navigation that never answers does not stall the agent: settling stops it, and the page answers and clicks again", async () => {
    const { s, executor } = await setup();
    const release = await holdSlowPages(s);
    await s.goto(`${SITE}/loading-frames.html`, signal);
    await leaveForHeldPage(s);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    await settle(s, signal, { navigationTimeoutMs: 1_000 });
    const shot = await captureModelScreenshot(s, NO_MASK_SOURCES, signal);
    const elapsed = Date.now() - started;
    console.info(JSON.stringify({ metric: "stuck_navigation_settle_ms", elapsed }));
    expect(elapsed).toBeLessThan(8_000);
    expect(shot.png.length).toBeGreaterThan(0);
    expect(s.page.url()).toContain("loading-frames.html"); // the old document stayed
    expect(await executor.execute(click(centre), signal)).toBeNull();
    expect(await clickedGo(s)).toBe("go");
    release();
  });
});

describe("what a click records for grading (bench I1, I3)", () => {
  it("records expanding a disclosure as disclosure, not page input", async () => {
    const { s, executor } = await setup("/long-toc.html");
    const run = await executor.run([click(await point(s, "Chapter 9"))], signal);
    expect(run.effects).toEqual(["disclosure"]);
    expect(await s.page.locator("#ch9").getAttribute("open")).not.toBeNull();
  });
  it("records each input's label and the opening text of its enclosing elements, innermost first", async () => {
    const { s, executor } = await setup("/activity.html");
    const run = await executor.run([click(await point(s, "False"))], signal);
    expect(run.effects).toEqual(["input"]);
    const target = run.targets[0]!;
    expect(target.label).toBe("False");
    expect(target.ancestors[0]).toMatch(/^2\) Is grass red\? True False/);
    expect(
      target.ancestors.some((a) => a.startsWith("PARTICIPATION ACTIVITY 1.1.1: Warm-up")),
    ).toBe(true);
  });
});
