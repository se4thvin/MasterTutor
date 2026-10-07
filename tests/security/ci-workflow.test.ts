import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const lines = workflow.split("\n");

describe("CI workflow", () => {
  it("pins every action by full commit SHA, with its tag as a comment (D60)", () => {
    const uses = lines.filter((line) => /^\s*(- )?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses)
      expect(line.trim()).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/);
  });

  it("never leaves the token in a checkout (persist-credentials: false)", () => {
    lines.forEach((line, i) => {
      if (!/uses: actions\/checkout@/.test(line)) return;
      expect(lines[i + 1]?.trim(), `line ${i + 2}`).toBe("with:");
      expect(lines[i + 2]?.trim(), `line ${i + 3}`).toBe("persist-credentials: false");
    });
  });

  it("runs the security project and the dependency audit, and has no e2e job (D46)", () => {
    expect(workflow).toContain("run: pnpm test:security");
    expect(workflow).toContain("run: pnpm audit --prod --audit-level high");
    expect(workflow).not.toMatch(/^ {2}e2e:/m);
    expect(workflow).not.toContain("scripts/e2e.sh");
  });
});
