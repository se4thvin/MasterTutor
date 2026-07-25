import { encodeRunEventSse, type NoteDetail, type RunDetail } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import {
  controlHolders,
  needsLocalPreflight,
  parseSmokeArgs,
  smokeProblems,
} from "./prod-smoke.ts";

const RUN = "0b0f8a64-4a8f-4c58-9df4-4f7ab2d7a8e1";
const detail = (over: Partial<RunDetail> = {}) =>
  ({
    id: RUN,
    status: "completed",
    noteId: "5f0c1f8e-9d43-4c47-9b0d-0e6d7b8e1a11",
    ...over,
  }) as RunDetail;
const note = (fidelity: string, blocks: number) =>
  ({
    note: { fidelity },
    blocks: Array.from({ length: blocks }, () => ({})),
    sources: [],
  }) as unknown as NoteDetail;

describe("parseSmokeArgs", () => {
  it("defaults to the loopback stack, $1 and the bench env files", () => {
    const options = parseSmokeArgs([]);
    expect(options.base.origin).toBe("http://localhost:18080");
    expect(options.maxUsd).toBe(1);
    expect(options.signUp).toBe(false);
    expect(options.envFiles).toEqual([".env", ".env.bench"]);
  });
  it("caps spend at $1 and rejects non-numbers (P9-28)", () => {
    expect(() => parseSmokeArgs(["--max-usd", "2"])).toThrow(/max-usd/);
    expect(() => parseSmokeArgs(["--max-usd", "NaN"])).toThrow(/max-usd/);
    expect(parseSmokeArgs(["--max-usd", "0.5"]).maxUsd).toBe(0.5);
  });
  it("allows plain http only on loopback, and rejects paths and unknown flags", () => {
    expect(() => parseSmokeArgs(["--base", "http://notes.example.org"])).toThrow(/base/);
    expect(parseSmokeArgs(["--base", "https://notes.example.org"]).base.origin).toBe(
      "https://notes.example.org",
    );
    expect(() => parseSmokeArgs(["--base", "http://localhost:18080/x"])).toThrow(/base/);
    expect(() => parseSmokeArgs(["--retries", "2"])).toThrow();
  });
});

describe("needsLocalPreflight (review minor)", () => {
  it("checks the local stack's lock and config only for a loopback base", () => {
    expect(needsLocalPreflight(new URL("http://localhost:18080"))).toBe(true);
    expect(needsLocalPreflight(new URL("http://127.0.0.1:18080"))).toBe(true);
    expect(needsLocalPreflight(new URL("https://notes.example.org"))).toBe(false);
  });
});

describe("controlHolders", () => {
  it("reads control events from the run_event SSE stream in order", () => {
    const at = "2026-10-06T00:00:00.000Z";
    const sse = [
      encodeRunEventSse({ id: "1", runId: RUN, at, event: { type: "control", holder: "user" } }),
      encodeRunEventSse({
        id: "2",
        runId: RUN,
        at,
        event: { type: "slot", slotName: "browser-1" },
      }),
      encodeRunEventSse({ id: "3", runId: RUN, at, event: { type: "control", holder: "agent" } }),
      "retry: 3000\n\n",
    ].join("");
    expect(controlHolders(sse)).toEqual(["user", "agent"]);
  });
});

describe("smokeProblems", () => {
  it("passes a completed run with a faithful note and a takeover round trip", () => {
    expect(
      smokeProblems({
        detail: detail(),
        note: note("verified", 12),
        controlHolders: ["user", "agent"],
      }),
    ).toEqual([]);
  });
  it("names every failure", () => {
    expect(
      smokeProblems({
        detail: detail({ status: "failed", noteId: null }),
        note: null,
        controlHolders: [],
      }),
    ).toEqual([
      "run status is failed, not completed",
      "run produced no note",
      "no control event handed the browser to the user and back to the agent",
    ]);
    expect(
      smokeProblems({ detail: detail(), note: note("needs_review", 3), controlHolders: ["user"] }),
    ).toEqual([
      "note fidelity is needs_review",
      "note has 3 blocks, expected at least 10",
      "no control event handed the browser to the user and back to the agent",
    ]);
  });
});
