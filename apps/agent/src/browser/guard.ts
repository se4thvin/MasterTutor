import { ControlHeld, Interrupted } from "../runtime/errors.ts";

/**
 * The code-owned control lock (spec §10.3). CDP input bypasses X, so n.eko cannot stop the agent:
 * every CDP input primitive and every model screenshot calls assertAgent first. It also refuses
 * once the worker's local lease deadline has passed, so a worker cut off from the database (a
 * partition, a paused process) cannot act while another agent may already own the run.
 */
export class ControlGuard {
  #held = false;
  /** Local lease deadline (performance.now() ms): no input or screenshot after it. */
  #notAfter = Number.POSITIVE_INFINITY;

  get held(): boolean {
    return this.#held;
  }

  /** True once the worker's local lease deadline has passed (another agent may own the run). */
  get expired(): boolean {
    return performance.now() > this.#notAfter;
  }

  hold(): void {
    this.#held = true;
  }

  release(): void {
    this.#held = false;
  }

  /** Sets the local lease deadline; the worker moves it forward after every successful renewal. */
  fence(notAfter: number): void {
    this.#notAfter = notAfter;
  }

  assertAgent(signal?: AbortSignal): void {
    if (this.#held) throw new ControlHeld();
    if (this.expired) throw new Interrupted("lease_lost");
    signal?.throwIfAborted();
  }
}
