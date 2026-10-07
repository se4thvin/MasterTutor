import type { ComposeConfig, ComposeService } from "./compose-json.ts";

/** Services that exist only in the test stack (compose.test.yml profiles). */
export const TEST_ONLY_SERVICES = [
  "llm-mock",
  "fixtures",
  "vault-fixtures",
  "bench-fixtures",
  "e2e",
] as const;
const OPENAI_ORIGIN = "https://api.openai.com";

const originOf = (url: string): string | null => (URL.canParse(url) ? new URL(url).origin : null);

const value = (service: ComposeService | undefined, key: string): string =>
  service?.environment?.[key] ?? "";

/**
 * Why a resolved Compose config is NOT the production configuration (D47), one line per problem;
 * empty when it is. Phase 9 Task 12 and the T22A harness reuse it for compose.prod.yml.
 * - the agent's test mode is off;
 * - the model is OpenAI itself (OPENAI_BASE_URL unset, or an api.openai.com URL), never the mock;
 * - web serves the real API, never the fixture API;
 * - slots open no private range in their egress firewall;
 * - no test-only service is defined.
 */
export function prodModeProblems(config: ComposeConfig): string[] {
  const problems: string[] = [];
  const testMode = value(config.services.agent, "AGENT_TEST_MODE");
  if (testMode !== "" && testMode !== "0") problems.push(`agent: AGENT_TEST_MODE is ${testMode}`);
  for (const name of ["agent", "web"]) {
    const url = value(config.services[name], "OPENAI_BASE_URL");
    if (url === "") continue;
    if (originOf(url) !== OPENAI_ORIGIN) problems.push(`${name}: OPENAI_BASE_URL points at ${url}`);
  }
  if (value(config.services.web, "WEB_FIXTURE_API") !== "")
    problems.push("web: WEB_FIXTURE_API is set");
  for (const [name, service] of Object.entries(config.services)) {
    if (!name.startsWith("browser-")) continue;
    const cidrs = value(service, "SLOT_EGRESS_ALLOW_CIDRS");
    if (cidrs !== "") problems.push(`${name}: SLOT_EGRESS_ALLOW_CIDRS opens ${cidrs}`);
  }
  for (const name of TEST_ONLY_SERVICES)
    if (config.services[name]) problems.push(`test-only service: ${name}`);
  return problems;
}
