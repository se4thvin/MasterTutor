import type { CDPSession } from "playwright-core";
import sharp from "sharp";
import type { PageHelpers } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extra mask targets owned by the vault (B3). Plaintext never crosses this seam: the vault keeps
 * only keyed digests and answers with node ids and a redactor.
 */
export interface MaskSources {
  /** backendNodeIds, in `cdp`'s target, of fields the vault filled in documents still loaded. */
  nodeIds(cdp: CDPSession): readonly number[];
  /** True while the run has secret values registered (the text scan runs only then). */
  hasSecrets(): boolean;
  /** `text` with every registered secret value replaced by SECRET_REDACTION; `text` itself when none occurs. */
  redact(text: string): string; /**
   * CDP frame ids holding vault-filled nodes, whatever session registered them (N2): a frame
   * whose CDP session was replaced still counts as filled. Optional: no fills, no frames.
   */
  filledFrames?(): readonly string[];
}

export const SECRET_REDACTION = "[secret]";

export const NO_MASK_SOURCES: MaskSources = {
  nodeIds: () => [],
  hasSecrets: () => false,
  redact: (text) => text,
};

export function containsSecret(sources: MaskSources, text: string): boolean {
  return sources.redact(text) !== text;
}

/** Every string inside a tool result (JSON data) with registered secrets redacted (M13). */
export function redactDeep(value: unknown, sources: MaskSources): unknown {
  if (!sources.hasSecrets()) return value;
  if (typeof value === "string") return sources.redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, sources));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, sources)]),
    );
  return value;
}

/** Isolated-world scan for secret inputs across same-origin frames and open shadow roots. Read-only. */
export function secretFieldBoxesScript(_arg: null, h: PageHelpers): Box[] {
  const boxes: Box[] = [];
  const visit = (root: Document | ShadowRoot, ox: number, oy: number, depth: number) => {
    if (depth > 6) return;
    for (const el of root.querySelectorAll("input")) {
      if (!h.isSecretField(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        boxes.push({ x: r.left + ox, y: r.top + oy, width: r.width, height: r.height });
    }
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) visit(host.shadowRoot, ox, oy, depth + 1);
    }
    for (const frame of root.querySelectorAll("iframe, frame")) {
      try {
        const doc = (frame as HTMLIFrameElement).contentDocument;
        if (!doc) continue;
        const r = frame.getBoundingClientRect();
        visit(
          doc,
          ox + r.left + (frame as HTMLElement).clientLeft,
          oy + r.top + (frame as HTMLElement).clientTop,
          depth + 1,
        );
      } catch {
        // Cross-origin frames are separate targets; their secret fields are B3's registered nodes.
      }
    }
  };
  visit(document, 0, 0, 0);
  return boxes;
}

function quadToBox(quad: readonly number[]): Box {
  const xs = [quad[0] ?? 0, quad[2] ?? 0, quad[4] ?? 0, quad[6] ?? 0];
  const ys = [quad[1] ?? 0, quad[3] ?? 0, quad[5] ?? 0, quad[7] ?? 0];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export interface MaskScan {
  boxes: Box[];
  /** Registered nodes whose box could not be computed and that are not provably detached or hidden. */
  unverifiable: number;
}

/** Runs in the page's main world, read-only: why a node without a box model has nothing to mask. */
const NODE_STATE_SCRIPT = `function () {
  if (!this.isConnected) return "detached";
  const el = this.nodeType === 1 ? this : this.parentElement;
  if (!el) return "detached";
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return "hidden";
  return "visible";
}`;

/** A node whose document was replaced (a navigation) still describes, but no longer resolves (F8). */
const GONE_DOCUMENT = /does not belong to the document/i;

/** True only when the node is provably not on screen; any doubt (other target, error, visible) is false. */
async function provablyNotShown(cdp: CDPSession, backendNodeId: number): Promise<boolean> {
  try {
    await cdp.send("DOM.describeNode", { backendNodeId });
    let resolved;
    try {
      resolved = await cdp.send("DOM.resolveNode", { backendNodeId });
    } catch (error) {
      return error instanceof Error && GONE_DOCUMENT.test(error.message);
    }
    if (!resolved.object.objectId) return false;
    const result = await cdp.send("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration: NODE_STATE_SCRIPT,
      returnByValue: true,
    });
    return result.result.value === "detached" || result.result.value === "hidden";
  } catch {
    return false;
  }
}

