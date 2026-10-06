/**
 * The single source of motion values (spec §11.4, D21, D28). CSS reads the generated
 * styles/motion.css; components pass `transitions.*` to motion. Lint forbids raw values elsewhere.
 */
export const springs = {
  /** Stiffness 400, damping 30: settles in about 455ms. Buttons, knobs, cards, toasts. */
  spring: { type: "spring", stiffness: 400, damping: 30, mass: 1 },
  /** Softer spring for sheets and the PiP. */
  springSoft: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
} as const;

/** Milliseconds. */
export const durations = {
  /** Press feedback (D21) must land in under 100ms. */
  press: 90,
  micro: 120,
  base: 200,
  panel: 300,
  stagger: 35,
  shimmer: 1300,
  pulse: 1600,
  toast: 5000,
  /** A folder takes in a dropped or moved item: the lid gulps, the sheet then closes. */
  receive: 450,
  /** How long a finished run's outcome shows on the Runs nav item. */
  flash: 2400,
  /** Agent cursor travel: 250–450ms by distance, on easings.cursor (run 13 §6). */
  cursorMin: 250,
  cursorMax: 450,
  /** Click ring 24→44px. */
  clickPulse: 400,
  /** The idle cursor's drift loop while the agent thinks. */
  drift: 2600,
  /** One turn of the Reconnecting spinner (the only spinner, spec §11.4). */
  spin: 1000,
} as const;

export const easings = {
  out: [0.16, 1, 0.3, 1],
  in: [0.4, 0, 1, 1],
  cursor: [0.2, 0.8, 0.2, 1],
} as const;

export const press = { scale: 0.96, iconScale: 0.92, rowScale: 0.98 } as const;

const seconds = (ms: number) => ms / 1000;

export const transitions = {
  micro: { duration: seconds(durations.micro), ease: easings.out },
  base: { duration: seconds(durations.base), ease: easings.out },
  panel: { duration: seconds(durations.panel), ease: easings.out },
  exit: { duration: seconds(durations.base), ease: easings.in },
  spring: springs.spring,
  springSoft: springs.springSoft,
} as const;

/** Toast countdown bar (WAAPI); it must burn at a constant rate. */
export const fuse = { easing: "linear" } as const;
