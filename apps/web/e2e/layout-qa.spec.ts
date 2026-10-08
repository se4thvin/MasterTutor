import { recordedEvents } from "../lib/fixtures/run-recording.ts";
import { findLayoutIssues } from "./helpers/layout-qa.ts";
import { emit, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

test.describe("layout detector self-test", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "runs once");

  test("flags every class of defect", async ({ page }) => {
    await page.setContent(`
      <div style="width:3000px">wide</div>
      <div style="width:100px;overflow:hidden"><span style="display:inline-block;width:150px">clipped box</span></div>
      <div style="width:60px;white-space:nowrap">text that spills</div>
      <span data-qa-single-line style="display:inline-block;width:40px">two words here</span>
      <div data-qa-avoid style="position:absolute;top:0;left:0;width:50px;height:50px">a</div>
      <div data-qa-obstacle style="position:absolute;top:10px;left:10px;width:50px;height:50px">b</div>`);
    const issues = (await findLayoutIssues(page)).join("\n");
    expect(issues).toContain("page scrolls sideways");
    expect(issues).toContain("clipped by");
    expect(issues).toContain("text overflows its box");
    expect(issues).toContain("wraps onto a second line");
    expect(issues).toContain("overlaps");
  });

  test("accepts ellipsis, scroll containers and opted-out clips", async ({ page }) => {
    await page.setContent(`
      <div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>truncated label text</b></div>
      <div style="width:80px;overflow:auto"><div style="width:300px">scrolls</div></div>
      <div data-qa-allow-clip style="width:40px;overflow:hidden"><div style="width:90px">mask</div></div>`);
    expect(await findLayoutIssues(page)).toEqual([]);
  });

  test("ignores a closed <details> body but checks it once open", async ({ page }) => {
    const html = (open: boolean) => `
      <div style="width:120px;height:60px;overflow:hidden">
        <details${open ? " open" : ""}><summary>Show data</summary>
          <div style="width:300px;height:400px">wide table</div>
        </details>
      </div>`;
    await page.setContent(html(false));
    expect(await findLayoutIssues(page)).toEqual([]);
    await page.setContent(html(true));
    expect((await findLayoutIssues(page)).join("\n")).toContain("clipped by");
  });

  test("accepts the visually-hidden pattern but not a small clipped box", async ({ page }) => {
    await page.setContent(`
      <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">screen reader text</span>
      <span style="position:absolute;top:40px;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap">more hidden text</span>`);
    expect(await findLayoutIssues(page)).toEqual([]);
    await page.setContent(
      `<div style="width:60px;height:20px;overflow:hidden;white-space:nowrap">long text that is cut off</div>`,
    );
    expect((await findLayoutIssues(page)).join("\n")).toContain("text clipped by its own box");
  });

  test("an ellipsis label inside a clipping box is its box, not its full text (fe-typography)", async ({
    page,
  }) => {
    const label = `<span style="display:block;width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">a long label that is truncated</span>`;
    await page.setContent(`<div style="width:120px;overflow:hidden">${label}</div>`);
    expect(await findLayoutIssues(page)).toEqual([]);
    // The label's own box still counts: one wider than the clipping box is flagged.
    await page.setContent(
      `<div style="width:60px;overflow:hidden">${label.replace("width:80px", "width:200px")}</div>`,
    );
    expect((await findLayoutIssues(page)).join("\n")).toContain("text clipped by its own box");
  });

  test("flags text clipped by its own overflow:hidden box", async ({ page }) => {
    await page.setContent(
      `<div style="width:60px;overflow:hidden;white-space:nowrap">long text that is cut off</div>`,
    );
    expect((await findLayoutIssues(page)).join("\n")).toContain("text clipped by its own box");
  });

  test("ellipsis exempts only text, not other clipped content", async ({ page }) => {
    await page.setContent(`
      <div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">
        <span style="display:inline-block;width:200px;height:10px;background:red"><svg width="200" height="10"></svg></span>
      </div>`);
    expect((await findLayoutIssues(page)).join("\n")).toContain("clipped by");
  });

  test("ignores ::after hit-area overflow and hidden Base UI inputs", async ({ page }) => {
    await page.setContent(`
      <style>.hit{position:relative;white-space:nowrap}.hit::after{content:"";position:absolute;inset:-0.25rem}</style>
      <button class="hit" style="width:80px;padding:0">Save note</button>
      <div style="width:60px;height:24px;overflow:hidden"><input aria-hidden="true" style="position:absolute;width:200px;opacity:0.01" /></div>`);
    expect(await findLayoutIssues(page)).toEqual([]);
  });

  test("a fixed box is clipped only from its containing block up (final M1)", async ({ page }) => {
    // No ancestor holds it: it is laid out against the screen and painted whole.
    await page.setContent(`
      <div style="width:300px;height:200px;overflow:hidden">
        <div style="position:fixed;left:0;bottom:0;width:400px;height:300px">sheet</div>
      </div>`);
    expect(await findLayoutIssues(page)).toEqual([]);
    // A transformed ancestor holds it; the clipping box above that one does clip it.
    await page.setContent(`
      <div style="width:200px;height:100px;overflow:hidden">
        <div style="transform:translateZ(0)">
          <div style="position:fixed;top:150px;left:0">Lost text</div>
        </div>
      </div>`);
    expect((await findLayoutIssues(page)).join("\n")).toContain("clipped by");
    // A size container is a containing block too (layout containment).
    await page.setContent(`
      <div style="width:200px;height:100px;overflow:hidden;container-type:size">
        <div style="position:fixed;top:150px;left:0">Lost text</div>
      </div>`);
    expect((await findLayoutIssues(page)).join("\n")).toContain("clipped by");
  });
});

