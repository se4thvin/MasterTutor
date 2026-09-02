import type { ReadPageElement } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import { captureModelScreenshot } from "../browser/screenshot.ts";
import { BrowserSession } from "../browser/session.ts";
import { readPage, resolveRef } from "./read-page.ts";

const log = createLogger({ service: "test", level: "silent" });
const signal = new AbortController().signal;
let session: BrowserSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function interactive(path = "/interactive.html") {
  session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP["browser-1"] ?? "",
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
  });
  await session.goto(`${SITE}${path}`, signal);
  await captureModelScreenshot(session, NO_MASK_SOURCES, signal);
  const result = await readPage(session, { mode: "interactive", sinceHash: null, offset: null });
  if (!("elements" in result)) throw new Error("expected elements");
  return { s: session, result, elements: result.elements };
}

/** Skips wrapping <label> entries so the labelled control (the input) is what resolves. */
const byName = (elements: readonly ReadPageElement[], name: string) => {
  const found = elements.find(
    (element) => element.tag !== "label" && element.name.startsWith(name),
  );
  if (!found) throw new Error(`no element named ${name}`);
  return found;
};

describe("read_page (spec §6, D20)", () => {
  it("keeps only allowlisted attributes and never exposes field values", async () => {
    const { elements } = await interactive();
    const attrs = byName(elements, "Attr test").attrs;
    expect(Object.keys(attrs).sort()).toEqual(["title"]);
    expect(JSON.stringify(elements)).not.toContain("s3cr3t");
    expect(JSON.stringify(elements)).not.toContain("onclick");
  });

  it("gives clickable points that hit the element, and null for off-screen elements", async () => {
    const { s, elements } = await interactive();
    const increment = byName(elements, "Increment");
    expect(increment.point).not.toBeNull();
    await s.page.mouse.click(increment.point!.x / s.lastScale, increment.point!.y / s.lastScale);
    expect(await s.page.locator("#count").textContent()).toBe("1");
    expect(byName(elements, "Far button").point).toBeNull();
  });

  it("reaches open shadow roots and same-origin iframes with page-level points", async () => {
    const { s, elements } = await interactive();
    const shadow = byName(elements, "Shadow button");
    const frame = byName(elements, "Frame button");
    await s.page.mouse.click(shadow.point!.x / s.lastScale, shadow.point!.y / s.lastScale);
    await s.page.mouse.click(frame.point!.x / s.lastScale, frame.point!.y / s.lastScale);
    expect(
      await s.page.evaluate(() => {
        const w = window as unknown as { __shadowClicks?: number; __frameClicks?: number };
        return [w.__shadowClicks, w.__frameClicks];
      }),
    ).toEqual([1, 1]);
  });

  it("marks state without leaking values, and refs resolve to DOM nodes", async () => {
    const { s, elements } = await interactive();
    await s.page.fill("#pw", "hunter2");
    await s.page.fill("#name", "Ada");
    const again = await readPage(s, { mode: "interactive", sinceHash: null, offset: null });
    if (!("elements" in again)) throw new Error("expected elements");
    // Both resolve to the <input>, not the wrapping <label>, so the checks are not vacuous.
    const name = byName(again.elements, "Name");
    const password = byName(again.elements, "Password");
    expect([name.tag, password.tag]).toEqual(["input", "input"]);
    expect(name.name).toContain("[filled]");
    expect(password.name).not.toContain("filled");
    expect(JSON.stringify(again)).not.toContain("hunter2");
    const ref = byName(elements, "Increment").ref;
    const resolved = await resolveRef(s, ref);
    expect(resolved.backendNodeId).toBeGreaterThan(0);
  });

  it("answers {unchanged:true} for an unchanged page and returns text mode", async () => {
    const { s, result } = await interactive();
    if (!("hash" in result)) throw new Error("expected hash");
    expect(
      await readPage(s, { mode: "interactive", sinceHash: result.hash, offset: null }),
    ).toEqual({
      unchanged: true,
    });
    await s.goto(`${SITE}/`, signal);
    const text = await readPage(s, { mode: "text", sinceHash: null, offset: null });
    expect("text" in text && text.text).toContain("Plants convert light into chemical energy.");
  });
});

