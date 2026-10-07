import { describe, expect, it } from "vitest";
import { isDarkColor, studioTones } from "./studio.ts";

describe("studio tones", () => {
  it("detects the theme background and dims the room for dark mode", () => {
    expect(isDarkColor("rgb(250, 250, 250)")).toBe(false);
    expect(isDarkColor("#0B0B0C")).toBe(true);
    expect(studioTones(true).wall).toBeLessThan(studioTones(false).wall);
  });
});
