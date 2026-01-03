import pino, { type DestinationStream, type Logger } from "pino";
import { CREDENTIAL_FIELDS, VAULT_SECRET_FIELDS } from "../enums.ts";
import type { LogLevel } from "../env.ts";

/** Keys whose values are secret wherever they appear, derived from the credential contracts. */
const SECRET_KEYS = [
  ...new Set<string>([
    ...CREDENTIAL_FIELDS,
    ...VAULT_SECRET_FIELDS,
    "secret",
    "sealed",
    "code",
    "token",
    "cookie",
    "set-cookie",
    "authorization",
  ]),
];

/** pino needs bracket notation for keys that are not valid identifiers (e.g. set-cookie). */
const accessor = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `["${key}"]`);

/** Spec §9: redact secrets at the top level or one level down, plus request/response headers. */
export const REDACT_PATHS: readonly string[] = [
  ...SECRET_KEYS.flatMap((key) => [accessor(key).replace(/^\./, ""), `*${accessor(key)}`]),
  ...["authorization", "cookie", "set-cookie"].flatMap((key) => [
    `req.headers${accessor(key)}`,
    `res.headers${accessor(key)}`,
  ]),
];

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
