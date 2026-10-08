import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type * as ContractsServer from "@mastertutor/contracts/server";
import { getTelemetry } from "@mastertutor/telemetry";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const collector = vi.hoisted(() => ({ url: "", paths: [] as string[] }));
vi.mock("./lib/server/env.ts", () => ({
  getWebEnv: () => ({
    LOG_LEVEL: "silent",
    MT_DEPLOYMENT: "test",
    OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
  }),
}));

const server = createServer((req, res) => {
  collector.paths.push(req.url ?? "");
  req.resume().on("end", () => res.end());
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  collector.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await getTelemetry().shutdown();
  server.close();
});

describe("web instrumentation register() (D50, review I2, I4)", () => {
  it("bridges log lines written by a route's own bundled copy, and hides Next's fetch spans", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_OTEL_FETCH_DISABLED", undefined);
    const { register } = await import("./instrumentation.ts");
    await register();
    // Next.js names its fetch spans after the full URL (a Web Push endpoint is a capability).
    expect(process.env.NEXT_OTEL_FETCH_DISABLED).toBe("1");
    // A route handler's layer bundles contracts again: its bridge is a separate module instance.
    const specifier = "../../packages/contracts/src/server/log-bridge.ts?route-layer";
    const route = (await import(specifier)) as typeof ContractsServer;
    route.otelLogStream("web").write(JSON.stringify({ level: 30, msg: "route line" }));
    await getTelemetry().flush(5_000);
    expect(collector.paths).toContain("/v1/logs");
    vi.unstubAllEnvs();
  });
});
