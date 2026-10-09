import { describe, expect, it } from "vitest";
import { allowsTopLevel, inRunScope, registrableDomain, sameSite } from "./navigation-scope.ts";

describe("navigation scope (D51)", () => {
  it("finds the registrable domain with the public suffix list, private section included", () => {
    expect(registrableDomain("accounts.mheducation.com")).toBe("mheducation.com");
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("alice.github.io")).toBe("alice.github.io");
    expect(registrableDomain("co.uk")).toBeNull();
    expect(registrableDomain("93.184.216.34")).toBeNull();
  });

  it("allows another host of an allowed site: the McGraw-Hill sign-in hops", () => {
    const allowed = ["https://accounts.mheducation.com"];
    for (const origin of [
      "https://newconnect.mheducation.com",
      "https://caas.mheducation.com",
      "https://mheducation.com",
    ])
      expect(inRunScope(origin, allowed)).toBe(true);
  });

  it("keeps different sites apart, public-suffix neighbours included", () => {
    expect(inRunScope("https://evil-mheducation.com", ["https://accounts.mheducation.com"])).toBe(
      false,
    );
    expect(inRunScope("https://mallory.github.io", ["https://alice.github.io"])).toBe(false);
    expect(inRunScope("https://b.example.co.uk", ["https://a.other.co.uk"])).toBe(false);
    expect(inRunScope("http://10.0.0.2", ["http://10.0.0.1"])).toBe(false);
  });

  it("never downgrades to http, but follows an upgrade to https", () => {
    expect(sameSite("http://www.example.com", "https://login.example.com")).toBe(false);
    expect(sameSite("https://www.example.com", "http://login.example.com")).toBe(true);
    expect(sameSite("http://www.example.com", "http://login.example.com")).toBe(true);
  });

  it("an exact allowed origin always matches, even one with no site (an IP)", () => {
    expect(inRunScope("http://93.184.216.34", ["http://93.184.216.34"])).toBe(true);
    expect(inRunScope("https://a.test", [])).toBe(false);
  });

  it("lets a sign-in flow pass through any https site, and only while it is open", () => {
    const allowed = ["https://accounts.mheducation.com"];
    expect(allowsTopLevel("https://sso.university.edu", allowed, false)).toBe(false);
    expect(allowsTopLevel("https://sso.university.edu", allowed, true)).toBe(true);
    expect(allowsTopLevel("http://sso.university.edu", allowed, true)).toBe(false);
  });
});
