import { describe, expect, it } from "vitest";
import { isCrossSiteWrite } from "./same-origin.ts";

const APP = "https://mt.example.com";
describe("isCrossSiteWrite (E2)", () => {
  it("lets reads through and refuses a write without the exact app Origin", () => {
    expect(isCrossSiteWrite("GET", null, APP)).toBe(false);
    expect(isCrossSiteWrite("HEAD", null, APP)).toBe(false);
    expect(isCrossSiteWrite("POST", `${APP}.evil.test`, APP)).toBe(true);
    expect(isCrossSiteWrite("POST", APP, APP)).toBe(false);
    expect(isCrossSiteWrite("POST", null, APP)).toBe(true);
    expect(isCrossSiteWrite("DELETE", "https://evil.test", APP)).toBe(true);
  });
});
