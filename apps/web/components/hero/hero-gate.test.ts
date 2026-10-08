import { describe, expect, it } from "vitest";
import { isSoftwareGL, shouldLoad3D, type HeroEnvironment } from "./hero-gate.ts";

const ok: HeroEnvironment = {
  reducedMotion: false,
  hasWebGL2: true,
  softwareGL: false,
  forcePoster: false,
  forceLive: false,
  saveData: false,
  lowMemory: false,
};

describe("shouldLoad3D", () => {
  it("loads only with WebGL2, motion allowed and no poster override", () => {
    expect(shouldLoad3D(ok)).toBe(true);
    expect(shouldLoad3D({ ...ok, reducedMotion: true })).toBe(false);
    expect(shouldLoad3D({ ...ok, hasWebGL2: false })).toBe(false);
    expect(shouldLoad3D({ ...ok, forcePoster: true })).toBe(false);
  });

  it("keeps the poster on software WebGL unless ?hero=live asks for the live hero (D49)", () => {
    expect(shouldLoad3D({ ...ok, softwareGL: true })).toBe(false);
    expect(shouldLoad3D({ ...ok, softwareGL: true, forceLive: true })).toBe(true);
    // ?hero=live overrides only the renderer: every other reason still keeps the poster.
    for (const reason of ["reducedMotion", "forcePoster", "saveData", "lowMemory"] as const)
      expect(shouldLoad3D({ ...ok, softwareGL: true, forceLive: true, [reason]: true })).toBe(
        false,
      );
    expect(shouldLoad3D({ ...ok, hasWebGL2: false, forceLive: true })).toBe(false);
  });

  it("respects Save-Data and low-memory devices (P2)", () => {
    expect(shouldLoad3D({ ...ok, saveData: true })).toBe(false);
    expect(shouldLoad3D({ ...ok, lowMemory: true })).toBe(false);
  });
});

describe("isSoftwareGL (D49)", () => {
  const UNMASKED = 0x9246;
  const gl = (renderer: string | null) =>
    ({
      getExtension: (name: string) =>
        renderer !== null && name === "WEBGL_debug_renderer_info"
          ? { UNMASKED_RENDERER_WEBGL: UNMASKED }
          : null,
      getParameter: (p: number) => (p === UNMASKED ? renderer : null),
    }) as unknown as WebGL2RenderingContext;

  it("names CPU rasterizers by their unmasked renderer", () => {
    for (const name of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "Mesa softpipe",
    ])
      expect(isSoftwareGL(gl(name)), name).toBe(true);
  });

  it("does not take a GPU for software, and decides nothing without the extension", () => {
    for (const name of [
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)",
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Mesa Intel(R) UHD Graphics 620 (KBL GT2)",
    ])
      expect(isSoftwareGL(gl(name)), name).toBe(false);
    expect(isSoftwareGL(gl(null))).toBe(false);
  });
});
