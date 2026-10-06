import { ControlHeld } from "../runtime/errors.ts";

/**
 * The code-owned control lock (spec §10.3). CDP input bypasses X, so n.eko cannot stop the agent:
 * every CDP input primitive and every model screenshot calls assertAgent first.
 */
export class ControlGuard {
  #held = false;

  get held(): boolean {
    return this.#held;
  }

  hold(): void {
    this.#held = true;
  }

  release(): void {
    this.#held = false;
  }

  assertAgent(signal?: AbortSignal): void {
    if (this.#held) throw new ControlHeld();
    signal?.throwIfAborted();
  }
}
