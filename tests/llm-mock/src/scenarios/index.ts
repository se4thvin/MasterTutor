import type { MockOutput, MockTurn, Scenario } from "../scenario.ts";

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
];

const click = (x: number, y: number) => ({
  type: "computer" as const,
  actions: [{ type: "click", button: "left", x, y }],
});
const fillFocused = (field: "username" | "password") => ({
  type: "function" as const,
  name: "fill_credential",
  args: { alias: "bench-fixture", field, target: "focused" },
});
const turn = (outputs: MockOutput[]): MockTurn => ({ outputs });
const done = turn([{ type: "turn", status: "done", reason: "Finished" }]);

/** Consent, then sign in by coordinates (computer_use). */
const signInByCoordinates: MockTurn[] = [
  turn([click(1100, 60)]),
  turn([click(640, 302)]),
  turn([fillFocused("username")]),
  turn([click(640, 372)]),
  turn([fillFocused("password")]),
  turn([click(640, 442)]),
];
/** Consent, then sign in by read_page refs (browser_use). */
const signInByRefs: MockTurn[] = [
  turn([{ type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } }]),
  turn([{ type: "click_named", name: "Accept" }]),
  turn([{ type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } }]),
  turn([{ type: "fill_named", alias: "bench-fixture", field: "username", name: "Email" }]),
  turn([{ type: "fill_named", alias: "bench-fixture", field: "password", name: "Password" }]),
  turn([{ type: "click_named", name: "Sign in" }]),
];
const activities: MockTurn[] = [
  turn([click(640, 322)]),
  turn([click(280, 222)]),
  turn([click(480, 222)]),
  turn([click(260, 412)]),
  turn([click(400, 412)]),
  turn([click(400, 412)]),
  turn([click(280, 602)]),
  turn([{ type: "computer", actions: [{ type: "type", text: "42" }] }]),
  turn([click(440, 602)]),
];
const readBook: MockTurn[] = [
  turn([{ type: "function", name: "read_page", args: { mode: "text", sinceHash: null } }]),
];

SCENARIOS.push(
  { name: "bench-activities-computer_use", turns: [...signInByCoordinates, ...activities, done] },
  { name: "bench-activities-browser_use", turns: [...signInByRefs, ...activities, done] },
  { name: "bench-verify-computer_use", turns: [...signInByCoordinates, ...readBook, done] },
  { name: "bench-verify-browser_use", turns: [...signInByRefs, ...readBook, done] },
);
