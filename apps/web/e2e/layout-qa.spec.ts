import { findLayoutIssues } from "./helpers/layout-qa.ts";
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
