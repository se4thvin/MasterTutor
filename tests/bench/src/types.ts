import type { ApprovalMode, Budget, ToolProfile, VaultSecretField } from "@mastertutor/contracts";
import { z } from "zod";

export const FAILURE_CLASSES = [
  "perception",
  "action",
  "navigation",
  "auth",
  "policy",
  "budget",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** test: compose.test.yml (fixtures, llm-mock). local: the production-like stack on the Mac (D46, D47). */
export const STACKS = ["test", "local"] as const;
export type StackName = (typeof STACKS)[number];

export const SUITE_IDS = ["fixtures", "zybooks"] as const;
export type SuiteId = (typeof SUITE_IDS)[number];

/** The modes the CLI may override to (nobody sits at every approval in ask mode). bypass needs --acknowledge-bypass. */
export const BENCH_APPROVAL_MODES = [
  "auto_within_allowlist",
  "bypass",
] as const satisfies readonly ApprovalMode[];
export type BenchApprovalMode = (typeof BENCH_APPROVAL_MODES)[number];

export const SectionSpec = z.object({
  reading: z.number().int().min(1).max(5),
  title: z.string().min(1).max(200),
  url: z.url(),
});
export type SectionSpec = z.infer<typeof SectionSpec>;

export type Criterion =
  | { kind: "page_text"; url: string; mustMatch: readonly string[] }
  | {
      kind: "sections_complete";
      sections: readonly SectionSpec[];
      activityPattern: string;
      completedPattern: string;
      requireInteraction: boolean;
    }
  /** Graded on the MAIN run's trace (P10b-5): the agent itself signed in, from a forgotten session. */
  | { kind: "signed_in"; origin: string; signInPath: string }
  /**
   * The grading run finds the readings and their sections itself (run 1, "full task once"). From
   * read_page output only: an element whose name matches `readingPattern` (group 1 = the reading
   * number) starts that reading; links matching `sectionUrlPattern` after it on the same page, or on
   * the reading's own page (its href), are its sections. A listing counts only when it is provably
   * complete: not truncated (or paged through) and no group matching `groupPattern` still collapsed.
   * Each section's text splits into activity blocks: `activityPattern` (group 1 = its id) starts a
   * participation activity, `otherActivityPattern` (challenge activities) ends one and is never
   * counted. A block is complete when it holds `completedPattern`; its questions are `questionPattern`
   * at line starts and its animation steps `stepPattern` (group 1 = number). With
   * `requireInteraction`, the main run must have answered every question and played every step of
   * every activity: its inputs are tied to activities and questions by the recorded enclosing text,
   * and a step is played by a control whose label matches `stepControlPattern`. Patterns are suite
   * config, never product code.
   */
  | {
      kind: "discovered_readings";
      readings: readonly number[];
      readingPattern: string;
      sectionUrlPattern: string;
      groupPattern: string;
      activityPattern: string;
      otherActivityPattern: string;
      completedPattern: string;
      questionPattern: string;
      stepPattern: string;
      stepControlPattern: string;
      requireInteraction: boolean;
    };

export interface VerifySpec {
  task: string;
  budget: Budget;
  /** The only page a grading run may interact with (to sign in); null: no interaction at all (I3). */
  signInUrl: string | null;
}

export interface VaultRequirement {
  alias: string;
  origin: string;
  fields: readonly VaultSecretField[];
}

export interface BenchmarkSpec {
  key: string;
  task: string;
  allowedOrigins: readonly string[];
  budget: Budget;
  toolProfile: ToolProfile;
  approvalMode: ApprovalMode;
  criterion: Criterion;
  /** A read-only browser_use run that collects evidence; null when the main trace is the evidence. */
  verify: VerifySpec | null;
  /** P10b-4: forget any saved site session before every run, and refuse to run if one survives. */
  freshLogin: boolean;
  /** P10b-5: the signed_in criterion, evaluated on the MAIN run's trace, in addition to `criterion`. */
  signInCheck: Extract<Criterion, { kind: "signed_in" }> | null;
  /** D32: the page must already show completion before the main run (needs `verify`). */
  baselineMustPass: boolean;
  /** The vault item this benchmark signs in with (checked by name only, D34). */
  requiredVaultItem: VaultRequirement | null;
  /** Fixture state reset, run inside the test stack before each attempt. */
  reset: readonly string[] | null;
  mockScenarios: { main: string; verify: string | null } | null;
}

export interface SuiteDefinition {
  id: SuiteId;
  stack: StackName;
  benchmarks: readonly BenchmarkSpec[];
}
