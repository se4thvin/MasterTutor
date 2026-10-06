import { describe, expect, it } from "vitest";
import {
  insertBenchmarkSchema,
  insertRunSchema,
  insertSourceSchema,
  insertVaultItemSchema,
  selectRunSchema,
} from "./zod.ts";

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
  it("rejects malformed origins", () => {
    for (const origin of ["javascript:x", "Example.COM/path"]) {
      expect(
        insertRunSchema.safeParse({ workspaceId, goal: "g", allowedOrigins: [origin] }).success,
      ).toBe(false);
      expect(
        insertVaultItemSchema.safeParse({ workspaceId, alias: "a", origin, label: "l" }).success,
      ).toBe(false);
      expect(insertSourcesOrigin(origin)).toBe(false);
    }
    expect(
      insertVaultItemSchema.safeParse({
        workspaceId,
        alias: "a",
        origin: "https://a.com",
        label: "l",
      }).success,
    ).toBe(true);
  });
});

const insertSourcesOrigin = (origin: string) =>
  insertSourceSchema.safeParse({ workspaceId, kind: "web", url: "https://a.com", origin }).success;
