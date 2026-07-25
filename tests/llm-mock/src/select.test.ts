import { describe, expect, it } from "vitest";
import { scenarioGoal, scenarioTag } from "./select.ts";

describe("scenarioGoal", () => {
  it("tags the goal with the scenario and a fresh nonce per call", () => {
    const a = scenarioGoal("long-wait", "Open http://site.fixtures.test/");
    const b = scenarioGoal("long-wait", "Open http://site.fixtures.test/");
    expect(a).toMatch(/^\[scenario:long-wait#[0-9a-f]{12}\] Open http:\/\/site\.fixtures\.test\/$/);
    expect(scenarioTag(a)?.nonce).not.toBe(scenarioTag(b)?.nonce);
  });

  it("refuses names the mock cannot route", () => {
    for (const name of ["", "Has Space", "a]b", "x".repeat(65)])
      expect(() => scenarioGoal(name, "t")).toThrow(TypeError);
  });
});

describe("scenarioTag", () => {
  it("reads the name and the nonce, and accepts the nonce-less form behaviour tests use", () => {
    expect(scenarioTag("Task from the user:\n[scenario:basic#ab12] go")).toEqual({
      name: "basic",
      nonce: "ab12",
    });
    expect(scenarioTag("[scenario:basic] go")).toEqual({ name: "basic", nonce: null });
    expect(scenarioTag("no tag here")).toBeNull();
  });
});
