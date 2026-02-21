import type { UsageReport } from "@mastertutor/contracts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The last `days` UTC calendar days ending today, inclusive, as ISO dates. */
export function rangeFor(days: number, today: Date): { from: string; to: string } {
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
}

export function summarize(report: UsageReport): { usd: number; runs: number; steps: number } {
  return report.perDay.reduce(
    (t, d) => ({
      usd: Math.round((t.usd + d.usd) * 100) / 100,
      runs: t.runs + d.runs,
      steps: t.steps + d.steps,
    }),
    { usd: 0, runs: 0, steps: 0 },
  );
}

/** The smallest 1, 2, 2.5 or 5 × 10ⁿ at or above `max`, so the axis top is a readable number. */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= max) ?? 10;
  return step * magnitude;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatUsd = (n: number) => usd.format(n);
