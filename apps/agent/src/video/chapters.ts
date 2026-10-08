import { escapeMarkdownText } from "@mastertutor/contracts";
import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import { timeAnchor, type TimedBlockDraft } from "../notes/note-writer.ts";
import { pageYoutubeData } from "./page/player.ts";
import { parseTimecode } from "./timecode.ts";

export interface Chapter {
  title: string;
  start: number;
}

/** Extracts the JSON object assigned to ytInitialData with a string-aware brace matcher. */
export function extractInitialData(script: string): unknown {
  const at = script.search(/ytInitialData\s*=\s*\{/);
  if (at < 0) return null;
  const start = script.indexOf("{", at);
  let depth = 0;
  let inString = false;
  for (let i = start; i < script.length; i++) {
    const char = script[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return JSON.parse(script.slice(start, i + 1)) as unknown;
      } catch {
        return null;
      }
    }
  }
  return null;
}

type Json = Record<string, unknown>;
const textOf = (title: unknown): string => {
  const t = title as { simpleText?: string; runs?: { text?: string }[] } | undefined;
  return (t?.simpleText ?? t?.runs?.map((r) => r.text ?? "").join("") ?? "").trim();
};

function normalize(chapters: Chapter[]): Chapter[] {
  const seen = new Set<number>();
  return chapters
    .filter((c) => c.title && Number.isFinite(c.start) && c.start >= 0)
    .sort((a, b) => a.start - b.start)
    .filter((c) => (seen.has(c.start) ? false : (seen.add(c.start), true)))
    .map((c) => ({ title: c.title.slice(0, 500), start: c.start }));
}

/** `chapterRenderer` (description chapters) and `macroMarkersListItemRenderer` (key moments). */
export function chaptersFromInitialData(data: unknown): Chapter[] {
  const found: Chapter[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 64 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    const obj = node as Json;
    const chapter = obj.chapterRenderer as Json | undefined;
    if (chapter)
      found.push({
        title: textOf(chapter.title),
        start: Number(chapter.timeRangeStartMillis) / 1_000,
      });
    const marker = obj.macroMarkersListItemRenderer as Json | undefined;
    if (marker) {
      const tap = marker.onTap as { watchEndpoint?: { startTimeSeconds?: number } } | undefined;
      const start =
        tap?.watchEndpoint?.startTimeSeconds ??
        parseTimecode(typeof marker.timeDescription === "string" ? marker.timeDescription : "");
      if (start !== null && start !== undefined)
        found.push({ title: textOf(marker.title), start: Number(start) });
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  };
  visit(data, 0);
  return normalize(found);
}

/** YouTube's own rule: at least three timestamps, the first at 0:00, strictly increasing. */
export function chaptersFromDescription(text: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:]?\s+(.+?)\s*$/.exec(line);
    const start = match?.[1] ? parseTimecode(match[1]) : null;
    if (match?.[2] && start !== null) chapters.push({ title: match[2], start });
  }
  const increasing = chapters.every((c, i) => i === 0 || c.start > (chapters[i - 1]?.start ?? 0));
  return chapters.length >= 3 && chapters[0]?.start === 0 && increasing ? normalize(chapters) : [];
}

/** spec §8: ytInitialData first, description timestamps as the fallback. */
export async function readChapters(worlds: Pick<IsolatedWorlds, "call">): Promise<Chapter[]> {
  const data = await worlds.call(pageYoutubeData, []);
  const fromData = data.initialDataScript
    ? chaptersFromInitialData(extractInitialData(data.initialDataScript))
    : [];
  return fromData.length > 0 ? fromData : chaptersFromDescription(data.description ?? "");
}

/** `## title` headings for the chapters the note does not have yet. */
export function chapterBlocks(
  chapters: readonly Chapter[],
  existingStarts: ReadonlySet<number>,
): TimedBlockDraft[] {
  return chapters
    .filter((c) => !existingStarts.has(c.start))
    .map((c, i, all) => ({
      type: "heading",
      markdown: `## ${escapeMarkdownText(c.title)}`,
      origin: "dom",
      assetId: null,
      verified: true,
      anchor: timeAnchor(c.start, all[i + 1]?.start ?? c.start),
    }));
}
