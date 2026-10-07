import { describe, expect, it, vi } from "vitest";
import { createHero } from "./hero-3d-scene.ts";

describe("createHero", () => {
  it("returns null, keeping the poster, when no WebGL2 context can be created (P2)", async () => {
    const canvas = { getContext: () => null };
    const el = { querySelector: () => canvas } as unknown as HTMLElement;
    await expect(createHero(el)).resolves.toBeNull();
  });

  it("returns null without a canvas", async () => {
    const el = { querySelector: () => null } as unknown as HTMLElement;
    await expect(createHero(el)).resolves.toBeNull();
  });

  it("asks for the default GPU, never forcing the discrete one (final I3)", async () => {
    const getContext = vi.fn(() => null);
    const el = { querySelector: () => ({ getContext }) } as unknown as HTMLElement;
    await createHero(el);
    expect(getContext).toHaveBeenCalledWith(
      "webgl2",
      expect.objectContaining({ powerPreference: "default" }),
    );
  });
});
