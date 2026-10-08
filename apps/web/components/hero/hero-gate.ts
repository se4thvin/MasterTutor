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
  /** WebGL drawn on the CPU (SwiftShader, llvmpipe: no GPU), where the scene starves the page (D49). */
  softwareGL: boolean;
  /** `?hero=poster` (QA switch from run 16). */
  forcePoster: boolean;
  /** `?hero=live`: the live hero even on software WebGL (hero.spec on the GPU-less CI host, D49). */
  forceLive: boolean;
  /** navigator.connection.saveData (P2). */
  saveData: boolean;
  /** navigator.deviceMemory below 4 GB (P2). */
  lowMemory: boolean;
}

/**
 * Under reduced motion, without WebGL2, on software WebGL (unless `?hero=live`), on Save-Data or
 * a low-memory device, three is never downloaded.
 */
export function shouldLoad3D(env: HeroEnvironment): boolean {
  return (
    env.hasWebGL2 &&
    (!env.softwareGL || env.forceLive) &&
    !env.reducedMotion &&
    !env.forcePoster &&
    !env.saveData &&
    !env.lowMemory
  );
}

/** WebGL renderer names of CPU rasterizers: Chromium's SwiftShader, Mesa's llvmpipe and softpipe. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software rasterizer/i;

/**
 * Whether a WebGL context draws on the CPU, by its unmasked renderer name
 * (WEBGL_debug_renderer_info). Without that extension nothing is known, and only context creation
 * decides (a GPU-less browser that cannot make a context keeps the poster anyway).
 */
export function isSoftwareGL(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  if (!info) return false;
  return SOFTWARE_RENDERER.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? ""));
}
