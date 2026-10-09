/** No computer-use latency distribution is checked in; live decides normally take 3–5 s. */
export const DECIDE_TIMEOUT_MS = 45_000;
export const DECIDE_SLOW_MS = 15_000;

/** Agent runtime timings and thresholds (spec §5). Tests shorten them; production uses the defaults. */
export interface RuntimeConfig {
  heartbeatMs: number;
  leaseMs: number;
  sweepMs: number;
  idleSleepMs: number;
  slotPollMs: number;
  slotRestartTimeoutMs: number;
  compactionInputTokens: number;
  fallbackAfter5xx: number;
  waitActionMs: number;
  /** Shared downloads volume mount (Phase 0 compose: `downloads:/downloads`). Tests point it at a temp dir. */
  downloadsDir: string;
  /** How long a graceful stop waits for slot restarts in flight (boot reconcile recovers the rest). */
  shutdownDrainMs: number;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  heartbeatMs: 10_000,
  leaseMs: 30_000,
  sweepMs: 30_000,
  idleSleepMs: 60_000,
  slotPollMs: 500,
  slotRestartTimeoutMs: 90_000,
  compactionInputTokens: 64_000,
  fallbackAfter5xx: 3,
  waitActionMs: 1_000,
  downloadsDir: "/downloads",
  shutdownDrainMs: 5_000,
};

export function runtimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return { ...DEFAULT_RUNTIME_CONFIG, ...overrides };
}
