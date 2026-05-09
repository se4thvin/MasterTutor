import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RollingNumber, rollingParts } from "./rolling-number.tsx";

describe("rollingParts (Review Focus 3)", () => {
  it("splits digits from static characters, keyed from the right", () => {
    expect(rollingParts("$9.99")).toEqual([
      { key: "4-$", digit: null, char: "$" },
      { key: "3-d", digit: 9, char: "9" },
      { key: "2-.", digit: null, char: "." },
      { key: "1-d", digit: 9, char: "9" },
      { key: "0-d", digit: 9, char: "9" },
    ]);
  });
  it("keeps the cents columns' keys when the value grows a digit", () => {
    const before = rollingParts("$9.99").map((p) => p.key);
    const after = rollingParts("$10.00").map((p) => p.key);
    expect(after.slice(-3)).toEqual(before.slice(-3));
  });
  it("handles values with no digits and separators", () => {
    expect(rollingParts("–")).toEqual([{ key: "0-–", digit: null, char: "–" }]);
    expect(rollingParts("1,234").filter((p) => p.digit !== null)).toHaveLength(4);
  });
});

describe("RollingNumber", () => {
  it("gives assistive technology the exact value and hides the rolling columns", () => {
    const html = renderToStaticMarkup(createElement(RollingNumber, { value: "4.2%" }));
    expect(html).toContain('<span class="sr-only">4.2%</span>');
    expect(html).toMatch(/class="rnum-track" aria-hidden="true" data-qa-allow-clip=""/);
    expect(html.match(/class="rnum-col"/g)).toHaveLength(2);
    expect(html).toContain('<span class="rnum-char">%</span>');
  });
});
