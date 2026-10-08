import type { DropReason } from "@mastertutor/contracts/telemetry";

export interface BatcherOptions<T> {
  maxQueue: number;
  maxBatch: number;
  intervalMs: number;
  send(batch: T[]): Promise<void>;
  onDrop(count: number, reason: DropReason): void;
}

/**
 * A bounded, non-blocking batch queue (spec §7.1): add() never waits and never throws, a full
 * queue drops and counts, one export runs at a time, and a failed export counts its batch.
 */
export class BoundedBatcher<T> {
  readonly #options: BatcherOptions<T>;
  readonly #timer: NodeJS.Timeout;
  #queue: T[] = [];
  #inFlight: Promise<void> | null = null;
  #closed = false;

  constructor(options: BatcherOptions<T>) {
    this.#options = options;
    this.#timer = setInterval(() => void this.flush(), options.intervalMs);
    this.#timer.unref();
  }

  get size(): number {
    return this.#queue.length;
  }

  add(item: T): void {
    if (this.#closed || this.#queue.length >= this.#options.maxQueue) {
      this.#drop(1, "queue_full");
      return;
    }
    this.#queue.push(item);
    if (this.#queue.length >= this.#options.maxBatch) void this.flush();
  }

  /** Exports everything queued now, one batch at a time. Never rejects. */
  flush(): Promise<void> {
    this.#inFlight ??= this.#drain().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#timer);
    await this.flush();
  }

  async #drain(): Promise<void> {
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, this.#options.maxBatch);
      try {
        await this.#options.send(batch);
      } catch {
        this.#drop(batch.length, "export_failed");
      }
    }
  }

  #drop(count: number, reason: DropReason): void {
    try {
      this.#options.onDrop(count, reason);
    } catch {
      // Counting a drop must never throw into the product.
    }
  }
}
