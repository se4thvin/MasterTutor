import { LOG_STREAMS } from "@mastertutor/contracts/telemetry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DashboardList, dashboardRef, o2Paths } from "../o2-api.ts";
import { startTestOpenObserve, type TestOpenObserve } from "../testing.ts";
import { DASHBOARDS } from "./catalog.ts";
import { upsertDashboards } from "./upsert.ts";

let o2: TestOpenObserve;
beforeAll(async () => {
  o2 = await startTestOpenObserve();
}, 180_000);
afterAll(async () => {
  await o2?.stop();
});

describe("upsertDashboards against the pinned image", () => {
  it("creates six dashboards once and updates them in place", async () => {
    await upsertDashboards(o2.root);
    await upsertDashboards(o2.root);
    const list = await o2.root.call(
      "listDashboards",
      "GET",
      o2Paths.dashboards("default"),
      undefined,
      DashboardList,
    );
    const titles = list.dashboards.map(dashboardRef).flatMap((ref) => (ref ? [ref.title] : []));
    for (const dashboard of DASHBOARDS)
      expect(titles.filter((t) => t === dashboard.title)).toHaveLength(1);
  });

  it("every panel's query runs: no unknown function, field or syntax", async () => {
    // The columns the SQL panels read exist once a stream has data.
    await o2.root.call("ingest", "POST", o2Paths.jsonIngest("default", LOG_STREAMS.containers), [
      { mt_service: "browser-1", body: "an error line" },
    ]);
    await o2.root.call("ingest", "POST", o2Paths.jsonIngest("default", LOG_STREAMS.app), [
      { severity: "ERROR", service_name: "agent", body: "x" },
    ]);
    const now = BigInt(Date.now()) * 1_000_000n;
    await o2.root.call("otlpTraces", "POST", o2Paths.otlp("default", "traces"), {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "agent" } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "5b8efff798038103d269b633813fc60c",
                  spanId: "eee19b7ec3c1b174",
                  name: "mt.step",
                  kind: 1,
                  startTimeUnixNano: String(now - 1_000_000n),
                  endTimeUnixNano: String(now),
                  status: { code: 2 },
                  attributes: [{ key: "mt.error.code", value: { stringValue: "x" } }],
                },
              ],
            },
          ],
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const nowMicros = Date.now() * 1_000;
    for (const dashboard of DASHBOARDS)
      for (const panel of dashboard.panels) {
        const run =
          panel.query.type === "promql"
            ? o2.root.call("promQuery", "GET", o2Paths.promQuery("default", panel.query.expr))
            : o2.root.call("search", "POST", o2Paths.search("default", panel.query.streamType), {
                query: {
                  sql: panel.query.sql,
                  start_time: nowMicros - 3_600_000_000,
                  end_time: nowMicros + 60_000_000,
                  from: 0,
                  size: 10,
                },
              });
        await expect(run, `${dashboard.title} / ${panel.title}`).resolves.toBeDefined();
      }
  });
});
