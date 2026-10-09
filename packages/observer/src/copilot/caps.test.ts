import { describe, expect, it } from "vitest";
import { capCheck } from "./caps.ts";

describe("caps (spec §7.8)", () => {
  it("refuses at 20 questions in the window and at the daily cap", () => {
    expect(capCheck({ questionsInWindow: 19, spentTodayUsd: 0 }, 3)).toEqual({ ok: true });
    expect(capCheck({ questionsInWindow: 20, spentTodayUsd: 0 }, 3)).toEqual({
      ok: false,
      code: "rate_limited",
    });
    expect(capCheck({ questionsInWindow: 0, spentTodayUsd: 3 }, 3)).toEqual({
      ok: false,
      code: "daily_cap",
    });
  });
});
