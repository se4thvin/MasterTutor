import { describe, expect, it } from "vitest";
import {
  rec,
  recordedDetail,
  recordedEvents,
  recordedSteps,
} from "@/lib/fixtures/run-recording.ts";
import { canTakeOver, deriveBrowserState, type ViewFlags } from "./browser-state.ts";
import { applyRunEvent, applyRunEvents, initRunModel } from "./run-model.ts";
import { IDLE_TAKEOVER, takeoverReducer } from "./takeover.ts";

const flags: ViewFlags = {
  connection: "open",
  takeover: IDLE_TAKEOVER,
  replaying: false,
  liveRetrying: false,
};
const model = (over = {}) => initRunModel(recordedDetail(over), recordedSteps());
const requesting = takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: false });

describe("deriveBrowserState", () => {
  it("is live while running and thinking, acting while an act step runs", () => {
    expect(deriveBrowserState(model(), flags)).toBe("live");
    expect(deriveBrowserState(applyRunEvent(model(), recordedEvents()[0]!), flags)).toBe("acting");
  });

  it("shows approval while one is pending, even if the run went to sleep", () => {
    const waiting = applyRunEvents(model(), recordedEvents());
    expect(deriveBrowserState(waiting, flags)).toBe("approval");
    const asleep = applyRunEvent(
      waiting,
      rec({ type: "status", status: "sleeping", waitReason: null, reason: null }),
    );
    expect(deriveBrowserState(asleep, flags)).toBe("approval");
  });

  it("puts control above approval and reconnecting, and replay above everything (A5)", () => {
    const waiting = applyRunEvents(model(), recordedEvents());
    expect(deriveBrowserState(waiting, { ...flags, takeover: requesting })).toBe("control");
    expect(
      deriveBrowserState(model({ controller: "user" }), { ...flags, connection: "lost" }),
    ).toBe("control");
    expect(deriveBrowserState(model({ controller: "user" }), { ...flags, replaying: true })).toBe(
      "replay",
    );
  });

  it("is reconnecting when the stream or live frame is lost", () => {
    expect(deriveBrowserState(model(), { ...flags, connection: "lost" })).toBe("reconnecting");
    expect(deriveBrowserState(model(), { ...flags, liveRetrying: true })).toBe("reconnecting");
  });

  it("is paused when sleeping, queued, slot-less or finished, never reconnecting once finished", () => {
    expect(deriveBrowserState(model({ status: "sleeping", slotName: null }), flags)).toBe("paused");
    expect(deriveBrowserState(model({ status: "queued", slotName: null }), flags)).toBe("paused");
    expect(
      deriveBrowserState(model({ status: "completed" }), { ...flags, connection: "lost" }),
    ).toBe("paused");
  });
});

describe("canTakeOver", () => {
  it("allows live, acting, sleeping and approval-waiting runs held by the agent (A5, D19)", () => {
    expect(canTakeOver(model(), "live", IDLE_TAKEOVER)).toBe(true);
    expect(
      canTakeOver(model({ status: "sleeping", slotName: null }), "paused", IDLE_TAKEOVER),
    ).toBe(true);
    expect(canTakeOver(applyRunEvents(model(), recordedEvents()), "approval", IDLE_TAKEOVER)).toBe(
      true,
    );
  });

  it("refuses finished, queued, user-held, replaying or in-flight cases", () => {
    expect(canTakeOver(model({ status: "completed" }), "paused", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model({ status: "queued", slotName: null }), "paused", IDLE_TAKEOVER)).toBe(
      false,
    );
    expect(canTakeOver(model({ controller: "user" }), "control", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model(), "replay", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model(), "live", takeoverReducer(IDLE_TAKEOVER, { type: "release" }))).toBe(
      false,
    );
  });
});
