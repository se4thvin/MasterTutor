"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RubberSegment, type SegmentItem } from "@/components/bits/rubber-segment.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { formatUsd, rangeFor, summarize } from "@/lib/usage/summary.ts";
import { UsageChart } from "./usage-chart.tsx";

type RangeKey = "7" | "30" | "90";
const RANGES: SegmentItem<RangeKey>[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

export function UsageView() {
  const [range, setRange] = useState<RangeKey>("30");
  const input = useMemo(() => rangeFor(Number(range), new Date()), [range]);
  const usage = useQuery(orpc.settings.usage.queryOptions({ input }));
  const { data } = usage;
  const totals = data ? summarize(data) : null;
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Settings", href: "/settings" }, { label: "Usage" }]} />
        <ToolbarSpacer />
        <RubberSegment
          aria-label="Range"
          size="sm"
          items={RANGES}
          value={range}
          onChange={setRange}
        />
      </Toolbar>
      <div className="wrap slist">
        <PageHead title="Usage" lede="What the agent spent, and how fast it worked." />
        {usage.isError && !data ? (
          <LoadError
            title="Couldn't load usage."
            onRetry={() => void usage.refetch()}
            retrying={usage.isFetching}
          />
        ) : !data || !totals ? (
          <div role="status" aria-busy="true" aria-label="Loading usage">
            <Skeleton className="h-64 rounded-lg" />
          </div>
        ) : (
          <>
            <dl className="tiles">
              <div className="tile">
                <dt>Spend</dt>
                <dd>{formatUsd(totals.usd)}</dd>
              </div>
              <div className="tile">
                <dt>Runs</dt>
                <dd>{totals.runs}</dd>
              </div>
              <div className="tile">
                <dt>Steps</dt>
                <dd>{totals.steps}</dd>
              </div>
              <div className="tile">
                <dt>Step latency</dt>
                <dd>
                  {data.stepLatencyMs.p50 ?? "–"}
                  <small> ms p50 · {data.stepLatencyMs.p95 ?? "–"} p95</small>
                </dd>
              </div>
              <div className="tile">
                <dt>OpenAI errors</dt>
                <dd>
                  {data.openaiErrorRate === null
                    ? "–"
                    : `${(data.openaiErrorRate * 100).toFixed(1)}%`}
                </dd>
              </div>
            </dl>
            <h2 className="t-title3 group-title">Daily spend</h2>
            <div className="group group-pad">
              <UsageChart perDay={data.perDay} />
            </div>
            <h2 className="t-title3 group-title">By run</h2>
            <div className="group table-scroll">
              <table className="data-table" aria-label="Spend by run">
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">Status</th>
                    <th scope="col">Steps</th>
                    <th scope="col">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perRun.map((r) => (
                    <tr key={r.runId}>
                      <td>
                        {/* Plain text until F3 builds /runs/<id>. */}
                        {r.goal}
                      </td>
                      <td>{r.status}</td>
                      <td>{r.steps}</td>
                      <td>{formatUsd(r.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
