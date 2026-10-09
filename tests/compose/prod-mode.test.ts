import { readFileSync } from "node:fs";
import {
  O2_REQUIRED_ENV,
  OPENOBSERVE_IMAGE,
  OTEL_COLLECTOR_IMAGE,
} from "@mastertutor/observability";
import { describe, expect, it } from "vitest";
import type { ComposeConfig } from "./compose-json.ts";
import { LOCAL_INGRESS_SERVICE, prodModeProblems, WORKERS } from "./prod-mode.ts";

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
    observer: {
      ...hardened,
      environment: {
        DATABASE_URL: "postgres://observer_role:test@postgres:5432/mastertutor",
        OPENAI_BASE_URL: "",
      },
      networks: {
        "observer-db": {},
        observe: {},
        "observe-edge": {},
        telemetry: {},
        "observer-egress": {},
      },
    },
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
  networks: Object.fromEntries(
    ["pdf", "audio", "pulse", "observer-db", "observe", "observe-edge", "telemetry"].map((key) => [
      key,
      { internal: true },
    ]),
  ),
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
});

describe("the local-ingress exception (D47 bench and smoke only; group-2 final review I1)", () => {
  const ingress = (): ComposeConfig["services"][string] => ({
    image: "traefik:v3.7.13",
    ports: [{ target: 80, published: "18080", host_ip: "127.0.0.1" }],
    volumes: [
      {
        type: "bind",
        source: "/var/run/docker.sock",
        target: "/var/run/docker.sock",
        read_only: true,
      },
    ],
  });
  const withService = (name: string, service: ComposeConfig["services"][string]) => {
    const config = prodLike();
    config.services[name] = service;
    return config;
  };

  it("accepts the loopback Traefik only when the caller opts in", () => {
    const config = withService(LOCAL_INGRESS_SERVICE, ingress());
    expect(prodModeProblems(config, { localIngress: true })).toEqual([]);
    // check-env (production) never opts in: there, it is not a production service.
    expect(prodModeProblems(config)).toEqual(["service traefik: not a production service (D47)"]);
  });

  it("is strict: official image, loopback ports, docker.sock read-only, nothing else", () => {
    const loose = ingress();
    loose.image = "evil/traefik:latest";
    loose.ports = [{ target: 80, published: "18080", host_ip: "0.0.0.0" }];
    loose.volumes = [
      { type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" },
      { type: "bind", source: "/", target: "/host", read_only: true },
    ];
    expect(
      prodModeProblems(withService(LOCAL_INGRESS_SERVICE, loose), { localIngress: true }),
    ).toEqual([
      "traefik.image: must be the official traefik image (D47)",
      "traefik.ports: must publish on 127.0.0.1 only (D47)",
      "traefik.volumes: only docker.sock, read-only (D47)",
      "traefik.volumes: only docker.sock, read-only (D47)",
    ]);
  });

  it("still refuses a renamed test service, even with the exception", () => {
    const renamed = withService("proxy", { image: "mastertutor/test-tools:local" });
    expect(prodModeProblems(renamed, { localIngress: true })).toEqual([
      "service proxy: not a production service (D47)",
      "service proxy: runs a test image (D47)",
    ]);
    const disguised = withService(LOCAL_INGRESS_SERVICE, {
      ...ingress(),
      image: "mastertutor/test-tools:local",
    });
    expect(prodModeProblems(disguised, { localIngress: true })).toEqual([
      "traefik.image: must be the official traefik image (D47)",
      "service traefik: runs a test image (D47)",
    ]);
  });
});

describe("production gates (review I2)", () => {
  it("is fed every profile by each production gate: check-env and the prod smoke (review I2)", () => {
    for (const file of ["../../scripts/deploy/check-env.ts", "../smoke/prod-smoke.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).toMatch(/prodModeProblems\(\s*resolveForProdCheck\(/);
      expect(source, file).not.toMatch(/prodModeProblems\(\s*(config|composeConfig)\b/);
    }
  });
});

describe("observability rules (D50)", () => {
  const withObservability = (): ComposeConfig => {
    const config = prodLike();
    config.services.openobserve = {
      ...hardened,
      image: OPENOBSERVE_IMAGE,
      environment: { ...O2_REQUIRED_ENV },
      networks: { observe: {}, "observe-store": {}, "observe-edge": {} },
      labels: {
        "traefik.http.routers.mastertutor-observability.middlewares":
          "mastertutor-observability-root,mastertutor-observability-auth,mastertutor-live-headers",
      },
    };
    config.services["otel-collector"] = {
      ...hardened,
      image: OTEL_COLLECTOR_IMAGE,
      ports: [{ target: 24224, published: "24224", host_ip: "127.0.0.1", protocol: "tcp" }],
      networks: { telemetry: {}, observe: {}, "obs-ingest": {} },
    };
    for (const n of ["telemetry", "observe", "observe-store", "observe-edge"])
      config.networks[n] = { internal: true };
    config.networks["obs-ingest"] = {
      driver_opts: { "com.docker.network.bridge.enable_ip_masquerade": "false" },
    };
    return config;
  };

  it("accepts the observability stack as designed, and the external edge network", () => {
    expect(prodModeProblems(withObservability())).toEqual([]);
    const external = withObservability();
    external.networks["observe-edge"] = { name: "mastertutor-obs", external: true };
    expect(prodModeProblems(external)).toEqual([]);
  });

  it("refuses a public, unpinned, chatty or unauthenticated OpenObserve and a loose collector", () => {
    const config = withObservability();
    const o2 = config.services.openobserve!;
    o2.ports = [{ target: 5080, published: "5080" }];
    o2.labels = {};
    // A pinned digest that is not the one the contract test runs against (review I3).
    o2.image = `openobserve/openobserve:v1.0.4@sha256:${"0".repeat(64)}`;
    o2.environment = { ZO_TELEMETRY: "true" };
    o2.user = "0:0";
    const collector = config.services["otel-collector"]!;
    collector.ports = [{ target: 24224, published: "24224", host_ip: "0.0.0.0" }];
    collector.image = "otel/opentelemetry-collector-contrib:latest";
    collector.read_only = false;
    config.networks.observe = { internal: false };
    config.networks["obs-ingest"] = {};
    expect(prodModeProblems(config)).toEqual([
      "openobserve.ports: must publish nothing (D50)",
      "openobserve.image: must be OPENOBSERVE_IMAGE, the digest the API contract test pins (D50)",
      "openobserve.ZO_BASE_URI: must be /observability (D50)",
      "openobserve.ZO_TELEMETRY: must be false (D50)",
      "openobserve.ZO_USAGE_REPORTING_ENABLED: must be false (D50)",
      "openobserve.ZO_MMDB_DISABLE_DOWNLOAD: must be true (D50)",
      "openobserve.ZO_SKIP_SSRF_CHECKS: must be true (D50)",
      "openobserve.user: must be a numeric non-root uid (D50)",
      "openobserve: its router must run mastertutor-observability-auth (D50)",
      "otel-collector.ports: only 127.0.0.1:24224 (D45, D50)",
      "otel-collector.image: must be OTEL_COLLECTOR_IMAGE, the digest the collector test pins (D50)",
      "otel-collector.read_only: must be true (D50)",
      "networks.observe: must be internal (D50)",
      "networks.obs-ingest: must disable IP masquerade, so the collector has no egress (D50)",
    ]);
  });
});

describe("the observer service (D52)", () => {
  it("rejects powerful credentials, a published port and extra network", () => {
    const config = prodLike();
    const observer = config.services.observer!;
    observer.environment!.S3_ACCESS_KEY_ID = "test";
    observer.ports = [{ target: 4000, published: "4000" }];
    observer.networks!.backend = {};
    expect(prodModeProblems(config)).toEqual(
      expect.arrayContaining([
        "observer.environment.S3_ACCESS_KEY_ID: the observer holds no S3, vault, sealing, auth or n.eko secret (D52)",
        "observer.ports: the observer publishes no port (D52)",
        "observer.networks: exactly observe, observe-edge, observer-db, observer-egress, telemetry (D52)",
      ]),
    );
  });
  it("rejects an owner database role, public database network and mock provider", () => {
    const config = prodLike();
    config.services.observer!.environment!.DATABASE_URL =
      "postgres://owner:test@postgres:5432/mastertutor";
    config.services.observer!.environment!.OPENAI_BASE_URL = "http://llm-mock:8080/v1";
    config.networks["observer-db"] = {};
    expect(prodModeProblems(config)).toEqual(
      expect.arrayContaining([
        "observer.DATABASE_URL: must use observer_role at postgres (D52)",
        "observer.OPENAI_BASE_URL: must be empty (real OpenAI only, D38/D47)",
        "networks.observer-db: must be internal (D52)",
      ]),
    );
  });
});
