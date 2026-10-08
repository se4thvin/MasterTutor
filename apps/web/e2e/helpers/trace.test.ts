import { describe, expect, it } from "vitest";
import { MOTION_MARKS, analyzeTrace, type MotionScope, type TraceEvent } from "./trace.ts";

const event = (name: string, ts: number, data?: TraceEvent["args"]): TraceEvent => ({
  name,
  cat: "devtools.timeline",
  ph: "I",
  ts,
  pid: 1,
  tid: 1,
  ...(data ? { args: data } : {}),
});
const mark = (message: string, ts: number) => event("TimeStamp", ts, { data: { message } });
const frame = (ts: number) => event("DrawFrame", ts);
/** A Paint of the layer owned by `nodeId` (Chromium attributes paints to the layer, not the element). */
const paint = (ts: number, nodeId: number) => event("Paint", ts, { data: { nodeId } });
const styled = (ts: number, nodeId: number, reason = "Animation") =>
  event("StyleRecalcInvalidationTracking", ts, { data: { nodeId, reason } });
const laidOut = (ts: number, nodeId: number, reason = "Style changed") =>
  event("LayoutInvalidationTracking", ts, { data: { nodeId, reason } });

/** Nodes 7 and 8 animate; node 1 (#document) is the layer they paint in; 99 is elsewhere. */
const SCOPE: MotionScope = { nodes: new Set([7, 8]), ancestors: new Set([1]) };
const window = (...events: TraceEvent[]) => [
  mark(MOTION_MARKS.ready, 0),
  mark(MOTION_MARKS.triggered, 5_000),
  ...events,
  mark(MOTION_MARKS.end, 200_000),
];

describe("analyzeTrace (D28, P8-28, I6)", () => {
  it("counts frames and long frames between the ready and end marks", () => {
    const v = analyzeTrace(window(...[10_000, 26_600, 43_200, 70_000, 86_600].map(frame)), SCOPE);
    expect(v).toMatchObject({ frames: 5, longFrames: 1 });
    expect(v.worstFrameMs).toBeCloseTo(26.8, 1);
  });

  it("counts layout frames by the element invalidated, even when the relayout root is the document", () => {
    const v = analyzeTrace(
      window(
        frame(10_000),
        frame(26_600),
        laidOut(30_000, 7),
        laidOut(31_000, 8), // the same frame: one layout frame
        event("Layout", 31_100, { data: { nodeId: 1 } }),
        frame(43_200),
        laidOut(50_000, 99), // outside the scope
        frame(60_000),
      ),
      SCOPE,
    );
    expect(v.layouts).toBe(1);
  });

  it("counts a paint frame only when a scoped element changed and its layer painted", () => {
    const v = analyzeTrace(
      window(
        frame(10_000),
        frame(26_600),
        styled(30_000, 7),
        paint(30_500, 1), // a background-color change on 7, painted in the document layer
        frame(43_200),
        styled(45_000, 7), // a transform change: no Paint follows
        frame(60_000),
        styled(61_000, 99),
        paint(61_500, 1), // something else repainted the layer; nothing in the scope changed
        frame(76_600),
        styled(77_000, 7),
        paint(77_500, 42), // a layer the scope is not painted in
        frame(93_200),
      ),
      SCOPE,
    );
    expect(v).toMatchObject({ layouts: 0, paints: 1 });
  });

  it("does not count content entering the page as motion", () => {
    const v = analyzeTrace(
      window(
        frame(10_000),
        frame(26_600),
        laidOut(30_000, 7, "Added to layout"),
        styled(30_100, 8, "Node was inserted into tree"),
        paint(30_500, 1),
        frame(43_200),
      ),
      SCOPE,
    );
    expect(v).toMatchObject({ layouts: 0, paints: 0 });
  });

  it("counts from the frames after the trigger returned, not after the ready mark", () => {
    const v = analyzeTrace(
      [
        mark(MOTION_MARKS.ready, 0),
        frame(10_000),
        frame(26_600),
        laidOut(30_000, 7), // during the trigger
        mark(MOTION_MARKS.triggered, 50_000),
        frame(60_000),
        laidOut(61_000, 7), // warm-up
        frame(76_600),
        laidOut(80_000, 7), // the motion
        frame(93_200),
        mark(MOTION_MARKS.end, 200_000),
      ],
      SCOPE,
    );
    expect(v).toMatchObject({ frames: 5, layouts: 1 });
  });

  it("ignores events outside the marks", () => {
    const v = analyzeTrace(
      [frame(-5), laidOut(-4, 7), ...window(), frame(300_000), laidOut(299_000, 7)],
      SCOPE,
    );
    expect(v).toMatchObject({ frames: 0, paints: 0, layouts: 0 });
  });

  it("refuses a trace without its marks (a harness error, not a pass)", () => {
    expect(() => analyzeTrace([frame(1)], SCOPE)).toThrow(/marks/);
    expect(() =>
      analyzeTrace([mark(MOTION_MARKS.ready, 0), mark(MOTION_MARKS.end, 9)], SCOPE),
    ).toThrow(/marks/);
  });
});
