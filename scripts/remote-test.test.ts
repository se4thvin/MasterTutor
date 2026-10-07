import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const client = read("./remote-test.sh");
const host = read("./remote-test/run-on-host.sh");
const readme = read("./README.md");
const suites = /^suites="([^"]+)"$/m.exec(client)?.[1]?.split(" ") ?? [];

describe("remote test runner (D45, X4)", () => {
  it("offers the full-stack suites beside the Vitest and image suites", () => {
    expect(suites).toEqual([
      "unit",
      "integration",
      "security",
      "web-build",
      "agent-image",
      "behaviour",
      "e2e",
      "smoke",
      "qa",
      "bench-mock",
    ]);
  });

  it("handles and documents every suite it offers", () => {
    for (const suite of suites) {
      expect(host, suite).toMatch(new RegExp(`(^|[ (|])${suite}( \\||\\))`, "m"));
      expect(readme, suite).toContain(`scripts/remote-test.sh ${suite}`);
    }
  });

  it("holds one host lock for every full-stack suite", () => {
    expect(host).toContain('stack_lock="$runs_dir/stack.lock"');
    expect(host).toMatch(/^ {2}e2e \| smoke \| qa \| bench-mock\) take_stack_lock ;;$/m);
  });
});