export async function collectMaskBoxes(
  session: BrowserSession,
  sources: MaskSources,
): Promise<MaskScan> {
  const worlds = await session.worlds();
  const boxes = await worlds.evaluate(secretFieldBoxesScript, null);
  const cdp = await session.cdp();
  let unverifiable = 0;
  for (const backendNodeId of sources.nodeIds(cdp)) {
    try {
      const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId });
      boxes.push(quadToBox(model.border));
    } catch {
      // No box model: fine only when the node is provably detached or hidden. A vault node in
      // another CDP target (cross-origin frame) or any other error must not ship an unmasked frame.
      if (!(await provablyNotShown(cdp, backendNodeId))) unverifiable += 1;
    }
  }
  return { boxes, unverifiable };
}

export function sameBoxes(a: readonly Box[], b: readonly Box[], tolerance = 1): boolean {
  if (a.length !== b.length) return false;
  return a.every((box, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      Math.abs(box.x - other.x) <= tolerance &&
      Math.abs(box.y - other.y) <= tolerance &&
      Math.abs(box.width - other.width) <= tolerance &&
      Math.abs(box.height - other.height) <= tolerance
    );
  });
}

/** Opaque rectangles drawn in the agent, on the image, never in the page (spec §9). Boxes are in image pixels. */
export async function drawMasks(
  png: Buffer,
  boxes: readonly Box[],
  size: { width: number; height: number },
): Promise<Buffer> {
  const pad = 2;
  const overlays = boxes
    .map((box) => {
      const left = Math.max(0, Math.floor(box.x - pad));
      const top = Math.max(0, Math.floor(box.y - pad));
      const right = Math.min(size.width, Math.ceil(box.x + box.width + pad));
      const bottom = Math.min(size.height, Math.ceil(box.y + box.height + pad));
      return { left, top, width: right - left, height: bottom - top };
    })
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({
      input: {
        create: {
          width: box.width,
          height: box.height,
          channels: 4 as const,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      },
      left: box.left,
      top: box.top,
    }));
  if (overlays.length === 0) return png;
  return sharp(png).composite(overlays).png().toBuffer();
}

interface FrameNode {
  frame: { id: string; url?: string; securityOrigin?: string };
  childFrames?: FrameNode[];
}

function flattenFrames(node: FrameNode, out: FrameNode["frame"][] = []): FrameNode["frame"][] {
  out.push(node.frame);
  for (const child of node.childFrames ?? []) flattenFrames(child, out);
  return out;
}

/**
 * True when an in-process frame is on a different origin from the main frame: the page-side
 * secret-field scan cannot reach into it. Out-of-process frames are not in this tree; their
 * filled fields are checked by `hasFilledOutOfProcessFrame`.
 */
export async function hasCrossOriginFrames(session: BrowserSession): Promise<boolean> {
  const { frameTree } = await (await session.cdp()).send("Page.getFrameTree");
  const frames = flattenFrames(frameTree as FrameNode);
  const main = frames[0]?.securityOrigin;
  // about:srcdoc and about:blank frames inherit the parent's origin (Chromium reports "://" for them).
  return frames
    .slice(1)
    .some((frame) => !frame.url?.startsWith("about:") && frame.securityOrigin !== main);
}

/**
 * True when the vault filled a field inside an out-of-process frame (R-E6 registers it on that
 * frame's own session): it cannot be boxed from the page's session, so the frame must be dropped.
 * An unrelated cross-site frame (an ad, a sign-in button, a video) costs no sight.
 */
export async function hasFilledOutOfProcessFrame(
  session: BrowserSession,
  sources: MaskSources,
): Promise<boolean> {
  const filledFrames = new Set(sources.filledFrames?.() ?? []);
  for (const [frameId, worlds] of await session.outOfProcessFrames())
    if (filledFrames.has(frameId) || sources.nodeIds(worlds.cdp).length > 0) return true;
  return false;
}

type AxText = { name?: { value?: unknown }; value?: { value?: unknown } };

function hasSecretText(nodes: readonly AxText[], sources: MaskSources): boolean {
  return nodes.some((node) =>
    [node.name?.value, node.value?.value].some(
      (value) => typeof value === "string" && containsSecret(sources, value),
    ),
  );
}

/** Bound on reading one out-of-process frame: its own (possibly busy, third-party) renderer answers. */
export const OOPIF_READ_TIMEOUT_MS = 1_500;
/** Out-of-process frames read at once (principle 2: parallel, but not unbounded). */
const OOPIF_READ_CONCURRENCY = 4;

type FrameRead = "clean" | "secret" | "failed" | "timeout";

