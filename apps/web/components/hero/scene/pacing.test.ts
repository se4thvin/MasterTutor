import { describe, expect, it } from "vitest";
import { IDLE_AFTER_MS, shouldRender } from "./pacing.ts";

describe("hero frame pacing (final I3)", () => {
  it("renders every frame while anything moves or was touched lately", () => {
    expect(shouldRender(1_000, 900, 984)).toBe(true);
  });

  it("drops to about 30 fps once idle", () => {
    const idleSince = 0;
    const now = IDLE_AFTER_MS + 1_000;
    expect(shouldRender(now, idleSince, now - 16.7)).toBe(false);
    expect(shouldRender(now, idleSince, now - 33.4)).toBe(true);
  });
});
