import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import type { LibraryServices } from "../library.ts";
import { writeContext } from "../notes/note-writer.ts";
import { ToolError, type ToolContext } from "../tools/types.ts";
import { pageVideoReveal } from "./page/player.ts";

export interface VideoContext {
  worlds: IsolatedWorlds;
  noteId: string;
  sourceId: string;
  url: string;
  duration: number;
  meta: Record<string, unknown>;
}

/** Shared by every video op: the run's note and one `youtube` source per watched URL. */
export async function openVideoContext(
  services: LibraryServices,
  ctx: ToolContext,
): Promise<VideoContext> {
  const worlds = await ctx.session.worlds();
  // Revealing scrolls the page: a live mutation (preflight F13).
  ctx.session.guard.assertAgent(ctx.signal);
  const revealed = await worlds.call(pageVideoReveal, []);
  if (!revealed.found) throw new ToolError("no_video", "There is no video on this page");
  const w = writeContext(ctx);
  const page = ctx.session.page;
  const title = (await page.title()) || page.url();
  const lede = await page
    .locator('meta[name="description"]')
    .first()
    .getAttribute("content", { timeout: 500 })
    .catch(() => null);
  const noteId = await services.writer.ensureNote(w, { title, lede });
  const url = page.url();
  const existing = await services.writer.findSource(w.scope, noteId, "youtube", url);
  if (existing)
    return {
      worlds,
      noteId,
      sourceId: existing.sourceId,
      url,
      duration: revealed.duration,
      meta: existing.meta,
    };
  const canonical = await page
    .locator('link[rel="canonical"]')
    .first()
    .getAttribute("href", { timeout: 500 })
    .catch(() => null);
  const sourceId = services.writer.stageSource(w, {
    noteId,
    kind: "youtube",
    url,
    canonicalUrl: canonical && /^https?:/.test(canonical) ? canonical : null,
    title,
    faviconAssetId: null,
    mhtmlKey: null,
    screenshotKey: null,
    snapshotSha256: null,
    meta: { duration: revealed.duration },
  });
  return { worlds, noteId, sourceId, url, duration: revealed.duration, meta: {} };
}
