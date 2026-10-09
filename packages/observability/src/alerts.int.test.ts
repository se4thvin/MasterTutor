import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ALERT_RULES } from "@mastertutor/contracts";
import { LOG_STREAMS, METRIC, ATTR } from "@mastertutor/contracts/telemetry";
import { TestContainers } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { upsertAlerts } from "./alerts.ts";
import { eventsWithin } from "./dashboards/queries.ts";
import { AlertList, o2Paths } from "./o2-api.ts";
import { provisionAlertDelivery, provisionStreams } from "./provision.ts";
import { startTestOpenObserve, type TestOpenObserve } from "./testing.ts";

const SECRET = "s".repeat(40);
const deliveries: Array<{ authorization: string | undefined; body: string }> = [];
let web: ReturnType<typeof createServer>;
let o2: TestOpenObserve;

beforeAll(async () => {
  // A stand-in for web's webhook, reachable from the container (exposed before it starts).
  web = createServer((req, res) => {
    let body = "";
    req
      .on("data", (chunk: Buffer) => (body += chunk.toString()))
      .on("end", () => {
        deliveries.push({ authorization: req.headers.authorization, body });
        res.writeHead(202).end();
      });
  });
  await new Promise<void>((resolve) => web.listen(0, "0.0.0.0", resolve));
  const port = (web.address() as AddressInfo).port;
  await TestContainers.exposeHostPorts(port);
  o2 = await startTestOpenObserve();
  await provisionStreams(o2.root);
  await provisionAlertDelivery(o2.root, {
    url: `http://host.testcontainers.internal:${port}/api/alerts/webhook`,
    secret: SECRET,
  });
}, 180_000);
afterAll(async () => {
  await o2?.stop();
  web?.close();
});

