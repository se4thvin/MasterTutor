/**
 * The agent's preload (spec §6.3): node --import ./packages/telemetry/src/register-agent.ts
 * apps/agent/src/main.ts. Instrumentations must be registered before the AWS SDK first loads
 * node:http, which happens while main.ts's imports are evaluated.
 */
import { LogLevel, TelemetryEnv, parseEnv } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { startTelemetry } from "./start.ts";

startTelemetry({
  service: "agent",
  env: parseEnv(TelemetryEnv, process.env),
  crash: "exit",
  log: createLogger({
    service: "agent",
    level: LogLevel.catch("info").parse(process.env.LOG_LEVEL),
  }),
});
