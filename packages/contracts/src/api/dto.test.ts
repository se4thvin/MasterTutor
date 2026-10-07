import { describe, expect, it } from "vitest";
import {
  CreateBenchmarkInput,
  CreateRunInput,
  CreateVaultItemInput,
  GradeBenchmarkRunInput,
  ListNotesInput,
  SetSecretInput,
  SettingsView,
  SubmitOtpInput,
  UpdateSettingsInput,
  USAGE_MAX_DAYS,
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

describe("vault secret validation in the DTOs (E3, E4)", () => {
  const item = { alias: "site", origin: "https://a.com", label: "A" };
  it("keeps an otpauth link whole, so digits, period and algorithm survive", () => {
    const link =
      "otpauth://totp/ACME:me?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256";
    expect(CreateVaultItemInput.parse({ ...item, secrets: { totp: link } }).secrets.totp).toBe(
      link,
    );
  });
  it("rejects a bad key and a bad PIN by path, without echoing either", () => {
    const bad = CreateVaultItemInput.safeParse({
      ...item,
      secrets: { totp: "nope-key-value", pin: "12a" },
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((issue) => issue.path.join(".")).sort()).toEqual([
      "secrets.pin",
      "secrets.totp",
    ]);
    expect(JSON.stringify(bad.error?.issues)).not.toContain("nope-key-value");
  });
  it("needs mail settings for an email-code password", () => {
    expect(
      CreateVaultItemInput.safeParse({ ...item, secrets: { imap_password: "x" } }).success,
    ).toBe(false);
  });
  it("validates a replaced secret the same way", () => {
    const itemId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(SetSecretInput.safeParse({ itemId, field: "pin", value: "1234" }).success).toBe(true);
    expect(SetSecretInput.safeParse({ itemId, field: "pin", value: "12" }).success).toBe(false);
    expect(SetSecretInput.safeParse({ itemId, field: "totp", value: "bad" }).success).toBe(false);
  });
});

describe("bypass mode needs an explicit acknowledgement (D44, m8)", () => {
  const run = { goal: "Take notes", allowedOrigins: ["https://a.example"] };
  const bench = { ...run, name: "B", task: "T", successCriteria: "S" };
  it("refuses bypass without bypassAcknowledged: true, accepts it with", () => {
    expect(CreateRunInput.safeParse({ ...run, approvalMode: "bypass" }).success).toBe(false);
    expect(
      CreateRunInput.safeParse({ ...run, approvalMode: "bypass", bypassAcknowledged: true })
        .success,
    ).toBe(true);
    expect(CreateBenchmarkInput.safeParse({ ...bench, approvalMode: "bypass" }).success).toBe(
      false,
    );
    expect(CreateRunInput.safeParse({ ...run, approvalMode: "ask" }).success).toBe(true);
  });
});

describe("settings concurrency and usage range (D14, D52)", () => {
  const view = {
    killSwitch: false,
    defaultBudget: { maxSteps: 150, maxUsd: 5, maxActiveMinutes: 60 },
    defaultAllowedOrigins: [],
    concurrency: 2,
  };
  it("requires a version on the view and on every update", () => {
    expect(SettingsView.safeParse(view).success).toBe(false);
    expect(SettingsView.safeParse({ ...view, version: "v1" }).success).toBe(true);
    expect(UpdateSettingsInput.safeParse({ concurrency: 2 }).success).toBe(false);
    expect(UpdateSettingsInput.safeParse({ version: "v1", concurrency: 2 }).success).toBe(true);
  });
  it("caps a usage range at USAGE_MAX_DAYS days, both ends included", () => {
    expect(USAGE_MAX_DAYS).toBe(400);
    expect(UsageInput.safeParse({ from: "2026-01-01", to: "2027-02-04" }).success).toBe(true);
    expect(UsageInput.safeParse({ from: "2026-01-01", to: "2027-02-05" }).success).toBe(false);
    expect(UsageInput.safeParse({ from: "2026-10-02", to: "2026-10-01" }).success).toBe(false);
  });
});
