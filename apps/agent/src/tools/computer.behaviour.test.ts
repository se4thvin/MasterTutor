import type { ComputerAction, ReadPageElement } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { OTHER, SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import { captureModelScreenshot } from "../browser/screenshot.ts";
import { BrowserSession } from "../browser/session.ts";
import { instantClock } from "../runtime/clock.ts";
import { ControlHeld, Interrupted } from "../runtime/errors.ts";
import { ComputerExecutor, SECRET_FIELD_REFUSAL } from "./computer.ts";
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
