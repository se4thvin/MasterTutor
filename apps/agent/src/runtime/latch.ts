/** A resettable wake-up flag: open() wakes the current or the next wait(). */
export class Latch {
  #open = false;
  #waiters: Array<() => void> = [];

  open(): void {
    const waiters = this.#waiters.splice(0);
    if (waiters.length === 0) {
      this.#open = true;
      return;
    }
    for (const wake of waiters) wake();
  }

  wait(): Promise<void> {
    if (this.#open) {
      this.#open = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#waiters.push(resolve));
  }
}
