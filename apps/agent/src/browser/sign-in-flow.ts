/** Agent actions after the last credential fill that still belong to its sign-in (D51). */
export const SIGN_IN_FLOW_ACTS = 3;
/** And never longer than this after the last fill. */
export const SIGN_IN_FLOW_MS = 120_000;

/**
 * A sign-in the person approved (credential_first_use, then a vault fill) may redirect through an
 * identity provider on another site without asking (D51). The window opens at each successful
 * fill and closes after SIGN_IN_FLOW_ACTS further actions (the submit, and a couple of steps on
 * the provider's pages) or SIGN_IN_FLOW_MS, whichever comes first. Nothing it lets through is
 * added to the run's allowed origins.
 */
export class SignInFlow {
  readonly #now: () => number;
  #actsLeft = 0;
  #until = 0;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** A credential fill succeeded. */
  open(): void {
    this.#actsLeft = SIGN_IN_FLOW_ACTS;
    this.#until = this.#now() + SIGN_IN_FLOW_MS;
  }

  /** The agent starts another action that is not a credential fill. */
  acted(): void {
    if (this.#actsLeft > 0) this.#actsLeft -= 1;
  }

  get isOpen(): boolean {
    return this.#actsLeft > 0 && this.#now() < this.#until;
  }
}
