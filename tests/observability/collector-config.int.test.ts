import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { GenericContainer, TestContainers, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OTEL_COLLECTOR_IMAGE } from "@mastertutor/observability";
import { composeConfig } from "../compose/compose-json.ts";

const CONFIG = new URL("../../infra/otel/collector.yaml", import.meta.url).pathname;
const received: Array<{ path: string; stream: string | undefined; body: string }> = [];
let sink: ReturnType<typeof createServer>;
let collector: StartedTestContainer;
let otlp: string;

beforeAll(async () => {
  sink = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => {
        const raw = Buffer.concat(chunks);
        const body = req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
        received.push({
          path: req.url ?? "",
          stream: req.headers["stream-name"] as string | undefined,
          body: body.toString("latin1"),
        });
        res.writeHead(200).end();
      });
  });
  await new Promise<void>((r) => sink.listen(0, "0.0.0.0", r));
  const port = (sink.address() as AddressInfo).port;
  await TestContainers.exposeHostPorts(port);
  collector = await new GenericContainer(OTEL_COLLECTOR_IMAGE)
    .withCopyFilesToContainer([{ source: CONFIG, target: "/etc/otelcol/config.yaml" }])
    .withCommand(["--config=/etc/otelcol/config.yaml"])
    .withEnvironment({
      OBSERVE_INGEST_PASSWORD: "ingest-password",
      OBSERVE_OTLP_ENDPOINT: `http://host.testcontainers.internal:${port}/observability/api/default`,
    })
    .withExposedPorts(4318, 13133, 24224)
    .withWaitStrategy(Wait.forHttp("/", 13133))
    .start();
  otlp = `http://${collector.getHost()}:${collector.getMappedPort(4318)}`;
}, 180_000);
afterAll(async () => {
  await collector?.stop();
  sink?.close();
});

const CANARY = "sk-CANARYCANARYCANARY0123";
const now = () => `${Date.now()}000000`;
const until = async (check: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
};

