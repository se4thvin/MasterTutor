import { describe, expect, it } from "vitest";
import { liveFailure } from "./live-policy.ts";

describe("liveFailure (L1, B6 A9)", () => {
  it("retries only network failures and server errors", () => {
    expect(liveFailure(null)).toBe("retry");
    expect(liveFailure("SERVICE_UNAVAILABLE")).toBe("retry");
    expect(liveFailure("INTERNAL_SERVER_ERROR")).toBe("retry");
  });

  it("never loops on a live view held by another tab", () => {
    expect(liveFailure("CONFLICT")).toBe("in_use");
  });

  it("gives up quietly on refusals and on an unwired backend", () => {
    for (const code of ["FORBIDDEN", "NOT_IMPLEMENTED", "NOT_FOUND", "BAD_REQUEST"]) {
      expect(liveFailure(code), code).toBe("unavailable");
    }
  });

  it("stops on an ended session (the RPC link already signs out)", () => {
    expect(liveFailure("UNAUTHORIZED")).toBe("off");
  });
});
