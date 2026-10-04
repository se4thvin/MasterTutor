// The single definition of "production mode" for a resolved compose config (D47). Used by the
// compose overlay tests (Task 12), the production env check (Task 14), the real-model smoke
// (Task 15) and the bench harness preflight (Phase 10). Problems name keys and services only.
import { composeConfig, type ComposeConfig } from "./compose-json.ts";

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
): ComposeConfig {
  return composeConfig(envFile, files, { profiles: ["*"] });
}

/** True for a production service or a slot: anything else must not run in production (review I2). */
export function isProductionService(name: string): boolean {
  return SLOT.test(name) || (PRODUCTION_SERVICES as readonly string[]).includes(name);
}

export function prodModeProblems(config: ComposeConfig): string[] {
  const problems: string[] = [];
  const envOf = (service: string) => config.services[service]?.environment ?? {};
  for (const [name, service] of Object.entries(config.services)) {
    if (!isProductionService(name))
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
  return problems;
}
