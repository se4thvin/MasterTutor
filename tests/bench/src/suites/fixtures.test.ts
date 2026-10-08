import { describe, expect, it, vi } from "vitest";
import type { BenchApi } from "../app-client.ts";
import { BENCH_ORIGIN, ensureFixtureVaultItem, fixturesSuite } from "./fixtures.ts";

describe("fixtures suite", () => {
  it("has one benchmark per track, each with its own main and verify scenario (P10b-11)", () => {
    const suite = fixturesSuite();
    expect(suite.benchmarks.map((b) => `${b.key}@${b.toolProfile}`)).toEqual([
      "activities@browser_use",
      "activities@computer_use",
    ]);
    for (const b of suite.benchmarks) {
      expect(b.mockScenarios).toEqual({
        main: `bench-activities-${b.toolProfile}`,
        verify: `bench-verify-${b.toolProfile}`,
      });
      expect(b.allowedOrigins).toEqual([BENCH_ORIGIN]);
      expect(b.task).toMatch(/cookie/i);
      expect(b.budget.maxUsd).toBeLessThanOrEqual(3);
    }
  });

  it("keeps the real-model worst case under the $10 fixtures cap", () => {
    const worst = fixturesSuite().benchmarks.reduce(
      (sum, b) => sum + b.budget.maxUsd + (b.verify?.budget.maxUsd ?? 0),
      0,
    );
    expect(worst).toBeLessThanOrEqual(10);
  });

  it("creates the dummy fixture vault item once, from .env.test values", async () => {
    const create = vi.fn(async () => ({}));
    const api = {
      vault: { list: vi.fn(async () => ({ items: [] })), create },
    } as unknown as BenchApi;
    const env =
      "BENCH_FIXTURE_USER=bench-user@fixtures.test\nBENCH_FIXTURE_PASSWORD=bench-fixture-password-not-secret-0123\n";
    await expect(ensureFixtureVaultItem(api, env)).resolves.toBe("created");
    expect(create).toHaveBeenCalledWith({
      alias: "bench-fixture",
      origin: BENCH_ORIGIN,
      label: "Benchmark fixture (dummy)",
      secrets: {
        username: "bench-user@fixtures.test",
        password: "bench-fixture-password-not-secret-0123",
      },
      imap: null,
    });
    const present = {
      vault: { list: vi.fn(async () => ({ items: [{ alias: "bench-fixture" }] })), create },
    } as unknown as BenchApi;
    await expect(ensureFixtureVaultItem(present, env)).resolves.toBe("present");
  });

  it("refuses to run without the dummy values", async () => {
    const api = {
      vault: { list: vi.fn(async () => ({ items: [] })), create: vi.fn() },
    } as unknown as BenchApi;
    await expect(ensureFixtureVaultItem(api, "")).rejects.toThrow(/BENCH_FIXTURE_USER/);
  });
});

describe("the committed .env.test (T1 seam)", () => {
  it("defines the dummy fixture login, so bench-fixtures can start", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseEnv } = await import("node:util");
    const env = parseEnv(readFileSync(new URL("../../../../.env.test", import.meta.url), "utf8"));
    expect(env.BENCH_FIXTURE_USER).toBeTruthy();
    expect(env.BENCH_FIXTURE_PASSWORD).toBeTruthy();
  });
});
