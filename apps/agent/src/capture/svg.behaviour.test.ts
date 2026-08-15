import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { isSafeSvg } from "./images.ts";
import { pageSanitizeSvg } from "./page/svg.ts";
import { captureWorlds } from "./worlds.ts";

let session: BrowserSession;
beforeAll(async () => {
  session = await openTestSession();
  await session.goto(`${FIXTURES}/index.html`, new AbortController().signal);
});
afterAll(async () => {
  await session?.close();
});

const sanitize = async (text: string) =>
  (await captureWorlds(session)).call(pageSanitizeSvg, [text]);

describe("pageSanitizeSvg (S2: the four verified bypasses)", () => {
  it.each([
    [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="&#106;avascript:alert(1)"><rect width="9" height="9"/></a><rect width="5" height="5"/></svg>',
      /javascript|<a\b/i,
    ],
    [
      '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" values="java&#x73;cript:alert(1)"/><rect width="5" height="5"/></svg>',
      /animate|javascript/i,
    ],
    [
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.test/x.css);</style><rect width="5" height="5"/></svg>',
      /style|@import/i,
    ],
    [
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.test/sprite.svg#icon"/><rect width="5" height="5"/></svg>',
      /evil\.test/,
    ],
    // Re-review: image-set() and src() fetch a string URL with no url( at all.
    [
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="mask-image:image-set(&quot;https://evil.test/a&quot; 1x)" width="5" height="5"/><rect style="fill:src(&quot;//evil.test/b&quot;)" width="5" height="5"/></svg>',
      /image-set|src\(|evil\.test/,
    ],
    // 5-8 review I5: a CSS escape decodes to url( in the browser.
    [
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:\\75 rl(https://evil.test/a)" fill="\\75 rl(https://evil.test/b)" width="5" height="5"/></svg>',
      /evil\.test|\\/,
    ],
  ])("strips %s", async (input, forbidden) => {
    const out = await sanitize(input);
    expect(out).not.toBeNull();
    expect(out).not.toMatch(forbidden);
    expect(out).toContain("<rect");
    expect(isSafeSvg(out!)).toBe(true);
  });
  it("keeps drawings and local references, and refuses non-SVG input", async () => {
    const out = await sanitize(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect style="fill:url(#g)" width="5" height="5"/><use href="#g"/></svg>',
    );
    expect(out).toContain('href="#g"');
    expect(out).toContain("url(#g)");
    expect(await sanitize("<html><body>no</body></html>")).toBeNull();
  });
});
