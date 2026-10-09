import { z } from "zod";
import { Budget, Usage, Plan, Origin } from "@mastertutor/contracts";
import { budgetExceeded } from "../guardrails/budget.ts";
import { allowedOriginsText, approvalModeText } from "../llm/instructions.ts";
import type { RunHooks } from "./hooks.ts";
import type { RunControl, RunSnapshot } from "./run-state.ts";
import type { TranscriptEntry } from "./transcript.ts";

/** Executor-owned bookkeeping, stored beside transcript items, never supplied by the model. */
export const TurnContextCheckpoint = z.object({
  facts: z.record(z.string(), z.string()),
  redirectedOrigins: z.array(Origin).default([]),
});
export type TurnContextCheckpoint = z.infer<typeof TurnContextCheckpoint>;

/** One path for run facts (D56). Only the vault can describe credentials; no values enter here. */
export class TurnContext {
  #announced: Record<string, string> = {};
  #facts: Record<string, string> = {};
  #signIn: { origin: string; usable: boolean } | null = null;
  #redirectedOrigins = new Set<string>();

  constructor(history: readonly TranscriptEntry[]) {
    for (const entry of history) {
      if (!entry.turnContext) continue;
      this.#announced = entry.turnContext.facts;
      this.#redirectedOrigins = new Set(entry.turnContext.redirectedOrigins);
    }
  }

  async refresh(
    run: RunSnapshot,
    origin: string | null,
    control: Pick<RunControl, "controller" | "waitReason">,
    hooks: Pick<RunHooks, "promptContext" | "hasSignIn">,
  ): Promise<void> {
    // Vault metadata is DB-only. Both hooks share one batched metadata read for this snapshot.
    const [contexts, usable] = await Promise.all([
      hooks.promptContext(run, origin),
      origin === null ? false : hooks.hasSignIn(run, origin),
    ]);
    const facts: Record<string, string> = {
      origins: allowedOriginsText(run.allowedOrigins),
      mode: approvalModeText(run.approvalMode),
      budget: `Budget: ${JSON.stringify({ limits: Budget.parse(run.budget), usage: Usage.parse(run.usage), exceeded: budgetExceeded(run.usage, run.budget) })}`,
      plan: `Plan: ${JSON.stringify(run.plan === null ? null : Plan.parse(run.plan))}`,
      control: `Control: ${control.controller}; wait: ${control.waitReason ?? "none"}`,
      currentOrigin: `Current origin: ${origin ?? "none"}; saved sign-in usable: ${usable}`,
    };
    // Keep the vault's existing header and field lines verbatim. Each alias changes separately.
    for (const [index, context] of contexts.entries()) {
      const [header, ...lines] = context.split("\n");
      facts[`context/${index}`] = header!;
      for (const line of lines) {
        const alias = /^- ([a-z0-9_-]+) \(/.exec(line)?.[1];
        facts[alias ? `signIn/${alias}` : `context/${index}/${line}`] = line;
      }
    }
    this.#facts = facts;
    this.#signIn = origin === null ? null : { origin, usable };
  }

  messages(full = false): string[] {
    const changed = Object.entries(this.#facts)
      .filter(([key, value]) => full || this.#announced[key] !== value)
      .map(([, value]) => value);
    const removed = Object.keys(this.#announced).filter((key) => !(key in this.#facts));
    if (!full && removed.some((key) => key.startsWith("signIn/")))
      changed.push(
        `Saved sign-ins no longer available: ${removed
          .filter((key) => key.startsWith("signIn/"))
          .map((key) => key.slice(7))
          .join(", ")}`,
      );
    return changed.length === 0 ? [] : [`Executor: run context\n${changed.join("\n\n")}`];
  }

  /** A saved login is system-held data, not something to ask a person for (D56). */
  redirectTakeover(origin: string | null): string | null {
    if (
      origin === null ||
      this.#signIn?.origin !== origin ||
      !this.#signIn.usable ||
      this.#redirectedOrigins.has(origin)
    )
      return null;
    const entry = Object.entries(this.#facts).find(
      ([key, line]) => key.startsWith("signIn/") && line.includes(` (${origin}):`),
    );
    if (!entry) return null;
    const alias = entry[0].slice("signIn/".length);
    this.#redirectedOrigins.add(origin);
    return `Executor: a saved sign-in is available for ${origin}. Use fill_credential with alias ${alias} and the field/target described in your instructions (use_passkey for a passkey). Try the saved sign-in before asking the user to sign in manually.`;
  }

  checkpoint(): TurnContextCheckpoint {
    return { facts: { ...this.#facts }, redirectedOrigins: [...this.#redirectedOrigins] };
  }

  /** Advance only after the input was committed, so an aborted turn does not lose a delta. */
  accept(): void {
    this.#announced = { ...this.#facts };
  }
}
