import { describe, expect, it } from "vitest";
import {
  rec,
  recordedDetail,
  recordedEvents,
  recordedSteps,
} from "@/lib/fixtures/run-recording.ts";
import { BROWSER_STATES } from "./browser-state.ts";
import {
  INFO_ERROR_COPY,
  STATE_PILL,
  TAKEOVER_NOTICE,
  actNumber,
  captionFor,
  errorLine,
  handBackErrorCopy,
  hostAndPath,
  pageHost,
  markFor,
  pausedCopy,
  shortRunId,
  statusLabel,
  stepLabel,
  takeControlErrorCopy,
} from "./copy.ts";
import { applyRunEvent, applyRunEvents, initRunModel } from "./run-model.ts";
import { IDLE_TAKEOVER, takeoverReducer } from "./takeover.ts";

const model = (over = {}) => initRunModel(recordedDetail(over), recordedSteps());

describe("captions", () => {
  it("captions each state verb-first and cleans model captions", () => {
    expect(captionFor("live", model(), IDLE_TAKEOVER, null)).toBe("Thinking about the next step");
    const acting = applyRunEvent(model(), recordedEvents()[0]!);
    expect(captionFor("acting", acting, IDLE_TAKEOVER, null)).toBe("Ticking the Honor Code box");
    const waking = takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: true });
    expect(captionFor("control", model(), waking, null)).toBe(
      "Waking the browser so you can take control…",
    );
    expect(captionFor("control", model({ controller: "user" }), IDLE_TAKEOVER, null)).toBe(
      "You're in control. Screenshots are off",
    );
    expect(
      captionFor("live", model({ status: "waiting", waitReason: "captcha" }), IDLE_TAKEOVER, null),
    ).toBe("Needs you: solve the CAPTCHA, then hand back");
    const hostile = applyRunEvent(
      model(),
      rec({
        type: "step",
        seq: 30,
        phase: "act",
        state: "started",
        caption: "Pay\u202E now\n\n",
        url: null,
        screenshotKey: null,
        action: null,
      }),
    );
    expect(captionFor("acting", hostile, IDLE_TAKEOVER, null)).toBe("Pay now");
  });
});

describe("paused copy", () => {
  it("explains paused runs by status", () => {
    expect(pausedCopy(model({ status: "sleeping" }))).toEqual({
      title: "Paused",
      detail: "Sleeping. Context saved at step 5",
      canResume: true,
    });
    expect(pausedCopy(model({ status: "completed" })).title).toBe("Finished");
    expect(pausedCopy(model({ status: "queued" })).canResume).toBe(false);
  });

  it("states a failure by its real cause, never an informational error (A7)", () => {
    const failed = applyRunEvents(model(), [
      rec({ type: "error", code: "nav_timeout", message: "The page took too long" }),
      rec({ type: "error", code: "download_blocked", message: "cancelled" }),
      rec({ type: "status", status: "failed", waitReason: null, reason: null }),
    ]);
    expect(pausedCopy(failed)).toMatchObject({
      title: "Stopped",
      detail: "The page took too long",
    });
    const onlyInfo = applyRunEvents(model(), [
      rec({ type: "error", code: "takeover_failed", message: "x" }),
      rec({ type: "status", status: "failed", waitReason: null, reason: null }),
    ]);
    expect(pausedCopy(onlyInfo).detail).toBe("Something went wrong");
  });
});

describe("labels", () => {
  it("labels status, step numbers and marks", () => {
    expect(statusLabel("approval", model())).toBe("Needs your approval");
    expect(stepLabel(model())).toBe("Step 5");
    expect(actNumber(model(), 8)).toBe(5);
    expect(markFor("paused", model({ status: "completed" }))).toBe("done");
    expect(markFor("live", model())).toBe("running");
    expect(markFor("paused", model({ status: "sleeping" }))).toBe("pending");
    expect(shortRunId("0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d")).toBe("run_0b4c2a1e");
  });

  it("words informational errors and takeover RPC failures", () => {
    expect(INFO_ERROR_COPY["download_blocked"]).toBe("Take over to download files.");
    expect(errorLine({ eventId: "1", code: "x", message: "Bad\u202E thing", at: "" })).toBe(
      "Bad thing",
    );
    expect(takeControlErrorCopy("FORBIDDEN")).toBe("Someone else is in control of this browser.");
    expect(takeControlErrorCopy("CONFLICT")).toBe(
      "This run has finished, so there is nothing to take over.",
    );
    expect(takeControlErrorCopy(null)).toBe("Couldn't take control. Try again.");
    expect(handBackErrorCopy("FORBIDDEN")).toBe(
      "Someone else is in control, so only they can hand back.",
    );
    expect(handBackErrorCopy(null)).toBe("Couldn't hand back. You're still in control.");
  });
});

describe("URLs (S7)", () => {
  it("keeps the full hostname and puts only the path through the cleaner", () => {
    expect(hostAndPath("https://www.learn.example.edu/a/b?c=1")).toEqual({
      host: "www.learn.example.edu",
      path: "/a/b?c=1",
      secure: true,
    });
    expect(hostAndPath("https://evil.example/learn.example.edu/login")).toMatchObject({
      host: "evil.example",
      path: "/learn.example.edu/login",
    });
    expect(hostAndPath("https://ex\u0430mple.com/")?.host).toMatch(/^xn--/);
    expect(hostAndPath("javascript:alert(1)")).toBeNull();
    expect(hostAndPath("not a url")).toBeNull();
    expect(pageHost("https://learn.example.edu:8443/x")).toBe("learn.example.edu:8443");
  });
});

describe("state pill and takeover notices", () => {
  it("names every browser state; only the states with the agent at work pulse", () => {
    expect(BROWSER_STATES).toEqual([
      "live",
      "acting",
      "approval",
      "control",
      "paused",
      "reconnecting",
      "replay",
    ]);
    expect(BROWSER_STATES.filter((s) => STATE_PILL[s].pulse)).toEqual([
      "live",
      "acting",
      "approval",
    ]);
    expect(STATE_PILL.control.label).toBe("You");
  });

  it("says plainly who holds control after a takeover attempt", () => {
    expect(TAKEOVER_NOTICE.failed).toMatch(/agent kept it/);
    expect(TAKEOVER_NOTICE.timed_out).toMatch(/agent still has control/);
    expect(TAKEOVER_NOTICE.now_in_control).toBe("You're in control now.");
  });
});