describe("upsertAlerts against the pinned image", () => {
  it("creates every alert rule once, on a fresh image whose metric streams have no data yet", async () => {
    await upsertAlerts(o2.root, { spendUsdPerHour: 25 });
    await upsertAlerts(o2.root, { spendUsdPerHour: 30 });
    const list = await o2.root.call(
      "listAlerts",
      "GET",
      o2Paths.alerts("default"),
      undefined,
      AlertList,
    );
    expect(list.list.map((a) => a.name).sort()).toEqual([...ALERT_RULES].sort());
    const spend = list.list.find((a) => a.name === "spend_jump")!;
    const stored = await o2.root.call("getAlert", "GET", o2Paths.alert("default", spend.alert_id));
    expect(JSON.stringify(stored)).toContain('"value":30');
  });

  it("fires on the first event of a new series (born at 1) and the SQL count, and only those (review I1)", async () => {
    await o2.root.call(
      "ingest",
      "POST",
      o2Paths.jsonIngest("default", LOG_STREAMS.app),
      Array.from({ length: 25 }, (_, i) => ({ severity: "ERROR", body: `e${i}` })),
    );
    // A process's first failed run and first rejected request: one point each, at value 1.
    const now = nowNanos();
    await ingestCounter("mt.runs.ended", { "mt.run.status": "failed" }, [[1, now]], now);
    await ingestCounter(
      "mt.run.failures",
      { "mt.error.code": "model_request_rejected" },
      [[1, now]],
      now,
    );
    // A Shadow block must never page the owner (D52).
    await ingestCounter(
      METRIC.observerVerdicts.name,
      { [ATTR.observerVerdict]: "block", [ATTR.observerRollout]: "shadow" },
      [[1, now]],
      now,
    );
    // Rules are evaluated once a minute; wait for two rounds at most.
    const deadline = Date.now() + 150_000;
    while (deliveries.length < 3 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    expect(deliveries.map((d) => d.body).sort()).toEqual([
      '{"rule":"error_spike"}',
      '{"rule":"model_request_rejected"}',
      '{"rule":"run_failed"}',
    ]);
    expect(deliveries.every((d) => d.authorization === `Bearer ${SECRET}`)).toBe(true);
  }, 180_000);

  it("delivers enforced Observer blocks and three failures, with authenticated webhooks", async () => {
    const now = nowNanos();
    await ingestCounter(
      METRIC.observerVerdicts.name,
      { [ATTR.observerVerdict]: "block", [ATTR.observerRollout]: "enforce" },
      [[1, now]],
      now,
    );
    await ingestCounter(
      METRIC.observerFailures.name,
      { [ATTR.observerRole]: "guard", [ATTR.observerOutcome]: "invalid" },
      [
        [1, now - 2_000_000_000n],
        [2, now - 1_000_000_000n],
        [3, now],
      ],
      now - 2_000_000_000n,
    );
    const bodies = () => deliveries.map((d) => d.body);
    const deadline = Date.now() + 150_000;
    while (
      (!bodies().includes('{"rule":"observer_escalation"}') ||
        !bodies().includes('{"rule":"observer_failure"}')) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(bodies()).toContain('{"rule":"observer_escalation"}');
    expect(bodies()).toContain('{"rule":"observer_failure"}');
    expect(
      deliveries
        .filter((d) => d.body.includes("observer_"))
        .every((d) => d.authorization === `Bearer ${SECRET}`),
    ).toBe(true);
  }, 180_000);

  it("counts events, not series: a steady old counter is 0, a grown one its growth, a new one its value", async () => {
    const now = nowNanos();
    const s = 1_000_000_000n;
    const born = now - 900n * s;
    // Exported every 30 s, as the SDK and spanmetrics do, for 12 minutes.
    const every30s = (value: (t: bigint) => number) =>
      Array.from({ length: 24 }, (_, i) => {
        const t = now - BigInt(720 - i * 30) * s;
        return [value(t), t] as [number, bigint];
      });
    await ingestCounter(
      "mt.runs.ended",
      { "mt.run.status": "steady" },
      every30s(() => 1),
      born,
    );
    await ingestCounter(
      "mt.runs.ended",
      { "mt.run.status": "grew" },
      every30s((t) => (t > now - 120n * s ? 3 : 1)),
      born,
    );
    await ingestCounter(
      "mt.runs.ended",
      { "mt.run.status": "new" },
      [[1, now - 60n * s]],
      now - 60n * s,
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const PromValue = z.object({
      data: z.object({ result: z.array(z.object({ value: z.tuple([z.number(), z.string()]) })) }),
    });
    const count = async (status: string) => {
      const expr = eventsWithin(`mt_runs_ended{mt_run_status="${status}"}`, 5);
      const result = await o2.root.call(
        "promQuery",
        "GET",
        o2Paths.promQuery("default", expr),
        undefined,
        PromValue,
      );
      return Number(result.data.result[0]?.value[1]);
    };
    expect(await count("steady")).toBe(0);
    expect(await count("grew")).toBe(2);
    expect(await count("new")).toBe(1);
  });
});

const nowNanos = () => BigInt(Date.now()) * 1_000_000n;

/** OTLP cumulative counter points for one series (cumulative from `start`, like the SDK exports). */
async function ingestCounter(
  name: string,
  attributes: Record<string, string>,
  points: ReadonlyArray<readonly [number, bigint]>,
  start: bigint,
) {
  await o2.root.call("otlpMetrics", "POST", o2Paths.otlp("default", "metrics"), {
    resourceMetrics: [
      {
        resource: { attributes: [] },
        scopeMetrics: [
          {
            metrics: [
              {
                name,
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: points.map(([value, time]) => ({
                    asInt: String(value),
                    startTimeUnixNano: String(start),
                    timeUnixNano: String(time),
                    attributes: Object.entries(attributes).map(([key, v]) => ({
                      key,
                      value: { stringValue: v },
                    })),
                  })),
                },
              },
            ],
          },
        ],
      },
    ],
  });
}
