import { COPILOT_LIMITS } from "@mastertutor/contracts";
import type { ResponseInputItem } from "@mastertutor/contracts/server/openai";

export interface ReplayEntry {
  role: string;
  item: Record<string, unknown>;
}
/** Ephemeral request projection: storage keeps the complete replay and opt-in provenance. */
export function replayInput(
  entries: ReplayEntry[],
  includeUntrusted: boolean,
  prefixChars: number,
): ResponseInputItem[] {
  const groups: Array<Array<Record<string, unknown>>> = [];
  for (const entry of entries) {
    if (!includeUntrusted && entry.item._copilotOptIn === true) continue;
    const item = Object.fromEntries(
      Object.entries(entry.item).filter(([key]) => !key.startsWith("_copilot")),
    );
    if (item.role === "user" || groups.length === 0) groups.push([]);
    groups.at(-1)!.push(item);
  }
  const size = () => prefixChars + JSON.stringify(groups.flat()).length;
  const max = COPILOT_LIMITS.inputTokens * 4;
  for (const item of groups.flat()) {
    if (size() <= max) break;
    if (item.type === "function_call_output" && typeof item.output === "string") {
      const id = /"resultId":"(Q[1-9][0-9]{0,2})"/.exec(item.output)?.[1] ?? "?";
      item.output = `[result ${id} omitted; re-run if needed]`;
    }
  }
  // Whole exchanges keep SDK function calls, outputs and encrypted reasoning together.
  while (size() > max && groups.length > 1) groups.shift();
  if (size() > max) throw new Error("input_limit");
  return groups.flat() as unknown as ResponseInputItem[];
}
