import { describe, expect, it } from "vitest";
import { STATUS_MARK_STATUSES } from "./status.ts";

describe("status vocabulary (m-2: one source for StatusMark and the run flash)", () => {
  it("lists the five mark states once", () => {
    expect(STATUS_MARK_STATUSES).toEqual(["pending", "running", "done", "failed", "cancelled"]);
  });
});
