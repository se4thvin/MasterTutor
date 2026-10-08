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
    data?: { message?: string; nodeId?: number; reason?: string };
  };
}
export interface MotionVerdict {
  frames: number;
  longFrames: number;
  worstFrameMs: number;
  layouts: number;
  paints: number;
}

/** console.timeStamp labels: ready before the trigger, triggered right after it, end. */
export const MOTION_MARKS = {
  ready: "mt-motion-ready",
  triggered: "mt-motion-triggered",
  end: "mt-motion-end",
} as const;
const FRAME_BUDGET_US = 16_700;

/** The animated subtree's backend node ids, and the ids of its ancestors (the layers it paints in). */
export interface MotionScope {
  nodes: ReadonlySet<number>;
  ancestors: ReadonlySet<number>;
}

/** Invalidation tracking names the element whose style or layout changed (I6). */
const INVALIDATION_CATEGORY = "disabled-by-default-devtools.timeline.invalidationTracking";
const STYLE_CHANGE = "StyleRecalcInvalidationTracking";
const LAYOUT_CHANGE = "LayoutInvalidationTracking";
/** Content entering or leaving the page is not motion: a mounted dialog lays out and paints once. */
const CONTENT_REASONS = new Set([
  "Added to layout",
  "Removed from layout",
  "Node was inserted into tree",
]);

/**
 * Spec §12 / D28: no frame over 16.7 ms, and no layout or paint caused by motion inside the
 * animated subtree. Frames count from the ready mark, stamped before the trigger. Layout and paint
 * count frames, from the `warmupFrames`-th frame after the trigger returned to the end mark (I6):
 * - a layout frame has a layout invalidation on a scoped element (invalidation tracking names the
 *   element even when the relayout's root is the document);
 * - a paint frame has a style or layout invalidation on a scoped element and a Paint of a layer the
 *   subtree is painted in (the scope or an ancestor). Chromium emits no Paint for transform or
 *   opacity changes, composited or not, so compositor-only motion counts zero.
 * Content entering or leaving the page is not motion and does not count.
 */
export function analyzeTrace(
  events: readonly TraceEvent[],
  scope: MotionScope,
  warmupFrames = 2,
): MotionVerdict {
  const markAt = (message: string) =>
    events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === message)?.ts;
  const start = markAt(MOTION_MARKS.ready);
  const triggered = markAt(MOTION_MARKS.triggered);
  const end = markAt(MOTION_MARKS.end);
  if (start === undefined || triggered === undefined || end === undefined)
    throw new Error("trace is missing the motion marks");

  const frames = events
    .filter((e) => e.name === "DrawFrame" && e.ts > start && e.ts <= end)
    .map((e) => e.ts)
    .sort((a, b) => a - b);
  let longFrames = 0;
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i]! - frames[i - 1]!;
    worst = Math.max(worst, gap);
    if (gap > FRAME_BUDGET_US) longFrames++;
  }
  const warm = frames.filter((ts) => ts > triggered)[warmupFrames - 1] ?? end;
  // The frame an event belongs to: the first DrawFrame at or after it.
  const frameOf = (ts: number) => frames.findIndex((f) => f >= ts);
  const node = (e: TraceEvent) => e.args?.data?.nodeId;
  const motion = (e: TraceEvent) =>
    scope.nodes.has(node(e) ?? -1) && !CONTENT_REASONS.has(e.args?.data?.reason ?? "");
  const layoutFrames = new Set<number>();
  const changedFrames = new Set<number>();
  const paintedFrames = new Set<number>();
  for (const e of events) {
    if (e.ts < warm || e.ts > end) continue;
    const at = frameOf(e.ts);
    if ((e.name === LAYOUT_CHANGE || e.name === STYLE_CHANGE) && motion(e)) changedFrames.add(at);
    if (e.name === LAYOUT_CHANGE && motion(e)) layoutFrames.add(at);
    const layer = node(e) ?? -1;
    if (e.name === "Paint" && (scope.nodes.has(layer) || scope.ancestors.has(layer)))
      paintedFrames.add(at);
  }
  return {
    frames: frames.length,
    longFrames,
    worstFrameMs: worst / 1000,
    layouts: layoutFrames.size,
    paints: [...paintedFrames].filter((at) => changedFrames.has(at)).length,
  };
}

async function backendIds(cdp: CDPSession, rootId: number, selector: string): Promise<number[]> {
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: rootId, selector });
  const ids: number[] = [];
  for (const nodeId of nodeIds)
    ids.push((await cdp.send("DOM.describeNode", { nodeId })).node.backendNodeId);
  return ids;
}

async function motionScope(cdp: CDPSession, selector: string): Promise<MotionScope> {
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const nodes = await backendIds(cdp, root.nodeId, `${selector}, ${selector} *`);
  if (nodes.length === 0) throw new Error(`motion scope ${selector} is not on the page`);
  const ancestors = await backendIds(cdp, root.nodeId, `:has(${selector})`);
  return { nodes: new Set(nodes), ancestors: new Set([root.backendNodeId, ...ancestors]) };
}

/**
 * Traces one motion: tracing and the ready mark come before the trigger (which may navigate, so
 * mount animations are caught, P8-27); counts are scoped to the animated subtree. A trigger only
 * starts the motion: it must not wait for the end state, or the motion is over before it is measured.
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
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        INVALIDATION_CATEGORY,
      ],
    },
  });
  try {
    // Ready before the trigger, so the whole motion is inside the window (I6).
    await page.evaluate((label) => console.timeStamp(label), MOTION_MARKS.ready);
    await run.trigger(page);
    await page.evaluate((label) => console.timeStamp(label), MOTION_MARKS.triggered);
    await page.waitForTimeout(run.durationMs);
    await page.evaluate((label) => console.timeStamp(label), MOTION_MARKS.end);
  } finally {
    await cdp.send("Tracing.end");
    await complete;
  }
  const scope = await motionScope(cdp, run.scope);

  await cdp.detach();
  return analyzeTrace(events, scope);
}
