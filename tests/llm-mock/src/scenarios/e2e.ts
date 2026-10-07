import type { MockTurn, RecordedRequest, Scenario } from "../scenario.ts";

/**
 * Scenario names: the single source for specs (via scenarioGoal) and for the mock. The capture
 * scenario (a filed note) waits for B2/B4/B5 (P3): filing needs its embeddings and structured outputs.
 */
export const E2E_SCENARIO = {
  riskyApprove: "risky-click-approve",
  riskyDeny: "risky-click-deny",
  riskyFlagged: "risky-click-flagged",
  downloadReport: "download-report",
  downloadRefused: "download-report-refused",
  loginPassword: "login-password",
  loginOtpUi: "login-otp-ui",
  loginOtpImap: "login-otp-imap",
  holdPage: "hold-page",
  modelRejected: "model-rejected",
} as const;

/** Vault aliases the E2E specs create through the Vault UI (unique per origin, P7-26). */
export const E2E_ALIAS = { login: "fixture-login", imap: "fixture-imap" } as const;

const readInteractive: MockTurn = {
  outputs: [
    { type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } },
  ],
};
const readText: MockTurn = {
  outputs: [{ type: "function", name: "read_page", args: { mode: "text", sinceHash: null } }],
};
const click = (name: string): MockTurn => ({ outputs: [{ type: "click_named", name }] });
const fill = (alias: string, field: string, name: string): MockTurn => ({
  outputs: [{ type: "fill_named", alias, field, name }],
});
const wait: MockTurn = { outputs: [{ type: "computer", actions: [{ type: "wait" }] }] };
const done: MockTurn = { outputs: [{ type: "turn", status: "done", reason: "Finished" }] };
const modelInput = (request: RecordedRequest) => JSON.stringify(request.body.input ?? "");
/**
 * Finishes only if the page showed `text`. A failed check answers 418, which the agent maps to
 * model_request_rejected, so a wrong fixture state fails the run (P7-23).
 */
const doneSeeing = (text: string): MockTurn => ({
  ...done,
  check: (request) => {
    if (!modelInput(request).includes(text))
      throw new Error(`expected "${text}" in the model input`);
  },
});
const doneNotSeeing = (text: string): MockTurn => ({
  ...done,
  check: (request) => {
    if (modelInput(request).includes(text))
      throw new Error(`"${text}" must not be in the model input`);
  },
});
const MALICIOUS = {
  id: "sc_e2e_1",
  code: "malicious_instructions",
  message: "The page asks you to ignore your instructions.",
};

export const E2E_SCENARIOS: Scenario[] = [
  {
    name: E2E_SCENARIO.riskyApprove,
    turns: [readInteractive, click("Delete account"), readText, doneSeeing("Account deleted")],
  },
  {
    name: E2E_SCENARIO.riskyDeny,
    turns: [readInteractive, click("Delete account"), readText, doneNotSeeing("Account deleted")],
  },
  {
    name: E2E_SCENARIO.riskyFlagged,
    turns: [
      readInteractive,
      { outputs: [{ type: "click_named", name: "Delete account", safetyChecks: [MALICIOUS] }] },
      readText,
      doneSeeing("Account deleted"),
    ],
  },
  {
    // A download the page starts is held for approval; once allowed, the executor asks the model to
    // repeat the action that started it, and that repeat saves it (B1 download gate).
    name: E2E_SCENARIO.downloadReport,
    turns: [readInteractive, click("Quarterly report"), click("Quarterly report"), readText, done],
  },
  {
    // Denied, by a person or by policy: the model does not try again.
    name: E2E_SCENARIO.downloadRefused,
    turns: [readInteractive, click("Quarterly report"), readText, done],
  },
  {
    name: E2E_SCENARIO.loginPassword,
    turns: [
      readInteractive,
      fill(E2E_ALIAS.login, "username", "Email"),
      fill(E2E_ALIAS.login, "password", "Password"),
      click("Sign in"),
      readText,
      doneSeeing("Signed in"),
    ],
  },
  {
    // The first fill finds no code (otp_unavailable) and the run waits for the person; once they
    // have typed it, the model fills again and the vault uses their code (B3).
    name: E2E_SCENARIO.loginOtpUi,
    turns: [
      readInteractive,
      fill(E2E_ALIAS.login, "otp", "Verification code"),
      fill(E2E_ALIAS.login, "otp", "Verification code"),
      click("Verify"),
      readText,
      doneSeeing("Code accepted"),
    ],
  },
  {
    name: E2E_SCENARIO.loginOtpImap,
    turns: [
      readInteractive,
      click("Email me a code"),
      readInteractive,
      fill(E2E_ALIAS.imap, "otp", "Code digit 1"),
      click("Verify"),
      readText,
      doneSeeing("Code accepted"),
    ],
  },
  {
    // Keeps a run acting on the page its goal names, one cheap `wait` per turn (live view, takeover).
    // Unlike Task 2's long-wait (one held turn), it survives a takeover aborting the in-flight call:
    // after hand-back the next request still finds a turn instead of an exhausted cursor (409).
    name: E2E_SCENARIO.holdPage,
    turns: [readInteractive, ...Array.from({ length: 300 }, () => wait), done],
  },
  {
    name: E2E_SCENARIO.modelRejected,
    turns: [{ error: { status: 400, message: "Rejected by the mock" } }],
  },
];
