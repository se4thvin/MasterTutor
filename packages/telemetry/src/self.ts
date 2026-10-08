import type { createLogger } from "@mastertutor/contracts/server";
import { ATTR, type DropReason, type TelemetrySignal } from "@mastertutor/contracts/telemetry";
import { instruments } from "./instruments.ts";

export type Log = ReturnType<typeof createLogger>;
const WARN_EVERY_MS = 60_000;
let log: Log | null = null;
let lastWarn = Number.NEGATIVE_INFINITY;

export function setTelemetryLog(next: Log | null): void {
  log = next;
}

/** Counts dropped telemetry and says so on stdout at most once a minute (module telemetry, unbridged). */
export function countDropped(signal: TelemetrySignal, reason: DropReason, count: number): void {
  if (count <= 0) return;
  try {
    instruments().telemetryDropped.add(count, {
      [ATTR.telemetrySignal]: signal,
      [ATTR.dropReason]: reason,
    });
    const now = Date.now();
    if (log && reason !== "not_allowed" && now - lastWarn >= WARN_EVERY_MS) {
      lastWarn = now;
      log.warn(
        { module: "telemetry", errorCode: "telemetry_dropped", signal, reason, count },
        "telemetry dropped",
      );
    }
  } catch {
    // Never throws into the product.
  }
}
