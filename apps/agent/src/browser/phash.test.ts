import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERCEPTUAL_SAME, perceptualDistance, perceptualHash, UNCOMPARABLE_HASH } from "./phash.ts";

const DIR = join(import.meta.dirname, "../../../../tests/fixtures/phash");

/** Every frame of a set, keyed by its slide (`<set>-s<slide>-<seconds>.png`). */
async function frames(set: string) {
  const names = readdirSync(DIR).filter((name) => name.startsWith(`${set}-`));
  return Promise.all(
    names.map(async (name) => ({
      name,
      slide: /-s(\d+)-/.exec(name)![1],
      hash: await perceptualHash(new Uint8Array(readFileSync(join(DIR, name)))),
    })),
  );
}

describe("perceptualHash on flat, low-texture frames (B4 review I6)", () => {
  it.each(["lecture", "stripes"])(
    "%s: frames of one slide are the same, frames of different slides are not",
    async (set) => {
      const all = await frames(set);
      expect(all.length).toBeGreaterThan(3);
      for (const a of all)
        for (const b of all) {
          if (a === b) continue;
          const distance = perceptualDistance(a.hash, b.hash);
          if (a.slide === b.slide)
            expect(distance, `${a.name} ~ ${b.name}`).toBeLessThanOrEqual(PERCEPTUAL_SAME);
          // A margin both ways: codec noise never reaches the threshold, a new slide clears it twice.
          else expect(distance, `${a.name} vs ${b.name}`).toBeGreaterThan(2 * PERCEPTUAL_SAME);
        }
    },
  );

  it("never calls an uncomparable frame the same as anything", async () => {
    const [frame] = await frames("lecture");
    expect(perceptualDistance(UNCOMPARABLE_HASH, frame!.hash)).toBe(Number.POSITIVE_INFINITY);
    expect(perceptualDistance(UNCOMPARABLE_HASH, UNCOMPARABLE_HASH)).toBe(Number.POSITIVE_INFINITY);
  });
});
