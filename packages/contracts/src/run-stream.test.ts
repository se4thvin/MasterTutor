import { describe, expect, it } from "vitest";
import { RunEventRecord } from "./events.ts";
import {
  approvalScreenshotPath,
  compareEventIds,
  decodeRunEventData,
  encodeRunEventSse,
  resumeAfter,
  runEventsPath,
  stepScreenshotPath,
} from "./run-stream.ts";

const runId = "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d";
const approvalId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const record = RunEventRecord.parse({
  id: "42",
  runId,
  at: "2026-10-05T17:10:00.000Z",
  event: { type: "user_message", text: "line one\nline two" },
});

describe("run stream wire format", () => {
  it("builds the events and screenshot paths and validates their inputs", () => {
    expect(runEventsPath(runId)).toBe(`/api/runs/${runId}/events`);
    expect(runEventsPath(runId, "12")).toBe(`/api/runs/${runId}/events?after=12`);
    expect(() => runEventsPath("not-a-uuid")).toThrow();
    expect(() => runEventsPath(runId, "12; drop")).toThrow();
    expect(stepScreenshotPath(runId, 7)).toBe(`/api/runs/${runId}/steps/7/screenshot`);
    expect(() => stepScreenshotPath(runId, -1)).toThrow();
    expect(approvalScreenshotPath(runId, approvalId)).toBe(
      `/api/runs/${runId}/approvals/${approvalId}/screenshot`,
    );
    expect(() => approvalScreenshotPath(runId, "../keys")).toThrow();
  });

  it("encodes one SSE message per record with exactly one data line", () => {
    const text = encodeRunEventSse(record);
    expect(text).toBe(`id: 42\nevent: run_event\ndata: ${JSON.stringify(record)}\n\n`);
    expect(text.split("\n").filter((line) => line.startsWith("data:"))).toHaveLength(1);
  });

  it("decodes valid data and returns null for junk", () => {
    expect(decodeRunEventData(JSON.stringify(record))).toEqual(record);
    expect(decodeRunEventData("{")).toBeNull();
    expect(decodeRunEventData(JSON.stringify({ ...record, id: "x" }))).toBeNull();
  });

  it("prefers Last-Event-ID over ?after=", () => {
    expect(resumeAfter("15", "12")).toBe("15");
    expect(resumeAfter(null, "12")).toBe("12");
    expect(resumeAfter("junk", "12")).toBe("12");
    expect(resumeAfter(null, null)).toBeNull();
  });

  it("accepts only canonical bigserial ids: no leading zeros, at most the bigint maximum's digits", () => {
    expect(resumeAfter("012", null)).toBeNull();
    expect(resumeAfter("0", null)).toBe("0");
    expect(resumeAfter("9223372036854775807", null)).toBe("9223372036854775807");
    expect(resumeAfter("12345678901234567890", null)).toBeNull();
    expect(() => runEventsPath(runId, "007")).toThrow();
  });

  it("orders bigserial ids numerically, beyond 2^53", () => {
    expect(compareEventIds("9", "10")).toBeLessThan(0);
    expect(compareEventIds("9007199254740993", "9007199254740992")).toBeGreaterThan(0);
    expect(compareEventIds("77", "77")).toBe(0);
  });
});
