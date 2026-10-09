// The single definition of "production mode" for a resolved compose config (D47). Used by the
// compose overlay tests (Task 12), the production env check (Task 14), the real-model smoke
// (Task 15) and the bench harness preflight (Phase 10). Problems name keys and services only.
import { O2_REQUIRED_ENV } from "@mastertutor/observability";
import { composeConfig, type ComposeConfig, type ComposeService } from "./compose-json.ts";

/**
 * The production services (compose.yml + compose.prod.yml), plus the slots (`browser-N`). An
 * allowlist: anything else is refused, whatever it is called (review I2). docling is B2/B4/B5's
 * PDF service under the `pdf` profile (D42). A production addition must be listed here.
 */
export const PRODUCTION_SERVICES = [
  "postgres",
  "garage",
  "garage-init",
  "migrate",
  "web",
  "agent",
  "pdf-worker",
  "docling",
  "audio-capture",
  // D50: the telemetry stack, under the `observability` profile (observabilityProblems below).
  "otel-collector",
  "openobserve",
  "observability-init",
] as const;

/**
 * Test-only images, refused even under a production service name: the llm-mock and vault-fixture
 * image, the Playwright runner, the mail fixture, and any image named for a mock, fixture or bench.
 */
const TEST_IMAGE_REPOSITORIES = [
  "mastertutor/test-tools",
  "mastertutor/e2e",
  "greenmail/standalone",
];
const TEST_IMAGE_NAME = /(llm-?mock|fixture|bench|e2e)/i;

const repositoryOf = (image: string): string => image.replace(/@.*$/, "").replace(/:[^/:]*$/, "");

/** True for an image only the test stacks run. */
export function isTestImage(image: string): boolean {
  const repository = repositoryOf(image);
  return TEST_IMAGE_REPOSITORIES.includes(repository) || TEST_IMAGE_NAME.test(repository);
}

/** D47's production-like local stack: the production files plus one loopback override (Task 22A). */
export const PROD_LIKE_LOCAL_FILES = [
  "compose.yml",
  "compose.prod.yml",
  "tests/bench/compose.local.yml",
] as const;

const SLOT = /^browser-\d+$/;

/**
 * The config the production check runs on: every profile enabled (`--profile '*'`), so a test
 * service behind a profile the deployment happens to enable cannot hide from it (review I2).
 */
export function resolveForProdCheck(
  envFile: string | readonly string[],
  files: readonly string[],
  env?: Readonly<Record<string, string>>,
): ComposeConfig {
  return composeConfig(envFile, files, { profiles: ["*"], ...(env ? { env } : {}) });
}

/** True for a production service or a slot: anything else must not run in production (review I2). */
export function isProductionService(name: string): boolean {
  return SLOT.test(name) || (PRODUCTION_SERVICES as readonly string[]).includes(name);
}

/**
 * The one service a prod-like LOCAL stack (D47 bench and smoke, tests/bench/compose.local.yml)
 * adds: a loopback Traefik standing in for Dokploy's ingress. Never production: behind Dokploy
 * there is no Traefik service, and one holding docker.sock would be a privilege risk. Only the
 * bench and smoke checks opt in (`localIngress`); check-env never does.
 */
export const LOCAL_INGRESS_SERVICE = "traefik";

export interface ProdModeOptions {
  /** Accept the strict local-ingress Traefik (bench and smoke only, never check-env). */
  localIngress?: boolean;
}

/** Why a `traefik` service is not the strict local ingress: official image, loopback, socket read-only. */
function localIngressProblems(service: ComposeService): string[] {
  const problems: string[] = [];
  if (!/^traefik:[\w.-]+(@sha256:[0-9a-f]{64})?$/.test(service.image ?? ""))
    problems.push(`${LOCAL_INGRESS_SERVICE}.image: must be the official traefik image (D47)`);
  if ((service.ports ?? []).some((port) => port.host_ip !== "127.0.0.1"))
    problems.push(`${LOCAL_INGRESS_SERVICE}.ports: must publish on 127.0.0.1 only (D47)`);
  for (const volume of service.volumes ?? []) {
    const socket = volume.source === "/var/run/docker.sock";
    if (!socket || volume.read_only !== true)
      problems.push(`${LOCAL_INGRESS_SERVICE}.volumes: only docker.sock, read-only (D47)`);
  }
  return problems;
}

