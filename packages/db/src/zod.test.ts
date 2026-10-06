import { describe, expect, it } from "vitest";
import { insertBenchmarkSchema, insertRunSchema, selectRunSchema } from "./zod.ts";

const workspaceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("drizzle-zod schemas", () => {
  it("validates run inserts", () => {
    expect(
      insertRunSchema.safeParse({ workspaceId, goal: "Notes", allowedOrigins: ["https://a.com"] })
        .success,
    ).toBe(true);
    expect(insertRunSchema.safeParse({ workspaceId, allowedOrigins: [] }).success).toBe(false);
    expect(Object.keys(selectRunSchema.shape)).toContain("approvalMode");
  });
  it("validates benchmark inserts", () => {
    expect(
      insertBenchmarkSchema.safeParse({
        workspaceId,
        name: "zyBooks 1-5",
        task: "Complete participation activities",
        allowedOrigins: ["https://learn.zybooks.com"],
        successCriteria: "All complete",
      }).success,
    ).toBe(true);
  });
});
