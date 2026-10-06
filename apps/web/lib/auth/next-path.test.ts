import { describe, expect, it } from "vitest";
import { safeNextPath, signInPathFor } from "./next-path.ts";

describe("safe next path", () => {
  it("keeps same-origin app paths with their query", () => {
    expect(safeNextPath("/vault")).toBe("/vault");
    expect(safeNextPath("/library?q=adam&folder=x")).toBe("/library?q=adam&folder=x");
  });
  it("falls back to the library for anything that could leave the app or loop", () => {
    for (const bad of [
      null,
      "",
      "vault",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/x",
      "javascript:alert(1)",
      "/sign-in",
      "/sign-up?next=/x",
      "/x\nSet-Cookie:a",
      `/${"a".repeat(600)}`,
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe("/library");
    }
  });
  it("builds the sign-in URL that brings the user back", () => {
    expect(signInPathFor("/vault", "?x=1")).toBe("/sign-in?next=%2Fvault%3Fx%3D1");
    expect(signInPathFor("/sign-in", "")).toBe("/sign-in");
  });
});
