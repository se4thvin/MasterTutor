/**
 * Live 3D or the per-state poster (D49): a software rasteriser (SwiftShader, llvmpipe) would
 * starve the page, so it gets the poster, like no WebGL2, reduced motion, Save-Data and a
 * low-memory device. `?pip=live` forces the live scene for its own tests; `?pip=poster` the poster.
 */
type WebGLTier = "hardware" | "software" | "none";

export interface PipEnvironment {
  reducedMotion: boolean;
  forced: "live" | "poster" | null;
  saveData: boolean;
  lowMemory: boolean;
  webgl: WebGLTier;
}

export function pipMode(env: PipEnvironment): "live" | "poster" {
  if (env.forced === "poster" || env.reducedMotion || env.webgl === "none") return "poster";
  if (env.forced === "live") return "live";
  return env.webgl === "hardware" && !env.saveData && !env.lowMemory ? "live" : "poster";
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function classifyRenderer(renderer: string): "hardware" | "software" {
  return SOFTWARE.test(renderer) ? "software" : "hardware";
}

/** The context attributes shared by the probe and the stage's renderer. */
export const PIP_CONTEXT: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  premultipliedAlpha: true,
  powerPreference: "default",
};

let probed: WebGLTier | undefined;

/** One throwaway context per page: is WebGL2 there, and is it a real GPU? */
function probeWebGL(): WebGLTier {
  if (probed) return probed;
  const canvas = document.createElement("canvas");
  const strict = canvas.getContext("webgl2", {
    ...PIP_CONTEXT,
    failIfMajorPerformanceCaveat: true,
  });
  const gl = strict ?? document.createElement("canvas").getContext("webgl2", PIP_CONTEXT);
  if (!gl) return (probed = "none");
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
  probed = strict ? classifyRenderer(renderer) : "software";
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return probed;
}

type HintedNavigator = Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };

/** Everything but the WebGL probe, which is costly and only made when nothing else says poster. */
export function readEnvironment(search: string, reducedMotion: boolean): PipEnvironment {
  const nav = navigator as HintedNavigator;
  const param = new URLSearchParams(search).get("pip");
  const env: PipEnvironment = {
    reducedMotion,
    forced: param === "live" || param === "poster" ? param : null,
    saveData: nav.connection?.saveData === true,
    lowMemory: nav.deviceMemory !== undefined && nav.deviceMemory < 4,
    webgl: "hardware",
  };
  return pipMode(env) === "live" ? { ...env, webgl: probeWebGL() } : env;
}
