import { encodeRunEventSse, type RunEventRecord } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { eventsOf, parseSse, recordsOf } from "./events.ts";

const RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const record = (id: string): RunEventRecord => ({
  id,
  runId: RUN,
  at: "2026-10-06T10:00:00.000Z",
  event: { type: "status", status: "running", waitReason: null, reason: null },
});

describe("SSE parsing for the real run-events route", () => {
  it("reads retry, skips comments, and decodes one run_event per record", () => {
    const body = `retry: 3000\n\n: keep-alive\n\n${encodeRunEventSse(record("1"))}${encodeRunEventSse(record("2"))}`;
    const frames = parseSse(body);
    expect(frames[0]).toEqual({ id: null, event: null, data: "", retry: 3000 });
    expect(recordsOf(frames).map((r) => r.id)).toEqual(["1", "2"]);
    expect(eventsOf(recordsOf(frames), "status")).toHaveLength(2);
  });

  it("refuses a frame whose id disagrees with its record", () => {
    const body = encodeRunEventSse(record("2")).replace("id: 2", "id: 3");
    expect(() => recordsOf(parseSse(body))).toThrow(/frame id 3/);
  });

  it("drops an unterminated trailing frame, as EventSource does", () => {
    expect(parseSse(`id: 1\nevent: run_event\ndata: {}`)).toEqual([]);
  });
});
