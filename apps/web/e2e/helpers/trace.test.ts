import { describe, expect, it } from "vitest";
import { MOTION_MARKS, analyzeTrace, type TraceEvent } from "./trace.ts";

const mark = (message: string, ts: number): TraceEvent => ({
  name: "TimeStamp",
  cat: "devtools.timeline",
  ph: "I",
  ts,
  pid: 1,
  tid: 1,
  args: { data: { message } },
});
const frame = (ts: number): TraceEvent => ({
  name: "DrawFrame",
  cat: "disabled-by-default-devtools.timeline.frame",
  ph: "I",
  ts,
  pid: 1,
  tid: 1,
});
const paint = (ts: number, nodeId: number): TraceEvent => ({
  name: "Paint",
  cat: "devtools.timeline",
  ph: "X",
  ts,
  dur: 50,
  pid: 1,
  tid: 1,
  args: { data: { nodeId } },
});
const layout = (ts: number, nodeId: number): TraceEvent => ({
  name: "Layout",
  cat: "devtools.timeline",
  ph: "X",
  ts,
  dur: 50,
  pid: 1,
  tid: 1,
  args: { endData: { layoutRoots: [{ nodeId }] } },
});
const window = (...events: TraceEvent[]) => [
  mark(MOTION_MARKS.ready, 0),
  ...events,
  mark(MOTION_MARKS.end, 200_000),
];

describe("analyzeTrace (D28, P8-28)", () => {
  it("counts frames and long frames between the ready and end marks", () => {
    const v = analyzeTrace(
      window(...[10_000, 26_600, 43_200, 70_000, 86_600].map(frame)),
      new Set(),
    );
    expect(v).toMatchObject({ frames: 5, longFrames: 1 });
    expect(v.worstFrameMs).toBeCloseTo(26.8, 1);
  });

  it("counts layout and paint only inside the animated subtree and after the warm-up frames", () => {
    const scope = new Set([7, 8]);
    const v = analyzeTrace(
      window(
        frame(10_000),
        paint(12_000, 7),
        frame(26_600),
        paint(40_000, 7),
        layout(41_000, 8),
        paint(42_000, 99),
        layout(43_000, 99),
        frame(43_200),
      ),
      scope,
    );
    expect(v.paints).toBe(1);
    expect(v.layouts).toBe(1);
  });

  it("ignores events outside the marks", () => {
    const v = analyzeTrace([frame(-5), paint(-4, 7), ...window(), paint(300_000, 7)], new Set([7]));
    expect(v).toMatchObject({ frames: 0, paints: 0, layouts: 0 });
  });

  it("refuses a trace without both marks (a harness error, not a pass)", () => {
    expect(() => analyzeTrace([frame(1)], new Set())).toThrow(/marks/);
  });
});
