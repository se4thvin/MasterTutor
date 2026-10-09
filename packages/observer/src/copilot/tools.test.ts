import { COPILOT_TOOL_NAMES } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { COPILOT_TOOLS } from "./tools.ts";

describe("Copilot tools (spec §7.5)", () => {
  it("defines exactly the eight read-only tools, each strict", () => {
    expect(Object.keys(COPILOT_TOOLS).sort()).toEqual([...COPILOT_TOOL_NAMES].sort());
    for (const tool of Object.values(COPILOT_TOOLS))
      expect(tool.schema.safeParse({ extra: 1 }).success).toBe(false);
  });
  it("takes run handles, never UUIDs, and bounds every limit", () => {
    expect(
      COPILOT_TOOLS.run_detail.schema.safeParse({ run: "R1", includeUntrusted: false }).success,
    ).toBe(true);
    expect(
      COPILOT_TOOLS.run_detail.schema.safeParse({
        run: "6f2c8a3e-0000-4000-8000-00000000000a",
        includeUntrusted: false,
      }).success,
    ).toBe(false);
    expect(
      COPILOT_TOOLS.runs_find.schema.safeParse({
        status: null,
        errorCode: null,
        sinceHours: 24,
        limit: 51,
      }).success,
    ).toBe(false);
    expect(
      COPILOT_TOOLS.code_read.schema.safeParse({ path: "../.env", startLine: 1, endLine: 10 })
        .success,
    ).toBe(false);
  });
});

it("carries per-tool limits and taint, and refuses traversing search prefixes", () => {
  for (const tool of Object.values(COPILOT_TOOLS)) {
    expect(tool.limits).toBeDefined();
    expect(tool.taint).toBeDefined();
  }
  expect(
    COPILOT_TOOLS.code_search.schema.safeParse({ query: "x1", pathPrefix: "apps/../packages" })
      .success,
  ).toBe(false);
});
