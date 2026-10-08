// The zyBooks acceptance suite (D32). Prompts, patterns and section lists live only under tests/bench/
// and orchestration/benchmarks/zybooks/, never in product code (no-site-hacks, Task 21).
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  SectionSpec,
  type BenchmarkSpec,
  type SuiteDefinition,
  type VerifySpec,
} from "../types.ts";
import { CREDENTIAL_HINT as HINT, signInInstruction } from "./prompts.ts";

export const ZYBOOKS_ORIGIN = "https://learn.zybooks.com";
export const ZYBOOKS_BOOK = `${ZYBOOKS_ORIGIN}/zybook/UTDALLASCE2310EE2310AkourFall2026`;
export const CALIBRATION_FILE = "orchestration/benchmarks/zybooks/sections.json";

export const ZybooksCalibration = z
  .object({
    book: z.literal(ZYBOOKS_BOOK),
    patterns: z.object({ activity: z.string().min(3), completed: z.string().min(3) }),
    sections: z.array(SectionSpec).min(5).max(200),
    calibratedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    surveyRunId: z.uuid(),
  })
  .refine((c) => c.sections.every((s) => s.url.startsWith(`${ZYBOOKS_BOOK}/`)), {
    message: "every section must be inside the book",
  })
  .refine((c) => [1, 2, 3, 4, 5].every((r) => c.sections.some((s) => s.reading === r)), {
    message: "readings 1-5 all need sections",
  });
export type ZybooksCalibration = z.infer<typeof ZybooksCalibration>;

export function loadCalibration(): ZybooksCalibration | null {
  return existsSync(CALIBRATION_FILE)
    ? ZybooksCalibration.parse(JSON.parse(readFileSync(CALIBRATION_FILE, "utf8")))
    : null;
}

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
const SIGNED_IN = { kind: "signed_in", origin: ZYBOOKS_ORIGIN, signInPath: "/signin" } as const;
const COMMON = {
  approvalMode: "bypass", // D44/D46: the CLI needs --acknowledge-bypass (T21 selectBenchmarks)
  allowedOrigins: [ZYBOOKS_ORIGIN],
  requiredVaultItem: VAULT,
  freshLogin: true,
  reset: null,
  mockScenarios: null,
} as const;

/**
 * A read-only grading run (I3, N2): it may interact only on the sign-in page, and reaches each section
 * through the address bar (CTRL+L, the URL, ENTER), which the grader counts as navigation.
 */
function verify(urls: readonly string[], budget: VerifySpec["budget"]): VerifySpec {
  return {
    task:
      `${LOGIN} ${HINT.browser_use} Then, for each of these pages in order, open it by typing its URL in the address bar ` +
      '(CTRL+L, the URL, ENTER), scroll to the bottom once, and call read_page with mode "text" and then with mode ' +
      `"interactive": ${urls.join(" ")} Do not click, type or press keys on these pages, and do not click links or ` +
      "anything inside an activity. Then finish.",
    budget,
    signInUrl: SIGN_IN_URL,
  };
}

/** One agent run (D46): signed_in is graded on this run's own trace, so there is no verify run. */
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

function reading(n: number, toolProfile: Track, c: ZybooksCalibration): BenchmarkSpec {
  const sections = c.sections.filter((s) => s.reading === n);
  return {
    ...COMMON,
    key: `reading-${n}`,
    toolProfile,
    task:
      `${LOGIN} ${HINT[toolProfile]} Open ${ZYBOOKS_BOOK}. Reading assignment ${n} consists of these sections: ` +
      `${sections.map((s) => `${s.title} (${s.url})`).join("; ")}. These activities are already completed on this account; ` +
      "redo every participation activity fully anyway: answer each question again and run each animation to its end with its own controls. " +
      `${RULES} Finish when you have redone every participation activity in these sections.`,
    budget: { maxSteps: 900, maxUsd: 50, maxActiveMinutes: 180 },
    criterion: {
      kind: "sections_complete",
      sections,
      activityPattern: c.patterns.activity,
      completedPattern: c.patterns.completed,
      requireInteraction: true,
    },
    verify: verify(
      sections.map((s) => s.url),
      { maxSteps: 40 + sections.length * 12, maxUsd: 4, maxActiveMinutes: 30 },
    ),
    signInCheck: SIGNED_IN,
    baselineMustPass: true,
  };
}

/** Calibration run (P10b-17/20): one section per reading, both read_page modes, nothing completed. */
export function surveySpec(): BenchmarkSpec {
  return {
    ...login("browser_use"),
    key: "survey",
    task:
      `${LOGIN} ${HINT.browser_use} Open ${ZYBOOKS_BOOK} and call read_page with mode "text", then "interactive". ` +
      'Open the book\'s assignments list and call read_page with mode "text" and "interactive" there. ' +
      'For each of reading assignments 1 to 5: open its section list and call read_page with mode "interactive" once, ' +
      'then open the first section of that reading and call read_page with mode "text" and then "interactive". ' +
      `Do not complete or click inside any activity. ${RULES} Then finish.`,
    budget: { maxSteps: 120, maxUsd: 6, maxActiveMinutes: 30 },
  };
}

export function surveySuite(): SuiteDefinition {
  return { id: "zybooks", stack: "local", benchmarks: [surveySpec()] };
}

export function zybooksSuite(
  calibration: ZybooksCalibration | null = loadCalibration(),
): SuiteDefinition {
  const tracks = ["browser_use", "computer_use"] as const;
  const benchmarks: BenchmarkSpec[] = tracks.map(login);
  if (calibration)
    for (const n of [1, 2, 3, 4, 5])
      for (const t of tracks) benchmarks.push(reading(n, t, calibration));
  return { id: "zybooks", stack: "local", benchmarks };
}
