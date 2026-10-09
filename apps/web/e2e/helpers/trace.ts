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
  /** Frames on which frosted-glass panels repainted within their allowance (D49), for the record. */
  glassPaints: number;
}

/** console.timeStamp labels: ready before the trigger, triggered right after it, end. */
export const MOTION_MARKS = {
  ready: "mt-motion-ready",
  triggered: "mt-motion-triggered",
  /** The scope came to rest: its CSS animations and transitions ended and no inline style moves. */
  settled: "mt-motion-settled",
  end: "mt-motion-end",
} as const;
const FRAME_BUDGET_US = 16_700;

/** The animated subtree's backend node ids. traceMotion gives the subtree its own layer. */
export interface MotionScope {
  nodes: ReadonlySet<number>;
  /** Its frosted-glass panels (a backdrop-filter): each may repaint on a few frames (D49). */
  glass: ReadonlySet<number>;
  /**
   * Holders of an embedded page (an element whose child is an <iframe>: the live view). The page
   * inside is another document, the remote browser's: re-rastered as the frame around it moves,
   * its pixels are not this app's motion, so its layer's paints are not counted.
   */
  embeds: ReadonlySet<number>;
}

/**
 * D49: a frosted-glass panel (backdrop-filter) re-rasterizes its blurred backdrop while it appears
 * or changes size, so it may repaint on at most this many frames of a motion. The allowance is per
 * panel and only for paints of the panel's own layer: a frame where anything else in the subtree
 * paints is a finding, and so is any layout.
 */
export const GLASS_PAINT_FRAMES = 4;

/**
 * Promotes the animated subtree to its own layer for the trace. Chromium attributes a Paint to the
 * layer, not the element, so without it the subtree paints in an ancestor's layer (often the whole
 * document), where any unrelated repaint in the same frame, a ticking timer or a cursor elsewhere,
 * looked like the motion's. In its own layer, a Paint of the subtree is the subtree's. `opacity`
 * promotes without making a containing block, so fixed and sticky descendants keep their layout.
 * It is added to whatever will-change the element already has (a frame that scales keeps its
 * transform hint, and is measured as the product ships it): on the scope's elements present now
 * inline, and by a rule for a scope the trigger mounts later.
 */
