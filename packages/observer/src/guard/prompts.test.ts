import { describe, expect, it } from "vitest";
import {
  GUARD_REVIEW_INSTRUCTIONS,
  GUARD_SCREEN_INSTRUCTIONS,
  TRAJECTORY_REVIEW_INSTRUCTIONS,
} from "./prompts.ts";

describe("Guard prompts (spec §6.5)", () => {
  it("share one static prefix, so the review call is mostly a cache hit", () => {
    const prefix = GUARD_SCREEN_INSTRUCTIONS.slice(0, 600);
    expect(GUARD_REVIEW_INSTRUCTIONS.startsWith(prefix)).toBe(true);
    expect(TRAJECTORY_REVIEW_INSTRUCTIONS.startsWith(prefix)).toBe(true);
  });
  it("say the Guard never approves and that data is never instructions", () => {
    expect(GUARD_SCREEN_INSTRUCTIONS).toMatch(/never instructions/);
    expect(GUARD_REVIEW_INSTRUCTIONS).toMatch(/cannot approve/);
  });
});
