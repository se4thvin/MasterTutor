/**
 * The one set of context attributes: the probe before the download and the renderer must ask for
 * the same, since a canvas keeps its first context. "default", not "high-performance": a
 * decorative hero never wakes a discrete GPU (final I3).
 */
export const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: true,
  powerPreference: "default",
};

export interface HeroEnvironment {
  reducedMotion: boolean;
  hasWebGL2: boolean;
  /** `?hero=poster` (QA switch from run 16). */
  forcePoster: boolean;
  /** navigator.connection.saveData (P2). */
  saveData: boolean;
  /** navigator.deviceMemory below 4 GB (P2). */
  lowMemory: boolean;
}

/** Under reduced motion, without WebGL2, on Save-Data or a low-memory device, three is never downloaded. */
export function shouldLoad3D(env: HeroEnvironment): boolean {
  return env.hasWebGL2 && !env.reducedMotion && !env.forcePoster && !env.saveData && !env.lowMemory;
}
