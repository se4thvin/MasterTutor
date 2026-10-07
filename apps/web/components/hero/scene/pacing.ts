/** After this long with nothing moving and no input, only the slow idle bob remains. */
export const IDLE_AFTER_MS = 3_000;
/** The idle bob at about 30 fps; the small slack keeps a 60 Hz display on every other frame. */
const IDLE_FRAME_MS = 1_000 / 30 - 1;

/**
 * Whether this animation frame draws (final I3): every frame while anything moves or was touched
 * lately, about 30 fps once idle. `lastActive` and `lastFrame` are performance.now() values.
 */
export function shouldRender(now: number, lastActive: number, lastFrame: number): boolean {
  return now - lastActive < IDLE_AFTER_MS || now - lastFrame >= IDLE_FRAME_MS;
}
