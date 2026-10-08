import { describe, expect, it } from "vitest";
import { textFragment } from "./text-fragment.ts";

describe("textFragment", () => {
  it("uses the whole text when short and start,end otherwise", () => {
    expect(textFragment("Light reactions")).toBe("#:~:text=Light%20reactions");
    expect(textFragment("one two three four five six seven eight nine ten")).toBe(
      "#:~:text=one%20two%20three%20four,seven%20eight%20nine%20ten",
    );
  });
  it("percent-encodes the directive delimiters", () => {
    expect(textFragment("a-b, c&d")).toBe("#:~:text=a%2Db%2C%20c%26d");
    expect(textFragment("   ")).toBeNull();
  });
  it("keeps the page's own characters: the browser matches the fragment literally", () => {
    expect(textFragment("x² ﬁne")).toBe(`#:~:text=${encodeURIComponent("x² ﬁne")}`);
  });
});
