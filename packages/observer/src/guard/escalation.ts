import { GUARD_ESCALATION } from "@mastertutor/contracts";

export interface LedgerState {
  consecutive: number;
  total: number;
}

/**
 * Deny-and-continue has a budget (GD §2.4, Claude Code's thresholds): after 3 turns in a row with
 * a block, or 20 blocked items in all, a person decides (spec §6.7). Persisted in guard_reviews.
 */
export class DenialLedger {
  #state: LedgerState;

  constructor(state: LedgerState = { consecutive: 0, total: 0 }) {
    this.#state = { ...state };
  }

  get state(): LedgerState {
    return { ...this.#state };
  }

  /** One reviewed turn: how many of its items the Guard blocked (applied, enforce). */
  recordTurn(blockedItems: number): void {
    this.#state =
      blockedItems > 0
        ? { consecutive: this.#state.consecutive + 1, total: this.#state.total + blockedItems }
        : { ...this.#state, consecutive: 0 };
  }

  reachedLimit(): boolean {
    return (
      this.#state.consecutive >= GUARD_ESCALATION.consecutive ||
      this.#state.total >= GUARD_ESCALATION.total
    );
  }

  /** A person approved the denial_limit hold: the budget starts again. */
  personCleared(): void {
    this.#state = { consecutive: 0, total: 0 };
  }
}
