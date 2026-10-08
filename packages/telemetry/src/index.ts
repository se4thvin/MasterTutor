export { BoundedBatcher } from "./batcher.ts";
export { AllowlistSpanExporter } from "./allowlist.ts";
export { DEFAULT_LIMITS, type QueueLimits } from "./processors.ts";
export type { Log } from "./self.ts";
export { startTelemetry, type StartOptions } from "./start.ts";
export { getTelemetry, type TelemetryHandle } from "./handle.ts";
export { installCrashHandlers, type CrashMode } from "./crash.ts";
