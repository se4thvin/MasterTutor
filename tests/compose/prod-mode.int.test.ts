import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillEnv, generateSecrets } from "../../scripts/env-init.ts";
import { composeConfig } from "./compose-json.ts";
import { prodModeProblems } from "./prod-mode.ts";

/**
 * D47: the production configuration runs no test mode, no mock model and no fixture service.
 * The env is `pnpm env:init`-shaped (fresh secrets, safe defaults), never .env.test, which turns
 * test mode on. Throwaway values: the file is deleted after the run.
 */
let dir: string;
let prodEnv: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mt-prod-env-"));
  prodEnv = join(dir, ".env.prod-check");
  const { text } = fillEnv("", generateSecrets());
  writeFileSync(prodEnv, `${text}\nOPENAI_API_KEY=sk-prod-mode-check-placeholder\n`, {
    mode: 0o600,
  });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("prodModeProblems (D47)", () => {
  it("finds every test-mode marker in the test stack, so it cannot pass a test config", () => {
    const test = composeConfig(".env.test", ["compose.yml", "compose.test.yml"], {
      profiles: ["e2e", "e2e-runner", "bench"],
    });
    const problems = prodModeProblems(test);
    for (const expected of [
      "agent: AGENT_TEST_MODE is 1",
      "agent: OPENAI_BASE_URL points at http://llm-mock:8090/v1",
      "web: OPENAI_BASE_URL points at http://llm-mock:8090/v1",
      "test-only service: llm-mock",
      "test-only service: fixtures",
      "test-only service: vault-fixtures",
      "test-only service: bench-fixtures",
      "test-only service: e2e",
      "browser-1: SLOT_EGRESS_ALLOW_CIDRS opens 172.30.241.0/24",
    ])
      expect(problems).toContain(expected);
  });

  it("flags a fixture API on web and a non-OpenAI model host", () => {
    expect(
      prodModeProblems({
        services: {
          web: {
            environment: { WEB_FIXTURE_API: "1", OPENAI_BASE_URL: "https://proxy.example/v1" },
          },
        },
        networks: {},
      }),
    ).toEqual([
      "web: OPENAI_BASE_URL points at https://proxy.example/v1",
      "web: WEB_FIXTURE_API is set",
    ]);
  });
});

describe("compose.yml alone is production-mode clean (D47)", () => {
  it("has no test mode, no mock model URL, no fixture API and no test-only service", () => {
    expect(prodModeProblems(composeConfig(prodEnv, ["compose.yml"]))).toEqual([]);
  });
});

// Phase 9 Task 12 creates compose.prod.yml; this block then runs with no change.
describe.skipIf(!existsSync(new URL("../../compose.prod.yml", import.meta.url)))(
  "compose.yml + compose.prod.yml is production-mode clean (D47)",
  () => {
    it("has no test mode, no mock model URL, no fixture API and no test-only service", () => {
      expect(prodModeProblems(composeConfig(prodEnv, ["compose.yml", "compose.prod.yml"]))).toEqual(
        [],
      );
    });
  },
);