describe("read_page review gaps (group C fix round)", () => {
  it("never leaks editable text as an element name", async () => {
    const { s, elements } = await interactive("/gaps.html");
    expect(JSON.stringify(elements)).not.toContain("s3cr3t");
    expect(
      JSON.stringify(await readPage(s, { mode: "interactive", sinceHash: null, offset: null })),
    ).not.toContain("s3cr3t");
    const editable = elements.find((element) => element.tag === "div" && element.name === "");
    expect(editable).toBeDefined();
  });

  it("drops a label only when its control is itself listed with a point", async () => {
    const wrapped = await interactive();
    expect(
      wrapped.elements.some(
        (element) => element.tag === "label" && element.name.startsWith("Name"),
      ),
    ).toBe(false);
    const gaps = await interactive("/gaps.html");
    const custom = gaps.elements.find(
      (element) => element.tag === "label" && element.name.startsWith("Custom check"),
    );
    expect(custom?.point).not.toBeNull();
    expect(
      gaps.elements.some((element) => element.tag === "input" && element.name.startsWith("Custom")),
    ).toBe(false);
  });

  it("lists cursor:pointer divs and elements that straddle the fold", async () => {
    const { s, elements } = await interactive("/gaps.html");
    const div = byName(elements, "Pointer div");
    expect(div.point).not.toBeNull();
    await s.page.mouse.click(div.point!.x / s.lastScale, div.point!.y / s.lastScale);
    expect(await s.page.locator("#cdiv-count").textContent()).toBe("1");
    // The span inside the pointer div is not listed separately.
    expect(elements.filter((element) => element.name.startsWith("Pointer div"))).toHaveLength(1);
    expect(byName(elements, "Fold button").point).not.toBeNull();
  });

  it("names wrappers around editable elements without the editable's content", async () => {
    const { s, elements } = await interactive("/gaps.html");
    const wrapped = elements.find((element) => element.name.startsWith("Wrapped label"));
    const pointer = elements.find((element) => element.name.startsWith("Pointer wrap"));
    expect(wrapped?.tag).toBe("label");
    expect(pointer?.tag).toBe("div");
    const dump = JSON.stringify(
      await readPage(s, { mode: "interactive", sinceHash: null, offset: null }),
    );
    expect(dump).not.toContain("w4rp");
    expect(dump).not.toContain("p4rp");
  });
});

describe("read_page past the element cap, and collapsed groups (bench I1)", () => {
  it("says how many elements the page has, and pages through them in document order", async () => {
    const { s, result } = await interactive("/long-toc.html");
    if (!("elements" in result)) throw new Error("expected elements");
    expect(result.elements).toHaveLength(400);
    expect(result.total).toBe(452);
    expect(result.offset).toBeUndefined();
    const rest = await readPage(s, { mode: "interactive", sinceHash: null, offset: 400 });
    if (!("elements" in rest)) throw new Error("expected elements");
    expect(rest).toMatchObject({ total: 452, offset: 400 });
    expect(rest.elements.map((e) => e.name)).toEqual(
      Array.from({ length: 52 }, (_, i) => `Link ${399 + i}`),
    );
  });
  it("marks collapsed disclosure controls, so a reader knows content is hidden", async () => {
    const { elements } = await interactive("/long-toc.html");
    expect(byName(elements, "Chapter 9").name).toBe("Chapter 9 [collapsed]");
    expect(byName(elements, "Chapter 10").name).toBe("Chapter 10 [collapsed]");
    expect(elements.some((e) => e.name.includes("Hidden section"))).toBe(false);
  });
});
