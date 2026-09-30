import type { Scenario } from "../scenario.ts";
import { E2E_SCENARIOS } from "./e2e.ts";

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
  {
    // A run that stays `running`: the model "thinks" for 120 s (under the client's 180 s timeout),
    // then finishes. Cancel, live-view and takeover specs act on it meanwhile. Tag the goal with
    // scenarioGoal("long-wait", …) so each run has its own cursor.
    name: "long-wait",
    turns: [
      {
        hold: () => new Promise((resolve) => setTimeout(resolve, 120_000)),
        outputs: [{ type: "turn", status: "done", reason: "Finished waiting" }],
      },
    ],
  },
  ...E2E_SCENARIOS,
];
