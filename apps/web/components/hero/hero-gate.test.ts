import { describe, expect, it } from "vitest";
import { shouldLoad3D, type HeroEnvironment } from "./hero-gate.ts";

const ok: HeroEnvironment = {
  reducedMotion: false,
  hasWebGL2: true,
  forcePoster: false,
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

  it("respects Save-Data and low-memory devices (P2)", () => {
    expect(shouldLoad3D({ ...ok, saveData: true })).toBe(false);
    expect(shouldLoad3D({ ...ok, lowMemory: true })).toBe(false);
  });
});
