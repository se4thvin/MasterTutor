import type { PipPoint } from "../pip-types.ts";

/** Radians. Beyond these Pip would show the seam of its face pad (3d-readiness §2). */
export const LOOK_LIMITS = { yaw: (25 * Math.PI) / 180, pitch: (12 * Math.PI) / 180 } as const;

export interface Look {
  /** Positive turns the face toward the viewer's right. */
  yaw: number;
  /** Positive looks up. */
  pitch: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The eye line as a fraction of the frame's height (both framings put the eyes here). */
const EYE_LINE = 0.42;
/** Pixels over which a turn saturates: at least this much, so a 48 px Pip glances, not spins. */
const MIN_RANGE_PX = 260;

/** Head turn toward a viewport point; tanh keeps it smooth and inside the limits. */
export function lookToward(target: PipPoint, rect: Rect): Look {
  const range = Math.max(MIN_RANGE_PX, rect.width * 1.4);
  const dx = target.x - (rect.left + rect.width / 2);
  const dy = rect.top + rect.height * EYE_LINE - target.y;
  return {
    yaw: LOOK_LIMITS.yaw * Math.tanh(dx / range),
    pitch: LOOK_LIMITS.pitch * Math.tanh(dy / range),
  };
}
