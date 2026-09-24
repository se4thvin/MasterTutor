import { POLICY_DECIDER } from "@mastertutor/contracts";
import { approvals, browserSlots } from "@mastertutor/db";
import { eq } from "drizzle-orm";
import { chromium, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FORBIDDEN_RESPONSE_FIELDS } from "../../apps/agent/src/llm/openai.ts";
import { imageWidth, regionIsBlack, type PixelBox } from "../../apps/agent/src/testing/png.ts";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import type { MockTurn, RecordedRequest, Scenario } from "../llm-mock/src/scenario.ts";
import { OTHER, SITE, SLOT_CDP } from "./constants.ts";
import {
  createRun,
  decideApproval,
  events,
  handBack,
  killSwitch,
  slotIdle,
  slotOf,
  startBehaviourAgent,
  steps,
  takeControl,
  waitForRun,
  type BehaviourAgent,
} from "./harness.ts";

/** Spec targets: takeover ≤ 300 ms, kill ≤ 1 s. CI asserts a generous bound on DB timestamps (ruling). */
const CI_BOUND_MS = 2_000;

let agent: BehaviourAgent;
let checked = 0;
beforeAll(async () => {
  agent = await startBehaviourAgent();
});
afterAll(async () => {
  await agent?.stop();
});
// Every model call is paired and every request is stateless and anonymous (openai-data-policy.md).
afterEach(() => {
  expect(agent.mock.failures.splice(0)).toEqual([]);
  for (const request of agent.mock.requests.slice(checked)) {
    expect(request.path).toBe("/v1/responses");
    expect(request.body.store).toBe(false);
    for (const field of FORBIDDEN_RESPONSE_FIELDS) expect(request.body).not.toHaveProperty(field);
  }
  checked = agent.mock.requests.length;
});

const scenario = (name: string, turns: MockTurn[]): string => {
  agent.mock.setScenarios([{ name, turns } satisfies Scenario]);
  return name;
};
const readInteractive: MockTurn = {
  outputs: [
    {
      type: "function",
      name: "read_page",
      args: { mode: "interactive", sinceHash: null, offset: null },
    },
  ],
};
const readText: MockTurn = {
  outputs: [
    { type: "function", name: "read_page", args: { mode: "text", sinceHash: null, offset: null } },
  ],
};
const clickNamed = (name: string): MockTurn => ({ outputs: [{ type: "click_named", name }] });
const typeText = (text: string): MockTurn => ({
  outputs: [{ type: "computer", actions: [{ type: "type", text }] }],
});
const done: MockTurn = { outputs: [{ type: "turn", status: "done", reason: "Finished" }] };
const expectIn = (text: string) => (request: RecordedRequest) => {
  if (!JSON.stringify(request.body.input).includes(text))
    throw new Error(`expected "${text}" in the model input`);
};
const doneExpecting = (text: string): MockTurn => ({ ...done, check: expectIn(text) });
/** A promise the test resolves, to hold the mock's answer until the test has looked. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, wait: () => opened };
}
/** run_steps.action is a StepAction; typing acts are summarised as `type "…"`. */
const isTyping = (action: unknown) =>
  ((action as { summary?: string } | null)?.summary ?? "").startsWith("type");
const typingStarted = (runId: string) =>
  waitFor(
    async () =>
      (await steps(agent, runId)).some(
        (s) => s.phase === "act" && s.state === "started" && isTyping(s.action),
      ),
    { label: "typing", timeoutMs: 60_000, intervalMs: 10 },
  );
const typeActs = async (runId: string) =>
  (await steps(agent, runId)).filter((s) => s.phase === "act" && isTyping(s.action));
async function withSlotPage<T>(
  runId: string,
  urlPart: string,
  read: (page: Page) => Promise<T>,
): Promise<T> {
  const slot = await slotOf(agent, runId);
  const browser = await chromium.connectOverCDP(SLOT_CDP[slot!] ?? "");
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes(urlPart));
    if (!page) throw new Error(`no ${urlPart} page in ${slot}`);
    return await read(page);
  } finally {
    await browser.close();
  }
}

