import pino, { type DestinationStream, type Logger } from "pino";
import type { LogLevel } from "../env.ts";

/** Spec §9: redact secrets wherever they appear at the top level or one level down. */
export const REDACT_PATHS = [
  "password",
  "secret",
  "sealed",
  "code",
  "authorization",
  "*.password",
  "*.secret",
  "*.sealed",
  "*.code",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
] as const;

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  const config = {
    level: options.level ?? "info",
    base: { service: options.service },
    redact: { paths: [...REDACT_PATHS], censor: "[redacted]" },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
