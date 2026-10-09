import { describe, expect, it } from "vitest";
import { ObserverCallError } from "./ports.ts";

describe("ObserverCallError (review: an unparseable answer is billed, so it is counted)", () => {
  it("carries the outcome and the billed usd, and no model text", () => {
    const error = new ObserverCallError("invalid", 0.0042);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ObserverCallError");
    expect(error.outcome).toBe("invalid");
    expect(error.usd).toBe(0.0042);
    expect(error.message).toBe("Observer call failed: invalid");
  });
});
