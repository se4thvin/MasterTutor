import { createServer, type IncomingHttpHeaders, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { trace } from "@opentelemetry/api";
import { createLogger } from "@mastertutor/contracts/server";
import { TRACER_NAME } from "@mastertutor/contracts/telemetry";
import { afterEach, describe, expect, it } from "vitest";
import { getTelemetry, startTelemetry } from "./start.ts";

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}
const silent = createLogger({ service: "test", level: "silent" });

afterEach(async () => {
  await getTelemetry().shutdown();
});

describe("startTelemetry (spec §6.3, §7)", () => {
  it("does nothing without an endpoint", () => {
    const handle = startTelemetry({
      service: "agent",
      env: { MT_DEPLOYMENT: "test" },
      crash: "observe",
      log: silent,
    });
    expect(handle.enabled).toBe(false);
    expect(trace.getTracer(TRACER_NAME).startSpan("s").isRecording()).toBe(false);
  });

  it("exports spans and never sends a traceparent anywhere (D38)", async () => {
    const paths: string[] = [];
    const seen: IncomingHttpHeaders[] = [];
    const collector = await listen((req, res) => {
      paths.push(req.url ?? "");
      req.resume().on("end", () => res.writeHead(200).end());
    });
    const target = await listen((req, res) => {
      seen.push(req.headers);
      res.end("ok");
    });
    const handle = startTelemetry({
      service: "agent",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, MT_DEPLOYMENT: "test" },
      crash: "observe",
      log: silent,
    });
    expect(handle.enabled).toBe(true);
    await trace.getTracer(TRACER_NAME).startActiveSpan("mt.tool", async (span) => {
      await (await fetch(target.url)).text();
      span.end();
    });
    await handle.flush(5_000);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty("traceparent");
    expect(seen[0]).not.toHaveProperty("tracestate");
    expect(paths).toContain("/v1/traces");
    collector.close();
    target.close();
  });

  it("stdout keeps every line while the bridge drops (collector down, Review Focus 1)", async () => {
    const lines: string[] = [];
    const log = createLogger({
      service: "agent",
      destination: { write: (line: string) => void lines.push(line) },
    });
    const handle = startTelemetry({
      service: "agent",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9", MT_DEPLOYMENT: "test" },
      crash: "observe",
      log,
      limits: { maxQueue: 50, maxBatch: 25, intervalMs: 60_000 },
    });
    const started = performance.now();
    for (let i = 0; i < 5_000; i++) log.info({ i }, "burst");
    const perLineMs = (performance.now() - started) / 5_000;
    await handle.flush(6_000);
    expect(lines.filter((line) => line.includes('"msg":"burst"'))).toHaveLength(5_000);
    expect(lines.some((line) => line.includes('"errorCode":"telemetry_dropped"'))).toBe(true);
    expect(perLineMs).toBeLessThan(0.2);
    // The OTLP exporter retries a refused connection until its 5 s export timeout.
  }, 15_000);
});
