// P10b-16: one gate list everywhere; P10b-13: no chat credential path; D46: review gate wording.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const GATE_LIST =
  "pnpm typecheck && pnpm lint && scripts/remote-test.sh unit && scripts/remote-test.sh integration && scripts/remote-test.sh security && pnpm bench:mock";

describe("benchmark protocol docs", () => {
  const readme = read("orchestration/benchmarks/README.md");
  const brief = read("orchestration/briefs/bench-fix.md");
  it("use one gate list", () => {
    expect(readme).toContain(GATE_LIST);
    expect(brief).toContain(GATE_LIST);
  });
  it("never route credentials through chat, files or commands", () => {
    expect(readme).not.toMatch(/give them (to the orchestrator )?in chat/i);
    expect(readme).toMatch(/types? (them|the credential) into the Vault UI (themselves|yourself)/i);
  });
  it("state the D46 stop and the review gate", () => {
    expect(readme).toContain("--continue-after-review");
    expect(readme).toContain("reviewed: true");
    expect(readme).toMatch(/\$500/);
  });
  it("list benchmarks/ in the orchestration layout", () => {
    expect(read("orchestration/README.md")).toMatch(/^\s+benchmarks\//m);
  });
});

describe("the protocol matches the harness as built", () => {
  const readme = read("orchestration/benchmarks/README.md");
  it("names the durable ledger, its resolve step and the hard caps", () => {
    expect(readme).toContain("~/.mastertutor-bench/ledger.jsonl");
    expect(readme).toContain("pnpm bench resolve <id>");
    expect(readme).toMatch(/\$50 per run.*Neither cap can be raised/);
  });
  it("describes read-only grading runs as the grader enforces them (I3, N1, N2)", () => {
    expect(readme).toMatch(/only on the sign-in page/);
    expect(readme).toMatch(/address bar/);
    expect(readme).toMatch(/auto_approved/);
  });
  it("mentions no flag the CLI does not have", () => {
    expect(readme).not.toContain("--on-budget");
  });
});

describe("run 1 is the full task, once (D46 ruling)", () => {
  const readme = read("orchestration/benchmarks/README.md");
  it("describes one full-task agent run graded by a discovering read-only run", () => {
    expect(readme).toContain("full@browser_use");
    expect(readme).toMatch(/discovers the reading assignments and their sections itself/);
    expect(readme).toMatch(/`unknown`.*never passes/);
  });
  it("names no calibration file or survey step, which grading replaced", () => {
    expect(readme).not.toMatch(/sections\.json|`survey`|zybooks\/survey/);
    expect(read("orchestration/README.md")).not.toMatch(/calibration/);
  });
});
