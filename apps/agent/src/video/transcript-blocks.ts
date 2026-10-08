import { escapeMarkdownText } from "@mastertutor/contracts";
import { timeAnchor, type TimedBlockDraft } from "../notes/note-writer.ts";
import type { CaptionSegment } from "./json3.ts";

/** Merges consecutive segments into readable paragraphs without crossing a chapter start or a speaker change. */
export function groupSegments(
  segments: readonly CaptionSegment[],
  boundaries: readonly number[],
  limits: { maxSeconds?: number; maxChars?: number } = {},
): CaptionSegment[] {
  const maxSeconds = limits.maxSeconds ?? 30;
  const maxChars = limits.maxChars ?? 600;
  const groups: CaptionSegment[] = [];
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const last = groups.at(-1);
    const crossesChapter = last
      ? boundaries.some((b) => b > last.start && b <= segment.start)
      : false;
    const tooLong = last
      ? segment.end - last.start > maxSeconds || last.text.length + segment.text.length > maxChars
      : false;
    if (!last || crossesChapter || tooLong || last.speaker !== segment.speaker) {
      groups.push({ ...segment });
    } else {
      last.text = `${last.text} ${segment.text}`;
      last.end = Math.max(last.end, segment.end);
    }
  }
  return groups;
}

/** Transcript Markdown carries no timecode: the reader prints the anchor's time and the export adds it (decision 14). */
export function transcriptBlocks(
  groups: readonly CaptionSegment[],
  origin: "captions" | "asr",
  verified: boolean,
): TimedBlockDraft[] {
  return groups.map((group) => ({
    type: "transcript",
    markdown: `${group.speaker ? `**Speaker ${escapeMarkdownText(group.speaker)}:** ` : ""}${escapeMarkdownText(group.text)}`,
    origin,
    assetId: null,
    verified,
    anchor: timeAnchor(group.start, group.end),
  }));
}
