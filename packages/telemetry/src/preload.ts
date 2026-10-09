import { LogLevel, TelemetryEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { startTelemetry } from "./start.ts";

/** A Node service's preload (spec §6.3): instrumentations registered before main's imports load. */
export function preload(service: "agent" | "observer"): void {
  startTelemetry({
    service,
    env: parseEnv(TelemetryEnv, process.env),
    crash: "exit",
    log: createLogger({ service, level: LogLevel.catch("info").parse(process.env.LOG_LEVEL) }),
  });
}