/** `work`'s verdict, "failed" on a CDP error, "timeout" past the bound; rejects only on abort. */
function bounded(work: Promise<FrameRead>, signal: AbortSignal): Promise<FrameRead> {
  return new Promise((resolve, reject) => {
    const onAbort = () => finish(() => reject(signal.reason));
    const timer = setTimeout(() => finish(() => resolve("timeout")), OOPIF_READ_TIMEOUT_MS);
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (verdict) => finish(() => resolve(verdict)),
      () => finish(() => resolve("failed")),
    );
  });
}

/** Every frame hosted by one target (an out-of-process frame and its in-process children). */
async function readTarget(cdp: CDPSession, sources: MaskSources): Promise<FrameRead> {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  for (const frame of flattenFrames(frameTree as FrameNode)) {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree", { frameId: frame.id });
    if (hasSecretText(nodes, sources)) return "secret";
  }
  return "clean";
}

/**
 * One frame through the page's session (it moved in process). The page tree omits out-of-process
 * frames, so a frame missing from it may still be live in its own process (a re-attach that
 * failed): unreadable, never clean (N1). A frame that is really gone is pruned by the next
 * `outOfProcessFrames()`, so this costs at most one dropped shot.
 */
async function readInProcess(
  cdp: CDPSession,
  frameId: string,
  sources: MaskSources,
): Promise<FrameRead> {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  if (!flattenFrames(frameTree as FrameNode).some((frame) => frame.id === frameId)) return "failed";
  const { nodes } = await cdp.send("Accessibility.getFullAXTree", { frameId });
  return hasSecretText(nodes, sources) ? "secret" : "clean";
}

/**
 * Whether one out-of-process frame shows a secret, or cannot be read (fail closed). A session
 * that errors (the frame swapped process, its renderer restarted) is forgotten and the frame is
 * read once more through a fresh one; a frame that does not answer in time is forgotten too, but
 * not retried.
 */
async function outOfProcessFrameLeaks(
  session: BrowserSession,
  frameId: string,
  cdp: CDPSession,
  sources: MaskSources,
  signal: AbortSignal,
): Promise<boolean> {
  session.guard.assertAgent(signal);
  let verdict = await bounded(readTarget(cdp, sources), signal);
  if (verdict === "failed") {
    await session.forgetFrame(frameId);
    session.guard.assertAgent(signal);
    const fresh = (await session.outOfProcessFrames()).get(frameId);
    verdict = await bounded(
      fresh ? readTarget(fresh.cdp, sources) : readInProcess(await session.cdp(), frameId, sources),
      signal,
    );
  }
  // A timed-out read is not retried, but its session is detached, which rejects the pending
  // sends: hung reads on a busy frame cannot pile up from one screenshot to the next (N3).
  if (verdict === "timeout") void session.forgetFrame(frameId).catch(() => undefined);
  return verdict !== "clean";
}

/** True when `test` holds for any item; at most `limit` run at once, and none start after a hit. */
async function anyLimited<T>(
  items: readonly T[],
  limit: number,
  test: (item: T) => Promise<boolean>,
): Promise<boolean> {
  let next = 0;
  let found = false;
  const worker = async () => {
    while (!found && next < items.length) {
      const item = items[next++]!;
      if (await test(item)) found = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return found;
}

/**
 * Final check (spec §9): any accessibility-tree name or value, in every frame, containing a
 * registered secret drops the frame; a frame whose tree cannot be read fails closed. The page
 * target's frame tree omits out-of-process frames, so each of those is read through its own
 * session, in parallel and time-bounded, stopping at a takeover (`signal`, the control guard).
 */
export async function containsSecretText(
  session: BrowserSession,
  sources: MaskSources,
  signal: AbortSignal,
): Promise<boolean> {
  if (!sources.hasSecrets()) return false;
  const cdp = await session.cdp();
  const { frameTree } = await cdp.send("Page.getFrameTree");
  for (const frame of flattenFrames(frameTree as FrameNode)) {
    session.guard.assertAgent(signal);
    const nodes = await cdp
      .send("Accessibility.getFullAXTree", { frameId: frame.id })
      .then((result) => result.nodes)
      .catch(() => null);
    if (nodes === null || hasSecretText(nodes, sources)) return true;
  }
  const { outOfProcess, unattached } = await session.frameCoverage();
  // A live frame that could not be attached at all may be out of process: unreadable (N1).
  if (unattached > 0) return true;
  const frames = [...outOfProcess];
  const leaks = await anyLimited(frames, OOPIF_READ_CONCURRENCY, ([frameId, worlds]) =>
    outOfProcessFrameLeaks(session, frameId, worlds.cdp, sources, signal),
  );
  session.guard.assertAgent(signal);
  return leaks;
}
