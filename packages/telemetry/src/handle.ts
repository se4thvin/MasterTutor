export interface TelemetryHandle {
  readonly enabled: boolean;
  /** Exports what is queued, waiting at most timeoutMs. Never rejects. */
  flush(timeoutMs?: number): Promise<void>;
  /** Flushes and stops, waiting at most timeoutMs. Never rejects. */
  shutdown(timeoutMs?: number): Promise<void>;
}

export const NOOP_HANDLE: TelemetryHandle = {
  enabled: false,
  flush: async () => undefined,
  shutdown: async () => undefined,
};

let current: TelemetryHandle = NOOP_HANDLE;

export function getTelemetry(): TelemetryHandle {
  return current;
}

export function setTelemetry(handle: TelemetryHandle): void {
  current = handle;
}

/** Waits for work, at most `ms`; never rejects. */
export function within(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
    work.then(
      () => (clearTimeout(timer), resolve()),
      () => (clearTimeout(timer), resolve()),
    );
  });
}
