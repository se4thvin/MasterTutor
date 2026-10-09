import { describe, expect, it } from "vitest";
import { concurrencyProblem, assertGuardWired } from "./boot-checks.ts";

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
describe("assertGuardWired (D52, spec §6.1)", () => {
  it("refuses to boot without a Guard", () => {
    expect(() => assertGuardWired({})).toThrow("The Guard is not wired (D52)");
    expect(() =>
      assertGuardWired({
        guards: {
          forRun: async () => {
            throw new Error("unused");
          },
        },
      }),
    ).not.toThrow();
  });
});
