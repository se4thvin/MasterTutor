import { describe, expect, it } from "vitest";
import {
  RECORDED_APPROVAL_ID,
  rec,
  recordedDetail,
  recordedEvents,
  recordedSteps,
} from "@/lib/fixtures/run-recording.ts";
import { applyRunEvent, applyRunEvents, initRunModel } from "./run-model.ts";
import { elapsedClock, summaryLabel, thinkingState, timelineItems } from "./timeline-items.ts";

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
    const pending = [{ key: "k1", text: "Skip it", afterEventId: model.lastEventId }];
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
