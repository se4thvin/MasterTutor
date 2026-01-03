import { describe, expect, it } from "vitest";
import {
  CreateBenchmarkInput,
  CreateRunInput,
  CreateVaultItemInput,
  GradeBenchmarkRunInput,
  ListNotesInput,
  SubmitOtpInput,
  UsageInput,
} from "./dto.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("run inputs", () => {
  it("normalizes origins and defaults to ask mode", () => {
    const input = CreateRunInput.parse({
      goal: "Take notes on reading 1",
      allowedOrigins: ["learn.zybooks.com/zybook/X"],
    });
    expect(input.allowedOrigins).toEqual(["https://learn.zybooks.com"]);
    expect(input.approvalMode).toBe("ask");
    expect(input.targetFolderId).toBeNull();
    expect(input.budget).toBeUndefined();
  });
  it("needs a goal and at least one origin", () => {
    expect(CreateRunInput.safeParse({ goal: " ", allowedOrigins: ["a.com"] }).success).toBe(false);
    expect(CreateRunInput.safeParse({ goal: "x", allowedOrigins: [] }).success).toBe(false);
  });
  it("accepts only 4-8 digit OTP codes", () => {
    expect(SubmitOtpInput.safeParse({ runId, code: "123456" }).success).toBe(true);
    expect(SubmitOtpInput.safeParse({ runId, code: "12a456" }).success).toBe(false);
    expect(SubmitOtpInput.safeParse({ runId, code: "123" }).success).toBe(false);
  });
});

describe("benchmark inputs", () => {
  it("defaults to auto approval within the allowlist", () => {
    const input = CreateBenchmarkInput.parse({
      name: "zyBooks readings 1-5",
      task: "Complete all participation activities in reading assignments 1-5",
      allowedOrigins: ["https://learn.zybooks.com"],
      successCriteria: "All participation activities in readings 1-5 show complete",
    });
    expect(input.approvalMode).toBe("auto_within_allowlist");
  });
  it("cannot grade a run as pending", () => {
    expect(
      GradeBenchmarkRunInput.safeParse({ benchmarkRunId: runId, outcome: "pending" }).success,
    ).toBe(false);
    expect(
      GradeBenchmarkRunInput.parse({ benchmarkRunId: runId, outcome: "partial" }).failureNotes,
    ).toBeNull();
  });
});

describe("other inputs", () => {
  it("lists notes by all, unfiled or a folder id", () => {
    expect(ListNotesInput.parse({}).folder).toBe("all");
    expect(ListNotesInput.parse({ folder: "unfiled" }).folder).toBe("unfiled");
    expect(ListNotesInput.parse({ folder: runId }).folder).toBe(runId);
    expect(ListNotesInput.safeParse({ folder: "../x" }).success).toBe(false);
  });
  it("never accepts passkeys typed into the vault form", () => {
    expect(
      CreateVaultItemInput.safeParse({
        alias: "site",
        origin: "https://a.com",
        label: "A",
        secrets: { passkey: "x" },
      }).success,
    ).toBe(false);
  });
  it("orders usage ranges", () => {
    expect(UsageInput.safeParse({ from: "2026-10-05", to: "2026-10-01" }).success).toBe(false);
  });
});
