import { runTranscript, type Database } from "@mastertutor/db";
import { objectKeys, type Storage } from "@mastertutor/storage";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { parseModelOutput, type PendingCall } from "../llm/items.ts";

export const GARAGE_REF = "garage:";
const PNG_PREFIX = "data:image/png;base64,";

/** One Responses item, stored with images replaced by Garage keys (spec §4 run_transcript). */
export const TranscriptEntry = z.object({
  dir: z.enum(["in", "out"]),
  item: z.record(z.string(), z.unknown()),
  responseId: z.string().nullable(),
  userEventId: z.string().nullable(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntry>;

export async function externalizeImages(
  storage: Storage,
  runId: string,
  seq: number,
  entry: TranscriptEntry,
): Promise<TranscriptEntry> {
  let index = 0;
  const uploads: Array<Promise<void>> = [];
  const walk = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith(PNG_PREFIX)) {
      const key = objectKeys.transcriptImage(runId, seq, index++);
      uploads.push(
        storage.put(key, Buffer.from(value.slice(PNG_PREFIX.length), "base64"), {
          contentType: "image/png",
        }),
      );
      return `${GARAGE_REF}${key}`;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  const item = walk(entry.item) as Record<string, unknown>;
  await Promise.all(uploads);
  return { ...entry, item };
}

export async function loadTranscript(db: Database, runId: string): Promise<TranscriptEntry[]> {
  const rows = await db
    .select({ item: runTranscript.item })
    .from(runTranscript)
    .where(eq(runTranscript.runId, runId))
    .orderBy(asc(runTranscript.seq));
  return rows.flatMap((row) => {
    const parsed = TranscriptEntry.safeParse(row.item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Calls of the last model response that have no output yet; restore answers them without re-running. */
export function unansweredCalls(entries: readonly TranscriptEntry[]): PendingCall[] {
  const last = [...entries].reverse().find((entry) => entry.dir === "out");
  if (!last) return [];
  const batch = entries
    .filter((entry) => entry.dir === "out" && entry.responseId === last.responseId)
    .map((entry) => entry.item);
  const answered = new Set(
    entries
      .filter(
        (entry) =>
          entry.dir === "in" &&
          (entry.item.type === "computer_call_output" ||
            entry.item.type === "function_call_output"),
      )
      .map((entry) => String(entry.item.call_id)),
  );
  return parseModelOutput(batch).calls.filter((call) => !answered.has(call.callId));
}

export function lastUserEventId(entries: readonly TranscriptEntry[]): string | null {
  let best: bigint | null = null;
  for (const entry of entries) {
    if (entry.userEventId === null) continue;
    const id = BigInt(entry.userEventId);
    if (best === null || id > best) best = id;
  }
  return best === null ? null : best.toString();
}

export function recentScreenshotKeys(entries: readonly TranscriptEntry[], count: number): string[] {
  const keys: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string" && value.startsWith(GARAGE_REF))
      keys.push(value.slice(GARAGE_REF.length));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
  };
  entries.forEach((entry) => walk(entry.item));
  return keys.slice(-count);
}

/** A plain-text run log for rebuilding a lost chain (spec §5.4). Images become "[screenshot]". */
export function transcriptAsText(entries: readonly TranscriptEntry[], maxChars = 150_000): string {
  const lines = entries.map((entry) => {
    const item = entry.item;
    switch (item.type) {
      case "computer_call":
        return `assistant computer actions: ${JSON.stringify(item.actions ?? item.action)}`;
      case "function_call":
        return `assistant called ${String(item.name)}(${String(item.arguments).slice(0, 500)})`;
      case "function_call_output":
        return `tool result: ${String(item.output).slice(0, 2_000)}`;
      case "computer_call_output":
        return "tool result: [screenshot]";
      default: {
        const content = Array.isArray(item.content)
          ? (item.content as Array<Record<string, unknown>>)
          : [];
        const text = content
          .map((part) => (part.type === "input_image" ? "[screenshot]" : String(part.text ?? "")))
          .join(" ");
        return `${entry.dir === "out" ? "assistant" : "user"}: ${text.slice(0, 4_000)}`;
      }
    }
  });
  const joined = lines.join("\n");
  return joined.length > maxChars ? joined.slice(-maxChars) : joined;
}
