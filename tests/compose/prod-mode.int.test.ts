import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillEnv, generateSecrets } from "../../scripts/env-init.ts";
import { composeConfig } from "./compose-json.ts";
import { prodModeProblems } from "./prod-mode.ts";

/**
 * D47: compose.yml's own defaults are production mode; compose.yml + compose.prod.yml is pinned by
 * prod-overlay.int.test.ts (Phase 9).
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

describe("prodModeProblems against the test stack (D47)", () => {
  it("finds every test-mode marker in the test stack, so it cannot pass a test config", () => {
    const test = composeConfig(".env.test", ["compose.yml", "compose.test.yml"], {
      profiles: ["e2e", "e2e-runner"],
    });
    const problems = prodModeProblems(test);
    for (const expected of [
      "agent.AGENT_TEST_MODE: must be 0 (D47)",
      "agent.OPENAI_BASE_URL: must be empty (real OpenAI only, D38/D47)",
      "web.OPENAI_BASE_URL: must be empty (real OpenAI only, D38/D47)",
      "service llm-mock: test-only, must not run (D47)",
      "service fixtures: test-only, must not run (D47)",
      "service vault-fixtures: test-only, must not run (D47)",
      "service e2e: test-only, must not run (D47)",
      "browser-1.SLOT_EGRESS_ALLOW_CIDRS: must be empty",
    ])
      expect(problems).toContain(expected);
  });
});

describe("compose.yml alone is production-mode clean (D47)", () => {
  it("has no test mode, no mock model URL, no fixture API and no test-only service", () => {
    expect(prodModeProblems(composeConfig(prodEnv, ["compose.yml"]))).toEqual([]);
  });
});
