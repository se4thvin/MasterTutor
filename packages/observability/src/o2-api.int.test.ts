import { OBSERVE_USERS, OBSERVE_UI_SESSION } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { O2Error, createO2Client } from "./client.ts";
import {
  AlertList,
  DashboardList,
  O2_EMPTY_PANEL_FILTER,
  O2_FIELDS,
  O2_ROLES,
  O2_TEMPLATE_RULE_VARIABLE,
  O2_TRACE_ERROR_STATUS,
  UserList,
  dashboardRef,
  o2Paths,
  o2StreamCreateBody,
} from "./o2-api.ts";
import { o2Label, o2StreamName } from "./names.ts";
import { startTestOpenObserve, type TestOpenObserve } from "./testing.ts";

let o2: TestOpenObserve;
beforeAll(async () => {
  o2 = await startTestOpenObserve();
}, 180_000);
afterAll(async () => {
  await o2?.stop();
});

const ORG = "default";
const PASSWORD = "Ingest-password-0123456789abcdefghij";
const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: unknown) => (error instanceof O2Error ? error.status : -1),
  );
const nowMicros = () => Date.now() * 1_000;
const SearchHits = z.object({ hits: z.array(z.record(z.string(), z.unknown())) });

async function searchUntilHit(sql: string, type: "logs" | "traces") {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await o2.root.call(
      "search",
      "POST",
      o2Paths.search(ORG, type),
      {
        query: {
          sql,
          start_time: nowMicros() - 600_000_000,
          end_time: nowMicros() + 60_000_000,
          from: 0,
          size: 5,
        },
      },
      SearchHits,
    );
    if (result.hits.length > 0) return result.hits[0]!;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no hit for ${sql}`);
}

describe("OpenObserve API contract (pinned digest, spec §11)", () => {
  it("refuses roles other than admin and weak passwords", async () => {
    const user = (role: string, password: string) =>
      o2.root.call("createUser", "POST", o2Paths.users(ORG), {
        email: `probe-${role}@mastertutor.internal`,
        password,
        role,
      });
    expect(await status(user("member", PASSWORD))).toBe(400);
    expect(await status(user("viewer", PASSWORD))).toBe(400);
    expect(await status(user("admin", "a".repeat(40)))).toBe(400);
  });

  it("creates a user with the pinned role and lists it", async () => {
    await o2.root.call("createUser", "POST", o2Paths.users(ORG), {
      email: OBSERVE_USERS.ingest,
      password: PASSWORD,
      role: O2_ROLES.ingest,
      first_name: "ingest",
      last_name: "collector",
    });
    const users = await o2.root.call("listUsers", "GET", o2Paths.users(ORG), undefined, UserList);
    expect(users.data.map((u) => u.email)).toContain(OBSERVE_USERS.ingest);
  });

  it("lets the ingest user write a log stream", async () => {
    const ingest = createO2Client({
      baseUrl: o2.baseUrl,
      email: OBSERVE_USERS.ingest,
      password: PASSWORD,
    });
    await ingest.call("ingest", "POST", o2Paths.jsonIngest(ORG, "mastertutor"), [
      { level: "info", msg: "contract test" },
    ]);
  });

  it("creates streams with settings, refuses a second create, and sets retention", async () => {
    await o2.root.call(
      "createStream",
      "POST",
      o2Paths.stream(ORG, "containers", "logs"),
      o2StreamCreateBody(30),
    );
    expect(
      await status(
        o2.root.call(
          "createStream",
          "POST",
          o2Paths.stream(ORG, "containers", "logs"),
          o2StreamCreateBody(30),
        ),
      ),
    ).toBe(400);
    await o2.root.call(
      "streamSettings",
      "PUT",
      o2Paths.streamSettings(ORG, "mastertutor", "logs"),
      {
        data_retention: 30,
      },
    );
    await o2.root.call(
      "createStream",
      "POST",
      o2Paths.stream(ORG, "mt_runs_ended", "metrics"),
      o2StreamCreateBody(),
    );
  });

  it("stores OTLP data under the pinned field names", async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    const resource = { attributes: [{ key: "service.name", value: { stringValue: "agent" } }] };
    await o2.root.call("otlpLogs", "POST", o2Paths.otlp(ORG, "logs"), {
      resourceLogs: [
        {
          resource,
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(now),
                  severityNumber: 17,
                  severityText: "ERROR",
                  body: { stringValue: "contract-log" },
                },
              ],
            },
          ],
        },
      ],
    });
    await o2.root.call("otlpTraces", "POST", o2Paths.otlp(ORG, "traces"), {
      resourceSpans: [
        {
          resource,
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "5b8efff798038103d269b633813fc60c",
                  spanId: "eee19b7ec3c1b174",
                  name: "mt.step",
                  kind: 1,
                  startTimeUnixNano: String(now - 20_000_000n),
                  endTimeUnixNano: String(now),
                  status: { code: 2 },
                },
              ],
            },
          ],
        },
      ],
    });
    await o2.root.call("otlpMetrics", "POST", o2Paths.otlp(ORG, "metrics"), {
      resourceMetrics: [
        {
          resource,
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "mt.runs.ended",
                  sum: {
                    aggregationTemporality: 2,
                    isMonotonic: true,
                    dataPoints: [
                      {
                        asInt: "1",
                        startTimeUnixNano: String(now),
                        timeUnixNano: String(now),
                        attributes: [{ key: "mt.run.status", value: { stringValue: "failed" } }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const log = await searchUntilHit(
      `SELECT * FROM "default" WHERE ${O2_FIELDS.logBody} = 'contract-log'`,
      "logs",
    );
    expect(log[O2_FIELDS.logSeverity]).toBe("ERROR");
    const span = await searchUntilHit(`SELECT * FROM "default"`, "traces");
    expect(span[O2_FIELDS.traceOperation]).toBe("mt.step");
    expect(span[O2_FIELDS.traceStatus]).toBe(O2_TRACE_ERROR_STATUS);
    expect(span[O2_FIELDS.traceDurationMicros]).toBe(20_000);
    // Metric names and labels map dots to underscores; label values keep theirs.
    const query = `${o2StreamName("mt.runs.ended")}{${o2Label("mt.run.status")}="failed"}`;
    const PromResult = z.object({ data: z.object({ result: z.array(z.unknown()) }) });
    let series = 0;
    for (let attempt = 0; attempt < 30 && series === 0; attempt++) {
      const result = await o2.root.call(
        "promQuery",
        "GET",
        o2Paths.promQuery(ORG, query),
        undefined,
        PromResult,
      );
      series = result.data.result.length;
      if (series === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(series).toBe(1);
  });

  it("upserts a template and a webhook destination on the internal network", async () => {
    const template = {
      name: "contract",
      body: `{"rule":"${O2_TEMPLATE_RULE_VARIABLE}"}`,
      type: "http",
      isDefault: false,
    };
    expect(
      await status(
        o2.root.call("updateTemplate", "PUT", o2Paths.template(ORG, "contract"), template),
      ),
    ).toBe(404);
    await o2.root.call("createTemplate", "POST", o2Paths.templates(ORG), template);
    await o2.root.call("updateTemplate", "PUT", o2Paths.template(ORG, "contract"), template);
    const destination = {
      name: "contract",
      type: "http",
      url: "http://web:3000/api/alerts/webhook",
      method: "post",
      skip_tls_verify: false,
      template: "contract",
      headers: { Authorization: "Bearer test" },
    };
    expect(
      await status(
        o2.root.call("updateDestination", "PUT", o2Paths.destination(ORG, "contract"), destination),
      ),
    ).toBe(404);
    await o2.root.call("createDestination", "POST", o2Paths.destinations(ORG), destination);
    await o2.root.call(
      "updateDestination",
      "PUT",
      o2Paths.destination(ORG, "contract"),
      destination,
    );
  });

  it("refuses an alert on a missing stream and accepts one on an existing stream", async () => {
    const alert = (stream: string) => ({
      name: `contract_${stream}`,
      stream_type: "metrics",
      stream_name: stream,
      is_real_time: false,
      enabled: true,
      query_condition: {
        type: "promql",
        promql: `sum (increase(${stream}[5m]))`,
        promql_condition: { column: "value", operator: ">=", value: 1 },
        conditions: null,
        sql: null,
      },
      trigger_condition: {
        period: 5,
        operator: ">=",
        threshold: 1,
        frequency: 1,
        frequency_type: "minutes",
        silence: 30,
      },
      destinations: ["contract"],
      context_attributes: {},
    });
    expect(
      await status(o2.root.call("createAlert", "POST", o2Paths.alerts(ORG), alert("mt_missing"))),
    ).toBe(404);
    await o2.root.call("createAlert", "POST", o2Paths.alerts(ORG), alert("mt_runs_ended"));
    const list = await o2.root.call("listAlerts", "GET", o2Paths.alerts(ORG), undefined, AlertList);
    const id = list.list.find((a) => a.name === "contract_mt_runs_ended")!.alert_id;
    await o2.root.call("updateAlert", "PUT", o2Paths.alert(ORG, id), alert("mt_runs_ended"));
  });

  it("creates a dashboard, lists its ref and updates it by hash", async () => {
    const dashboard = (description: string) => ({
      version: 5,
      title: "Contract",
      description,
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [
            {
              id: "panel_1",
              type: "line",
              title: "p",
              description: "",
              config: { show_legends: true },
              queryType: "promql",
              queries: [
                {
                  query: "sum (mt_runs_ended)",
                  customQuery: true,
                  config: { promql_legend: "" },
                  fields: {
                    stream: "",
                    stream_type: "metrics",
                    x: [],
                    y: [],
                    z: [],
                    filter: O2_EMPTY_PANEL_FILTER,
                  },
                },
              ],
              layout: { x: 0, y: 0, w: 24, h: 9, i: 1 },
            },
          ],
        },
      ],
    });
    await o2.root.call("createDashboard", "POST", o2Paths.dashboards(ORG), dashboard("one"));
    const list = await o2.root.call(
      "listDashboards",
      "GET",
      o2Paths.dashboards(ORG),
      undefined,
      DashboardList,
    );
    const ref = list.dashboards.map(dashboardRef).find((r) => r?.title === "Contract")!;
    expect(ref).toMatchObject({ id: expect.any(String), hash: expect.any(String) });
    await o2.root.call(
      "updateDashboard",
      "PUT",
      o2Paths.dashboard(ORG, ref.id, ref.hash),
      dashboard("two"),
    );
    expect(
      await status(
        o2.root.call(
          "updateDashboard",
          "PUT",
          o2Paths.dashboard(ORG, ref.id, ref.hash),
          dashboard("three"),
        ),
      ),
    ).toBe(409);
  });

  it("serves only under the base path, and its UI gates on the pinned session record", async () => {
    const origin = new URL(o2.baseUrl).origin;
    expect((await fetch(`${origin}/healthz`)).status).toBe(404);
    const page = await fetch(`${o2.baseUrl}/web/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const entry = (await page.text()).match(/src="\.\/(assets\/index-[^"]+\.js)"/)?.[1];
    expect(entry).toBeDefined();
    const bundle = await (await fetch(`${o2.baseUrl}/web/${entry}`)).text();
    // The router reads this key from this storage, base64-decodes and JSON-parses it (spec §12).
    expect(bundle).toContain(`${OBSERVE_UI_SESSION.storage}.getItem(e)`);
    expect(bundle).toContain(`"${OBSERVE_UI_SESSION.key}"`);
  });
});
