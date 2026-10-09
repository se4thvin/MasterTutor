import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, EMPTY_USAGE } from "../budget.ts";
import { MAX_USER_DOWNLOADS_PER_RUN } from "../constants.ts";
import {
  BenchmarkRunView,
  BenchmarkView,
  CreateBenchmarkInput,
  CreateRunInput,
  CreateVaultItemInput,
  GradeBenchmarkRunInput,
  HandBackInput,
  HeldDownloadView,
  ListNotesInput,
  RunDetail,
  RunStepView,
  StoredDownloadView,
  RunSummary,
  SendMessageInput,
  SetApprovalModeInput,
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
  it("needs a goal; sources and origins are optional", () => {
    expect(CreateRunInput.safeParse({ goal: " ", allowedOrigins: ["a.com"] }).success).toBe(false);
    expect(CreateRunInput.parse({ goal: "Find a tutorial on Rust lifetimes" })).toMatchObject({
      goal: "Find a tutorial on Rust lifetimes",
      allowedOrigins: [],
      approvalMode: "ask",
    });
    expect(CreateRunInput.safeParse({ goal: "x", allowedOrigins: [] }).success).toBe(true);
  });
  it("refuses auto mode with no allowed origin: it could never open a page", () => {
    expect(
      CreateRunInput.safeParse({ goal: "x", approvalMode: "auto_within_allowlist" }).success,
    ).toBe(false);
    expect(
      CreateRunInput.safeParse({
        goal: "x",
        allowedOrigins: ["a.com"],
        approvalMode: "auto_within_allowlist",
      }).success,
    ).toBe(true);
    for (const approvalMode of ["ask", "bypass"] as const)
      expect(
        CreateRunInput.safeParse({ goal: "x", approvalMode, bypassAcknowledged: true }).success,
      ).toBe(true);
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

describe("SetApprovalModeInput (run-mode)", () => {
  it("takes any mode for a run; bypass only with bypassAcknowledged: true, as at creation", () => {
    for (const mode of ["ask", "auto_within_allowlist"] as const)
      expect(SetApprovalModeInput.parse({ runId, mode })).toEqual({ runId, mode });
    expect(SetApprovalModeInput.safeParse({ runId, mode: "bypass" }).success).toBe(false);
    expect(
      SetApprovalModeInput.safeParse({ runId, mode: "bypass", bypassAcknowledged: false }).success,
    ).toBe(false);
    expect(
      SetApprovalModeInput.safeParse({ runId, mode: "bypass", bypassAcknowledged: true }).success,
    ).toBe(true);
  });
  it("validates the boundary: a run id, a known mode, nothing else", () => {
    expect(SetApprovalModeInput.safeParse({ runId: "x", mode: "ask" }).success).toBe(false);
    expect(SetApprovalModeInput.safeParse({ runId, mode: "yolo" }).success).toBe(false);
    expect(SetApprovalModeInput.safeParse({ runId }).success).toBe(false);
  });
});

describe("SendMessageInput delivery (run-mode: queue or interrupt)", () => {
  it("queues by default and takes interrupt: true for Send now", () => {
    expect(SendMessageInput.parse({ runId, text: "hi" }).interrupt).toBe(false);
    expect(SendMessageInput.parse({ runId, text: "hi", interrupt: true }).interrupt).toBe(true);
    expect(SendMessageInput.safeParse({ runId, text: "hi", interrupt: "yes" }).success).toBe(false);
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

describe("HandBackInput: the person keeps or discards each download made during control", () => {
  it("keeps nothing unless told: undecided downloads are discarded", () => {
    expect(HandBackInput.parse({ runId, note: null }).keep).toEqual([]);
  });
  it("accepts at most one decision per allowed download, as download ids", () => {
    const ids = Array.from({ length: MAX_USER_DOWNLOADS_PER_RUN + 1 }, () => crypto.randomUUID());
    expect(HandBackInput.parse({ runId, note: null, keep: ids.slice(1) }).keep).toHaveLength(
      MAX_USER_DOWNLOADS_PER_RUN,
    );
    expect(HandBackInput.safeParse({ runId, note: null, keep: ids }).success).toBe(false);
    expect(HandBackInput.safeParse({ runId, note: null, keep: ["../x"] }).success).toBe(false);
  });
});

describe("RunDetail.heldDownloads (B6 A11 reload gap)", () => {
  it("carries each held download as id, filename and size, and nothing else", () => {
    expect(Object.keys(RunDetail.shape)).toContain("heldDownloads");
    const held = { id: runId, filename: "week-2 report.pdf", bytes: 1_572_864 };
    expect(HeldDownloadView.parse({ ...held, approvedBy: "u-1", keptAt: null })).toEqual(held);
  });

  it("refuses an over-long name, a negative size and a non-uuid id", () => {
    expect(
      HeldDownloadView.safeParse({ id: runId, filename: "x".repeat(256), bytes: 1 }).success,
    ).toBe(false);
    expect(HeldDownloadView.safeParse({ id: runId, filename: "a.pdf", bytes: -1 }).success).toBe(
      false,
    );
    expect(HeldDownloadView.safeParse({ id: "../x", filename: "a.pdf", bytes: 1 }).success).toBe(
      false,
    );
  });
});

describe("tool profiles and takeovers (Phase 10, P10a-3/5)", () => {
  const run = { goal: "g", allowedOrigins: ["https://a.example"] };
  const bench = { ...run, name: "B", task: "T", successCriteria: "S" };
  const at = "2026-10-06T10:00:00.000Z";
  const summary = {
    id: runId,
    goal: "g",
    title: "g",
    status: "queued",
    waitReason: null,
    controller: "agent",
    approvalMode: "ask",
    observerMode: "enforce",
    toolProfile: "browser_use",
    model: "m",
    noteId: null,
    usage: EMPTY_USAGE,
    budget: DEFAULT_BUDGET,
    createdAt: at,
    finishedAt: null,
  };
  const benchmarkView = {
    id: runId,
    name: "B",
    task: "T",
    allowedOrigins: ["https://a.example"],
    approvalMode: "auto_within_allowlist",
    toolProfile: "computer_use",
    budget: DEFAULT_BUDGET,
    successCriteria: "S",
    createdAt: at,
  };
  const benchmarkRun = {
    id: runId,
    benchmarkId: runId,
    runId,
    outcome: "pending",
    steps: 0,
    usd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: null,
    takeovers: 0,
    failureNotes: null,
    gradedBy: null,
    startedAt: at,
    finishedAt: null,
  };
  const without = (value: Record<string, unknown>, key: string) =>
    Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

  it("defaults runs and benchmarks to browser_use", () => {
    expect(CreateRunInput.parse(run).toolProfile).toBe("browser_use");
    expect(CreateBenchmarkInput.parse(bench).toolProfile).toBe("browser_use");
  });
  it("rejects unknown profiles", () => {
    expect(CreateRunInput.safeParse({ ...run, toolProfile: "exec" }).success).toBe(false);
    expect(CreateBenchmarkInput.safeParse({ ...bench, toolProfile: "exec" }).success).toBe(false);
  });
  it("keeps the bypass refine on both inputs when a profile is set (D44)", () => {
    expect(
      CreateRunInput.safeParse({ ...run, toolProfile: "computer_use", approvalMode: "bypass" })
        .success,
    ).toBe(false);
    expect(
      CreateRunInput.parse({
        ...run,
        toolProfile: "computer_use",
        approvalMode: "bypass",
        bypassAcknowledged: true,
      }).toolProfile,
    ).toBe("computer_use");
    expect(
      CreateBenchmarkInput.safeParse({
        ...bench,
        toolProfile: "computer_use",
        approvalMode: "bypass",
      }).success,
    ).toBe(false);
    expect(
      CreateBenchmarkInput.parse({
        ...bench,
        toolProfile: "computer_use",
        approvalMode: "bypass",
        bypassAcknowledged: true,
      }).approvalMode,
    ).toBe("bypass");
  });
  it("requires toolProfile on run and benchmark views, and takeovers on benchmark runs", () => {
    expect(RunSummary.safeParse(summary).success).toBe(true);
    expect(RunSummary.safeParse(without(summary, "toolProfile")).success).toBe(false);
    // Every run view carries a title (the stored one or the fallback).
    expect(RunSummary.safeParse(without(summary, "title")).success).toBe(false);
    expect(BenchmarkView.safeParse(benchmarkView).success).toBe(true);
    expect(BenchmarkView.safeParse(without(benchmarkView, "toolProfile")).success).toBe(false);
    expect(BenchmarkRunView.safeParse(benchmarkRun).success).toBe(true);
    expect(BenchmarkRunView.safeParse(without(benchmarkRun, "takeovers")).success).toBe(false);
  });
});

describe("RunDetail.downloads (reload of a finished run)", () => {
  it("carries each stored download as id, asset, filename, size and time, and nothing else", () => {
    expect(Object.keys(RunDetail.shape)).toContain("downloads");
    const stored = {
      id: runId,
      assetId: runId,
      filename: "week-2 report.pdf",
      bytes: 2_048,
      at: "2026-10-07T10:00:00.000Z",
    };
    expect(StoredDownloadView.parse({ ...stored, approvedBy: "u-1", sha256: "x" })).toEqual(stored);
  });

  it("refuses an over-long name, a negative size and a download with no stored file", () => {
    const ok = {
      id: runId,
      assetId: runId,
      filename: "a.pdf",
      bytes: 1,
      at: "2026-10-07T10:00:00.000Z",
    };
    expect(StoredDownloadView.safeParse({ ...ok, filename: "x".repeat(256) }).success).toBe(false);
    expect(StoredDownloadView.safeParse({ ...ok, bytes: -1 }).success).toBe(false);
    expect(StoredDownloadView.safeParse({ ...ok, assetId: null }).success).toBe(false);
  });
});

describe("RunStepView.reasoning (fe-run-chat)", () => {
  const view = {
    seq: 2,
    phase: "decide",
    state: "done",
    caption: null,
    url: null,
    screenshotKey: null,
    action: null,
    createdAt: "2026-10-05T17:04:05.000Z",
  };
  it("defaults to null and keeps a summary", () => {
    expect(RunStepView.parse(view).reasoning).toBeNull();
    expect(RunStepView.parse({ ...view, reasoning: "Sign in first." }).reasoning).toBe(
      "Sign in first.",
    );
  });
});

describe("observer mode (spec §6.8)", () => {
  it("defaults to enforce and needs an acknowledgement for shadow", () => {
    expect(CreateRunInput.parse({ goal: "g" }).observerMode).toBe("enforce");
    expect(CreateRunInput.safeParse({ goal: "g", observerMode: "shadow" }).success).toBe(false);
    expect(
      CreateRunInput.parse({ goal: "g", observerMode: "shadow", observerShadowAcknowledged: true })
        .observerMode,
    ).toBe("shadow");
  });
});
