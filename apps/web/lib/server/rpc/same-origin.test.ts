import { describe, expect, it } from "vitest";
import { isCrossSiteWrite } from "./same-origin.ts";

const app = "https://notes.example.com";
const request = (method: string, origin?: string) =>
  new Request(`${app}/api/rpc/vault/list`, {
    method,
    headers: origin ? { origin } : {},
  });

describe("isCrossSiteWrite (E2)", () => {
  it("allows reads and same-origin writes", () => {
    expect(isCrossSiteWrite(request("GET"), app)).toBe(false);
    expect(isCrossSiteWrite(request("POST", app), app)).toBe(false);
  });
  it("refuses writes from another origin or with no Origin at all", () => {
    expect(isCrossSiteWrite(request("POST", "https://evil.example"), app)).toBe(true);
    expect(isCrossSiteWrite(request("POST", "https://notes.example.com.evil.example"), app)).toBe(
      true,
    );
    expect(isCrossSiteWrite(request("POST"), app)).toBe(true);
  });
});