interface WorkerRule {
  /** The only environment it may have: fixed, secret-free settings (values included). */
  env: Readonly<Record<string, string>>;
  /** Exactly these networks, each internal (no egress). */
  networks: readonly string[];
  /** Runs in every production stack (docling only under profile pdf, which check-env requires). */
  required: boolean;
}

/** The isolated workers that read untrusted bytes or slot audio: one hardening rule (final I8). */
export const WORKERS: Readonly<Record<string, WorkerRule>> = {
  "pdf-worker": { env: {}, networks: ["pdf"], required: true },
  "audio-capture": { env: {}, networks: ["audio", "pulse"], required: true },
  docling: {
    env: {
      DOCLING_SERVE_ENABLE_UI: "false",
      DOCLING_SERVE_ENABLE_REMOTE_SERVICES: "false",
      DOCLING_SERVE_MAX_FILE_SIZE: "104857600",
      DOCLING_SERVE_MAX_NUM_PAGES: "500",
    },
    networks: ["pdf"],
    required: false,
  },
};

/** Read-only, no capabilities, no new privileges, non-root and bounded; `tag` names the decision. */
function hardeningProblems(name: string, service: ComposeService, tag: string): string[] {
  const problems: string[] = [];
  if (service.read_only !== true) problems.push(`${name}.read_only: must be true (${tag})`);
  if (!service.cap_drop?.includes("ALL")) problems.push(`${name}.cap_drop: must drop ALL (${tag})`);
  if (!service.security_opt?.includes("no-new-privileges:true")) {
    problems.push(`${name}.security_opt: must set no-new-privileges (${tag})`);
  }
  const uid = /^(\d+)(?::\d+)?$/.exec(service.user ?? "")?.[1];
  if (uid === undefined || Number(uid) === 0) {
    problems.push(`${name}.user: must be a numeric non-root uid (${tag})`);
  }
  if (!(
    Number(service.mem_limit) > 0 &&
    Number(service.cpus) > 0 &&
    Number(service.pids_limit) > 0
  )) {
    problems.push(`${name}: must bound memory, CPU and processes (${tag})`);
  }
  return problems;
}

/** No secrets, read-only, no capabilities, no new privileges, non-root, bounded, internal only. */
function workerProblems(config: ComposeConfig, name: string, rule: WorkerRule): string[] {
  const service = config.services[name];
  if (!service) return rule.required ? [`service ${name}: must run (final I8)`] : [];
  const problems: string[] = [];
  const env = Object.entries(service.environment ?? {});
  if (
    env.length !== Object.keys(rule.env).length ||
    env.some(([key, value]) => rule.env[key] !== value)
  ) {
    problems.push(`${name}.environment: only its fixed settings, no secrets (final I8)`);
  }
  problems.push(...hardeningProblems(name, service, "final I8"));
  const networks = Object.keys(service.networks ?? {}).sort();
  if (networks.join(",") !== [...rule.networks].sort().join(",")) {
    problems.push(`${name}.networks: must be exactly ${rule.networks.join(", ")} (final I8)`);
  }
  for (const network of networks) {
    if (config.networks[network]?.internal !== true) {
      problems.push(`${name}.networks: ${network} must be internal (final I8)`);
    }
  }
  if ((service.ports ?? []).length > 0)
    problems.push(`${name}.ports: must publish nothing (final I8)`);
  return problems;
}

const DIGEST = /@sha256:[0-9a-f]{64}$/;
const OBSERVE_NETWORKS = ["telemetry", "observe", "observe-store", "observe-edge"] as const;
/** The collector's one non-internal network (it publishes the fluent-forward port): no outbound NAT. */
export const NO_MASQUERADE = { "com.docker.network.bridge.enable_ip_masquerade": "false" } as const;

/**
 * D50: applied when the observability profile runs (check-env requires it in production).
 * OpenObserve publishes nothing and is reached only through the owner ForwardAuth; both images
 * are pinned; the collector publishes one loopback port; every telemetry hop is internal.
 */
