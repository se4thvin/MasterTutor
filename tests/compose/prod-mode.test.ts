import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ComposeConfig } from "./compose-json.ts";
import { prodModeProblems, WORKERS } from "./prod-mode.ts";

const hardened = {
  read_only: true,
  cap_drop: ["ALL"],
  security_opt: ["no-new-privileges:true"],
  user: "1000:1000",
  mem_limit: "1073741824",
  cpus: 1,
  pids_limit: 64,
};
const prodLike = (): ComposeConfig => ({
  services: {
    web: { environment: { OPENAI_API_KEY: "sk-value-never-printed", OPENAI_BASE_URL: "" } },
    agent: { environment: { AGENT_TEST_MODE: "0", OPENAI_BASE_URL: "" } },
    "browser-1": {
      environment: { SLOT_EGRESS_ALLOW_CIDRS: "", PULSE_ALLOWED_IP: "172.30.233.10" },
    },
    "audio-capture": {
      ...hardened,
      networks: { audio: {}, pulse: { ipv4_address: "172.30.233.10" } },
    },
    "pdf-worker": { ...hardened, networks: { pdf: {} } },
    docling: {
      ...hardened,
      user: "1001:0",
      environment: { ...WORKERS.docling!.env },
      networks: { pdf: {} },
    },
  },
  networks: { pdf: { internal: true }, audio: { internal: true }, pulse: { internal: true } },
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

  it("lets only a secret-free, read-only audio-capture record slot audio (B4 review I7)", () => {
    const config = prodLike();
    config.services["audio-capture"]!.environment = { OPENAI_API_KEY: "sk-value-never-printed" };
    config.services["audio-capture"]!.read_only = false;
    config.services["browser-1"]!.environment!.PULSE_ALLOWED_IP = "172.30.231.10";
    config.services["audio-capture"]!.networks!.cdp = {};
    config.services.agent!.networks = { pulse: {} };
    const problems = prodModeProblems(config);
    expect(problems).toEqual([
      "audio-capture.environment: only its fixed settings, no secrets (final I8)",
      "audio-capture.read_only: must be true (final I8)",
      "audio-capture.networks: must be exactly audio, pulse (final I8)",
      "audio-capture.networks: cdp must be internal (final I8)",
      "agent.networks: must not join pulse (B4 I7)",
      "browser-1.PULSE_ALLOWED_IP: must be audio-capture's pulse address only (B4 I7)",
    ]);
    expect(problems.join("\n")).not.toContain("sk-value-never-printed");
  });

  it("holds pdf-worker and docling to the same hardening as audio-capture (final review I8)", () => {
    const config = prodLike();
    const worker = config.services["pdf-worker"]!;
    worker.environment = { VAULT_PRIVATE_KEY: "key-value-never-printed" };
    worker.read_only = false;
    worker.cap_drop = [];
    worker.security_opt = [];
    worker.user = "0:0";
    worker.pids_limit = 0;
    worker.networks = { pdf: {}, backend: {} };
    worker.ports = [{ target: 5002, published: "5002" }];
    const docling = config.services.docling!;
    delete docling.user;
    docling.environment = { ...docling.environment, DOCLING_SERVE_ENABLE_REMOTE_SERVICES: "true" };
    const problems = prodModeProblems(config);
    expect(problems).toEqual([
      "pdf-worker.environment: only its fixed settings, no secrets (final I8)",
      "pdf-worker.read_only: must be true (final I8)",
      "pdf-worker.cap_drop: must drop ALL (final I8)",
      "pdf-worker.security_opt: must set no-new-privileges (final I8)",
      "pdf-worker.user: must be a numeric non-root uid (final I8)",
      "pdf-worker: must bound memory, CPU and processes (final I8)",
      "pdf-worker.networks: must be exactly pdf (final I8)",
      "pdf-worker.networks: backend must be internal (final I8)",
      "pdf-worker.ports: must publish nothing (final I8)",
      "docling.environment: only its fixed settings, no secrets (final I8)",
      "docling.user: must be a numeric non-root uid (final I8)",
    ]);
    expect(problems.join("\n")).not.toContain("key-value-never-printed");
  });

  it("requires pdf-worker and audio-capture, and docling only under its profile", () => {
    const config = prodLike();
    delete config.services["pdf-worker"];
    delete config.services["audio-capture"];
    delete config.services.docling;
    expect(prodModeProblems(config)).toEqual([
      "service pdf-worker: must run (final I8)",
      "service audio-capture: must run (final I8)",
      "browser-1.PULSE_ALLOWED_IP: must be audio-capture's pulse address only (B4 I7)",
    ]);
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
