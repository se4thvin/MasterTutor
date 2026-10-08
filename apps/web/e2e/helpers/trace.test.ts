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

/** Nodes 7 and 8 animate, in their own layer owned by 7 (ISOLATE); 1 is #document; 99 is elsewhere. */
const SCOPE: MotionScope = { nodes: new Set([7, 8]), glass: new Set() };
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
        laidOut(80_000, 7), // the motion
        frame(93_200),
        mark(MOTION_MARKS.end, 200_000),
      ],
      SCOPE,
    );
    expect(v).toMatchObject({ frames: 5, layouts: 1 });
  });

  describe("frosted-glass panels (D49)", () => {
    // Node 8 is a glass panel in its own layer; 7 owns the subtree's layer.
    const GLASS: MotionScope = { nodes: new Set([7, 8]), glass: new Set([8]) };
    const glassFrames = (count: number, also: TraceEvent[] = []) => {
      const events: TraceEvent[] = [frame(10_000)];
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
    expect(v).toMatchObject({ frames: 0, paints: 0, layouts: 0 });
  });

  it("refuses a trace without its marks (a harness error, not a pass)", () => {
    expect(() => analyzeTrace([frame(1)], SCOPE)).toThrow(/marks/);
    expect(() =>
      analyzeTrace([mark(MOTION_MARKS.ready, 0), mark(MOTION_MARKS.end, 9)], SCOPE),
    ).toThrow(/marks/);
  });
});
