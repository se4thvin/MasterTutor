import { describe, expect, it } from "vitest";
import { RUN_STATUSES } from "@mastertutor/contracts";
import { STATUS_MARK_STATUSES, markStatus } from "./status.ts";

describe("status vocabulary (m-2: one source for StatusMark and the run flash)", () => {
  it("lists the five mark states once", () => {
    expect(STATUS_MARK_STATUSES).toEqual(["pending", "running", "done", "failed", "cancelled"]);
  });
});

describe("markStatus (one mapping from a run's status to its mark)", () => {
  it("maps every run status", () => {
    expect(RUN_STATUSES.map((status) => [status, markStatus(status)])).toEqual([
      ["queued", "pending"],
      ["running", "running"],
      ["waiting", "pending"],
      ["sleeping", "pending"],
      ["completed", "done"],
      ["failed", "failed"],
      ["cancelled", "cancelled"],
    ]);
  });
});
