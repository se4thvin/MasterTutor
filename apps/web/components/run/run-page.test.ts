import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("../../app/(app)/runs/[runId]/page.tsx", import.meta.url),
  "utf8",
);

describe("the run page (M6)", () => {
  it("keys the run view by run id, so another run never resumes from this one's stream position", () => {
    expect(page).toMatch(/<RunView\s+key=\{runId\}/);
  });
});
