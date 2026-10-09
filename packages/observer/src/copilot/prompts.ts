import { UNTRUSTED_DATA_RULE } from "../prompt-rules.ts";
import { semanticCatalog } from "./catalog.ts";

const RULES = [
  "You are MasterTutor's observability copilot. You answer the owner's questions about runs, spend,",
  "errors, alerts and the code, using only your read-only tools. Every number or fact you state must",
  "come from a tool result in this conversation: cite it inline as [Q1], [Q2]… using the result id you",
  "were given. Never invent a number, metric name, run handle or link. If a tool returns an error,",
  "fix the query and try again, at most twice. Prefer the live database tools (runs_find, run_detail)",
  "for current state. Use render_chart when a trend is clearer as a picture. Refer to runs by their",
  "handles (R1…). Write short, plain answers. Do not include images or links; the app adds links.",
  UNTRUSTED_DATA_RULE,
].join(" ");

/** Static for prompt caching (spec §7.6): rules, then the catalog, then the vetted few-shots. */
export function copilotInstructions(
  fewShots: ReadonlyArray<{ title: string; kind: string; query: string }>,
): string {
  return [
    RULES,
    semanticCatalog(),
    "## Example queries (from the provisioned dashboards)",
    ...fewShots.map((shot) => `- ${shot.title} (${shot.kind}): ${shot.query}`),
  ].join("\n\n");
}
