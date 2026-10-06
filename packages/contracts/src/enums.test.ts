import { describe, expect, it } from "vitest";
import * as enums from "./enums.ts";

describe("enum tuples", () => {
  it("have no duplicate values", () => {
    for (const [name, value] of Object.entries(enums)) {
      if (Array.isArray(value)) {
        expect(new Set(value).size, name).toBe(value.length);
      }
    }
  });

  it("matches the spec state machine and approval modes", () => {
    expect(enums.RUN_STATUSES).toEqual([
      "queued",
      "running",
      "waiting",
      "sleeping",
      "completed",
      "failed",
      "cancelled",
    ]);
    expect(enums.TERMINAL_RUN_STATUSES).toEqual(["completed", "failed", "cancelled"]);
    expect(enums.APPROVAL_MODES).toEqual(["ask", "auto_within_allowlist"]);
    expect(enums.RunStatus.safeParse("paused").success).toBe(false);
    expect(enums.STEP_STATES).toContain("aborted");
    expect(enums.CONTROLLERS).toEqual(["agent", "user"]);
  });
});
