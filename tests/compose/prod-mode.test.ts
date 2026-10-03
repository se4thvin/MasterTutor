import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ComposeConfig } from "./compose-json.ts";
import { prodModeProblems } from "./prod-mode.ts";

const prodLike = (): ComposeConfig => ({
  services: {
    web: { environment: { OPENAI_API_KEY: "sk-value-never-printed", OPENAI_BASE_URL: "" } },
    agent: { environment: { AGENT_TEST_MODE: "0", OPENAI_BASE_URL: "" } },
    "browser-1": { environment: { SLOT_EGRESS_ALLOW_CIDRS: "" } },
  },
  networks: {},
});

describe("prodModeProblems (D47)", () => {
  it("accepts a production-mode config", () => {
    expect(prodModeProblems(prodLike())).toEqual([]);
  });

  it("names every test-mode signal by key or service, never by value", () => {
    const config = prodLike();
    config.services["llm-mock"] = {};
    config.services.fixtures = {};
    config.services.web!.environment!.WEB_FIXTURE_API = "0";
    config.services.web!.command = ["pnpm", "dev"];
    config.services.agent!.environment!.AGENT_TEST_MODE = "1";
    config.services.agent!.environment!.OPENAI_BASE_URL = "http://llm-mock:8080/v1";
    config.services["browser-1"]!.environment!.SLOT_EGRESS_ALLOW_CIDRS = "10.0.0.0/8";
    const problems = prodModeProblems(config);
    expect(problems).toEqual([
      "service llm-mock: not a production service (D47)",
      "service fixtures: not a production service (D47)",
      "web.WEB_FIXTURE_API: must be unset (D47)",
      "agent.AGENT_TEST_MODE: must be 0 (D47)",
      "agent.OPENAI_BASE_URL: must be empty (real OpenAI only, D38/D47)",
      "web.command: must be the image's production server (next start)",
      "browser-1.SLOT_EGRESS_ALLOW_CIDRS: must be empty",
    ]);
    const text = problems.join("\n");
    for (const value of ["sk-value-never-printed", "http://llm-mock:8080/v1", "10.0.0.0/8"]) {
      expect(text).not.toContain(value);
    }
  });

  it("treats a missing agent or AGENT_TEST_MODE as not production", () => {
    const config = prodLike();
    delete config.services.agent!.environment!.AGENT_TEST_MODE;
    expect(prodModeProblems(config)).toEqual(["agent.AGENT_TEST_MODE: must be 0 (D47)"]);
  });

  it("refuses every service of the test stack's profiles, the bench fixture site included", () => {
    const config = prodLike();
    config.services["bench-fixtures"] = {};
    expect(prodModeProblems(config)).toEqual([
      "service bench-fixtures: not a production service (D47)",
    ]);
  });

  it("refuses a test service under any name: production is an allowlist (review I2)", () => {
    const config = prodLike();
    config.services["model-proxy"] = { image: "nginx:1.30.5-alpine-slim" };
    expect(prodModeProblems(config)).toEqual([
      "service model-proxy: not a production service (D47)",
    ]);
  });

  it("refuses a test image even under a production service name (review I2)", () => {
    for (const image of [
      "mastertutor/test-tools:local",
      "mastertutor/e2e:local",
      "registry.example/team/llm-mock:1",
      "greenmail/standalone:2.1.14",
    ]) {
      const config = prodLike();
      config.services["garage-init"] = { image };
      expect(prodModeProblems(config), image).toEqual([
        "service garage-init: runs a test image (D47)",
      ]);
    }
  });

  it("is fed every profile by each production gate: check-env and the prod smoke (review I2)", () => {
    for (const file of ["../../scripts/deploy/check-env.ts", "../smoke/prod-smoke.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).toMatch(/prodModeProblems\(\s*resolveForProdCheck\(/);
      expect(source, file).not.toMatch(/prodModeProblems\(\s*(config|composeConfig)\b/);
    }
  });
});