describe("agent behaviour on real slots (spec §12)", () => {
  it("completes a participation-style activity with DOM-assisted clicks", async () => {
    const name = scenario("quiz", [
      readInteractive,
      clickNamed("4"),
      readInteractive,
      clickNamed("Check"),
      readText,
      doneExpecting("Correct"),
    ]);
    const runId = await createRun(
      agent,
      `[scenario:${name}] Complete the activity at ${SITE}/quiz.html`,
    );
    await waitForRun(agent, runId, (run) => run.status === "completed", "quiz completed");
    const shots = (await steps(agent, runId)).filter((step) => step.phase === "observe");
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((step) => step.screenshotKey !== null)).toBe(true);
  });

  it("waits for approval of a risky click, sleeps, and acts after the user approves", async () => {
    const name = scenario("approve", [
      readInteractive,
      clickNamed("Delete account"),
      readText,
      doneExpecting("Account deleted"),
    ]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/injection.html`);
    await waitForRun(
      agent,
      runId,
      (run) => run.status === "sleeping" && run.slotName === null,
      "asleep awaiting approval",
    );
    await decideApproval(agent, runId, "approved");
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed after approval");
  });

  it("auto mode never leaves the allowlist (prompt injection)", async () => {
    const name = scenario("inject", [
      readInteractive,
      clickNamed("the verification page"),
      doneExpecting("not one of this run's allowed origins"),
    ]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/injection.html`, {
      approvalMode: "auto_within_allowlist",
    });
    const run = await waitForRun(agent, runId, (r) => r.status === "completed", "completed");
    expect(run.currentUrl?.startsWith(OTHER)).toBe(false);
    // The blocked navigation was decided by policy, recorded, and denied.
    const decisions = await agent.owner.db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    expect(decisions.map((a) => [a.kind, a.status, a.decidedBy])).toEqual([
      ["new_origin", "denied", POLICY_DECIDER],
    ]);
    expect(decisions[0]!.request).toMatchObject({ origin: OTHER });
  });

  it("restores after a crash without retrying the started action", async () => {
    const name = scenario("crash", [
      readInteractive,
      clickNamed("Notes"),
      typeText("x".repeat(4_000)),
      doneExpecting("Not retried"),
    ]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    await agent.crash();
    await agent.restart();
    await waitForRun(
      agent,
      runId,
      (run) => run.status === "completed",
      "completed after restore",
      90_000,
    );
    // A true crash writes nothing more: the act stays "started" with no abort row, and the restored
    // worker answers it "Not retried" instead of typing again.
    const acts = await typeActs(runId);
    expect(acts.map((s) => s.state)).toEqual(["started"]);
  });

  it("resets the slot after a run: no cookies survive (profile wiped)", async () => {
    // The run's own read_page shows the cookie it set, so an empty jar afterwards proves a wipe.
    const name = scenario("storage", [readText, doneExpecting("mt_session=abc")]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/storage.html?set=1`);
    await waitForRun(agent, runId, (r) => r.status === "completed", "completed");
    const slot = await slotOf(agent, runId);
    expect(slot).toBeTruthy();
    await waitFor(() => slotIdle(agent, slot!), { label: "slot recycled", timeoutMs: 60_000 });
    await waitForRun(agent, runId, (r) => r.slotName === null, "slot released");
    const browser = await chromium.connectOverCDP(SLOT_CDP[slot!] ?? "");
    try {
      const context = browser.contexts()[0]!;
      expect(await context.cookies()).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("takeover during an act aborts it quickly, makes no model calls, and hand back re-observes without retrying it", async () => {
    const name = scenario("takeover", [
      readInteractive,
      clickNamed("Notes"),
      typeText("y".repeat(5_000)),
      doneExpecting("Interrupted: the user took control"),
    ]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/interactive.html`);
    await typingStarted(runId);
    const before = agent.mock.requestsFor(name).length;
    const takenAt = await takeControl(agent, runId);
    const aborted = await waitFor(
      async () => (await steps(agent, runId)).find((s) => s.state === "aborted"),
      { label: "aborted", intervalMs: 10 },
    );
    const latencyMs = aborted.updatedAt.getTime() - takenAt.getTime();
    console.info(`takeover → act aborted: ${latencyMs} ms (spec target 300 ms)`);
    expect(latencyMs).toBeLessThan(CI_BOUND_MS);
    // While the user holds control nothing is typed and the model is not called.
    const typed = () =>
      withSlotPage(runId, "interactive", (page) =>
        page.evaluate(() => (document.getElementById("notes") as HTMLTextAreaElement).value.length),
      );
    const typedAtAbort = await typed();
    expect(typedAtAbort).toBeLessThan(5_000);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await typed()).toBe(typedAtAbort);
    expect(agent.mock.requestsFor(name)).toHaveLength(before);
    expect(
      (await events(agent, runId)).some((e) => e.type === "control" && e.holder === "user"),
    ).toBe(true);
    await handBack(agent, runId);
    await waitForRun(
      agent,
      runId,
      (run) => run.status === "completed",
      "completed after hand back",
    );
    const all = await steps(agent, runId);
    expect(all[all.findIndex((s) => s.state === "aborted") + 1]?.phase).toBe("observe");
    // Nothing was retried after hand back: one type act, and it stays aborted.
    expect((await typeActs(runId)).map((s) => s.state)).toEqual(["aborted"]);
  });

  it("the kill switch cancels every run quickly", async () => {
    const name = scenario("kill", [
      { ...readText, hold: () => new Promise((resolve) => setTimeout(resolve, 10_000)) },
      done,
    ]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/`);
    await waitForRun(agent, runId, (run) => run.status === "running", "running");
    const queued = await createRun(agent, `[scenario:${name}] ${SITE}/`);
    try {
      const killedAt = await killSwitch(agent, true);
      for (const id of [runId, queued]) {
        const run = await waitForRun(agent, id, (r) => r.status === "cancelled", "killed", 5_000);
        const latencyMs = run.finishedAt!.getTime() - killedAt.getTime();
        console.info(`kill switch → cancelled: ${latencyMs} ms (spec target 1000 ms)`);
        expect(latencyMs).toBeLessThan(CI_BOUND_MS);
      }
    } finally {
      await killSwitch(agent, false);
    }
    await waitForRun(agent, runId, (run) => run.slotName === null, "released");
  });

  it("waits for a person on a visible CAPTCHA without calling the model", async () => {
    const name = scenario("captcha", [done]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/captcha.html`);
    await waitForRun(
      agent,
      runId,
      (run) =>
        run.status === "sleeping" || (run.status === "waiting" && run.waitReason === "captcha"),
      "captcha wait",
    );
    expect(
      (await events(agent, runId)).some((e) => e.type === "status" && e.waitReason === "captcha"),
    ).toBe(true);
    expect(agent.mock.requestsFor(name)).toHaveLength(0);
  });

  it("pauses on a sign-in page without a saved sign-in, even in bypass mode, before any model call or keystroke", async () => {
    const name = scenario("signin", [clickNamed("Password"), typeText("guessed-password"), done]);
    const runId = await createRun(agent, `[scenario:${name}] ${OTHER}/login.html`, {
      allowedOrigins: [OTHER],
      approvalMode: "bypass",
    });
    await waitForRun(
      agent,
      runId,
      (run) =>
        run.status === "sleeping" || (run.status === "waiting" && run.waitReason === "takeover"),
      "sign-in wait",
    );
    expect(
      (await events(agent, runId)).some(
        (e) =>
          e.type === "status" &&
          e.waitReason === "takeover" &&
          e.reason === `Sign-in needed for ${OTHER} — add it in the Vault or take over`,
      ),
    ).toBe(true);
    expect(agent.mock.requestsFor(name)).toHaveLength(0);
    expect((await steps(agent, runId)).filter((s) => s.phase === "act")).toEqual([]);
  });

  it("masking is passive during a live run and masks secret fields in stored screenshots", async () => {
    const first = gate();
    const second = gate();
    const name = scenario("mask", [
      { ...readText, hold: first.wait },
      { ...done, hold: second.wait },
    ]);
    const runId = await createRun(agent, `[scenario:${name}] ${SITE}/masking.html`);
    try {
      await waitFor(() => agent.mock.requestsFor(name).length === 1, {
        label: "first decide",
        timeoutMs: 60_000,
      });
      const mutations = () =>
        withSlotPage(runId, "masking", (page) =>
          page.evaluate(() => [...(window as unknown as { __mutations: string[] }).__mutations]),
        );
      // The page's observer starts inside its own script, so it also sees the parser finish the
      // document: exactly these 3 records. Anything more came from the agent's first observation.
      const loaded = await mutations();
      expect(loaded).toEqual(["childList", "characterData", "characterData"]);
      first.open();
      await waitFor(() => agent.mock.requestsFor(name).length === 2, {
        label: "second decide",
        timeoutMs: 60_000,
      });
      // read_page and a second observation (screenshot, DOM read, page state) changed nothing.
      expect(await mutations()).toEqual(loaded);
      const geometry = await withSlotPage(runId, "masking", (page) =>
        page.evaluate(() => ({
          viewport: window.innerWidth,
          boxes: ["#password", "#otp", "#pin", "#plain"].map((selector) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        })),
      );
      const shot = (await steps(agent, runId)).find(
        (s) => s.phase === "observe" && s.screenshotKey,
      );
      const png = await agent.storage.getBytes(shot!.screenshotKey!);
      const scale = (await imageWidth(png)) / geometry.viewport;
      const black = (box: PixelBox) =>
        regionIsBlack(png, {
          x: box.x * scale,
          y: box.y * scale,
          width: box.width * scale,
          height: box.height * scale,
        });
      const [password, otp, pin, plain] = geometry.boxes;
      for (const secret of [password, otp, pin]) expect(await black(secret!)).toBe(true);
      expect(await black(plain!)).toBe(false);
      // No secret value reached the model, as text or anywhere else in a request (images aside).
      for (const request of agent.mock.requestsFor(name)) {
        const body = JSON.stringify(request.body).replaceAll(
          /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g,
          "",
        );
        for (const secret of ["hunter2-secret", "123456", "9876"])
          expect(body).not.toContain(secret);
      }
    } finally {
      first.open();
      second.open();
    }
    await waitForRun(agent, runId, (run) => run.status === "completed", "completed");
  });

  it("a hung frame never stalls a run: typing fails closed, then runs once approved, and takeover and kill stay quick", async () => {
    const clickNotesThenType = (text: string): MockTurn => ({
      outputs: [{ type: "click_named", name: "Notes", then: [{ type: "type", text }] }],
    });
    const name = scenario("hung", [
      readInteractive,
      clickNotesThenType("hello"),
      { ...clickNotesThenType("y".repeat(5_000)), check: expectIn("needs the user's approval") },
      // After hand back the model "thinks" while the advert still hangs: the kill lands here.
      {
        ...done,
        check: expectIn("Interrupted: the user took control"),
        hold: () => new Promise((resolve) => setTimeout(resolve, 10_000)),
      },
    ]);
    // The advert hangs for 8 s from each load (the restore after approval loads it again).
    const HANG_MS = 8_000;
    const page = `${SITE}/hung-frame.html?ms=${HANG_MS}`;
    const runId = await createRun(agent, `[scenario:${name}] ${page}`);
    // Acts are summarised as `click … (+1 more)`.
    const acts = async () =>
      (await steps(agent, runId)).filter(
        (s) => s.phase === "act" && JSON.stringify(s.action).includes("+1 more"),
      );
    // The first batch's click finds the advert unresponsive (its guard cannot arm there within the
    // budget), so its typing is stopped for approval at once; the retry asks a person.
    await waitForRun(
      agent,
      runId,
      (run) => run.status === "sleeping" && run.slotName === null,
      "asleep awaiting approval",
    );
    const [failedClosed] = await acts();
    expect(failedClosed!.state).not.toBe("started");
    expect(failedClosed!.updatedAt.getTime() - failedClosed!.createdAt.getTime()).toBeLessThan(
      CI_BOUND_MS,
    );
    await decideApproval(agent, runId, "approved");
    await waitFor(async () => (await acts()).length === 2, {
      label: "approved typing",
      timeoutMs: 60_000,
      intervalMs: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 500)); // well into the 5,000 characters
    const takenAt = await takeControl(agent, runId);
    const aborted = await waitFor(
      async () => (await steps(agent, runId)).find((s) => s.state === "aborted"),
      { label: "aborted", intervalMs: 10 },
    );
    const takeoverMs = aborted.updatedAt.getTime() - takenAt.getTime();
    console.info(`hung frame: takeover → act aborted: ${takeoverMs} ms (spec target 300 ms)`);
    expect(takeoverMs).toBeLessThan(1_000);
    // The approved typing was still running 500 ms in (arming alone ends within 250 ms), so it
    // typed rather than failing closed again. (A second CDP client cannot attach to this slot while
    // its advert hangs, so the field is not read here; computer.behaviour checks the text.)
    expect((await acts())[1]!.state).toBe("aborted");
    await handBack(agent, runId);
    await waitFor(() => agent.mock.requestsFor(name).length === 4, { label: "holding" });
    try {
      const killedAt = await killSwitch(agent, true);
      const run = await waitForRun(agent, runId, (r) => r.status === "cancelled", "killed", 5_000);
      const killMs = run.finishedAt!.getTime() - killedAt.getTime();
      console.info(`hung frame: kill switch → cancelled: ${killMs} ms (spec target 1000 ms)`);
      expect(killMs).toBeLessThan(1_000);
    } finally {
      await killSwitch(agent, false);
    }
    // Other files drive these slots directly: let them restart before this file ends.
    await waitFor(
      async () =>
        (await agent.owner.db.select().from(browserSlots)).every((slot) => slot.state === "idle"),
      { label: "slots idle", timeoutMs: 90_000, intervalMs: 250 },
    );
  }, 240_000);
});
