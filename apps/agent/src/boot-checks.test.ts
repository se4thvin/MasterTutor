import { describe, expect, it } from "vitest";
import { concurrencyProblem } from "./boot-checks.ts";

describe("concurrencyProblem", () => {
  it("passes when no workspace exists yet or concurrency fits", () => {
    expect(concurrencyProblem(null, 1)).toBeNull();
    expect(concurrencyProblem(6, 6)).toBeNull();
    expect(concurrencyProblem(1, 6)).toBeNull();
  });
  it("explains a concurrency above the slot count", () => {
    expect(concurrencyProblem(7, 6)).toMatch(/concurrency \(7\) exceeds .* slots \(6\)/);
  });
});
