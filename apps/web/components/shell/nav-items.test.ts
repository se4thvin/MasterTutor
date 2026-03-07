import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavActive } from "./nav-items.ts";

describe("navigation", () => {
  it("keeps mockup D's items and order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "New task",
      "Runs",
      "Library",
      "Vault",
      "Settings",
    ]);
  });
  it("marks nested routes and notes as part of Library", () => {
    expect(isNavActive("/library", "/library")).toBe(true);
    expect(isNavActive("/notes/abc", "/library")).toBe(true);
    expect(isNavActive("/settings/usage", "/settings")).toBe(true);
    expect(isNavActive("/runs", "/library")).toBe(false);
  });
});
