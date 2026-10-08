import {
  ApprovalRequest,
  DEFAULT_BUDGET,
  MODELS,
  RunDetail,
  RunEventRecord,
  RunStepView,
  RunSummary,
  type RunEvent,
} from "@mastertutor/contracts";
import { ids } from "./ids.ts";

/**
 * A recorded run (spec §16: F phases use recorded RunEvents). It is fixture-mode run 1 and the
 * unit tests' source. Phase 7 may swap in a real recording of the same shape; every consumer
 * parses it through the contract schemas.
 */
export const RECORDED_RUN_ID = ids.run(1);
export const RECORDED_APPROVAL_ID = ids.approval(1);
/** The seeded completed run (fixture run 2). */
export const OTHER_RUN_ID = ids.run(2);

const COURSE = "https://learn.example.edu/course/week-2";
const LECTURE = `${COURSE}/lecture-3`;
const LOGIN = "https://learn.example.edu/login";
const t = (time: string) => `2026-10-05T${time}.000Z`;
/** The real key shape: runs/<id>/steps/<seq>-<nonce>.png (objectKeys.stepScreenshot). */
const shot = (seq: number) => `runs/${RECORDED_RUN_ID}/steps/${seq}-r${seq}k7.png`;

const DETAIL = {
  id: RECORDED_RUN_ID,
  goal: `Week 2 of the course: every lecture, figure and table. Skip the quizzes.\n\nSources:\n- ${COURSE}`,
  status: "running",
  waitReason: null,
  controller: "agent",
  approvalMode: "ask",
  toolProfile: "browser_use",
  model: MODELS.agentPrimary,
  noteId: null,
  usage: {
    steps: 9,
    inputTokens: 182_000,
    cachedInputTokens: 120_000,
    outputTokens: 6_400,
    usd: 0.41,
    activeMs: 372_000,
  },
  budget: DEFAULT_BUDGET,
  createdAt: t("17:04:00"),
  finishedAt: null,
  plan: {
    items: [
      { text: "Sign in", done: true },
      { text: "Capture week 2", done: false },
    ],
  },
  allowedOrigins: ["https://learn.example.edu"],
  currentUrl: LECTURE,
  slotName: "browser-1",
  targetFolderId: null,
  pendingApprovals: [],
  heldDownloads: [],
  downloads: [],
  lastEventId: "12",
};

const click = (summary: string, x: number, y: number) => ({
  tool: "computer",
  summary,
  point: { x, y },
  pointer: "click",
});

const STEPS = [
  {
    seq: 1,
    phase: "observe",
    state: "done",
    caption: "Looking at the course home",
    url: COURSE,
    screenshotKey: shot(1),
    action: null,
    createdAt: t("17:04:02"),
  },
  {
    seq: 2,
    phase: "decide",
    state: "done",
    caption: "Planning the sign-in",
    url: null,
    screenshotKey: null,
    action: null,
    createdAt: t("17:04:05"),
  },
  {
    seq: 3,
    phase: "act",
    state: "done",
    caption: "Opening the sign-in page",
    url: LOGIN,
    screenshotKey: null,
    action: click("Clicked “Log in”", 1120, 36),
    createdAt: t("17:04:07"),
  },
  {
    seq: 4,
    phase: "act",
    state: "done",
    caption: "Filling ada-learn securely",
    url: LOGIN,
    screenshotKey: null,
    action: {
      tool: "fill_credential",
      summary: "Filled the password for ada-learn",
      point: { x: 640, y: 380 },
    },
    createdAt: t("17:04:11"),
  },
  // Recorded before the agent set `pointer` (A1): the UI must say "Act" and never pulse (W1).
  {
    seq: 5,
    phase: "act",
    state: "done",
    caption: "Signing in",
    url: LOGIN,
    screenshotKey: null,
    action: { tool: "computer", summary: "Clicked “Sign in”", point: { x: 640, y: 452 } },
    createdAt: t("17:04:14"),
  },
  {
    seq: 6,
    phase: "observe",
    state: "done",
    caption: "Reading lecture 3",
    url: LECTURE,
    screenshotKey: shot(6),
    action: null,
    createdAt: t("17:04:41"),
  },
  {
    seq: 7,
    phase: "act",
    state: "done",
    caption: "Capturing the transcript",
    url: LECTURE,
    screenshotKey: null,
    action: { tool: "capture", summary: "Transcript: 1,842 words, verified", point: null },
    createdAt: t("17:05:58"),
  },
  {
    seq: 8,
    phase: "act",
    state: "done",
    caption: "Capturing the convergence figure",
    url: LECTURE,
    screenshotKey: null,
    action: { tool: "capture", summary: "Figure: cost vs. iterations", point: { x: 520, y: 300 } },
    createdAt: t("17:07:20"),
  },
  {
    seq: 9,
    phase: "decide",
    state: "done",
    caption: "Choosing what to capture next",
    url: null,
    screenshotKey: null,
    action: null,
    createdAt: t("17:09:47"),
  },
];

