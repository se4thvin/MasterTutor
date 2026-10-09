import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PIP_STATES } from "./pip-types.ts";
import { PIP_POSTERS } from "./posters.ts";

describe("Pip posters (D49)", () => {
  it("has a rendered poster for every state at both sizes", () => {
    for (const state of PIP_STATES) {
      for (const size of ["hero", "compact"] as const) {
        const url = PIP_POSTERS[state][size];
        expect(url).toContain(`pip-${state}-${size}.webp`);
        expect(existsSync(fileURLToPath(url)), url).toBe(true);
      }
    }
  });
});
