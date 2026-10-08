import { VideoArgs, VideoResult } from "@mastertutor/contracts";
import { noteBlocks } from "@mastertutor/db";
import { and, eq } from "drizzle-orm";
import { pixelsAreClean } from "../browser/local-ocr.ts";
import type { LibraryServices } from "../library.ts";
import {
  NoteWriteError,
  timeAnchor,
  type TimedBlockDraft,
  writeContext,
} from "../notes/note-writer.ts";
import { type Tool, type ToolContext, ToolError } from "../tools/types.ts";
import { captureTimedtext } from "./captions.ts";
import { chapterBlocks, readChapters } from "./chapters.ts";
import { parseJson3 } from "./json3.ts";
import { sampleKeyframes } from "./keyframes.ts";
import { openVideoContext, type VideoContext } from "./source.ts";
import { transcribeVideo } from "./transcribe.ts";
import { groupSegments, transcriptBlocks } from "./transcript-blocks.ts";

/** One call covers at most ten minutes; the model pages through longer videos (preflight S9). */
export const MAX_VIDEO_RANGE_S = 600;
const inRange = (t: number, range: { start: number; end: number }) =>
  t >= range.start && t <= range.end;

/** spec §8 `video`. Chapter titles are page text, so the result is wrapped as untrusted (S6). */
export function createVideoTool(services: LibraryServices): Tool<VideoArgs, VideoResult> {
  const append = (ctx: ToolContext, video: VideoContext, blocks: TimedBlockDraft[]) =>
    services.writer.appendTimedBlocks(writeContext(ctx), {
      noteId: video.noteId,
      sourceId: video.sourceId,
      blocks,
    });

  async function keyframes(
    ctx: ToolContext,
    video: VideoContext,
    range: { start: number; end: number },
  ): Promise<VideoResult> {
    const sampled = await sampleKeyframes(ctx, video.worlds, range);
    const blocks: TimedBlockDraft[] = [];
    let screened = 0;
    for (const frame of sampled.frames) {
      // On a secret-holding run, pixels are screened locally before they are stored (A-M1).
      if (!(await pixelsAreClean(services.localOcr, ctx.mask, frame.png, ctx.signal))) {
        screened++;
        continue;
      }
      const asset = await services.assets.put(
        ctx.workspaceId,
        { bytes: frame.png, mime: "image/png", width: null, height: null, sourceUrl: null },
        ctx.mask,
      );
      blocks.push({
        type: "keyframe",
        markdown: "Keyframe",
        origin: "dom",
        assetId: asset.assetId,
        verified: true,
        anchor: timeAnchor(frame.segmentStart, frame.t),
      });
    }
    // Every slide the note lacks keeps it from `verified` (B4 review I1, I2): withheld or screened
    // frames, sample points without a frame, and a range that was all DRM-dark or unplayable.
    const unseen = sampled.drm || sampled.unplayable ? Math.max(1, sampled.sampled) : 0;
    const lost = sampled.withheld + sampled.missed + screened + unseen;
    const prior = typeof video.meta.mediaLost === "number" ? video.meta.mediaLost : 0;
    services.writer.stageSourceMeta(writeContext(ctx), video.sourceId, {
      drm: sampled.drm,
      ...(sampled.unplayable ? { playback: "failed" } : {}),
      figuresWithheld: sampled.withheld + screened,
      ...(lost > 0 ? { mediaLost: prior + lost } : {}),
    });
    const blockIds = await append(ctx, video, blocks);
    return {
      op: "keyframes",
      blockIds,
      kept: blocks.length,
      dropped: sampled.dropped,
      drm: sampled.drm,
    };
  }

  return {
    name: "video",
    args: VideoArgs,
    result: VideoResult,
    untrusted: true,
    async run(ctx, args): Promise<VideoResult> {
      const w = writeContext(ctx);
      try {
        const video = await openVideoContext(services, ctx);
        const playsMedia = args.op === "keyframes" || args.op === "transcribe";
        if (playsMedia && video.ad)
          throw new ToolError("ad_playing", "An ad is playing; wait for the video, then try again");
        if (playsMedia && !args.range && video.duration === null)
          throw new ToolError("duration_unknown", "The video's length is unknown; pass a range");
        const range = args.range ?? { start: 0, end: video.duration ?? 0 };
        if (playsMedia && range.end - range.start > MAX_VIDEO_RANGE_S)
          throw new ToolError(
            "range_too_long",
            "Use a range of at most 600 seconds and page through the video",
          );
        const chapters = await readChapters(video.worlds);
        const boundaries = chapters.map((c) => c.start);
        try {
          switch (args.op) {
            case "chapters": {
              const existing = await services.db
                .select({ anchor: noteBlocks.anchor })
                .from(noteBlocks)
                .where(
                  and(
                    eq(noteBlocks.noteId, video.noteId),
                    eq(noteBlocks.sourceId, video.sourceId),
                    eq(noteBlocks.type, "heading"),
                  ),
                );
              const starts = new Set(
                existing.flatMap((row) =>
                  typeof row.anchor?.tStart === "number" ? [row.anchor.tStart] : [],
                ),
              );
              await append(ctx, video, chapterBlocks(chapters, starts));
              services.writer.stageSourceMeta(w, video.sourceId, { chapters });
              return { op: "chapters", chapters };
            }
            case "captions": {
              const track = await captureTimedtext(ctx.session, video.worlds, {
                signal: ctx.signal,
              });
              const segments = track ? parseJson3(track.body) : null;
              if (!track || !segments) {
                services.writer.stageSourceMeta(w, video.sourceId, {
                  captions: {
                    segments: 0,
                    language: null,
                    format: track ? "unsupported" : "none",
                  },
                });
                return { op: "captions", blockIds: [], segments: 0, language: null };
              }
              // Without a range the whole track is the content: no player duration (0, or an
              // ad's) may cut it short (B4 review I8).
              const selected = args.range
                ? segments.filter((s) => inRange(s.start, range))
                : segments;
              // Auto-generated or machine-translated tracks are never verified (Q4).
              const origin = track.autoGenerated ? "asr" : "captions";
              const blockIds = await append(
                ctx,
                video,
                transcriptBlocks(groupSegments(selected, boundaries), origin, !track.autoGenerated),
              );
              const language = track.language?.slice(0, 16) ?? null;
              services.writer.stageSourceMeta(w, video.sourceId, {
                captions: {
                  segments: selected.length,
                  language,
                  kind: track.kind,
                  tlang: track.tlang,
                  autoGenerated: track.autoGenerated,
                },
              });
              return { op: "captions", blockIds, segments: selected.length, language };
            }
            case "keyframes":
              return await keyframes(ctx, video, range);
            case "transcribe": {
              const known = video.meta.captions as { segments?: number } | undefined;
              if ((known?.segments ?? 0) > 0)
                throw new ToolError(
                  "captions_available",
                  "Captions exist; use op captions instead",
                );
              // Audio never goes to OpenAI for a captioned video, whatever op the model tried first (D4).
              const probe = await captureTimedtext(ctx.session, video.worlds, {
                signal: ctx.signal,
                timeoutMs: 5_000,
              });
              if (probe && (parseJson3(probe.body)?.length ?? 0) > 0)
                throw new ToolError(
                  "captions_available",
                  "Captions exist; use op captions instead",
                );
              const result = await transcribeVideo(
                { transcriber: services.transcriber },
                ctx,
                video.worlds,
                range,
              );
              const blockIds = await append(
                ctx,
                video,
                transcriptBlocks(groupSegments(result.segments, boundaries), "asr", false),
              );
              return { op: "transcribe", blockIds, seconds: result.seconds };
            }
          }
        } finally {
          services.writer.stageQuality(w, video.noteId, null);
        }
      } catch (error) {
        if (error instanceof NoteWriteError) throw new ToolError(error.code, error.message);
        throw error;
      }
    },
  };
}
