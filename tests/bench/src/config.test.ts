import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCH_ACCOUNT_FILE,
  BENCH_PROJECT,
  STACK_COMPOSE,
  assertNoSiteCredentialsInEnv,
  readBenchEnv,
  writeBenchEnv,
} from "./config.ts";

const dir = () => mkdtempSync(join(tmpdir(), "bench-"));

describe("bench config", () => {
  it("refuses site credentials in the environment (D34)", () => {
    expect(() => assertNoSiteCredentialsInEnv({ ZYBOOKS_PASSWORD: "x" })).toThrow(/Vault UI/);
    expect(() => assertNoSiteCredentialsInEnv({ zybooks_user: "x" })).toThrow();
    expect(() => assertNoSiteCredentialsInEnv({ PATH: "/bin" })).not.toThrow();
  });

  it("runs zyBooks on the prod-like compose (D47), never the test overlay", () => {
    expect(STACK_COMPOSE.local).toEqual([
      "docker",
      "compose",
      "-p",
      BENCH_PROJECT,
      "--env-file",
      ".env",
      "--env-file",
      ".env.bench",
      "--profile",
      "pdf",
      "-f",
      "compose.yml",
      "-f",
      "compose.prod.yml",
      "-f",
      "tests/bench/compose.local.yml",
    ]);
    expect(STACK_COMPOSE.local.join(" ")).not.toMatch(/compose\.test|llm-mock|fixtures/);
    expect(STACK_COMPOSE.test.join(" ")).toBe(
      "docker compose --env-file .env.test -f compose.yml -f compose.test.yml",
    );
  });

  it("keeps the app account in its own 0600 file, never in env-init's .env.bench (D47)", () => {
    expect(BENCH_ACCOUNT_FILE).toBe(".env.bench-account");
    const path = join(dir(), BENCH_ACCOUNT_FILE);
    const env = {
      BENCH_STACK: "local" as const,
      BENCH_BASE_URL: "http://localhost:18080",
      BENCH_EMAIL: "bench-owner@local.test",
      BENCH_PASSWORD: "p".repeat(24),
    };
    writeBenchEnv(path, env);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readBenchEnv(path)).toEqual(env);
    writeFileSync(path, readFileSync(path, "utf8").replace("BENCH_PASSWORD=", "BENCH_PASSWORD=x"), {
      mode: 0o600,
    });
    expect(readBenchEnv(path).BENCH_PASSWORD).toBe(`x${"p".repeat(24)}`);
  });
});
