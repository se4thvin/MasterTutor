import type { Scenario } from "../scenario.ts";

/** Scenarios served by the standalone mock (Compose E2E, Phase 7). Agent-behaviour tests pass their own. */
export const SCENARIOS: Scenario[] = [
  {
    // Wire shapes the client must tolerate: a reasoning item, then a single-`action` computer_call.
    name: "wire-shapes",
    turns: [
      {
        outputs: [
          { type: "reasoning", text: "Looking at the page." },
          { type: "computer_single", action: { type: "screenshot" } },
        ],
      },
      { outputs: [{ type: "turn", status: "done", reason: "Finished" }] },
    ],
  },
];