test.describe("layout detector: 44px targets, struck-out words, run-view obstacles (Phase 8)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "runs once");

  test("flags a target under 44px only when asked, and counts the ::after hit area", async ({
    page,
  }) => {
    await page.setContent(`
      <style>.hit{position:relative}.hit::after{content:"";position:absolute;inset:-0.25rem}</style>
      <button style="width:30px;height:30px;padding:0">x</button>
      <button class="hit" style="width:120px;height:36px;padding:0;border:0">Save note</button>`);
    expect(await findLayoutIssues(page)).toEqual([]);
    const issues = await findLayoutIssues(page, { minTargetPx: 44 });
    expect(issues.filter((i) => i.startsWith("target smaller than 44px"))).toHaveLength(1);
    expect(issues.join("\n")).toContain("(30×30)");
  });

  test("exempts inline links in running text, disabled controls and label-wrapped inputs", async ({
    page,
  }) => {
    await page.setContent(`
      <p style="width:300px">Read <a href="#">more</a> here.</p>
      <button disabled style="width:20px;height:20px;padding:0">x</button>
      <label style="display:inline-flex;align-items:center;min-height:44px;padding:0 8px">
        <input type="checkbox" style="width:16px;height:16px"> Remember me
      </label>`);
    expect(await findLayoutIssues(page, { minTargetPx: 44 })).toEqual([]);
  });

  test("a struck-out word that wraps is flagged without opting in; nowrap fixes it (D22)", async ({
    page,
  }) => {
    await page.setContent(`<p style="width:40px">You → Browser · <s>the model</s></p>`);
    expect((await findLayoutIssues(page)).join("\n")).toContain("wraps onto a second line");
    await page.setContent(
      `<p style="width:40px">You → Browser · <s style="white-space:nowrap">the model</s></p>`,
    );
    expect(await findLayoutIssues(page)).toEqual([]);
  });

  test("[data-qa-allow-clip] exempts clipping only: targets and struck-out words are still checked (I1)", async ({
    page,
  }) => {
    await page.setContent(`
      <div data-qa-allow-clip style="width:40px;overflow:hidden">
        <button style="width:30px;height:30px;padding:0">x</button>
        <p style="width:40px">You <s>the model</s></p>
      </div>`);
    const issues = (await findLayoutIssues(page, { minTargetPx: 44 })).join("\n");
    expect(issues).toContain("target smaller than 44px (30×30)");
    expect(issues).toContain("wraps onto a second line");
    expect(issues).not.toContain("clipped by");
  });

  test("ellipsis exempts text, not a clipped control (isTextOnly sees the element itself)", async ({
    page,
  }) => {
    await page.setContent(`
      <div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">
        <button style="width:200px">A long button label</button>
      </div>`);
    expect((await findLayoutIssues(page)).join("\n")).toContain("clipped by");
  });

  test("the run callout and leader avoid the timeline, and the rule bites when they meet (P8-5)", async ({
    page,
  }) => {
    await gotoRun(page);
    await emit(page, [recordedEvents()[0]!]);
    await expect(page.locator(".run-callout[data-qa-avoid]")).toBeVisible();
    await expect(page.locator(".run-leader[data-qa-avoid]")).toBeAttached();
    await expect(page.locator("aside.run-tl[data-qa-obstacle]")).toBeVisible();
    expect((await findLayoutIssues(page)).filter((i) => i.startsWith("overlaps"))).toEqual([]);
    await page.evaluate(() => {
      const callout = document.querySelector(".run-callout")!.getBoundingClientRect();
      const timeline = document.querySelector<HTMLElement>("aside.run-tl")!;
      Object.assign(timeline.style, {
        position: "fixed",
        left: `${callout.left}px`,
        top: `${callout.top}px`,
        width: "200px",
        height: "200px",
      });
    });
    expect((await findLayoutIssues(page)).join("\n")).toContain("overlaps");
  });
});
