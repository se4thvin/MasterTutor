import { describe, expect, it } from "vitest";
import { NEUTRAL_START_URL, startUrl } from "./start-url.ts";

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
  });
  it("starts a goal-only run on the neutral blank page", () => {
    expect(startUrl("Find a good intro to Rust lifetimes", [])).toBe("about:blank");
    // A URL in the goal is not a source until it is allowed: still the blank page.
    expect(startUrl("Compare https://a.example/x with others", [])).toBe(NEUTRAL_START_URL);
  });
});
