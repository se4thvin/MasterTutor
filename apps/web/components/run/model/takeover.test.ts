import { describe, expect, it } from "vitest";
import {
  HANDBACK_TIMEOUT_MS,
  IDLE_TAKEOVER,
  inControl,
  takeoverReducer,
  takeoverTimeoutMs,
  type TakeoverState,
} from "./takeover.ts";

const requesting = takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: false });
const releasing = takeoverReducer(IDLE_TAKEOVER, { type: "release" });

describe("takeover machine", () => {
  it("requests optimistically and confirms on control{user}", () => {
    expect(requesting).toMatchObject({ phase: "requesting", wake: false, notice: null });
    expect(inControl("agent", requesting)).toBe(true);
    expect(takeoverReducer(requesting, { type: "holder", holder: "user" })).toEqual(IDLE_TAKEOVER);
    expect(inControl("user", IDLE_TAKEOVER)).toBe(true);
  });

  it("fails at once on control{agent} or takeover_failed while requesting (A6, B6 §3)", () => {
    expect(takeoverReducer(requesting, { type: "holder", holder: "agent" })).toEqual({
      ...IDLE_TAKEOVER,
      notice: "failed",
    });
    expect(takeoverReducer(requesting, { type: "takeover_failed" }).notice).toBe("failed");
    expect(takeoverReducer(IDLE_TAKEOVER, { type: "takeover_failed" })).toBe(IDLE_TAKEOVER);
  });

  it("reverts on timeout, then re-applies a late control{user} with a notice (B6 E5)", () => {
    const timedOut = takeoverReducer(requesting, { type: "timeout" });
    expect(timedOut).toMatchObject({ phase: "idle", notice: "timed_out", timedOut: true });
    const seen = takeoverReducer(timedOut, { type: "seen" });
    expect(seen.notice).toBeNull();
    expect(takeoverReducer(seen, { type: "holder", holder: "user" })).toMatchObject({
      phase: "idle",
      notice: "now_in_control",
      timedOut: false,
    });
    expect(takeoverReducer(seen, { type: "holder", holder: "agent" }).timedOut).toBe(false);
  });

  it("reverts silently when the RPC itself fails (the view shows the code's copy)", () => {
    expect(takeoverReducer(requesting, { type: "request_failed" })).toEqual(IDLE_TAKEOVER);
  });

  it("waits 2s normally, 30s to wake a sleeping run, 5s for a hand back", () => {
    expect(takeoverTimeoutMs(requesting)).toBe(2_000);
    expect(takeoverTimeoutMs(takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: true }))).toBe(
      30_000,
    );
    expect(takeoverTimeoutMs(releasing)).toBe(HANDBACK_TIMEOUT_MS);
    expect(takeoverTimeoutMs(IDLE_TAKEOVER)).toBeNull();
  });

  it("hands back optimistically and settles on control{agent}, failure or timeout", () => {
    expect(inControl("user", releasing)).toBe(false);
    for (const action of [
      { type: "holder", holder: "agent" },
      { type: "release_failed" },
      { type: "release_timeout" },
    ] as const) {
      expect(takeoverReducer(releasing, action)).toEqual(IDLE_TAKEOVER);
    }
  });

  it("ignores a request while releasing and a second request while requesting (Review Focus 2)", () => {
    expect(takeoverReducer(releasing, { type: "request", wake: false })).toBe(releasing);
    expect(takeoverReducer(requesting, { type: "request", wake: true })).toBe(requesting);
    const stale: TakeoverState = takeoverReducer(releasing, { type: "holder", holder: "user" });
    expect(stale).toBe(releasing);
  });
});
