import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORDED_RUN_ID as RUN_ID, recordedEvents } from "@/lib/fixtures/run-recording.ts";
import { LOST_GRACE_MS, connectRunEvents, reconnectDelayMs } from "./run-events.ts";

class FakeSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
    FakeSource.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  send(data: string) {
    this.dispatchEvent(new MessageEvent("run_event", { data }));
  }
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.(new Event("error"));
  }
  close() {
    this.readyState = 2;
  }
}

const last = () => FakeSource.all.at(-1)!;

function connect(after: string | null = "12") {
  const records: string[] = [];
  const states: string[] = [];
  const stream = connectRunEvents({
    runId: RUN_ID,
    after,
    onRecord: (r) => records.push(r.id),
    onConnection: (s) => states.push(s),
    EventSourceImpl: FakeSource as unknown as typeof EventSource,
  });
  return { stream, records, states };
}

beforeEach(() => {
  FakeSource.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("connectRunEvents", () => {
  it("connects after the snapshot id and delivers valid records for this run only", () => {
    const { records, states } = connect();
    expect(last().url).toBe(`/api/runs/${RUN_ID}/events?after=12`);
    last().open();
    const [a, b] = recordedEvents();
    last().send(JSON.stringify(a));
    last().send("{not json");
    last().send(JSON.stringify({ ...b, runId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f" }));
    expect(records).toEqual([a!.id]);
    expect(states).toEqual(["open"]);
  });

  it("lets the browser retry (CONNECTING) and reports lost only after the grace", () => {
    const { states } = connect();
    last().open();
    last().fail(false);
    expect(FakeSource.all).toHaveLength(1);
    vi.advanceTimersByTime(LOST_GRACE_MS - 1);
    expect(states).toEqual(["open"]);
    vi.advanceTimersByTime(1);
    expect(states).toEqual(["open", "lost"]);
    last().open();
    expect(states).toEqual(["open", "lost", "open"]);
  });

  it("reopens a CLOSED stream after backoff, resuming from the last delivered id", () => {
    connect();
    last().open();
    last().send(JSON.stringify(recordedEvents()[2]));
    last().fail(true);
    vi.advanceTimersByTime(reconnectDelayMs(0));
    expect(FakeSource.all).toHaveLength(2);
    expect(last().url).toBe(`/api/runs/${RUN_ID}/events?after=15`);
    last().fail(true);
    vi.advanceTimersByTime(reconnectDelayMs(1) - 1);
    expect(FakeSource.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSource.all).toHaveLength(3);
  });

  it("backs off exponentially to 8s", () => {
    expect([0, 1, 2, 3, 4, 5].map(reconnectDelayMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it("stops everything on close", () => {
    const { stream, states } = connect();
    last().fail(true);
    stream.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSource.all).toHaveLength(1);
    expect(states).toEqual([]);
  });
});
