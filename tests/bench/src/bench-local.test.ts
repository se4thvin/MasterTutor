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
