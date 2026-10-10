import { createHash } from "node:crypto";
import { unwrapUntrusted, wrapUntrusted } from "@mastertutor/contracts";

type Item = Record<string, unknown>;
export const PAGE_OUTPUT_WINDOW = 2;
const BULKY_OUTPUT_CHARS = 2_000;

/** Only replay is elided: the stored transcript and captured notes remain verbatim (D54).
 * A stub depends only on the original bytes. RunLoop starts a fresh compaction seed before
 * this frontier changes any previously sent item; decides never silently rewrite history.
 */
export function windowPageOutputs(items: readonly Item[]): Item[] {
  const reads = new Set<string>();
  const outputs: number[] = [];
  for (const [index, item] of items.entries()) {
    if (item.type === "function_call" && item.name === "read_page") reads.add(String(item.call_id));
    if (
      item.type === "function_call_output" &&
      reads.has(String(item.call_id)) &&
      typeof item.output === "string" &&
      item.output.length > BULKY_OUTPUT_CHARS
    )
      outputs.push(index);
  }
  const omitted = new Set(outputs.slice(0, -PAGE_OUTPUT_WINDOW));
  return items.map((item, index) => {
    if (!omitted.has(index) || typeof item.output !== "string") return item;
    const envelope = unwrapUntrusted(item.output);
    let url = "unknown";
    try {
      const body: unknown = JSON.parse(envelope?.content ?? item.output);
      if (
        body !== null &&
        typeof body === "object" &&
        "url" in body &&
        typeof body.url === "string"
      )
        url = body.url.slice(0, 500);
    } catch {
      /* An invalid tool result is still bounded, never interpreted as instructions. */
    }
    const hash = createHash("sha256").update(item.output).digest("hex");
    const stub = `[page text elided: ${url} ${hash}, ${item.output.length} chars]`;
    return { ...item, output: wrapUntrusted(envelope?.origin ?? null, stub) };
  });
}
