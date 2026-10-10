import { notes, sources } from "@mastertutor/db";
import { and, eq, sql } from "drizzle-orm";
import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import type { LibraryServices } from "../library.ts";
import { writeContext } from "../notes/note-writer.ts";
import { ToolError, type ToolContext } from "../tools/types.ts";
import { pageVideoReveal, pageVideoState, pageYoutubeData } from "./page/player.ts";

export interface VideoContext {
  worlds: IsolatedWorlds;
  noteId: string | null;
  sourceId: string | null;
  ensureSource(): Promise<{ noteId: string; sourceId: string }>;
  stageMeta(patch: Record<string, unknown>): void;
  url: string;
  /** The content's length in seconds, or null when unknown (never an ad's length, B4 review I8). */
  duration: number | null;
  /** An ad is in the player right now. */
  ad: boolean;
  meta: Record<string, unknown>;
}

/**
 * YouTube's own length for the content, but only when its videoId is the URL's `v=` (after SPA
 * navigation the inline response is the previous video's, N2); else the player's when no ad shows.
 */
async function contentDuration(
  worlds: IsolatedWorlds,
  pageUrl: string,
): Promise<{ duration: number | null; ad: boolean }> {
  const [data, state] = await Promise.all([
    worlds.call(pageYoutubeData, []),
    worlds.call(pageVideoState, []),
  ]);
  const player = !state.ad && Number.isFinite(state.duration) && state.duration > 0;
  const onScreen = new URL(pageUrl).searchParams.get("v");
  const own = data.videoId !== null && data.videoId === onScreen ? data.lengthSeconds : null;
  return { duration: own ?? (player ? state.duration : null), ad: state.ad };
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
  const { duration, ad } = await contentDuration(worlds, ctx.session.page.url());
  const w = writeContext(ctx);
  const page = ctx.session.page;
  const title = (await page.title()) || page.url();
  const url = page.url();
  const [existing] = await services.db
    .select({ noteId: notes.id, sourceId: sources.id, meta: sources.meta })
    .from(notes)
    .innerJoin(sources, sql`${sources.meta}->>'noteId' = ${notes.id}::text`)
    .where(
      and(
        eq(notes.runId, ctx.runId),
        eq(notes.workspaceId, ctx.workspaceId),
        eq(sources.workspaceId, ctx.workspaceId),
        eq(sources.kind, "youtube"),
        eq(sources.url, url),
      ),
    )
    .limit(1);
  const video: VideoContext = {
    worlds,
    url,
    duration,
    ad,
    noteId: existing?.noteId ?? null,
    sourceId: existing?.sourceId ?? null,
    meta: existing?.meta ?? {},
    async ensureSource() {
      if (video.noteId && video.sourceId) return { noteId: video.noteId, sourceId: video.sourceId };
      const lede = services.selection
        ? null
        : await page
            .locator('meta[name="description"]')
            .first()
            .getAttribute("content", { timeout: 500 })
            .catch(() => null);
      const noteId = await services.writer.ensureNote(w, {
        title,
        lede,
        document: { kind: "youtube", url },
      });
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
        meta: { ...video.meta, ...(duration === null ? {} : { duration }) },
      });
      video.noteId = noteId;
      video.sourceId = sourceId;
      return { noteId, sourceId };
    },
    stageMeta(patch) {
      video.meta = { ...video.meta, ...patch };
      if (video.sourceId) services.writer.stageSourceMeta(w, video.sourceId, patch);
    },
  };
  // Production creates the source only after selection keeps a block. Legacy extraction fakes
  // have no selector and retain their original eager lifecycle.
  if (!services.selection) await video.ensureSource();
  return video;
}
