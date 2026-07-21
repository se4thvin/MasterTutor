import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { imageInfo, isSafeSvg, sniffSvg } from "./images.ts";

/** The four bypasses the preflight reproduced against the base plan's regex (S2), plus the classics. */
const UNSAFE = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="&#106;avascript:alert(1)"><rect width="9" height="9"/></a></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="java&#x73;cript:alert(1)"/><text>x</text></a></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.test/x.css);</style></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.test/sprite.svg#icon"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"\nonload="alert(1)"/>',
  '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
  '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.test/a)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>',
];

describe("isSafeSvg", () => {
  it.each(UNSAFE)("rejects %s", (svg) => {
    expect(isSafeSvg(svg)).toBe(false);
  });
  it("accepts plain drawings with local references", () => {
    expect(
      isSafeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect width="1" height="1" style="fill:url(#g)"/><use href="#g"/></svg>',
      ),
    ).toBe(true);
  });
});

describe("imageInfo and sniffSvg", () => {
  it("detects real images by content, not headers", async () => {
    const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#f00" } })
      .png()
      .toBuffer();
    expect(await imageInfo(new Uint8Array(png))).toEqual({
      mime: "image/png",
      width: 3,
      height: 2,
    });
    expect(await imageInfo(new TextEncoder().encode("<html>not an image</html>"))).toBeNull();
    expect(
      sniffSvg(
        new TextEncoder().encode(
          '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
        ),
      ),
    ).toBe(true);
    expect(sniffSvg(png)).toBe(false);
  });
});
