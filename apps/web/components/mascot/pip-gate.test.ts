import { describe, expect, it } from "vitest";
import { classifyRenderer, pipMode, type PipEnvironment } from "./pip-gate.ts";

const ok: PipEnvironment = {
  reducedMotion: false,
  forced: null,
  saveData: false,
  lowMemory: false,
  webgl: "hardware",
};

describe("pipMode (D49)", () => {
  it("goes live only on hardware WebGL2 with motion allowed", () => {
    expect(pipMode(ok)).toBe("live");
    expect(pipMode({ ...ok, webgl: "software" })).toBe("poster");
    expect(pipMode({ ...ok, webgl: "none" })).toBe("poster");
    expect(pipMode({ ...ok, reducedMotion: true })).toBe("poster");
    expect(pipMode({ ...ok, saveData: true })).toBe("poster");
    expect(pipMode({ ...ok, lowMemory: true })).toBe("poster");
  });

  it("?pip=poster always wins; ?pip=live forces software GL live, never a missing context", () => {
    expect(pipMode({ ...ok, forced: "poster" })).toBe("poster");
    expect(pipMode({ ...ok, webgl: "software", forced: "live" })).toBe("live");
    expect(pipMode({ ...ok, webgl: "none", forced: "live" })).toBe("poster");
    expect(pipMode({ ...ok, reducedMotion: true, forced: "live" })).toBe("poster");
  });
});

describe("classifyRenderer", () => {
  it.each([
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", "software"],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", "software"],
    ["Microsoft Basic Render Driver", "software"],
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)", "hardware"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)", "hardware"],
    ["WebKit WebGL", "hardware"],
  ] as const)("%s → %s", (renderer, expected) => {
    expect(classifyRenderer(renderer)).toBe(expected);
  });
});
