/**
 * The single source of motion values (spec §11.4, D21, D28). CSS reads the generated
 * styles/motion.css; components pass `transitions.*` to motion. Lint forbids raw values elsewhere.
 */
export const springs = {
  /** Stiffness 400, damping 30: settles in about 455ms. Buttons, knobs, cards, toasts. */
  spring: { type: "spring", stiffness: 400, damping: 30, mass: 1 },
  /** Softer spring for sheets and the PiP. */
  springSoft: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
  /** 3D hero (run 16): calm pointer parallax. */
  heroParallax: { type: "spring", stiffness: 60, damping: 13, mass: 1 },
  /** 3D hero: the lens leans toward the focused composer. */
  heroAttention: { type: "spring", stiffness: 170, damping: 22, mass: 1 },
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
  /** Poster → 3D crossfade (run 16). */
  heroReveal: 700,
  /** A running action card's progress wipe (CallChip): it holds at 90% until the step is done. */
  callWipe: 2400,
  /** A cancelled action card's shake (CallChip), on transform only. */
  shake: 450,
} as const;

export const easings = {
  out: [0.16, 1, 0.3, 1],
  in: [0.4, 0, 1, 1],
  cursor: [0.2, 0.8, 0.2, 1],
  standard: [0.4, 0, 0.2, 1],
} as const;

export const press = { scale: 0.96, iconScale: 0.92, rowScale: 0.98 } as const;

/**
 * MarqueeText: a truncated label glides to its end and back on hover or keyboard focus. It moves
 * at a reading pace, so the time follows the distance (clamped), and rests at each end.
 */
export const marquee = {
  pxPerSecond: 45,
  minTravelMs: 600,
  maxTravelMs: 6000,
  /** Rest before it sets off, and again at the end, so the eye can catch up. */
  holdMs: 700,
  /** Back to the start on the way out (pointer left, focus moved): quick, not a snap. */
  settleMs: durations.base,
  easing: easings.standard,
} as const;

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
