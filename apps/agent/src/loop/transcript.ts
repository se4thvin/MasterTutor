import { runTranscript, type Database } from "@mastertutor/db";
import { objectKeys, type Storage } from "@mastertutor/storage";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { parseModelOutput, type PendingCall } from "../llm/items.ts";

export const GARAGE_REF = "garage:";

/** One Responses item, stored with images replaced by Garage keys (spec §4 run_transcript). */
export const TranscriptEntry = z.object({
  dir: z.enum(["in", "out"]),
  item: z.record(z.string(), z.unknown()),
  responseId: z.string().nullable(),
  userEventId: z.string().nullable(),
  /**
   * `compaction`: a compaction exchange (never replayed to the model). `seed`: the input that starts
   * a fresh context after a compaction; model input is rebuilt from the last seed on (D37).
   */
  mark: z.enum(["compaction", "seed"]).optional(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntry>;

const DATA_IMAGE = /^data:image\/([a-z0-9]+)(?:[.+-][a-z0-9.+-]*)?;base64,/i;

/**
 * Replaces every image data URL with a `garage:` ref and uploads it. Keys carry `nonce` (unique per
 * commit) so a zombie writer cannot overwrite a live owner's object. Uploaded keys are pushed to
 * `uploaded` as they are created so the caller can delete them if the commit fails.
 */
export async function externalizeImages(
  storage: Storage,
  runId: string,
  seq: number,
  entry: TranscriptEntry,
  nonce = randomUUID().replaceAll("-", ""),
  uploaded: string[] = [],
): Promise<TranscriptEntry> {
  let index = 0;
  const uploads: Array<Promise<void>> = [];
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      const match = DATA_IMAGE.exec(value);
      if (!match) return value;
      const ext = match[1]!.toLowerCase().slice(0, 8);
      const key = objectKeys.transcriptImage(runId, seq, index++, nonce, ext);
      uploaded.push(key);
      uploads.push(
        storage.put(key, Buffer.from(value.slice(match[0].length), "base64"), {
          contentType: `image/${ext}`,
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
    .select({ seq: runTranscript.seq, item: runTranscript.item })
    .from(runTranscript)
    .where(eq(runTranscript.runId, runId))
    .orderBy(asc(runTranscript.seq));
  // A dropped row would orphan a call/output pair and make the next request 400; fail loudly.
  return rows.map((row) => {
    const parsed = TranscriptEntry.safeParse(row.item);
    if (!parsed.success)
      throw new Error(`run_transcript row ${row.seq} of run ${runId} is unparseable`);
    return parsed.data;
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

/** The storage key behind a `garage:` ref, only if it lies under this run's transcript prefix. */
export function resolveGarageRef(runId: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(GARAGE_REF)) return null;
  const key = value.slice(GARAGE_REF.length);
  if (
    !key.startsWith(objectKeys.transcriptImagePrefix(runId)) ||
    key.includes("..") ||
    key.includes("\\")
  )
    return null;
  return key;
}

/** Keys of the newest `count` screenshots; only real image fields count, never message or argument text. */
export function recentScreenshotKeys(
  entries: readonly TranscriptEntry[],
  runId: string,
  count: number,
): string[] {
  const keys: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (object.type === "computer_screenshot" || object.type === "input_image") {
      const key = resolveGarageRef(runId, object.image_url);
      if (key) keys.push(key);
    }
    Object.values(object).forEach(walk);
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
      case "reasoning":
        return null;
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
  const joined = lines.filter((line) => line !== null).join("\n");
  return joined.length > maxChars ? joined.slice(-maxChars) : joined;
}
