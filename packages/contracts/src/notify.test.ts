import { describe, expect, it } from "vitest";
import { NOTIFY_CHANNELS, assertNotifySize, decodeNotify, encodeNotify } from "./notify.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("NOTIFY payloads", () => {
  it("lists the spec channels", () => {
    expect(NOTIFY_CHANNELS).toEqual([
      "run_queued",
      "run_wake",
      "run_control",
      "otp_ready",
      "run_event",
    ]);
  });
  it("round-trips ids-only payloads", () => {
    const text = encodeNotify("run_wake", { runId, reason: "takeover" });
    expect(decodeNotify("run_wake", text)).toEqual({ runId, reason: "takeover" });
    expect(
      decodeNotify("run_wake", encodeNotify("run_wake", { runId: null, reason: "kill" })),
    ).toEqual({ runId: null, reason: "kill" });
  });
  it("refuses extra keys so page content can never ride along", () => {
    expect(() =>
      encodeNotify("run_queued", { runId, note: "x" } as unknown as { runId: string }),
    ).toThrow();
  });
  it("enforces the 200-byte limit", () => {
    expect(() => assertNotifySize("x".repeat(201))).toThrow(/200/);
    expect(() => assertNotifySize("x".repeat(200))).not.toThrow();
  });
  it("rejects malformed text", () => {
    expect(() => decodeNotify("run_event", "not json")).toThrow();
    expect(() => decodeNotify("run_event", JSON.stringify({ runId, eventId: "abc" }))).toThrow();
  });
});
