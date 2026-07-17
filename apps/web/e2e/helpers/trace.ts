import type { CDPSession, Page } from "@playwright/test";

export interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: {
    data?: { message?: string; nodeId?: number };
    endData?: { rootNode?: number; layoutRoots?: { nodeId: number }[] };
  };
}
export interface MotionVerdict {
  frames: number;
  longFrames: number;
  worstFrameMs: number;
  layouts: number;
  paints: number;
}

/** console.timeStamp labels that bound the measured window inside the trace. */
export const MOTION_MARKS = { ready: "mt-motion-ready", end: "mt-motion-end" } as const;
const FRAME_BUDGET_US = 16_700;

/**
 * Spec §12 / D28: no frame over 16.7 ms, and no layout or paint caused inside the animated subtree
 * (`scope`: backend DOM node ids) once the first `warmupFrames` frames after the trigger are drawn.
 * Events with no node id cannot be attributed and are not counted (P8-28).
 */
export function analyzeTrace(
  events: readonly TraceEvent[],
  scope: ReadonlySet<number>,
  warmupFrames = 2,
): MotionVerdict {
  const markAt = (message: string) =>
    events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === message)?.ts;
  const start = markAt(MOTION_MARKS.ready);
  const end = markAt(MOTION_MARKS.end);
  if (start === undefined || end === undefined)
    throw new Error("trace is missing the motion marks");
  const inWindow = (e: TraceEvent) => e.ts > start && e.ts <= end;

  const frames = events
    .filter((e) => e.name === "DrawFrame" && inWindow(e))
    .map((e) => e.ts)
    .sort((a, b) => a - b);
  let longFrames = 0;
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i]! - frames[i - 1]!;
    worst = Math.max(worst, gap);
    if (gap > FRAME_BUDGET_US) longFrames++;
  }
  const warm = frames[warmupFrames - 1] ?? end;
  const nodes = (e: TraceEvent): number[] => {
    if (e.name === "Paint") return e.args?.data?.nodeId === undefined ? [] : [e.args.data.nodeId];
    const roots = e.args?.endData?.layoutRoots?.map((r) => r.nodeId);
    if (roots) return roots;
    return e.args?.endData?.rootNode === undefined ? [] : [e.args.endData.rootNode];
  };
  const count = (name: string) =>
    events.filter(
      (e) => e.name === name && inWindow(e) && e.ts >= warm && nodes(e).some((n) => scope.has(n)),
    ).length;
  return {
    frames: frames.length,
    longFrames,
    worstFrameMs: worst / 1000,
    layouts: count("Layout"),
    paints: count("Paint"),
  };
}

async function subtreeNodeIds(cdp: CDPSession, selector: string): Promise<Set<number>> {
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: `${selector}, ${selector} *`,
  });
  if (nodeIds.length === 0) throw new Error(`motion scope ${selector} is not on the page`);
  const ids = new Set<number>();
  for (const nodeId of nodeIds)
    ids.add((await cdp.send("DOM.describeNode", { nodeId })).node.backendNodeId);
  return ids;
}

/**
 * Traces one motion: tracing starts before the trigger (which may navigate, so mount animations
 * are caught, P8-27), the window runs from the ready mark to the end mark, and counts are scoped
 * to the animated subtree.
 */
export async function traceMotion(
  page: Page,
  run: { scope: string; trigger(page: Page): Promise<void>; durationMs: number },
): Promise<MotionVerdict> {
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  cdp.on("Tracing.dataCollected", (payload) =>
    events.push(...(payload.value as unknown as TraceEvent[])),
  );
  const complete = new Promise<void>((resolve) =>
    cdp.once("Tracing.tracingComplete", () => resolve()),
  );
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: {
      recordMode: "recordAsMuchAsPossible",
      includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline.frame"],
    },
  });
  try {
    await run.trigger(page);
    await page.evaluate((label) => console.timeStamp(label), MOTION_MARKS.ready);
    await page.waitForTimeout(run.durationMs);
    await page.evaluate((label) => console.timeStamp(label), MOTION_MARKS.end);
  } finally {
    await cdp.send("Tracing.end");
    await complete;
  }
  const scope = await subtreeNodeIds(cdp, run.scope);
  await cdp.detach();
  return analyzeTrace(events, scope);
}