describe("collector pipeline (spec §10)", () => {
  it("validates", async () => {
    const result = await collector.exec([
      "/otelcol-contrib",
      "validate",
      "--config=/etc/otelcol/config.yaml",
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("scrubs secrets, maps S3 spans, keeps errors and derives span metrics", async () => {
    await fetch(`${otlp}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: { attributes: [{ key: "service.name", value: { stringValue: "agent" } }] },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: "b7ad6b7169203331",
                    name: "GET",
                    kind: 3,
                    startTimeUnixNano: now(),
                    endTimeUnixNano: now(),
                    status: { code: 2 },
                    attributes: [
                      { key: "server.address", value: { stringValue: "garage" } },
                      { key: "http.request.method", value: { stringValue: "GET" } },
                      {
                        key: "url.full",
                        value: { stringValue: "http://garage:3900/mastertutor/x/private.pdf" },
                      },
                      { key: "mt.error.code", value: { stringValue: "s3_failed" } },
                      { key: "note", value: { stringValue: `Bearer ${CANARY}` } },
                      { key: "db_password", value: { stringValue: "pw-canary" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    await fetch(`${otlp}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: now(),
                    severityText: "ERROR",
                    body: { stringValue: `key ${CANARY}` },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    await new Promise((r) => setTimeout(r, 35_000)); // tail sampling waits 20 s; spanmetrics flush 30 s
    const traces = received
      .filter((r) => r.path.endsWith("/v1/traces"))
      .map((r) => r.body)
      .join("");
    const logs = received.filter((r) => r.path.endsWith("/v1/logs") && r.stream === "mastertutor");
    const metrics = received
      .filter((r) => r.path.endsWith("/v1/metrics"))
      .map((r) => r.body)
      .join("");
    expect(received.every((r) => r.path.startsWith("/observability/api/default/v1/"))).toBe(true);
    expect(traces).toContain("s3 GET");
    expect(traces).not.toContain("private.pdf");
    expect(traces).not.toContain("pw-canary");
    expect(logs.length).toBeGreaterThan(0);
    expect(traces + logs.map((l) => l.body).join("")).not.toContain(CANARY);
    expect(traces).toContain("****");
    expect(metrics).toContain("mt.span.calls");
  }, 90_000);

  it("takes container logs from Docker's fluentd driver, and `docker logs` still works", async () => {
    const name = `mt-ci-${randomUUID().slice(0, 8)}-browser-3-1`;
    const marker = `container-line-${randomUUID()}`;
    const runId = process.env["MT_CI_RUN_ID"];
    // The production log options (compose.prod.yml, spec §9): async, non-blocking, dual-logging cache.
    execFileSync("docker", [
      "run",
      "--name",
      name,
      ...(runId ? ["--label", "mastertutor.ci=1", "--label", `mastertutor.ci.run=${runId}`] : []),
      "--log-driver",
      "fluentd",
      "--log-opt",
      `fluentd-address=127.0.0.1:${collector.getMappedPort(24224)}`,
      "--log-opt",
      "fluentd-async=true",
      "--log-opt",
      "mode=non-blocking",
      "--log-opt",
      "max-buffer-size=4m",
      "--log-opt",
      "tag=mt.{{.Name}}",
      "--log-opt",
      "cache-max-size=10m",
      "--log-opt",
      "cache-max-file=3",
      "busybox:1.37",
      "echo",
      `${marker} Bearer ${CANARY}`,
    ]);
    try {
      expect(execFileSync("docker", ["logs", name], { encoding: "utf8" })).toContain(marker);
      const containerLogs = () =>
        received.filter((r) => r.stream === "containers" && r.body.includes(marker));
      await until(() => containerLogs().length > 0, 30_000);
      const body = containerLogs()
        .map((r) => r.body)
        .join("");
      // The mapped value, not just the raw container name (which ends in "-browser-3-1").
      expect(body).toContain("mt.service");
      expect(body).toMatch(/browser-3(?!-)/);
      expect(body).not.toContain(CANARY);
    } finally {
      execFileSync("docker", ["rm", "-f", name]);
    }
  }, 60_000);

  it("obs-ingest: the loopback-published port works, but nothing gets out (review I2)", async () => {
    const options = composeConfig(".env.test", ["compose.yml"], { profiles: ["observability"] })
      .networks["obs-ingest"]!.driver_opts!;
    const id = randomUUID().slice(0, 8);
    const network = `mt-ci-obs-ingest-${id}`;
    const listener = `mt-ci-obs-listener-${id}`;
    const runId = process.env["MT_CI_RUN_ID"];
    const labels = runId
      ? ["--label", "mastertutor.ci=1", "--label", `mastertutor.ci.run=${runId}`]
      : [];
    const egress = (net: string) =>
      execFileSync(
        "docker",
        [
          "run",
          "--rm",
          ...labels,
          "--network",
          net,
          "busybox:1.37",
          "sh",
          "-c",
          "nc -w 5 1.1.1.1 80 </dev/null && echo out || echo blocked",
        ],
        { encoding: "utf8" },
      ).trim();
    execFileSync("docker", [
      "network",
      "create",
      ...labels,
      ...Object.entries(options).flatMap(([key, value]) => ["-o", `${key}=${value}`]),
      network,
    ]);
    try {
      expect(egress("bridge")).toBe("out"); // the host itself has egress, so the next line means something
      expect(egress(network)).toBe("blocked");
      execFileSync("docker", [
        "run",
        "-d",
        "--name",
        listener,
        ...labels,
        "--network",
        network,
        "-p",
        "127.0.0.1::24224",
        "busybox:1.37",
        "sh",
        "-c",
        "while true; do echo ok | nc -l -p 24224; done",
      ]);
      const port = Number(
        execFileSync("docker", ["port", listener, "24224/tcp"], { encoding: "utf8" })
          .trim()
          .split(":")
          .pop(),
      );
      await new Promise((r) => setTimeout(r, 1_000)); // the listener starts
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        let data = "";
        socket
          .on("data", (chunk) => (data += chunk.toString()))
          .on("end", () => resolve(data.trim()))
          .on("error", reject);
      });
      expect(reply).toBe("ok");
    } finally {
      execFileSync("docker", ["rm", "-f", listener], { stdio: "ignore" });
      execFileSync("docker", ["network", "rm", network], { stdio: "ignore" });
    }
  }, 60_000);
});
