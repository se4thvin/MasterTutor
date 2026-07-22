import type { Budget, Usage } from "@mastertutor/contracts";
import { compactNumber, formatCount } from "@/components/bits/format.ts";
import { RollingNumber } from "@/components/bits/rolling-number.tsx";

export function BudgetMeters({ usage, budget }: { usage: Usage; budget: Budget }) {
  const rows = [
    {
      id: "steps",
      label: "Steps",
      value: usage.steps,
      max: budget.maxSteps,
      decimals: 0,
      prefix: "",
      suffix: "",
      foot: "Pauses and asks at the limit",
    },
    {
      id: "spend",
      label: "Spend",
      value: usage.usd,
      max: budget.maxUsd,
      decimals: 2,
      prefix: "$",
      suffix: "",
      foot: `${compactNumber(usage.inputTokens + usage.outputTokens)} tokens`,
    },
    {
      id: "time",
      label: "Time",
      value: Math.floor(usage.activeMs / 60_000),
      max: budget.maxActiveMinutes,
      decimals: 0,
      prefix: "",
      suffix: " min",
      foot: "Counts while the agent works",
    },
  ];
  return (
    <dl className="run-meters" aria-label="Budget">
      {rows.map((r) => (
        <div key={r.id} className="run-meter" data-testid={`meter-${r.id}`}>
          <dt className="eyebrow">{r.label}</dt>
          <dd className="run-meter-value">
            <span className="run-meter-num">
              <RollingNumber value={formatCount(r.value, r.decimals, r.prefix, r.suffix)} />
              <small> / {formatCount(r.max, r.decimals, r.prefix, r.suffix)}</small>
            </span>
            <span className="run-meter-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(1, r.value / r.max)})` }} />
            </span>
            <span className="run-meter-foot">{r.foot}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
