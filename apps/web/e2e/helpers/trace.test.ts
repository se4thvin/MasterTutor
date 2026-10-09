import { describe, expect, it } from "vitest";
import {
  GLASS_PAINT_FRAMES,
  MOTION_MARKS,
  analyzeTrace,
  type MotionScope,
  type TraceEvent,
} from "./trace.ts";

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

/** Nodes 7 and 8 animate, in their own layer owned by 7 (isolate); 9 holds an iframe; 1 is #document; 99 is elsewhere. */
const SCOPE: MotionScope = { nodes: new Set([7, 8, 9]), glass: new Set(), embeds: new Set([9]) };
/** The motion's first frame (7 starts moving), which mounts and promotes and is never counted. */
const start = (): TraceEvent[] => [styled(6_000, 7), paint(6_100, 7), laidOut(6_200, 7)];
const window = (...events: TraceEvent[]) => [
  mark(MOTION_MARKS.ready, 0),
  mark(MOTION_MARKS.triggered, 5_000),
  ...start(),
  frame(7_000),
  ...events,
  mark(MOTION_MARKS.end, 200_000),
];

describe("analyzeTrace (D28, P8-28, I6)", () => {
  it("counts frames and long frames between the ready and end marks", () => {
    const v = analyzeTrace(window(...[10_000, 26_600, 43_200, 70_000, 86_600].map(frame)), SCOPE);
    expect(v).toMatchObject({ frames: 6, longFrames: 1 });
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

  it("counts a paint frame only when a scoped element changed and the subtree's layer painted", () => {
    const v = analyzeTrace(
      window(
        frame(10_000),
        frame(26_600),
        styled(30_000, 8),
        paint(30_500, 7), // a background-color change on 8, painted in the subtree's layer
        frame(43_200),
        styled(45_000, 7), // a transform change: no Paint follows
        frame(60_000),
        styled(61_000, 99),
        paint(61_500, 7), // the layer painted, but nothing in the scope changed
        frame(76_600),
        styled(77_000, 7),
        paint(77_500, 1), // a transform tick on 7 while a timer elsewhere repaints the document
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
        paint(30_500, 7),
        frame(43_200),
      ),
      SCOPE,
    );
    expect(v).toMatchObject({ layouts: 0, paints: 0 });
  });

  it("counts from the triggered mark (stamped frames after the trigger), not the ready mark", () => {
    const v = analyzeTrace(
      [
        mark(MOTION_MARKS.ready, 0),
        frame(10_000),
        frame(26_600),
        laidOut(30_000, 7), // during the trigger
        frame(43_200),
        laidOut(61_000, 7), // the trigger's own frame, however late a busy host produces it
        frame(76_600),
        mark(MOTION_MARKS.triggered, 77_000),
        laidOut(80_000, 7), // the motion's first frame: it starts here, not counted
        frame(93_200),
        laidOut(95_000, 7), // the motion
        frame(109_800),
        mark(MOTION_MARKS.end, 200_000),
      ],
      SCOPE,
    );
    expect(v).toMatchObject({ frames: 6, layouts: 1 });
  });

  it("starts counting on the frame after the motion's first, however late that frame comes", () => {
    const late = (startAt: number) =>
      analyzeTrace(
        [
          mark(MOTION_MARKS.ready, 0),
          mark(MOTION_MARKS.triggered, 5_000),
          frame(10_000),
          frame(60_000), // a busy host: frames come late, the async trigger applies later still
          styled(70_000, 7),
          paint(70_100, 7), // first frame: mounts and first-paints, never counted
          frame(startAt),
          styled(startAt + 1_000, 7),
          frame(startAt + 16_600),
          mark(MOTION_MARKS.end, 400_000),
        ],
        SCOPE,
      );
    expect(late(80_000)).toMatchObject({ paints: 0, layouts: 0 });
    expect(late(300_000)).toMatchObject({ paints: 0, layouts: 0 });
  });

  it("does not count a paint in a frame where scoped content entered", () => {
    const v = analyzeTrace(
      window(
        styled(20_000, 7),
        laidOut(20_100, 8, "Added to layout"), // a new digit
        paint(20_200, 7),
        frame(21_000),
      ),
      SCOPE,
    );
    expect(v.paints).toBe(0);
  });

  it("does not count an element's first paint, even after the motion started; its later paints count", () => {
    const appears = window(
      frame(10_000),
      styled(20_000, 7),
      paint(20_100, 8), // 8 (its own layer) shows up two frames into the motion: its first paint
      frame(21_000),
    );
    expect(analyzeTrace(appears, SCOPE).paints).toBe(0);
    const repaints = window(
      frame(10_000),
      styled(20_000, 7),
      paint(20_100, 8),
      frame(21_000),
      styled(30_000, 8),
      paint(30_100, 8), // then repaints as it moves: a finding
      frame(31_000),
    );
    expect(analyzeTrace(repaints, SCOPE).paints).toBe(1);
  });

  it("does not count an embedded page re-rastering inside the frame (the live view's iframe)", () => {
    const v = analyzeTrace(
      window(
        frame(10_000),
        paint(10_100, 9), // 9 holds the iframe: its first paint
        styled(20_000, 7),
        paint(20_100, 9), // the frame around it scales; the remote page re-rasters
        frame(21_000),
        styled(30_000, 7),
        paint(30_100, 9),
        frame(31_000),
      ),
      SCOPE,
    );
    expect(v.paints).toBe(0);
  });

  it("counts within the animation: a re-raster after the scope came to rest is not motion", () => {
    const v = analyzeTrace(
      window(
        styled(20_000, 7),
        frame(21_000),
        mark(MOTION_MARKS.settled, 30_000),
        styled(40_000, 7),
        paint(40_100, 7), // the layer re-rastered at its final scale, after the motion ended
        frame(41_000),
      ),
      SCOPE,
    );
    expect(v).toMatchObject({ paints: 0, layouts: 0 });
    // Without the settled mark (an endless motion), the window runs to the end mark.
    const open = analyzeTrace(
      window(styled(20_000, 7), frame(21_000), styled(40_000, 7), paint(40_100, 7), frame(41_000)),
      SCOPE,
    );
    expect(open.paints).toBe(1);
  });

  describe("frosted-glass panels (D49)", () => {
    // Node 8 is a glass panel in its own layer; 7 owns the subtree's layer.
    const GLASS: MotionScope = { nodes: new Set([7, 8]), glass: new Set([8]), embeds: new Set() };
    const glassFrames = (count: number, also: TraceEvent[] = []) => {
      // The panel appears (its first paint) with the motion's first frame.
      const events: TraceEvent[] = [paint(6_500, 8), frame(10_000)];
      for (let i = 0; i < count; i++) {
        const at = 20_000 + i * 16_600;
        events.push(styled(at, 8), paint(at + 100, 8), frame(at + 1_000));
      }
      return window(...events, ...also);
    };

    it(`may repaint on up to ${GLASS_PAINT_FRAMES} frames, recorded but not a finding`, () => {
      expect(analyzeTrace(glassFrames(GLASS_PAINT_FRAMES), GLASS)).toMatchObject({
        paints: 0,
        glassPaints: GLASS_PAINT_FRAMES,
      });
    });

    it("counts every frame past the allowance", () => {
      expect(analyzeTrace(glassFrames(GLASS_PAINT_FRAMES + 2), GLASS)).toMatchObject({
        paints: 2,
        glassPaints: GLASS_PAINT_FRAMES,
      });
    });

    it("is per panel: anything else painting in the frame is a finding, and layout always is", () => {
      const v = analyzeTrace(
        glassFrames(1, [styled(20_200, 7), paint(20_300, 7), laidOut(20_400, 8)]),
        GLASS,
      );
      expect(v).toMatchObject({ paints: 1, layouts: 1, glassPaints: 0 });
      // A non-glass layer gets no allowance at all.
      expect(analyzeTrace(glassFrames(1), { ...GLASS, glass: new Set() }).paints).toBe(1);
    });
  });

  it("ignores events outside the marks", () => {
    const v = analyzeTrace(
      [frame(-5), laidOut(-4, 7), ...window(), frame(300_000), laidOut(299_000, 7)],
      SCOPE,
    );
    expect(v).toMatchObject({ frames: 1, paints: 0, layouts: 0 });
  });

  it("refuses a trace without its marks (a harness error, not a pass)", () => {
    expect(() => analyzeTrace([frame(1)], SCOPE)).toThrow(/marks/);
    expect(() =>
      analyzeTrace([mark(MOTION_MARKS.ready, 0), mark(MOTION_MARKS.end, 9)], SCOPE),
    ).toThrow(/marks/);
  });
});
