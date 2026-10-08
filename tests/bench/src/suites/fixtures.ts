import { parseEnv } from "node:util";
import type { BenchApi } from "../app-client.ts";
import type { BenchmarkSpec, SuiteDefinition } from "../types.ts";
import { escapeRegExp } from "../discovery.ts";
import { CREDENTIAL_HINT as HINT, discoveryInstruction, signInInstruction } from "./prompts.ts";

/** The `bench-fixtures` service on T1's `fixtures` network (X2). Reachable only on the test stacks. */
export const BENCH_ORIGIN = "http://bench.fixtures.test:8080";
const ALIAS = "bench-fixture";
const LOGIN = signInInstruction(`${BENCH_ORIGIN}/signin`, ALIAS);

function spec(toolProfile: "computer_use" | "browser_use"): BenchmarkSpec {
  return {
    key: "activities",
    toolProfile,
    approvalMode: "auto_within_allowlist",
    task:
      `${LOGIN} ${HINT[toolProfile]} Open the book, open "Section 1.1 activities", and complete all three ` +
      "participation activities. Finish when the book page shows 3 of 3 activities completed.",
    allowedOrigins: [BENCH_ORIGIN],
    budget: { maxSteps: 80, maxUsd: 3, maxActiveMinutes: 20 },
    criterion: {
      kind: "page_text",
      url: `${BENCH_ORIGIN}/book`,
      mustMatch: ["Participation: 3 of 3 activities completed \\(100%\\)"],
    },
    verify: {
      task: `${LOGIN} ${HINT[toolProfile]} Then open ${BENCH_ORIGIN}/book and call read_page with mode "text" once. Do not click anything else. Then finish.`,
      budget: { maxSteps: 20, maxUsd: 1, maxActiveMinutes: 5 },
      signInUrl: `${BENCH_ORIGIN}/signin`,
    },
    baselineMustPass: false,
    freshLogin: false,
    signInCheck: null,
    requiredVaultItem: { alias: ALIAS, origin: BENCH_ORIGIN, fields: ["username", "password"] },
    reset: [
      "exec",
      "-T",
      "bench-fixtures",
      "node",
      "-e",
      "fetch('http://127.0.0.1:8080/__reset',{method:'POST'}).then((r)=>process.exit(r.ok?0:1))",
    ],
    mockScenarios: {
      main: `bench-activities-${toolProfile}`,
      verify: `bench-verify-${toolProfile}`,
    },
  };
}

const LIBRARY = `${BENCH_ORIGIN}/library`;
const READINGS = [1, 2, 3] as const;

/**
 * Run 1's shape on the fixture site: the grading run discovers readings 1-3 of the library and their
 * sections itself (mixed completion, an empty section and an unread one), read-only.
 */
function readings(): BenchmarkSpec {
  return {
    key: "readings",
    toolProfile: "browser_use",
    approvalMode: "auto_within_allowlist",
    task:
      `${LOGIN} ${HINT.browser_use} Open ${LIBRARY}. Find reading assignments 1 to 3 and complete every ` +
      "participation activity in their sections. Finish when they are all complete.",
    allowedOrigins: [BENCH_ORIGIN],
    budget: { maxSteps: 40, maxUsd: 0.5, maxActiveMinutes: 10 },
    criterion: {
      kind: "discovered_readings",
      readings: READINGS,
      readingPattern: "^Reading (\\d+)$",
      sectionUrlPattern: `^${escapeRegExp(LIBRARY)}/chapter/\\d+/section/\\d+$`,
      activityPattern: "PARTICIPATION ACTIVITY",
      completedPattern: "Activity completed",
      requireInteraction: false,
    },
    verify: {
      task: `${LOGIN} ${HINT.browser_use} Then: ${discoveryInstruction(LIBRARY, READINGS)}`,
      budget: { maxSteps: 60, maxUsd: 1, maxActiveMinutes: 10 },
      signInUrl: `${BENCH_ORIGIN}/signin`,
    },
    baselineMustPass: false,
    freshLogin: false,
    signInCheck: null,
    requiredVaultItem: { alias: ALIAS, origin: BENCH_ORIGIN, fields: ["username", "password"] },
    reset: null,
    mockScenarios: {
      main: "bench-readings-browser_use",
      verify: "bench-readings-verify-browser_use",
    },
  };
}

export function fixturesSuite(): SuiteDefinition {
  return {
    id: "fixtures",
    stack: "test",
    benchmarks: [spec("browser_use"), spec("computer_use"), readings()],
  };
}

/** Test stacks only: the dummy fixture login comes from the committed `.env.test` (not a secret). */
export async function ensureFixtureVaultItem(
  api: BenchApi,
  envTestText: string,
): Promise<"created" | "present"> {
  const env = parseEnv(envTestText);
  const user = env.BENCH_FIXTURE_USER;
  const password = env.BENCH_FIXTURE_PASSWORD;
  if (!user || !password)
    throw new Error(".env.test must define BENCH_FIXTURE_USER and BENCH_FIXTURE_PASSWORD");
  if ((await api.vault.list({})).items.some((i) => i.alias === ALIAS)) return "present";
  await api.vault.create({
    alias: ALIAS,
    origin: BENCH_ORIGIN,
    label: "Benchmark fixture (dummy)",
    secrets: { username: user, password },
    imap: null,
  });
  return "created";
}