const honor = click("Clicked the Honor Code checkbox", 980, 560);
const ev = (id: number, at: string, event: unknown) => ({
  id: String(id),
  runId: RECORDED_RUN_ID,
  at: t(at),
  event,
});

const EVENTS = [
  ev(13, "17:10:01", {
    type: "step",
    seq: 10,
    phase: "act",
    state: "started",
    caption: "Ticking the Honor Code box",
    url: LECTURE,
    screenshotKey: null,
    action: honor,
  }),
  ev(14, "17:10:02", {
    type: "step",
    seq: 10,
    phase: "act",
    state: "done",
    caption: "Ticking the Honor Code box",
    url: LECTURE,
    screenshotKey: null,
    action: honor,
  }),
  ev(15, "17:10:02", {
    type: "budget",
    usage: {
      steps: 10,
      inputTokens: 190_000,
      cachedInputTokens: 124_000,
      outputTokens: 6_700,
      usd: 0.44,
      activeMs: 380_000,
    },
    budget: DEFAULT_BUDGET,
  }),
  ev(16, "17:10:03", {
    type: "step",
    seq: 11,
    phase: "decide",
    state: "started",
    caption: "Deciding whether to start the quiz",
    url: null,
    screenshotKey: null,
    action: null,
  }),
  ev(17, "17:10:06", {
    type: "step",
    seq: 11,
    phase: "decide",
    state: "done",
    caption: "Deciding whether to start the quiz",
    url: null,
    screenshotKey: null,
    action: null,
  }),
  ev(18, "17:10:07", {
    type: "step",
    seq: 12,
    phase: "approve",
    state: "started",
    caption: "Waiting for your approval to start the quiz",
    url: LECTURE,
    screenshotKey: null,
    action: null,
  }),
  ev(19, "17:10:08", {
    type: "approval_requested",
    approvalId: RECORDED_APPROVAL_ID,
    request: {
      kind: "risky_click",
      action: { type: "click", x: 1000, y: 610, button: "left" },
      label: "Start quiz",
      url: LECTURE,
      screenshotKey: null,
      context: "Week 2 quiz. Attempt 1 of 1",
    },
  }),
  ev(20, "17:10:09", {
    type: "status",
    status: "waiting",
    waitReason: "approval",
    reason: "Starting the quiz counts as an attempt.",
  }),
];

export function recordedDetail(over: Partial<RunDetail> = {}): RunDetail {
  return RunDetail.parse({ ...DETAIL, ...over });
}

export function recordedSummary(): RunSummary {
  return RunSummary.parse(DETAIL);
}

export function recordedSteps(): RunStepView[] {
  return RunStepView.array().parse(STEPS);
}

export function recordedEvents(): RunEventRecord[] {
  return RunEventRecord.array().parse(EVENTS);
}

let nextId = 100;

/** A follow-on event with a fresh id above the recorded stream. */
export function rec(event: RunEvent, runId: string = RECORDED_RUN_ID): RunEventRecord {
  const id = nextId++;
  return RunEventRecord.parse({
    id: String(id),
    runId,
    at: new Date(Date.UTC(2026, 9, 5, 17, 20, 0) + id * 1000).toISOString(),
    event,
  });
}

/**
 * A first-use sign-in whose form posts to another site (B3: policy cannot clear it). The run
 * view's approval card must name that destination (I1). Task 14 adds it to the recorded stream.
 */
export function offSiteSignInRequest(): Extract<ApprovalRequest, { kind: "credential_first_use" }> {
  const request = ApprovalRequest.parse({
    kind: "credential_first_use",
    alias: "ada-learn",
    origin: "https://learn.example.edu",
    postsTo: "https://evil.example/collect",
  });
  if (request.kind !== "credential_first_use") throw new Error("unreachable");
  return request;
}