function observabilityProblems(config: ComposeConfig): string[] {
  const o2 = config.services.openobserve;
  const collector = config.services["otel-collector"];
  const problems: string[] = [];
  if (o2) {
    if ((o2.ports ?? []).length > 0) problems.push("openobserve.ports: must publish nothing (D50)");
    if (!DIGEST.test(o2.image ?? ""))
      problems.push("openobserve.image: must be pinned by digest (D50)");
    for (const [key, value] of Object.entries(O2_REQUIRED_ENV))
      if (o2.environment?.[key] !== value)
        problems.push(`openobserve.${key}: must be ${value} (D50)`);
    problems.push(...hardeningProblems("openobserve", o2, "D50"));
    const middlewares =
      o2.labels?.["traefik.http.routers.mastertutor-observability.middlewares"] ?? "";
    if (!middlewares.split(",").includes("mastertutor-observability-auth"))
      problems.push("openobserve: its router must run mastertutor-observability-auth (D50)");
  }
  if (collector) {
    const ports = collector.ports ?? [];
    if (ports.some((p) => p.host_ip !== "127.0.0.1" || p.target !== 24224))
      problems.push("otel-collector.ports: only 127.0.0.1:24224 (D45, D50)");
    if (!DIGEST.test(collector.image ?? ""))
      problems.push("otel-collector.image: must be pinned by digest (D50)");
    problems.push(...hardeningProblems("otel-collector", collector, "D50"));
  }
  for (const name of OBSERVE_NETWORKS) {
    const network = config.networks[name];
    // Production's observe-edge is the host-made external mastertutor-obs (create-obs-network.sh).
    if (network && network.external !== true && network.internal !== true)
      problems.push(`networks.${name}: must be internal (D50)`);
  }
  const ingest = config.networks["obs-ingest"];
  if (
    collector &&
    ingest &&
    Object.entries(NO_MASQUERADE).some(([key, value]) => ingest.driver_opts?.[key] !== value)
  )
    problems.push(
      "networks.obs-ingest: must disable IP masquerade, so the collector has no egress (D50)",
    );
  return problems;
}

export function prodModeProblems(config: ComposeConfig, options: ProdModeOptions = {}): string[] {
  const problems: string[] = [];
  const envOf = (service: string) => config.services[service]?.environment ?? {};
  for (const [name, service] of Object.entries(config.services)) {
    if (options.localIngress && name === LOCAL_INGRESS_SERVICE)
      problems.push(...localIngressProblems(service));
    else if (!isProductionService(name))
      problems.push(`service ${name}: not a production service (D47)`);
    if (service.image && isTestImage(service.image))
      problems.push(`service ${name}: runs a test image (D47)`);
  }
  for (const [name, service] of Object.entries(config.services)) {
    if (service.environment && "WEB_FIXTURE_API" in service.environment) {
      problems.push(`${name}.WEB_FIXTURE_API: must be unset (D47)`);
    }
  }
  if (envOf("agent").AGENT_TEST_MODE !== "0") {
    problems.push("agent.AGENT_TEST_MODE: must be 0 (D47)");
  }
  for (const name of ["web", "agent"]) {
    if ((envOf(name).OPENAI_BASE_URL ?? "") !== "") {
      problems.push(`${name}.OPENAI_BASE_URL: must be empty (real OpenAI only, D38/D47)`);
    }
  }
  if (config.services.web?.command != null) {
    problems.push("web.command: must be the image's production server (next start)");
  }
  for (const [name, service] of Object.entries(config.services)) {
    if (SLOT.test(name) && (service.environment?.SLOT_EGRESS_ALLOW_CIDRS ?? "") !== "") {
      problems.push(`${name}.SLOT_EGRESS_ALLOW_CIDRS: must be empty`);
    }
  }
  for (const [name, rule] of Object.entries(WORKERS))
    problems.push(...workerProblems(config, name, rule));
  if (config.services.agent?.networks && "pulse" in config.services.agent.networks) {
    problems.push("agent.networks: must not join pulse (B4 I7)");
  }
  const capture = config.services["audio-capture"];
  const captureAddress = capture?.networks?.pulse?.ipv4_address;
  for (const [name, service] of Object.entries(config.services)) {
    if (!SLOT.test(name)) continue;
    const pulse = service.environment?.PULSE_ALLOWED_IP;
    if (!captureAddress || pulse !== captureAddress) {
      problems.push(`${name}.PULSE_ALLOWED_IP: must be audio-capture's pulse address only (B4 I7)`);
    }
  }
  problems.push(...observabilityProblems(config));
  return problems;
}
