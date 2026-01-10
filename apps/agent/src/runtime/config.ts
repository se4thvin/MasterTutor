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
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  heartbeatMs: 10_000,
  leaseMs: 30_000,
  sweepMs: 30_000,
  idleSleepMs: 60_000,
  slotPollMs: 500,
  slotRestartTimeoutMs: 90_000,
  compactionInputTokens: 200_000,
  fallbackAfter5xx: 3,
  waitActionMs: 1_000,
  downloadsDir: "/downloads",
};

export function runtimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return { ...DEFAULT_RUNTIME_CONFIG, ...overrides };
}
