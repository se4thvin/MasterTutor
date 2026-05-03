/** The composer talks to the 3D hero only through these window events; it never imports three. */
const HERO_EVENTS = {
  type: "hero:type",
  focus: "hero:focus",
  start: "hero:start",
  captured: "hero:captured",
} as const;
type HeroEventName = keyof typeof HERO_EVENTS;

/** Start waits for at least this much of the ~2.4s capture before opening the run (P3). */
const HERO_MIN_CAPTURE_MS = 1_200;

export function emitHero(name: "type" | "start"): void;
export function emitHero(name: "focus", focused: boolean): void;
export function emitHero(name: HeroEventName, detail?: boolean): void {
  window.dispatchEvent(new CustomEvent(HERO_EVENTS[name], { detail }));
}

function isHeroLive(): boolean {
  return document.querySelector("[data-hero][data-live]") !== null;
}

/** Resolves after HERO_MIN_CAPTURE_MS when the 3D hero is live; at once otherwise. */
export function heroCaptureFloor(): Promise<void> {
  if (!isHeroLive()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, HERO_MIN_CAPTURE_MS));
}
