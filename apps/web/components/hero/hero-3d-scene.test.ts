import { describe, expect, it } from "vitest";
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
});
