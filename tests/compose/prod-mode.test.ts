import { describe, expect, it } from "vitest";
import type { ComposeConfig } from "./compose-json.ts";
import { prodModeProblems } from "./prod-mode.ts";

const prodLike = (): ComposeConfig => ({
  services: {
    web: { environment: { OPENAI_API_KEY: "sk-value-never-printed", OPENAI_BASE_URL: "" } },
    agent: { environment: { AGENT_TEST_MODE: "0", OPENAI_BASE_URL: "" } },
    "browser-1": {
      environment: { SLOT_EGRESS_ALLOW_CIDRS: "", PULSE_ALLOWED_IP: "172.30.231.13" },
    },
    "audio-capture": {
      read_only: true,
      cap_drop: ["ALL"],
      networks: { cdp: { ipv4_address: "172.30.231.13" } },
    },
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
      "service llm-mock: test-only, must not run (D47)",
      "service fixtures: test-only, must not run (D47)",
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

  it("lets only a secret-free, read-only audio-capture record slot audio (B4 review I7)", () => {
    const config = prodLike();
    config.services["audio-capture"]!.environment = { OPENAI_API_KEY: "sk-value-never-printed" };
    config.services["audio-capture"]!.read_only = false;
    config.services["browser-1"]!.environment!.PULSE_ALLOWED_IP = "172.30.231.10";
    const problems = prodModeProblems(config);
    expect(problems).toEqual([
      "audio-capture.environment: must be empty (no secrets, B4 I7)",
      "audio-capture.read_only: must be true (B4 I7)",
      "browser-1.PULSE_ALLOWED_IP: must be audio-capture's cdp address only (B4 I7)",
    ]);
    expect(problems.join("\n")).not.toContain("sk-value-never-printed");
    delete config.services["audio-capture"];
    expect(prodModeProblems(config)).toContain(
      "browser-1.PULSE_ALLOWED_IP: must be audio-capture's cdp address only (B4 I7)",
    );
  });

  it("treats a missing agent or AGENT_TEST_MODE as not production", () => {
    const config = prodLike();
    delete config.services.agent!.environment!.AGENT_TEST_MODE;
    expect(prodModeProblems(config)).toEqual(["agent.AGENT_TEST_MODE: must be 0 (D47)"]);
  });
});
