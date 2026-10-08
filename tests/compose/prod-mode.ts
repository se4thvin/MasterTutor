// The single definition of "production mode" for a resolved compose config (D47). Used by the
// compose overlay tests (Task 12), the production env check (Task 14), the real-model smoke
// (Task 15) and the bench harness preflight (Phase 10). Problems name keys and services only.
import type { ComposeConfig } from "./compose-json.ts";

/** Services that exist only in test stacks; a production-like stack never runs them. */
export const TEST_ONLY_SERVICES = [
  "llm-mock",
  "fixtures",
  "vault-fixtures",
  "bench-fixtures",
  "greenmail",
  "e2e",
] as const;

/** D47's production-like local stack: the production files plus one loopback override (Task 22A). */
export const PROD_LIKE_LOCAL_FILES = [
  "compose.yml",
  "compose.prod.yml",
  "tests/bench/compose.local.yml",
] as const;

const SLOT = /^browser-\d+$/;

export function prodModeProblems(config: ComposeConfig): string[] {
  const problems: string[] = [];
  const envOf = (service: string) => config.services[service]?.environment ?? {};
  for (const name of TEST_ONLY_SERVICES) {
    if (config.services[name]) problems.push(`service ${name}: test-only, must not run (D47)`);
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
  // B4 review I7: slot audio is recorded only by audio-capture, which holds no secrets.
  const capture = config.services["audio-capture"];
  if (capture && Object.keys(capture.environment ?? {}).length > 0) {
    problems.push("audio-capture.environment: must be empty (no secrets, B4 I7)");
  }
  if (capture && capture.read_only !== true) {
    problems.push("audio-capture.read_only: must be true (B4 I7)");
  }
  if (capture?.networks && "cdp" in capture.networks) {
    problems.push("audio-capture.networks: must not join cdp (B4 I7)");
  }
  if (config.services.agent?.networks && "pulse" in config.services.agent.networks) {
    problems.push("agent.networks: must not join pulse (B4 I7)");
  }
  const captureAddress = capture?.networks?.pulse?.ipv4_address;
  for (const [name, service] of Object.entries(config.services)) {
    if (!SLOT.test(name)) continue;
    const pulse = service.environment?.PULSE_ALLOWED_IP;
    if (!captureAddress || pulse !== captureAddress) {
      problems.push(`${name}.PULSE_ALLOWED_IP: must be audio-capture's pulse address only (B4 I7)`);
    }
  }
  return problems;
}
