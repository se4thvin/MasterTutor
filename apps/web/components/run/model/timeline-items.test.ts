import { describe, expect, it } from "vitest";
import {
  RECORDED_APPROVAL_ID,
  rec,
  recordedDetail,
  recordedEvents,
  recordedSteps,
} from "@/lib/fixtures/run-recording.ts";
import { applyRunEvent, applyRunEvents, initRunModel } from "./run-model.ts";
import {
  elapsedClock,
  selectedRowSeq,
  summaryLabel,
  thinkingState,
  timelineItems,
} from "./timeline-items.ts";

const VIEWER = "fixture-user";
const base = () => initRunModel(recordedDetail(), recordedSteps());
const resolved = (status: "approved" | "denied" | "superseded", decidedBy: string) =>
  rec({ type: "approval_resolved", approvalId: RECORDED_APPROVAL_ID, status, decidedBy });

describe("timelineItems", () => {
  it("lists act and approve steps; an unpointered computer step says Act (W1)", () => {
    const items = timelineItems(applyRunEvents(base(), recordedEvents()), [], VIEWER);
    const steps = items.filter((i) => i.kind === "step");
    expect(steps.map((s) => (s.kind === "step" ? s.verb : ""))).toEqual([
      "Click",
      "Fill",
      "Act",
      "Capture",
      "Capture",
      "Click",
      "Approve",
    ]);
    const fill = steps[1];
    expect(fill?.kind === "step" && fill.credential).toBe(true);
    const approve = steps.at(-1);
    expect(approve?.kind === "step" && approve.status).toBe("pending");
    expect(approve?.kind === "step" && approve.current).toBe(true);
  });

  it("says You only for the viewer, Someone else for another member, policy for policy (A4)", () => {
    const line = (status: "approved" | "denied" | "superseded", by: string) => {
      const model = applyRunEvents(base(), [...recordedEvents(), resolved(status, by)]);
      const d = timelineItems(model, [], VIEWER).find((i) => i.kind === "decision");
      return d?.kind === "decision" ? d.line : null;
    };
    expect(line("denied", VIEWER)).toBe("You denied: click “Start quiz”");
    expect(line("approved", "someone-else")).toBe("Someone else approved: click “Start quiz”");
    expect(line("approved", "policy")).toBe("Approved by policy: click “Start quiz”");
    expect(line("superseded", "agent")).toBe("No longer needed: click “Start quiz”");
  });

  it("merges messages, decisions, downloads and notices in time order, cleaning page text", () => {
    const model = applyRunEvents(base(), [
      ...recordedEvents(),
      resolved("denied", VIEWER),
      rec({ type: "user_message", text: "Skip it" }),
      rec({
        type: "download_ready",
        downloadId: RECORDED_APPROVAL_ID,
        assetId: RECORDED_APPROVAL_ID,
        filename: "\u202Egpj.exe",
        bytes: 1,
      }),
      rec({ type: "error", code: "download_blocked", message: "cancelled" }),
    ]);
    const items = timelineItems(model, [], VIEWER);
    expect(items.slice(-4).map((i) => i.kind)).toEqual([
      "decision",
      "message",
      "download",
      "notice",
    ]);
    const download = items.find((i) => i.kind === "download");
    expect(download?.kind === "download" && download.line).toBe("Downloaded gpj.exe");
    const notice = items.at(-1);
    expect(notice).toMatchObject({
      kind: "notice",
      tone: "info",
      line: "Take over to download files.",
    });
  });

  it("shows pending messages until their SSE echo arrives", () => {
    const model = base();
    const pending = [
      {
        key: "k1",
        text: "Skip it",
        afterEventId: model.lastEventId,
        sentAt: "2026-10-05T17:20:00.000Z",
      },
    ];
    expect(timelineItems(model, pending, VIEWER).filter((i) => i.kind === "message")).toMatchObject(
      [{ pending: true }],
    );
    const echoed = applyRunEvent(model, rec({ type: "user_message", text: "Skip it" }));
    expect(
      timelineItems(echoed, pending, VIEWER).filter((i) => i.kind === "message"),
    ).toMatchObject([{ pending: false }]);
  });

  it("reports thinking, then settles while acting", () => {
    expect(thinkingState(base())).toMatchObject({
      working: true,
      label: "Thinking about the next step",
    });
    expect(thinkingState(applyRunEvent(base(), recordedEvents()[0]!))?.working).toBe(false);
    expect(
      thinkingState(initRunModel(recordedDetail({ status: "completed" }), recordedSteps())),
    ).toBeNull();
  });

  it("summarises steps and captures and formats run-relative clocks", () => {
    expect(summaryLabel(base())).toBe("5 steps · 2 captures");
    expect(elapsedClock("2026-10-05T17:04:00.000Z", "2026-10-05T17:10:06.000Z")).toBe("06:06");
  });
});

const step = (seq: number, phase: "observe" | "decide" | "act", state: "started" | "done") =>
  rec({
    type: "step",
    seq,
    phase,
    state,
    caption: `${phase} ${seq}`,
    url: null,
    screenshotKey: null,
    action: phase === "act" ? { tool: "computer", summary: "Clicked", point: null } : null,
  });

