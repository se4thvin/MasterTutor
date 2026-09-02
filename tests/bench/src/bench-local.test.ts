import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STACK_COMPOSE } from "./config.ts";

const script = readFileSync(new URL("../../../scripts/bench-local.sh", import.meta.url), "utf8");

describe("scripts/bench-local.sh (D46, D47)", () => {
  it("brings up exactly T19's STACK_COMPOSE.local", () => {
    expect(script).toContain(`DC=(${STACK_COMPOSE.local.join(" ")})`);
  });
  it("takes the Mac stack lock and never names a test-only file", () => {
    expect(script).toContain("until mkdir /tmp/mt-behaviour.lock");
    expect(script).not.toMatch(/compose\.test\.yml|llm-mock|WEB_FIXTURE_API=/);
  });
  it("uses T15's smoke, not a second one", () => {
    expect(script).toContain("pnpm prod:smoke --max-usd 1");
  });
});

describe("scripts/bench-mock.sh (fresh stack per invocation)", () => {
  const mock = readFileSync(new URL("../../../scripts/bench-mock.sh", import.meta.url), "utf8");
  it("drops a leftover account file before init, since every run boots an empty stack", () => {
    const drop = mock.indexOf("rm -f .env.bench-account");
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(mock.indexOf("pnpm bench init"));
  });
});

describe("scripts/bench-mock.sh proves run 1's grading on the fixture library", () => {
  const mock = readFileSync(new URL("../../../scripts/bench-mock.sh", import.meta.url), "utf8");
  it("runs the library benchmark (main run, then grading run) and checks every section's row", () => {
    expect(mock).toContain("pnpm bench run --suite fixtures --mock --only readings");
    for (const row of [
      "answered 0/1 questions",
      "**failed** | 1/2 activities complete",
      "**unknown** | no activity found",
      "**unknown** | never read",
      "3.3 Extra",
    ])
      expect(mock).toContain(row);
  });
  it("re-grades the record from its stored traces and checks the regrade agrees (I5)", () => {
    expect(mock).toContain('pnpm bench regrade "$record"');
    expect(mock).toMatch(/sed -n '\/\^## Regrade\/,\$p'/);
  });
  it("keeps the activities runs to their own benchmark", () => {
    expect(mock.match(/pnpm bench run --suite fixtures --mock --only activities/g)).toHaveLength(2);
  });
});

describe("scripts/bench-local.sh regrade (I5)", () => {
  it("re-grades a record on the bench stack without the vault wait or a run", () => {
    const local = readFileSync(new URL("../../../scripts/bench-local.sh", import.meta.url), "utf8");
    expect(local).toMatch(/\n {2}regrade\)\n {4}shift\n {4}pnpm bench regrade "\$@" ;;/);
  });
});

describe("scripts/bench-real-fixtures.sh (I4)", () => {
  it("runs only the activities benchmark with the real model, never the static library", () => {
    const real = readFileSync(
      new URL("../../../scripts/bench-real-fixtures.sh", import.meta.url),
      "utf8",
    );
    expect(real).toMatch(/pnpm bench run --suite fixtures --only activities --track both/);
    expect(real).not.toMatch(/--only readings/);
  });
});
