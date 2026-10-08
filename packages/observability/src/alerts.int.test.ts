import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { LOG_STREAMS } from "@mastertutor/contracts/telemetry";
import { TestContainers } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertAlerts } from "./alerts.ts";
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
  it("creates the five alerts once, on a fresh image whose metric streams have no data yet", async () => {
    await upsertAlerts(o2.root, { spendUsdPerHour: 25 });
    await upsertAlerts(o2.root, { spendUsdPerHour: 30 });
    const list = await o2.root.call(
      "listAlerts",
      "GET",
      o2Paths.alerts("default"),
      undefined,
      AlertList,
    );
    expect(list.list.map((a) => a.name).sort()).toEqual([
      "error_spike",
      "model_request_rejected",
      "run_failed",
      "slot_crash_loop",
      "spend_jump",
    ]);
    const spend = list.list.find((a) => a.name === "spend_jump")!;
    const stored = await o2.root.call("getAlert", "GET", o2Paths.alert("default", spend.alert_id));
    expect(JSON.stringify(stored)).toContain('"value":30');
  });

  it("fires the SQL and PromQL rules that hold, and only those, with the rule name and bearer", async () => {
    await o2.root.call(
      "ingest",
      "POST",
      o2Paths.jsonIngest("default", LOG_STREAMS.app),
      Array.from({ length: 25 }, (_, i) => ({ severity: "ERROR", body: `e${i}` })),
    );
    const now = BigInt(Date.now()) * 1_000_000n;
    for (const [value, offset] of [
      [1, 20_000_000_000n],
      [3, 0n],
    ] as const)
      await o2.root.call("otlpMetrics", "POST", o2Paths.otlp("default", "metrics"), {
        resourceMetrics: [
          {
            resource: { attributes: [] },
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
                          asInt: String(value),
                          startTimeUnixNano: String(now - 30_000_000_000n),
                          timeUnixNano: String(now - offset),
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
    // Rules are evaluated once a minute; wait for two rounds at most.
    const deadline = Date.now() + 150_000;
    while (deliveries.length < 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    expect(deliveries.map((d) => d.body).sort()).toEqual([
      '{"rule":"error_spike"}',
      '{"rule":"run_failed"}',
    ]);
    expect(deliveries.every((d) => d.authorization === `Bearer ${SECRET}`)).toBe(true);
  }, 180_000);
});
