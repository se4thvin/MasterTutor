import { describe, expect, it } from "vitest";
import { startUrl } from "./start-url.ts";

describe("startUrl", () => {
  it("uses the first goal URL on an allowed origin", () => {
    expect(
      startUrl("Open https://evil.com/x then https://learn.zybooks.com/zybook/ABC, please.", [
        "https://learn.zybooks.com",
      ]),
    ).toBe("https://learn.zybooks.com/zybook/ABC");
  });
  it("falls back to the first allowed origin", () => {
    expect(startUrl("Read the article", ["http://site.fixtures.test"])).toBe(
      "http://site.fixtures.test/",
    );
    expect(startUrl("nothing", [])).toBeNull();
  });
});