describe("thinkingState: a stable span from the first thought to the act (I2)", () => {
  it("keeps its start through observe → decide and ends it when the act begins", () => {
    let model = applyRunEvents(base(), recordedEvents().slice(0, 2));
    const observe = step(30, "observe", "started");
    model = applyRunEvent(model, observe);
    const thinking = thinkingState(model);
    expect(thinking).toMatchObject({ working: true, since: observe.at, until: null });
    const decide = step(31, "decide", "started");
    model = applyRunEvents(model, [step(30, "observe", "done"), decide]);
    expect(thinkingState(model)?.since).toBe(observe.at);
    const act = step(32, "act", "started");
    model = applyRunEvent(model, act);
    expect(thinkingState(model)).toMatchObject({
      working: false,
      since: observe.at,
      until: act.at,
    });
  });
});

describe("messages (S6, pending)", () => {
  it("cleans every member's chat and caps it at 2,000 characters", () => {
    const model = applyRunEvent(
      base(),
      rec({ type: "user_message", text: `hi\u202E there ${"x".repeat(3_000)}` }),
    );
    const message = timelineItems(model, [], VIEWER).find((i) => i.kind === "message");
    expect(message?.kind === "message" && message.text.startsWith("hi there")).toBe(true);
    expect(message?.kind === "message" && [...message.text].length).toBe(2_000);
  });

  it("caps a 2,000-character step line, beyond the contract's own limit", () => {
    const model = base();
    const long = {
      seq: 40,
      phase: "act" as const,
      state: "done" as const,
      caption: null,
      url: null,
      screenshotKey: null,
      action: { tool: "computer" as const, summary: "y".repeat(2_000), point: null },
      at: "2026-10-05T17:30:00.000Z",
    };
    const items = timelineItems({ ...model, steps: [...model.steps, long] }, [], VIEWER);
    const line = items.find((i) => i.kind === "step" && i.seq === 40);
    expect(line?.kind === "step" && [...line.line].length).toBeLessThanOrEqual(200);
  });

  it("times a pending message from when it was sent, and one echo clears one pending copy", () => {
    const model = applyRunEvents(base(), recordedEvents());
    const sent = (key: string, sentAt: string) => ({
      key,
      text: "Skip it",
      afterEventId: model.lastEventId,
      sentAt,
    });
    const pending = [
      sent("a", "2026-10-05T17:20:00.000Z"),
      sent("a", "2026-10-05T17:20:00.000Z"),
      sent("b", "2026-10-05T17:20:05.000Z"),
    ];
    const messages = (m = model) =>
      timelineItems(m, pending, VIEWER).filter((i) => i.kind === "message");
    // Deduped by client id, and timed from sentAt (stable across renders).
    expect(messages().map((m) => m.at)).toEqual([
      "2026-10-05T17:20:00.000Z",
      "2026-10-05T17:20:05.000Z",
    ]);
    const echoed = applyRunEvent(model, rec({ type: "user_message", text: "Skip it" }));
    // The echo is the real message; only the second client id is still pending.
    const after = messages(echoed);
    expect(after.filter((m) => m.kind === "message" && m.pending).map((m) => m.key)).toEqual([
      "pending-b",
    ]);
    expect(after.filter((m) => m.kind === "message" && !m.pending)).toHaveLength(1);
  });
});

describe("step replay shots: the agent keeps screenshots on observe steps (Phase 7 Task 3)", () => {
  const shot = (seq: number) =>
    rec({
      type: "step",
      seq,
      phase: "observe",
      state: "done",
      caption: null,
      url: "http://site.fixtures.test/",
      screenshotKey: `runs/r/steps/${seq}-k.png`,
      action: null,
    });

  it("replays the screen an act was taken on when the act step has no screenshot of its own", () => {
    const model = applyRunEvents(base(), [
      shot(40),
      step(41, "decide", "done"),
      step(42, "act", "done"),
      shot(43),
      step(44, "act", "done"),
    ]);
    const rows = timelineItems(model, [], VIEWER).filter((i) => i.kind === "step" && i.seq >= 40);
    expect(rows.map((i) => (i.kind === "step" ? [i.seq, i.shotSeq] : null))).toEqual([
      [42, 40],
      [44, 43],
    ]);
  });

  it("keeps an act step's own screenshot when it has one", () => {
    const before = shot(50);
    const own = rec({
      type: "step",
      seq: 51,
      phase: "act",
      state: "done",
      caption: null,
      url: null,
      screenshotKey: "runs/r/steps/51-k.png",
      action: { tool: "computer", summary: "Clicked", point: null },
    });
    const model = applyRunEvents(base(), [before, own]);
    const row = timelineItems(model, [], VIEWER).find((i) => i.kind === "step" && i.seq === 51);
    expect(row?.kind === "step" && row.shotSeq).toBe(51);
  });
});

describe("selectedRowSeq: rows sharing a screenshot are not all selected (group 1 review, Minor 3)", () => {
  const row = (seq: number, shotSeq: number | null) =>
    ({ kind: "step", seq, shotSeq }) as Parameters<typeof selectedRowSeq>[0][number];
  const items = [row(3, 1), row(4, 1), row(5, 1), row(7, 6)];

  it("selects the clicked row while its screenshot is the one replayed", () => {
    expect(selectedRowSeq(items, 1, 4)).toBe(4);
  });

  it("falls back to the first row of the replayed screenshot once replay moves on", () => {
    expect(selectedRowSeq(items, 6, 4)).toBe(7);
    expect(selectedRowSeq(items, 1, null)).toBe(3);
  });

  it("selects nothing outside replay", () => {
    expect(selectedRowSeq(items, null, 4)).toBeNull();
  });
});
