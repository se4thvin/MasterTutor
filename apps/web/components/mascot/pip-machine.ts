import type { RunStatus } from "@mastertutor/contracts";
import { durations } from "@/lib/motion-tokens.ts";
import type { PipState } from "./pip-types.ts";

/**
 * Pip's one state machine: what the person (New task) or the run (run view) is doing becomes a
 * PipState. Framework-free; use-pip-machine.ts binds it to React and the page's input events.
 *
 * The shown state is `moment ?? (dozing ? "dozing" : base)`:
 * - base: the steady state (idle, attentive, thinking, working, or the run's mirror);
 * - moment: a short one-shot over it (waving, celebrating, oops) that ends on its own timer;
 * - dozing: no input for dozeAfterMs (only with `doze`); any input wakes Pip.
 * Every change is debounced: a state shows for at least minDwellMs, so a flapping input shows
 * only where it settled, never a flicker.
 */
export const PIP_TIMING = {
  minDwellMs: durations.panel,
  /** Arrival wave (the 3D design's 1.2 s wave). */
  waveMs: 1_200,
  /** A poke's wave. */
  pokeMs: 1_200,
  /** Typing pause before Pip "thinks" about the goal. */
  thinkAfterMs: 900,
  thinkMs: durations.pulse,
  /** Start's celebration before Pip settles into working (and the floor before navigating). */
  celebrateMs: 600,
  /** A run that completes while watched. */
  runCelebrateMs: durations.flash,
  /** A failed Start. */
  oopsMs: durations.pulse,
  dozeAfterMs: 60_000,
} as const;

export type PipEvent =
  | { type: "arrive" }
  | { type: "type" }
  | { type: "activity" }
  | { type: "start" }
  | { type: "startFailed" }
  | { type: "poke" }
  | { type: "run"; status: RunStatus; capturing: boolean };

export interface PipMachineOptions {
  onChange(state: PipState): void;
  /** Doze after dozeAfterMs without input (New task). */
  doze?: boolean;
}

export interface PipMachine {
  readonly state: PipState;
  send(event: PipEvent): void;
  dispose(): void;
}

const RUN_STATE: Record<RunStatus, PipState> = {
  queued: "idle",
  running: "working",
  waiting: "waiting",
  sleeping: "dozing",
  completed: "idle",
  failed: "oops",
  cancelled: "idle",
};

/** Run status → Pip: needs-you (approval, sign-in, code, takeover) waits; a capture step reads. */
export function runPipState(status: RunStatus, capturing: boolean): PipState {
  return status === "running" && capturing ? "reading" : RUN_STATE[status];
}

type Timer = ReturnType<typeof setTimeout> | undefined;

export function createPipMachine({ onChange, doze = false }: PipMachineOptions): PipMachine {
  let base: PipState = "idle";
  let moment: PipState | null = null;
  let dozing = false;
  /** After Start: Pip works until the page navigates (or the start fails). */
  let started = false;
  let runStatus: RunStatus | null = null;
  let shown: PipState = "idle";
  /** The shown state is inside its minimum dwell: the next change waits for the settle timer. */
  let dwelling = false;
  // A monotonic clock: a wall clock can jump or (in tests) stand still.
  let lastInput = performance.now();
  const timers = {
    moment: undefined as Timer,
    pause: undefined as Timer,
    settle: undefined as Timer,
    doze: undefined as Timer,
  };
  const clear = (name: keyof typeof timers) => {
    clearTimeout(timers[name]);
    timers[name] = undefined;
  };

  const commit = () => {
    const next = moment ?? (dozing ? "dozing" : base);
    if (next === shown || dwelling) return;
    shown = next;
    onChange(next);
    dwelling = true;
    timers.settle = setTimeout(() => {
      timers.settle = undefined;
      dwelling = false;
      commit();
    }, PIP_TIMING.minDwellMs);
  };

  const showMoment = (state: PipState, ms: number) => {
    clear("moment");
    moment = state;
    timers.moment = setTimeout(() => {
      timers.moment = undefined;
      moment = null;
      commit();
    }, ms);
  };
  const endMoment = () => {
    clear("moment");
    moment = null;
  };

  // The doze timer is armed once and re-armed for the remainder, never reset per input event:
  // pointer moves stay a timestamp write.
  const armDoze = (ms: number) => {
    timers.doze = setTimeout(() => {
      timers.doze = undefined;
      if (started) return;
      const idleFor = performance.now() - lastInput;
      if (idleFor < PIP_TIMING.dozeAfterMs) return armDoze(PIP_TIMING.dozeAfterMs - idleFor);
      dozing = true;
      commit();
    }, ms);
  };
  const input = () => {
    lastInput = performance.now();
    dozing = false;
    if (doze && !started && timers.doze === undefined) armDoze(PIP_TIMING.dozeAfterMs);
  };
  if (doze) armDoze(PIP_TIMING.dozeAfterMs);

  const handle = (event: PipEvent) => {
    switch (event.type) {
      case "arrive":
        input();
        showMoment("waving", PIP_TIMING.waveMs);
        return;
      case "activity":
        input();
        return;
      case "type":
        input();
        if (started) return;
        if (moment === "waving") endMoment();
        base = "attentive";
        clear("pause");
        timers.pause = setTimeout(() => {
          base = "thinking";
          commit();
          timers.pause = setTimeout(() => {
            timers.pause = undefined;
            base = "idle";
            commit();
          }, PIP_TIMING.thinkMs);
        }, PIP_TIMING.thinkAfterMs);
        return;
      case "start":
        started = true;
        clear("pause");
        clear("doze");
        dozing = false;
        base = "working";
        showMoment("celebrating", PIP_TIMING.celebrateMs);
        return;
      case "startFailed":
        started = false;
        base = "idle";
        showMoment("oops", PIP_TIMING.oopsMs);
        input();
        return;
      case "poke":
        input();
        if (moment !== "celebrating") showMoment("waving", PIP_TIMING.pokeMs);
        return;
      case "run": {
        const finished =
          event.status === "completed" && runStatus !== null && runStatus !== "completed";
        runStatus = event.status;
        base = runPipState(event.status, event.capturing);
        if (finished) showMoment("celebrating", PIP_TIMING.runCelebrateMs);
        return;
      }
    }
  };

  return {
    get state() {
      return shown;
    },
    send(event) {
      handle(event);
      commit();
    },
    dispose() {
      for (const name of Object.keys(timers) as (keyof typeof timers)[]) clear(name);
    },
  };
}
