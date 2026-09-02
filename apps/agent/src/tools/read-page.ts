import { createHash } from "node:crypto";
import {
  ElementRef,
  READ_PAGE_ATTRS,
  ReadPageArgs,
  ReadPageResult,
  type ReadPageElement,
} from "@mastertutor/contracts";
import type { BrowserSession } from "../browser/session.ts";
import { StaleRef } from "../runtime/errors.ts";
import { readPageScript } from "./read-page-script.ts";
import type { Tool } from "./types.ts";

/** Below the contract caps (2,000 elements / 200,000 chars) to bound token cost per call. */
export const MAX_ELEMENTS = 400;
export const MAX_TEXT = 50_000;

export async function readPage(
  session: BrowserSession,
  args: ReadPageArgs,
): Promise<ReadPageResult> {
  const worlds = await session.worlds();
  const raw = await worlds.evaluate(readPageScript, {
    mode: args.mode,
    attrs: READ_PAGE_ATTRS,
    max: MAX_ELEMENTS,
    maxText: MAX_TEXT,
    offset: args.mode === "interactive" ? args.offset : null,
  });
  const scale = session.lastScale;
  const header = { url: raw.url, title: raw.title.slice(0, 1_000) };
  const body = raw.elements
    ? {
        ...header,
        elements: raw.elements.map((element, index): ReadPageElement => ({
          ref: `e${index + 1}`,
          tag: element.tag,
          role: element.role,
          name: element.name,
          attrs: element.attrs as ReadPageElement["attrs"],
          point: element.point
            ? { x: Math.round(element.point.x * scale), y: Math.round(element.point.y * scale) }
            : null,
        })),
        total: raw.total ?? raw.elements.length,
        ...(args.offset !== null ? { offset: args.offset } : {}),
      }
    : { ...header, text: raw.text ?? "" };
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  if (args.sinceHash === hash) return { unchanged: true };
  return { hash, ...body };
}

/** Resolves a read_page ref to a DOM node (B3's fill_credential target). Stale after navigation. */
export async function resolveRef(
  session: BrowserSession,
  ref: string,
): Promise<{ objectId: string; backendNodeId: number }> {
  const index = Number(ElementRef.parse(ref).slice(1)) - 1;
  const worlds = await session.worlds();
  const objectId = await worlds.evaluateHandle(`(globalThis.__mtRefs ?? [])[${index}]`);
  if (!objectId) throw new StaleRef(ref);
  const { node } = await (await session.cdp()).send("DOM.describeNode", { objectId });
  return { objectId, backendNodeId: node.backendNodeId };
}

export const readPageTool: Tool<ReadPageArgs, ReadPageResult> = {
  name: "read_page",
  args: ReadPageArgs,
  result: ReadPageResult,
  untrusted: true,
  run: (ctx, args) => readPage(ctx.session, args),
};
