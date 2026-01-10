export type InterruptCause = "takeover" | "cancel" | "kill" | "shutdown" | "lease_lost" | "crash";

/** The abort reason for a run's AbortController; tells the worker why the action stopped. */
export class Interrupted extends Error {
  readonly why: InterruptCause;
  constructor(why: InterruptCause) {
    super(`Run interrupted: ${why}`);
    this.name = "Interrupted";
    this.why = why;
  }
}

/** Thrown by the browser guard for any CDP input or model screenshot while the user holds control. */
export class ControlHeld extends Error {
  constructor() {
    super("The user holds control of this browser");
    this.name = "ControlHeld";
  }
}

export class LeaseLost extends Error {
  constructor(runId: string) {
    super(`Lease lost for run ${runId}`);
    this.name = "LeaseLost";
  }
}

/** A guarded run update matched no row although the lease is ours: someone else changed the run. */
export class RunChanged extends Error {
  constructor(runId: string) {
    super(`Run ${runId} changed underneath the agent`);
    this.name = "RunChanged";
  }
}

/** The Responses chain is gone (previous_response_not_found); rebuild it from run_transcript. */
export class ChainLost extends Error {
  constructor() {
    super("previous_response_not_found");
    this.name = "ChainLost";
  }
}

export class ModelUnavailable extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelUnavailable";
    this.code = code;
  }
}

export class StaleRef extends Error {
  constructor(ref: string) {
    super(`Element ref ${ref} is stale; call read_page again`);
    this.name = "StaleRef";
  }
}

export function interruptionOf(error: unknown): InterruptCause | null {
  if (error instanceof Interrupted) return error.why;
  if (error instanceof ControlHeld) return "takeover";
  return null;
}
