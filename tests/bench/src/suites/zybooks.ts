// The zyBooks acceptance suite (D32; D46 "full task, once"). Prompts and discovery patterns live only
// here under tests/bench/, never in product code (no-site-hacks, Task 21).
import { escapeRegExp } from "../discovery.ts";
import type { BenchmarkSpec, Criterion, SuiteDefinition, VerifySpec } from "../types.ts";
import { CREDENTIAL_HINT as HINT, discoveryInstruction, signInInstruction } from "./prompts.ts";

export const ZYBOOKS_ORIGIN = "https://learn.zybooks.com";
export const ZYBOOKS_BOOK = `${ZYBOOKS_ORIGIN}/zybook/UTDALLASCE2310EE2310AkourFall2026`;
const READINGS = [1, 2, 3, 4, 5] as const;

/**
 * How the grader reads readings and sections back from the grading run's read_page output. Not yet
 * checked against the live book (no contact before run 1): a pattern that does not match leaves the
 * sections unknown or failed in the record, with the reason, never passed. The grading run's raw
 * read_page output stays in run_steps, so the patterns can be corrected from it.
 */
export const DISCOVERY = {
  readingPattern: "^\\s*reading(?:\\s+assignment)?\\s*(\\d+)\\b",
  sectionUrlPattern: `^${escapeRegExp(ZYBOOKS_BOOK)}/chapter/\\d+/section/\\d+(?:[/?#].*)?$`,
  activityPattern: "participation\\s+activity",
  completedPattern: "activity\\s+completed",
} as const;

type Track = "computer_use" | "browser_use";
const VAULT = {
  alias: "zybooks",
  origin: ZYBOOKS_ORIGIN,
  fields: ["username", "password"],
} as const;
const SIGN_IN_URL = `${ZYBOOKS_ORIGIN}/signin`;
const LOGIN = signInInstruction(SIGN_IN_URL, VAULT.alias);
const RULES =
  "Stay on learn.zybooks.com. Do not change account settings, do not open challenge activities, labs or zyLabs, " +
  "and do not submit anything other than participation activities.";
const REDO =
  "These participation activities are already completed on this account; redo every one of them fully anyway: " +
  "answer each question again and run each animation to its end with its own controls.";
const SIGNED_IN = { kind: "signed_in", origin: ZYBOOKS_ORIGIN, signInPath: "/signin" } as const;
const COMMON = {
  approvalMode: "bypass", // D44/D46: the CLI needs --acknowledge-bypass (T21 selectBenchmarks)
  allowedOrigins: [ZYBOOKS_ORIGIN],
  requiredVaultItem: VAULT,
  freshLogin: true,
  reset: null,
  mockScenarios: null,
} as const;

const discovered = (readings: readonly number[]): Criterion => ({
  kind: "discovered_readings",
  readings,
  ...DISCOVERY,
  requireInteraction: true,
});

/**
 * The read-only grading run (I3, N2): it signs in, then finds the readings and their sections itself,
 * moving only through the address bar. It may interact only on the sign-in page.
 */
function grading(readings: readonly number[], budget: VerifySpec["budget"]): VerifySpec {
  return {
    task: `${LOGIN} ${HINT.browser_use} Then: ${discoveryInstruction(ZYBOOKS_BOOK, readings)}`,
    budget,
    signInUrl: SIGN_IN_URL,
  };
}

/** One agent run (D46): signed_in is graded on this run's own trace, so there is no grading run. */
function login(toolProfile: Track): BenchmarkSpec {
  return {
    ...COMMON,
    key: "login",
    toolProfile,
    task: `${LOGIN} ${HINT[toolProfile]} Then open ${ZYBOOKS_BOOK} and finish when the book's table of contents is visible. ${RULES}`,
    budget: { maxSteps: 40, maxUsd: 2, maxActiveMinutes: 10 },
    criterion: SIGNED_IN,
    verify: null,
    signInCheck: null,
    baselineMustPass: false,
  };
}

/**
 * Run 1 (D46, "full task, once"): ONE agent run signs in fresh and redoes readings 1-5, finding them
 * and their sections itself. The grading run discovers them too and grades each section. No baseline
 * run: the redo is required by the main run's own interactions on every section.
 */
function full(toolProfile: Track): BenchmarkSpec {
  return {
    ...COMMON,
    key: "full",
    toolProfile,
    task:
      `${LOGIN} ${HINT[toolProfile]} Then open ${ZYBOOKS_BOOK}, find reading assignments 1 to 5 and every section ` +
      `in each of them yourself, and work through every participation activity in those sections. ${REDO} ` +
      `${RULES} Finish when you have redone every participation activity in reading assignments 1 to 5.`,
    budget: { maxSteps: 3_000, maxUsd: 50, maxActiveMinutes: 600 },
    criterion: discovered(READINGS),
    verify: grading(READINGS, { maxSteps: 400, maxUsd: 10, maxActiveMinutes: 90 }),
    signInCheck: SIGNED_IN,
    baselineMustPass: false,
  };
}

/** One reading at a time, for reviewed continuations (T25B), with a D32 baseline grading run first. */
function reading(n: number, toolProfile: Track): BenchmarkSpec {
  return {
    ...COMMON,
    key: `reading-${n}`,
    toolProfile,
    task:
      `${LOGIN} ${HINT[toolProfile]} Then open ${ZYBOOKS_BOOK}, find reading assignment ${n} and every section in it ` +
      `yourself, and work through every participation activity in those sections. ${REDO} ${RULES} ` +
      `Finish when you have redone every participation activity in reading assignment ${n}.`,
    budget: { maxSteps: 900, maxUsd: 50, maxActiveMinutes: 180 },
    criterion: discovered([n]),
    verify: grading([n], { maxSteps: 150, maxUsd: 4, maxActiveMinutes: 30 }),
    signInCheck: SIGNED_IN,
    baselineMustPass: true,
  };
}

export function zybooksSuite(): SuiteDefinition {
  const tracks = ["browser_use", "computer_use"] as const;
  return {
    id: "zybooks",
    stack: "local",
    benchmarks: [
      ...tracks.map(full),
      ...tracks.map(login),
      ...READINGS.flatMap((n) => tracks.map((t) => reading(n, t))),
    ],
  };
}