async function isolate(page: Page, scope: string): Promise<void> {
  await page.evaluate((selector) => {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const own = getComputedStyle(el).willChange;
      const hints = own === "auto" ? "opacity" : `${own}, opacity`;
      el.style.setProperty("will-change", hints, "important");
      el.setAttribute("data-mt-isolated", "");
    }
  }, scope);
  await page.addStyleTag({
    content: `${scope}:not([data-mt-isolated]) { will-change: opacity !important }`,
  });
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
 * count the motion's frames, from the frame after the first one where a scoped element moves to
 * the end mark (I6). That first frame mounts, promotes and first-paints what moves, and is not
 * counted. traceMotion stamps the triggered mark from the second requestAnimationFrame after the
 * trigger, so the trigger's own frame (its hover, press or content change) is behind the window,
 * and the window is found by what moves, not by wall time, so a slow host only shifts it:
 * - a layout frame has a layout invalidation on a scoped element (invalidation tracking names the
 *   element even when the relayout's root is the document);
 * - a paint frame has a style or layout invalidation on a scoped element and a Paint of the
 *   subtree's own layer (isolate). Chromium emits no Paint for transform or opacity changes, so
 *   compositor-only motion counts zero.
 * Content entering or leaving the page is not motion and does not count, nor does a paint in a
 * frame where scoped content entered (a new digit, a new caption), nor a layer's first paint in
 * the window (an element appearing, even after the motion started). A frame where only
 * frosted-glass panels painted counts against each panel's GLASS_PAINT_FRAMES instead.
 */
export function analyzeTrace(events: readonly TraceEvent[], scope: MotionScope): MotionVerdict {
  const markAt = (message: string) =>
    events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === message)?.ts;
  const start = markAt(MOTION_MARKS.ready);
  const triggered = markAt(MOTION_MARKS.triggered);
  const end = markAt(MOTION_MARKS.end);
  if (start === undefined || triggered === undefined || end === undefined)
    throw new Error("trace is missing the motion marks");
  // Layout and paint count within the animation only: once the scope has come to rest, Chromium
  // re-rasters a layer that was scaled or moved at its final scale (one paint, after the motion),
  // and on a slow host that lands before the end mark. Frame times still run to the end mark.
  const settledAt = events
    .filter((e) => e.name === "TimeStamp" && e.args?.data?.message === MOTION_MARKS.settled)
    .map((e) => e.ts)
    .filter((ts) => ts <= end);
  const settled = settledAt.length > 0 ? Math.max(...settledAt) : end;

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
  // The frame an event belongs to: the first DrawFrame at or after it.
  const frameOf = (ts: number) => frames.findIndex((f) => f >= ts);
  const node = (e: TraceEvent) => e.args?.data?.nodeId;
  const motion = (e: TraceEvent) =>
    scope.nodes.has(node(e) ?? -1) && !CONTENT_REASONS.has(e.args?.data?.reason ?? "");
  const content = (e: TraceEvent) =>
    scope.nodes.has(node(e) ?? -1) && CONTENT_REASONS.has(e.args?.data?.reason ?? "");
  // A frame where content enters the subtree (a new digit, a new caption) paints it: not motion.
  const contentFrames = new Set<number>();
  const layoutFrames = new Set<number>();
  const changedFrames = new Set<number>();
  const painted = new Map<number, Set<number>>(); // frame -> the scoped layers that painted
  const startsOwnMotion = new Map<number, number>(); // element -> the frame it starts to move
  for (const e of events) {
    if (e.ts < triggered || e.ts > settled) continue;
    const at = frameOf(e.ts);
    if ((e.name === LAYOUT_CHANGE || e.name === STYLE_CHANGE) && motion(e)) {
      changedFrames.add(at);
      const moved = node(e) ?? -1;
      if (!startsOwnMotion.has(moved)) startsOwnMotion.set(moved, at);
    }
    if (e.name === LAYOUT_CHANGE && content(e)) contentFrames.add(at);
    if (e.name === LAYOUT_CHANGE && motion(e)) layoutFrames.add(at);
    const layer = node(e) ?? -1;
    if (e.name === "Paint" && scope.nodes.has(layer) && !scope.embeds.has(layer))
      painted.set(at, (painted.get(at) ?? new Set()).add(layer));
  }
  // The motion's own window: it starts on the first frame a scoped element moves, which also
  // mounts, promotes and first-paints what moves; counting starts on the frame after it. An async
  // trigger (an event the page applies a frame or two later) and a slow host only shift it.
  const moving = [...changedFrames].filter((at) => at >= 0);
  const started = moving.length > 0 ? Math.min(...moving) : frames.length;
  const inMotion = (at: number) => at > started;
  // Per element (layer): its first paint in the window is it appearing, wherever the motion is by
  // then; under slow frames a caption or cursor that arrives after the motion started is first
  // painted inside the counted frames. Likewise the frame where a layer's own element starts to
  // move: a transition starting on it (a frame that scales on takeover) rasters it once for the
  // animation, wherever the rest of the motion is. Every other paint of that layer counts.
  const seen = new Set<number>();
  let paints = 0;
  const glassFrames = new Map<number, number>(); // glass panel -> frames it painted on
  for (const at of [...painted.keys()].sort((a, b) => a - b)) {
    const repainted = [...painted.get(at)!].filter(
      (layer) => seen.has(layer) && startsOwnMotion.get(layer) !== at,
    );
    for (const layer of painted.get(at)!) seen.add(layer);
    if (repainted.length === 0) continue;
    if (!inMotion(at) || !changedFrames.has(at) || contentFrames.has(at)) continue;
    if (!repainted.every((layer) => scope.glass.has(layer))) {
      paints++;
      continue;
    }
    for (const layer of repainted) glassFrames.set(layer, (glassFrames.get(layer) ?? 0) + 1);
  }
  let glassPaints = 0;
  for (const count of glassFrames.values()) {
    glassPaints += Math.min(count, GLASS_PAINT_FRAMES);
    paints += Math.max(0, count - GLASS_PAINT_FRAMES);
  }
  return {
    frames: frames.length,
    longFrames,
    worstFrameMs: worst / 1000,
    layouts: [...layoutFrames].filter(inMotion).length,
    paints,
    glassPaints,
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
  // Frosted glass is whatever has a backdrop-filter; marked for the query, after the trace ended.
  const marked = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const scoped = document.querySelectorAll(${JSON.stringify(`${selector}, ${selector} *`)});
      for (const el of scoped)
        if (getComputedStyle(el).backdropFilter !== "none") el.setAttribute("data-mt-glass", "");
    })()`,
  });
  if (marked.exceptionDetails) throw new Error("could not find the scope's glass panels");
  const glass = await backendIds(
    cdp,
    root.nodeId,
    `${selector}[data-mt-glass], ${selector} [data-mt-glass]`,
  );
  const embeds = await backendIds(
    cdp,
    root.nodeId,
    `${selector} :has(> iframe), ${selector} iframe`,
  );
  return { nodes: new Set(nodes), glass: new Set(glass), embeds: new Set(embeds) };
}

/**
 * Stamps a mark from the second requestAnimationFrame from now: by then the frame that applies
 * what came before (a trigger's own style changes) has been styled, laid out and painted. Marks
 * keyed to frames, not to wall time, make the window the same on a busy host as on an idle one.
 */
const stampAfterFrames = (label: string) =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        console.timeStamp(label);
        resolve();
      }),
    ),
  );

/**
 * Stamps a mark once the motion comes to rest: after something in the scope moved, its finite CSS
 * animations and transitions have finished and (for motion's requestAnimationFrame springs) no
 * inline style in it changed since the frame before (confirmed by one more still frame). Endless ambient animations (a pulse, a drift) are not
 * the motion and do not hold it open. Counted in frames, so a slow host only moves it later; never
 * stamped before the motion started (an async trigger), so the window then runs to the end mark.
 */
const stampWhenSettled = async ({ scope, label }: { scope: string; label: string }) => {
  const inScope = () => [...document.querySelectorAll(`${scope}, ${scope} *`)];
  const styles = () =>
    inScope()
      .map((el) => el.getAttribute("style") ?? "")
      .join("|");
  let previous = styles();
  let moved = false;
  for (let still = 0; still < 2;) {
    await new Promise(requestAnimationFrame);
    const scoped = new Set(inScope());
    const running = document.getAnimations().filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      return (
        target instanceof Element &&
        scoped.has(target) &&
        a.playState === "running" &&
        a.effect?.getTiming().iterations !== Infinity
      );
    });
    const next = styles();
    const moving = running.length > 0 || next !== previous;
    moved ||= moving;
    still = moved && !moving ? still + 1 : 0;
    // Stamped on the first still frame, before it is painted: the re-raster at the final scale
    // comes in this very frame. Motion that resumes stamps again; the last stamp counts.
    if (still === 1) console.timeStamp(label);
    previous = next;
  }
};

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
  // Before tracing, so promoting the layer is not in the trace; a subtree the trigger mounts
  // matches the rule too.
  await isolate(page, run.scope);
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
    await page.evaluate(stampAfterFrames, MOTION_MARKS.triggered);
    // Runs alongside the window; one that never settles is simply dropped when the page goes.
    void page
      .evaluate(stampWhenSettled, { scope: run.scope, label: MOTION_MARKS.settled })
      .catch(() => undefined);
    await page.waitForTimeout(run.durationMs);
    await page.evaluate(stampAfterFrames, MOTION_MARKS.end);
  } finally {
    await cdp.send("Tracing.end");
    await complete;
  }
  const scope = await motionScope(cdp, run.scope);

  await cdp.detach();
  return analyzeTrace(events, scope);
}
