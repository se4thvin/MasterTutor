import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type HealthCheck = () => Promise<unknown>;
export type CheckStatus = "ok" | "fail";

export interface HealthReport {
  status: CheckStatus;
  checks: Record<string, CheckStatus>;
  details?: Record<string, unknown>;
}

export interface HealthServerOptions {
  port: number;
  host?: string;
  checks: Readonly<Record<string, HealthCheck>>;
  details?: () => Promise<Record<string, unknown>>;
  timeoutMs?: number;
}

export interface HealthServer {
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 2_000;

function within<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
    Promise.resolve()
      .then(work)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
  });
}

export async function runHealthChecks(
  options: Pick<HealthServerOptions, "checks" | "details" | "timeoutMs">,
): Promise<HealthReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results = await Promise.all(
    Object.entries(options.checks).map(async ([name, check]): Promise<[string, CheckStatus]> => {
      try {
        await within(check, timeoutMs);
        return [name, "ok"];
      } catch {
        return [name, "fail"];
      }
    }),
  );
  const report: HealthReport = {
    status: results.every(([, status]) => status === "ok") ? "ok" : "fail",
    checks: Object.fromEntries(results),
  };
  if (options.details) {
    try {
      report.details = await within(options.details, timeoutMs);
    } catch {
      report.details = { error: "unavailable" };
    }
  }
  return report;
}

/** Internal-only /healthz (spec §14); never exposed through Traefik. */
export async function startHealthServer(options: HealthServerOptions): Promise<HealthServer> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET" || path !== "/healthz") {
      res.writeHead(404, { "content-type": "application/json" }).end('{"status":"not_found"}');
      return;
    }
    void runHealthChecks(options).then((report) => {
      res
        .writeHead(report.status === "ok" ? 200 : 503, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify(report));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
