import type { Storage } from "@mastertutor/storage";
import type { ResponseInputItem } from "../llm/openai.ts";
import { resolveGarageRef, type TranscriptEntry } from "./transcript.ts";

/** Only the newest screenshots go to the model as images (openai-data-policy.md rule 4). */
export const SCREENSHOT_WINDOW = 3;
export const SCREENSHOT_OMITTED = "[screenshot omitted]";
/**
 * A computer_call_output must carry an image, so an omitted one becomes this blank 1×1 PNG (no
 * page data); user-message images become the SCREENSHOT_OMITTED text instead.
 */
export const BLANK_SCREENSHOT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type Loose = Record<string, unknown>;

/** The current context: from the start of the last compaction seed on, without compaction exchanges. */
export function contextEntries(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  let start = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index]!.mark !== "seed") continue;
    start = index;
    while (start > 0 && entries[start - 1]!.mark === "seed") start -= 1;
    break;
  }
  return entries.slice(start).filter((entry) => entry.mark !== "compaction");
}

/** Every call is followed by exactly one output, and every output answers an earlier call. */
function assertPaired(items: readonly Loose[]): void {
  const open = new Set<string>();
  const answered = new Set<string>();
  for (const item of items) {
    const id = typeof item.call_id === "string" ? item.call_id : null;
    if (id === null) continue;
    if (item.type === "computer_call" || item.type === "function_call") open.add(id);
    else if (item.type === "computer_call_output" || item.type === "function_call_output") {
      if (!open.has(id) || answered.has(id))
        throw new Error(`model input is unpaired: output ${id} has no open call`);
      open.delete(id);
      answered.add(id);
    }
  }
  if (open.size > 0)
    throw new Error(`model input is unpaired: no output for ${[...open].join(", ")}`);
}

/** Visits every image slot in order; `replace` returns the new item for that slot. */
function mapImages(
  items: readonly Loose[],
  replace: (url: string, slot: { kind: "output" | "message"; index: number }) => string | null,
): Loose[] {
  let index = 0;
  return items.map((item) => {
    const output = item.output as Loose | undefined;
    if (item.type === "computer_call_output" && output?.type === "computer_screenshot") {
      const url = replace(String(output.image_url ?? ""), { kind: "output", index: index++ });
      return { ...item, output: { ...output, image_url: url ?? BLANK_SCREENSHOT } };
    }
    if (!Array.isArray(item.content)) return item;
    return {
      ...item,
      content: (item.content as Loose[]).map((part) => {
        if (part.type !== "input_image") return part;
        const url = replace(String(part.image_url ?? ""), { kind: "message", index: index++ });
        return url === null
          ? { type: "input_text", text: SCREENSHOT_OMITTED }
          : { ...part, image_url: url };
      }),
    };
  });
}

/**
 * The stateless model input (D37): the current context from run_transcript, in order (reasoning
 * items included, so encrypted reasoning is replayed), then this turn's pending items. Pure.
 */
export function buildModelInput(
  entries: readonly TranscriptEntry[],
  pending: readonly ResponseInputItem[],
  keep = SCREENSHOT_WINDOW,
): ResponseInputItem[] {
  const items = [
    ...contextEntries(entries).map((entry) => entry.item),
    ...(pending as unknown as Loose[]),
  ];
  assertPaired(items);
  let total = 0;
  mapImages(items, (url) => {
    total += 1;
    return url;
  });
  return mapImages(items, (url, slot) =>
    slot.index >= total - keep ? url : null,
  ) as unknown as ResponseInputItem[];
}

/** Replaces this run's `garage:` refs with data URLs; foreign or missing images are omitted. */
export async function rehydrateImages(
  items: readonly ResponseInputItem[],
  runId: string,
  storage: Storage,
): Promise<ResponseInputItem[]> {
  const loose = items as unknown as Loose[];
  const keys = new Set<string>();
  mapImages(loose, (url) => {
    const key = resolveGarageRef(runId, url);
    if (key) keys.add(key);
    return url;
  });
  const urls = new Map<string, string>();
  await Promise.all(
    [...keys].map(async (key) => {
      const bytes = await storage.getBytes(key).catch(() => null);
      if (!bytes) return;
      const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase() ?? "png";
      urls.set(key, `data:image/${ext};base64,${Buffer.from(bytes).toString("base64")}`);
    }),
  );
  return mapImages(loose, (url) => {
    if (!url.startsWith("garage:")) return url;
    const key = resolveGarageRef(runId, url);
    return (key && urls.get(key)) ?? null;
  }) as unknown as ResponseInputItem[];
}
