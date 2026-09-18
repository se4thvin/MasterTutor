import { USAGE_MAX_DAYS, type RunSummary, type UsageReport } from "@mastertutor/contracts";
import { createSeed } from "./seed.ts";
import type { FixtureState } from "./types.ts";

const MAX_NAMESPACES = 500;
const states = new Map<string, FixtureState>();

/** One seeded state per namespace (per Playwright test), created lazily, oldest evicted first. */
export function stateFor(ns: string): FixtureState {
  let state = states.get(ns);
  if (!state) {
    if (states.size >= MAX_NAMESPACES) {
      const oldest = states.keys().next().value;
      if (oldest !== undefined) states.delete(oldest);
    }
    state = createSeed();
    states.set(ns, state);
  }
  return state;
}

const hash = (text: string) => {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Deterministic usage for any date range so charts look real in fixture mode. */
export function usageReport(runs: readonly RunSummary[], from: string, to: string): UsageReport {
  const perDay: UsageReport["perDay"] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (
    const d = new Date(`${from}T00:00:00Z`);
    d <= end && perDay.length < USAGE_MAX_DAYS;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.toISOString().slice(0, 10);
    const h = hash(day);
    const count = h % 5;
    perDay.push({
      day,
      runs: count,
      usd: Math.round(count * (0.6 + (h % 70) / 100) * 100) / 100,
      steps: count * (18 + (h % 40)),
    });
  }
  return {
    perDay,
    perRun: runs.map((r) => ({
      runId: r.id,
      goal: r.goal,
      status: r.status,
      usd: r.usage.usd,
      steps: r.usage.steps,
    })),
    stepLatencyMs: { p50: 840, p95: 2310 },
    openaiErrorRate: 0.012,
  };
}
