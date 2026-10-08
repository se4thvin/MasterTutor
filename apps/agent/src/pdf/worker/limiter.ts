/** No room left: every slot is busy and the queue is full. */
export class LimiterFull extends Error {
  constructor() {
    super("pdf worker busy");
    this.name = "LimiterFull";
  }
}

export interface Limiter {
  /** Waits for a slot (in arrival order); the returned function frees it. Aborting leaves the queue. */
  acquire(signal: AbortSignal): Promise<() => void>;
  readonly active: number;
}

/** At most `concurrency` holders at once and at most `queue` waiting (B5 review I-2). */
export function createLimiter(concurrency: number, queue: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  const hold = () => {
    active++;
    let freed = false;
    return () => {
      if (freed) return;
      freed = true;
      release();
    };
  };
  return {
    get active() {
      return active;
    },
    async acquire(signal) {
      signal.throwIfAborted();
      if (active < concurrency) return hold();
      if (waiting.length >= queue) throw new LimiterFull();
      return new Promise((resolve, reject) => {
        const turn = () => {
          signal.removeEventListener("abort", leave);
          resolve(hold());
        };
        const leave = () => {
          const at = waiting.indexOf(turn);
          if (at >= 0) waiting.splice(at, 1);
          reject(signal.reason);
        };
        waiting.push(turn);
        signal.addEventListener("abort", leave, { once: true });
      });
    },
  };
}
