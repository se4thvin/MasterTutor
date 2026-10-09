import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, EMPTY_USAGE } from "./budget.ts";
import {
  POINTER_KINDS,
  RUN_EVENT_TYPES,
  RunEvent,
  RunEventRecord,
  StepAction,
  pointerOf,
  type RunEventType,
} from "./events.ts";
import { REASONING_SUMMARY_MAX } from "./step-result.ts";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("RunEvent", () => {
  it("covers every spec event type plus model_fallback", () => {
    const samples: Record<RunEventType, unknown> = {
      status: { type: "status", status: "waiting", waitReason: "approval", reason: null },
      step: {
        type: "step",
        seq: 3,
        phase: "act",
        state: "aborted",
        caption: "Clicking Check",
        url: "https://learn.zybooks.com/",
        screenshotKey: null,
        action: { tool: "computer", summary: "click Check", point: { x: 10, y: 20 } },
      },
      control: { type: "control", holder: "user" },
      slot: { type: "slot", slotName: "browser-2" },
      approval_requested: {
        type: "approval_requested",
        approvalId: id,
        request: { kind: "new_origin", origin: "https://b.com", url: "https://b.com/x" },
      },
      approval_resolved: {
        type: "approval_resolved",
        approvalId: id,
        status: "approved",
        decidedBy: "policy",
      },
      block_added: {
        type: "block_added",
        noteId: id,
        blockId: id,
        blockType: "paragraph",
        origin: "dom",
      },
      budget: { type: "budget", usage: EMPTY_USAGE, budget: DEFAULT_BUDGET },
      user_message: { type: "user_message", text: "Do reading 2 next", interrupt: true },
      user_messages_read: { type: "user_messages_read", through: "42" },
      approval_mode_changed: {
        type: "approval_mode_changed",
        from: "ask",
        to: "bypass",
        by: "6f2c8a3e-0000-4000-8000-000000000000",
      },
      download_ready: {
        type: "download_ready",
        downloadId: id,
        assetId: id,
        filename: "a.pdf",
        bytes: 10,
      },
      download_pending: {
        type: "download_pending",
        downloadId: id,
        filename: "a.pdf",
        bytes: 10,
      },
      error: { type: "error", code: "openai_5xx", message: "Model unavailable" },
      filed: {
        type: "filed",
        noteId: id,
        folderId: id,
        path: ["CS", "zyBooks"],
        filedBy: "agent",
      },
      model_fallback: { type: "model_fallback", from: "gpt-6-astra", to: "gpt-6.1-sol" },
    };
    expect(Object.keys(samples).sort()).toEqual([...RUN_EVENT_TYPES].sort());
    for (const type of RUN_EVENT_TYPES) expect(RunEvent.parse(samples[type]).type).toBe(type);
    // B6 A3: a download is always linked to its stored asset.
    const { assetId: _assetId, ...withoutAsset } = samples.download_ready as Record<
      string,
      unknown
    >;
    expect(RunEvent.safeParse(withoutAsset).success).toBe(false);
  });

  it("keeps user_message's interrupt optional, so messages stored before it still parse", () => {
    expect(RunEvent.parse({ type: "user_message", text: "hi" })).toEqual({
      type: "user_message",
      text: "hi",
    });
    expect(RunEvent.safeParse({ type: "user_messages_read", through: "not-an-id" }).success).toBe(
      false,
    );
    expect(
      RunEvent.safeParse({ type: "approval_mode_changed", from: "ask", to: "yolo", by: "u" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown event types", () => {
    expect(RunEvent.safeParse({ type: "screencast_frame" }).success).toBe(false);
  });

  it("wraps events in records with bigserial ids as strings", () => {
    const event = { type: "control", holder: "agent" };
    expect(
      RunEventRecord.safeParse({ id: "42", runId: id, at: "2026-10-05T12:00:00Z", event }).success,
    ).toBe(true);
    expect(
      RunEventRecord.safeParse({ id: "4x", runId: id, at: "2026-10-05T12:00:00Z", event }).success,
    ).toBe(false);
  });
});

describe("StepAction.pointer (run view A1)", () => {
  const base = { tool: "computer", summary: "Clicked", point: { x: 1, y: 2 } } as const;
  it("is optional and limited to pointer kinds", () => {
    expect(StepAction.parse(base)).not.toHaveProperty("pointer");
    expect(StepAction.parse({ ...base, pointer: "click" }).pointer).toBe("click");
    expect(StepAction.safeParse({ ...base, pointer: "type" }).success).toBe(false);
    expect(POINTER_KINDS).toEqual(["click", "double_click", "drag", "move", "scroll"]);
  });
  it("pointerOf names pointer actions and leaves keyboard and idle actions out", () => {
    expect(pointerOf({ type: "click", x: 1, y: 2, button: "left" })).toBe("click");
    expect(pointerOf({ type: "scroll", x: 1, y: 2, scroll_x: 0, scroll_y: 100 })).toBe("scroll");
    expect(pointerOf({ type: "keypress", keys: ["ENTER"] })).toBeUndefined();
    expect(pointerOf({ type: "type", text: "x" })).toBeUndefined();
    expect(pointerOf({ type: "wait" })).toBeUndefined();
  });
});

describe("step reasoning summaries (fe-run-chat)", () => {
  const step = {
    type: "step",
    seq: 4,
    phase: "decide",
    state: "done",
    caption: "Planning the sign-in",
    url: null,
    screenshotKey: null,
    action: null,
  } as const;
  it("is optional, so events stored before it still parse", () => {
    expect(RunEvent.parse(step)).not.toHaveProperty("reasoning");
    expect(RunEvent.parse({ ...step, reasoning: "Find the sign-in link first." })).toMatchObject({
      reasoning: "Find the sign-in link first.",
    });
  });
  it("is capped at REASONING_SUMMARY_MAX", () => {
    const long = "x".repeat(REASONING_SUMMARY_MAX + 1);
    expect(RunEvent.safeParse({ ...step, reasoning: long }).success).toBe(false);
  });
});
