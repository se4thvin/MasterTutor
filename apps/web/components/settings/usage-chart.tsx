import type { UsageReport } from "@mastertutor/contracts";
import type { CSSProperties } from "react";
import { formatUsd, niceCeiling } from "@/lib/usage/summary.ts";

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayLabel = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Single-series daily spend: accent bars, no legend, a tooltip on hover or focus for each bar,
 * and the same numbers as a table under "Show data". Bar heights are static CSS, not animated.
 */
export function UsageChart({ perDay }: { perDay: UsageReport["perDay"] }) {
  const max = niceCeiling(Math.max(0, ...perDay.map((d) => d.usd)));
  const ticks = [...new Set([0, Math.floor(perDay.length / 2), perDay.length - 1])];
  return (
    <figure className="chart" aria-label="Daily spend">
      <div className="chart-plot">
        <div className="chart-axis" aria-hidden="true">
          <span>{formatUsd(max)}</span>
          <span>{formatUsd(0)}</span>
        </div>
        <ol className="chart-bars">
          {perDay.map((d, i) => (
            <li
              key={d.day}
              className="chart-col"
              style={{ "--x": (i + 0.5) / perDay.length } as CSSProperties}
            >
              <span
                data-qa="bar"
                role="img"
                tabIndex={0}
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
