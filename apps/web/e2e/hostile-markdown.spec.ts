import { ids } from "../lib/fixtures/ids.ts";
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

/** Captured page content is untrusted (Review Focus 1). Every vector a hostile page could plant. */
const HOSTILE_PROSE = [
  "Script <script>window.__pwned = 'script'</script> inline.",
  "[click me](javascript:window.__pwned='link') and [data](data:text/html,<script>alert(1)</script>)",
  "![pixel](https://evil.example/pixel.png) ![inline](data:image/png;base64,iVBORw0KGgo=)",
  "<img src=x onerror=\"window.__pwned='img'\"> <svg onload=\"window.__pwned='svg'\"></svg>",
  '<iframe src="https://evil.example/frame"></iframe> <style>body{background:url(https://evil.example/css)}</style>',
  '<a href="https://evil.example/x" onclick="window.__pwned=\'click\'">styled</a>',
  "Math $\\href{javascript:window.__pwned='katex'}{x}$ and $\\url{https://evil.example/m}$",
].join("\n\n");

const HOSTILE_TABLE = [
  '<table onmouseover="window.__pwned=\'table\'" style="background:url(https://evil.example/t)">',
  '<tr><td style="background-image:url(https://evil.example/cell)"><script>window.__pwned="cell"</script>',
  '<img src="https://evil.example/table.png"><a href="javascript:window.__pwned=\'a\'">x</a>',
  '<link rel="stylesheet" href="https://evil.example/l.css"><form action="https://evil.example/f"><input name="q"></form>',
  "</td></tr></table>",
].join("");

test("hostile captured Markdown and HTML run nothing and fetch nothing", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const thirdParty: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).hostname.endsWith("evil.example")) thirdParty.push(r.url());
  });
  await page.route("**/api/rpc/notes/get", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      json: { blocks: Array<{ type: string; markdown: string }> };
    };
    const prose = body.json.blocks.find((b) => b.type === "paragraph");
    const table = body.json.blocks.find((b) => b.type === "table");
    if (prose) prose.markdown = HOSTILE_PROSE;
    if (table) table.markdown = HOSTILE_TABLE;
    await route.fulfill({ response, json: body });
  });

  await page.goto(`/notes/${ids.note(1)}`);
  const content = page.locator(".reader-content");
  await expect(content).toContainText("Script");
  await expect(content).toContainText("Image: pixel");
  // Let lazy plugins load and anything that would fire, fire.
  await page.locator(".katex").first().waitFor();
  await content.locator("table").first().hover();
  await page.getByText("styled").click();
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => (window as { __pwned?: string }).__pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
  expect(thirdParty).toEqual([]);
  const sinks = await content.evaluate((root) => ({
    tags: [
      ...root.querySelectorAll("script, iframe, style, link, form, object, embed, svg[onload]"),
    ].map((el) => el.tagName),
    handlers: [...root.querySelectorAll("*")].flatMap((el) =>
      [...el.attributes]
        .filter((a) => a.name.startsWith("on"))
        .map((a) => `${el.tagName}.${a.name}`),
    ),
    styles: [...root.querySelectorAll("table [style], table[style]")].length,
    hrefs: [...root.querySelectorAll("a[href]")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => !/^(https?:|#|\/)/.test(h)),
    images: [...root.querySelectorAll("img")]
      .map((img) => img.getAttribute("src") ?? "")
      .filter((src) => !src.startsWith("/api/assets/") && !src.startsWith("data:image/svg+xml")),
  }));
  expect(sinks).toEqual({ tags: [], handlers: [], styles: 0, hrefs: [], images: [] });
  await expectCleanScreen(page);
});
