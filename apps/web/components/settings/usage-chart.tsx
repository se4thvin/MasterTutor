"use client";

import type { UsageReport } from "@mastertutor/contracts";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { formatUsd, niceCeiling } from "@/lib/usage/summary.ts";

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayLabel = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Where each key moves focus, given the current bar and the bar count. */
const KEY_STEP: Record<string, (index: number, last: number) => number> = {
  ArrowLeft: (i) => Math.max(0, i - 1),
  ArrowRight: (i, last) => Math.min(last, i + 1),
  Home: () => 0,
  End: (_i, last) => last,
};

/**
 * Single-series daily spend: accent bars, no legend, a tooltip on hover or focus for each bar,
 * and the same numbers as a table under "Show data". Bars grow from the baseline (scale) on a
 * left-to-right wave.
 * The bars are one tab stop (roving tabindex, starting on the latest day); arrow keys, Home and
 * End move between days, so 90 days never means 90 presses of Tab.
 */
export function UsageChart({ perDay }: { perDay: UsageReport["perDay"] }) {
  const max = niceCeiling(Math.max(0, ...perDay.map((d) => d.usd)));
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  // Tracked by day, so a new range that no longer contains it falls back to the latest day.
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const found = perDay.findIndex((d) => d.day === activeDay);
  const active = found >= 0 ? found : perDay.length - 1;

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = KEY_STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const next = step(index, perDay.length - 1);
    setActiveDay(perDay[next]?.day ?? null);
    bars.current[next]?.focus();
  };
  const ticks = [...new Set([0, Math.floor(perDay.length / 2), perDay.length - 1])];
  return (
    <figure className="chart" aria-label="Daily spend">
      <div
        className="chart-plot"
        role="group"
        aria-label="Spend per day"
        aria-describedby="chart-keys"
      >
        <div className="chart-axis" aria-hidden="true">
          <span>{formatUsd(max)}</span>
          <span>{formatUsd(0)}</span>
        </div>
        {/* Keyed by range length, so a new range replays the bars' growth, but a refetch that
            moves the window a day does not remount the bars (and drop keyboard focus). */}
        <ol className="chart-bars" key={perDay.length}>
          {perDay.map((d, i) => (
            <li
              key={d.day}
              className="chart-col"
              style={{ "--x": (i + 0.5) / perDay.length } as CSSProperties}
            >
              <span
                ref={(el) => {
                  bars.current[i] = el;
                }}
                data-qa="bar"
                role="img"
                tabIndex={i === active ? 0 : -1}
                onFocus={() => setActiveDay(d.day)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className="chart-bar"
                style={{ "--v": d.usd / max } as CSSProperties}
                aria-label={`${dayLabel(d.day)}: ${formatUsd(d.usd)}, ${count(d.runs, "run")}`}
                aria-describedby={`tip-${d.day}`}
              />
              <span id={`tip-${d.day}`} role="tooltip" className="chart-tip">
                <b>{dayLabel(d.day)}</b> {formatUsd(d.usd)} · {count(d.runs, "run")} ·{" "}
                {count(d.steps, "step")}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="chart-x t-foot" aria-hidden="true">
        {ticks.map((i) => (
          <span key={i}>{perDay[i] ? dayLabel(perDay[i].day) : ""}</span>
        ))}
      </div>
      <p id="chart-keys" className="chart-keys t-foot">
        Use the arrow keys to move between days, and Home or End for the first or last.
      </p>
      <details className="chart-data">
        <summary className="btn btn-plain">Show data</summary>
        <div className="table-scroll">
          <table aria-label="Daily spend data">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Spend</th>
                <th scope="col">Runs</th>
                <th scope="col">Steps</th>
              </tr>
            </thead>
            <tbody>
              {perDay.map((d) => (
                <tr key={d.day}>
                  <td>{dayLabel(d.day)}</td>
                  <td>{formatUsd(d.usd)}</td>
                  <td>{d.runs}</td>
                  <td>{d.steps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
