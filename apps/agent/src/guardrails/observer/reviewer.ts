import {
  EMPTY_USAGE,
  GUARD_MAX_OUTPUT_TOKENS,
  GUARD_REASONING,
  GUARD_TIMEOUT_MS,
  GuardReview,
  GuardScreen,
  MODELS,
  untrustedText,
  type GuardInput,
  type GuardVerdict,
  type TrajectoryDigest,
  type Usage,
} from "@mastertutor/contracts";
import {
  GUARD_REVIEW_INSTRUCTIONS,
  GUARD_SCREEN_INSTRUCTIONS,
  TRAJECTORY_REVIEW_INSTRUCTIONS,
} from "@mastertutor/observer/guard";
import { ZodError } from "zod";
import { StructuredParseError, type StatelessOpenAI } from "../../llm/openai.ts";
import { addUsage, billedUsageOf, usageDelta } from "../../llm/pricing.ts";

export interface ReviewOutcome {
  verdict: GuardVerdict;
  usage: Usage;
  latencyMs: number;
  failure: "timeout" | "error" | "invalid" | null;
}

export interface GuardReviewer {
  review(input: GuardInput, signal: AbortSignal): Promise<ReviewOutcome>;
  reviewTrajectory(digest: TrajectoryDigest, signal: AbortSignal): Promise<ReviewOutcome>;
}

/** The synchronous gate fails closed (O6): anything but a parsed answer asks a person. */
export const UNAVAILABLE_VERDICT: GuardVerdict = {
  verdict: "escalate",
  category: "guard_unavailable",
  stage: "screen",
  itemKeys: [],
  rationale: "The safety observer could not review this step.",
};

const ALLOW = (stage: GuardVerdict["stage"]): GuardVerdict => ({
  verdict: "allow",
  category: "other",
  stage,
  itemKeys: [],
  rationale: "",
});

function failureOf(error: unknown, signal: AbortSignal): ReviewOutcome["failure"] {
  if (signal.aborted || (error instanceof Error && error.name === "TimeoutError")) return "timeout";
  if (
    error instanceof StructuredParseError ||
    error instanceof ZodError ||
    error instanceof SyntaxError
  )
    return "invalid";
  return "error";
}

/**
 * Two stages through the single stateless wrapper (spec §6.5, the run-title template): a luna
 * screen on every triggered turn; the stronger model only on "review". One deadline for both.
 */
export function createGuardReviewer(
  openai: Pick<StatelessOpenAI, "responses">,
  options: { timeoutMs?: number } = {},
): GuardReviewer {
  async function twoStage(
    payload: string,
    instructions: { screen: string; review: string },
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<ReviewOutcome> {
    const started = performance.now();
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(options.timeoutMs ?? GUARD_TIMEOUT_MS),
    ]);
    let usage = EMPTY_USAGE;
    const done = (
      verdict: GuardVerdict,
      failure: ReviewOutcome["failure"] = null,
    ): ReviewOutcome => ({
      verdict,
      usage,
      latencyMs: Math.round(performance.now() - started),
      failure,
    });
    try {
      const screen = await openai.responses.parse(
        {
          model: MODELS.observerGuardScreen,
          instructions: instructions.screen,
          input: [{ role: "user", content: payload }],
          schema: GuardScreen,
          name: "guard_screen",
          maxOutputTokens: GUARD_MAX_OUTPUT_TOKENS.screen,
          ...(GUARD_REASONING ? { reasoningEffort: GUARD_REASONING } : {}),
        },
        { signal: deadline },
      );
      usage = addUsage(usage, usageDelta(screen.model, { ...screen.tokens, cacheWrite: 0 }, 0));
      if (screen.parsed.decision === "allow") return done(ALLOW("screen"));
      const review = await openai.responses.parse(
        {
          model: MODELS.observerGuardReview,
          instructions: instructions.review,
          input: [{ role: "user", content: payload }],
          schema: GuardReview,
          name: "guard_review",
          maxOutputTokens: GUARD_MAX_OUTPUT_TOKENS.review,
          reasoningEffort: "low",
        },
        { signal: deadline },
      );
      usage = addUsage(usage, usageDelta(review.model, { ...review.tokens, cacheWrite: 0 }, 0));
      return done({
        verdict: review.parsed.verdict,
        category: review.parsed.category,
        stage: "review",
        itemKeys: review.parsed.itemKeys.filter((key) => knownKeys.has(key)),
        rationale: untrustedText(review.parsed.rationale, 300),
      });
    } catch (error) {
      const billed = billedUsageOf(error);
      if (billed) usage = addUsage(usage, billed);
      return done(UNAVAILABLE_VERDICT, failureOf(error, deadline));
    }
  }

  return {
    review(input, signal) {
      return twoStage(
        JSON.stringify(input),
        { screen: GUARD_SCREEN_INSTRUCTIONS, review: GUARD_REVIEW_INSTRUCTIONS },
        new Set(input.items.map((item) => item.key)),
        signal,
      );
    },
    reviewTrajectory(digest, signal) {
      return twoStage(
        JSON.stringify(digest),
        { screen: GUARD_SCREEN_INSTRUCTIONS, review: TRAJECTORY_REVIEW_INSTRUCTIONS },
        new Set(),
        signal,
      );
    },
  };
}
