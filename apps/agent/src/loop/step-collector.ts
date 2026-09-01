import { EMPTY_USAGE, type RunEvent, type Usage } from "@mastertutor/contracts";
import type { DbTx } from "@mastertutor/db";
import { addUsage } from "../llm/pricing.ts";
import type { Log } from "../runtime/types.ts";
import type { StepWriter } from "../tools/types.ts";

/** One act's (or the completion's) staged writes, committed by the loop in the step transaction. */
export class StepCollector implements StepWriter {
  #writes: Array<(tx: DbTx) => Promise<void>> = [];
  #events: RunEvent[] = [];
  #after: Array<() => Promise<void>> = [];
  #objects: string[] = [];
  #usage: Usage = EMPTY_USAGE;
  readonly #usdAtStart: number;

  /** `usdLeft`: what the run's budget allowed when the step began (unbounded by default). */
  constructor(options: { usdLeft?: number } = {}) {
    this.#usdAtStart = options.usdLeft ?? Number.POSITIVE_INFINITY;
  }

  defer(write: (tx: DbTx) => Promise<void>): void {
    this.#writes.push(write);
  }

  emit(event: RunEvent): void {
    this.#events.push(event);
  }

  afterCommit(task: () => Promise<void>): void {
    this.#after.push(task);
  }

  ownObject(key: string): void {
    this.#objects.push(key);
  }

  addUsage(delta: Usage): void {
    this.#usage = addUsage(this.#usage, delta);
  }

  usdLeft(): number {
    return this.#usdAtStart - this.#usage.usd;
  }

  get usage(): Usage {
    return this.#usage;
  }

  get events(): readonly RunEvent[] {
    return this.#events;
  }

  /** The StepCommit fields for this step: writes in call order, then the events. */
  commitParts(): {
    extra?: (tx: DbTx) => Promise<void>;
    events: RunEvent[];
    ownedObjects: string[];
  } {
    const writes = [...this.#writes];
    return {
      ...(writes.length > 0
        ? {
            extra: async (tx: DbTx) => {
              for (const write of writes) await write(tx);
            },
          }
        : {}),
      events: [...this.#events],
      ownedObjects: [...this.#objects],
    };
  }

  /** Drops everything staged and returns the uploaded keys to delete. Spend already happened, so usage stays. */
  reset(): string[] {
    const objects = this.#objects;
    this.#writes = [];
    this.#events = [];
    this.#after = [];
    this.#objects = [];
    return objects;
  }

  /** Best effort: a failing task is logged by name, never thrown into the loop. */
  async afterCommitted(log: Log): Promise<void> {
    for (const task of this.#after) {
      try {
        await task();
      } catch (error) {
        log.warn({ errName: (error as Error).name }, "after-commit task failed");
      }
    }
    this.#after = [];
  }
}
