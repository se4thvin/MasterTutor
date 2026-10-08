import { describe, expect, it } from "vitest";
import { RunDetail } from "@mastertutor/contracts";
import { ids } from "@/lib/fixtures/ids.ts";
import {
  OTHER_RUN_ID,
  RECORDED_APPROVAL_ID,
  RECORDED_RUN_ID,
  rec,
  recordedDetail,
  recordedEvents,
  recordedSteps,
} from "@/lib/fixtures/run-recording.ts";
import {
  applyRunEvent,
  applyRunEvents,
  captureCount,
  failureOf,
  initRunModel,
  isInformational,
  isTerminal,
  latestError,
  latestPointerStep,
  latestScreenshotSeq,
  latestStep,
  originOf,
  syncRunModel,
} from "./run-model.ts";

const base = () => initRunModel(recordedDetail(), recordedSteps());

describe("initRunModel", () => {
  it("parses the recording and derives captures and the secure-fill origin", () => {
    const model = base();
    expect(model.runId).toBe(RECORDED_RUN_ID);
    expect(model.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(captureCount(model)).toBe(2);
    expect(model.secureFillOrigin).toBe("https://learn.example.edu");
    expect(model.lastEventId).toBe("12");
    expect(latestScreenshotSeq(model)).toBe(6);
    expect(model.lastControl).toBeNull();
  });

  it("keeps only pending approvals from the snapshot", () => {
    const request = recordedEvents()[6]!.event;
    if (request.type !== "approval_requested") throw new Error("fixture order changed");
    const view = (status: "pending" | "approved") => ({
      id: RECORDED_APPROVAL_ID,
      runId: RECORDED_RUN_ID,
      stepSeq: 12,
      kind: "risky_click" as const,
      request: request.request,
      status,
      decidedBy: null,
      decidedAt: null,
      createdAt: "2026-10-05T17:10:08.000Z",
    });
    const pending = initRunModel(recordedDetail({ pendingApprovals: [view("pending")] }), []);
    expect(pending.approvals.map((a) => a.id)).toEqual([RECORDED_APPROVAL_ID]);
    const done = initRunModel(recordedDetail({ pendingApprovals: [view("approved")] }), []);
    expect(done.approvals).toEqual([]);
  });
});

describe("applyRunEvent", () => {
  it("folds the recorded stream into an approval wait", () => {
    const model = applyRunEvents(base(), recordedEvents());
    expect(model.status).toBe("waiting");
    expect(model.waitReason).toBe("approval");
    expect(model.approvals.map((a) => a.id)).toEqual([RECORDED_APPROVAL_ID]);
    expect(model.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(model.usage.steps).toBe(10);
    expect(latestPointerStep(model)?.seq).toBe(10);
    expect(model.lastEventId).toBe("20");
  });

  it("upserts a step's phases in place and keeps its first timestamp", () => {
    const [started, done] = recordedEvents();
    const twice = applyRunEvent(applyRunEvent(base(), started!), done!);
    const rows = twice.steps.filter((s) => s.seq === 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("done");
    expect(rows[0]?.at).toBe(started!.at);
  });

  it("ignores ids at or below lastEventId (reconnect replay overlap)", () => {
    const model = applyRunEvents(base(), recordedEvents());
    expect(applyRunEvents(model, recordedEvents())).toBe(model);
    const stale = { ...rec({ type: "control", holder: "user" }), id: "12" };
    expect(applyRunEvent(base(), stale).controller).toBe("agent");
  });

  it("ignores events for another run", () => {
    const model = base();
    expect(applyRunEvent(model, rec({ type: "control", holder: "user" }, OTHER_RUN_ID))).toBe(
      model,
    );
  });

  it("moves approvals to outcomes when resolved, even within one batch (A9)", () => {
    const requested = recordedEvents()[6]!;
    const resolved = rec({
      type: "approval_resolved",
      approvalId: RECORDED_APPROVAL_ID,
      status: "approved",
      decidedBy: "policy",
    });
    const model = applyRunEvents(base(), [requested, resolved]);
    expect(model.approvals).toEqual([]);
    expect(model.outcomes).toMatchObject([
      { id: RECORDED_APPROVAL_ID, status: "approved", decidedBy: "policy" },
    ]);
    expect(model.outcomes[0]?.request?.kind).toBe("risky_click");
  });

  it("clears the secure-fill badge when the page leaves that origin", () => {
    const moved = applyRunEvent(
      base(),
      rec({
        type: "step",
        seq: 20,
        phase: "act",
        state: "done",
        caption: "Opening the docs",
        url: "https://docs.example.org/page",
        screenshotKey: null,
        action: { tool: "computer", summary: "Clicked Docs", point: null },
      }),
    );
    expect(moved.secureFillOrigin).toBeNull();
    expect(moved.currentUrl).toBe("https://docs.example.org/page");
  });

  it("tracks control events by id, slot, messages, downloads, filing and model fallback", () => {
    const control = rec({ type: "control", holder: "user" });
    const model = applyRunEvents(base(), [
      control,
      rec({ type: "slot", slotName: null }),
      rec({ type: "user_message", text: "Skip the quiz" }),
      rec({
        type: "download_ready",
        downloadId: ids.asset(9),
        assetId: ids.asset(10),
        filename: "slides.pdf",
        bytes: 2048,
      }),
      rec({
        type: "filed",
        noteId: ids.note(1),
        folderId: ids.folder(1),
        path: ["Courses", "ML"],
        filedBy: "agent",
      }),
      rec({ type: "model_fallback", from: "gpt-6-astra", to: "gpt-6.1-sol" }),
    ]);
    expect(model.controller).toBe("user");
    expect(model.lastControl).toEqual({ eventId: control.id, holder: "user" });
    expect(model.slotName).toBeNull();
    expect(model.messages.map((m) => m.text)).toEqual(["Skip the quiz"]);
    expect(model.downloads.map((d) => d.filename)).toEqual(["slides.pdf"]);
    expect(model.filedPath).toEqual(["Courses", "ML"]);
    expect(model.model).toBe("gpt-6.1-sol");
  });

  it("seeds the stored downloads from the snapshot, so a reload shows what the live view showed", () => {
    const stored = {
      id: ids.asset(21),
      assetId: ids.asset(22),
      filename: "week-2.pdf",
      bytes: 28,
      at: "2026-10-07T10:00:00.000Z",
    };
    const model = initRunModel(
      recordedDetail({ status: "completed", downloads: [stored] }),
      recordedSteps(),
    );
    expect(model.downloads).toEqual([stored]);
    // The stream replays from the snapshot's position: the same download is not listed twice.
    const replayed = applyRunEvents(model, [
      rec({
        type: "download_ready",
        downloadId: stored.id,
        assetId: stored.assetId,
        filename: stored.filename,
        bytes: stored.bytes,
      }),
    ]);
    expect(replayed.downloads).toHaveLength(1);
  });

  it("seeds the held downloads from the snapshot, so a reload during control still offers them", () => {
    const detail = recordedDetail({
      controller: "user",
      status: "waiting",
      waitReason: "takeover",
      heldDownloads: [{ id: ids.asset(11), filename: "notes.txt", bytes: 28 }],
    });
    const model = initRunModel(detail, recordedSteps());
    expect(model.heldDownloads).toEqual([{ id: ids.asset(11), filename: "notes.txt", bytes: 28 }]);
    // The same download replayed by the stream is not offered twice.
    const replayed = applyRunEvents(model, [
      rec({
        type: "download_pending",
        downloadId: ids.asset(11),
        filename: "notes.txt",
        bytes: 28,
      }),
    ]);
    expect(replayed.heldDownloads).toHaveLength(1);
  });

  it("holds downloads made during control for Keep or Discard until the hand-back (B6 A11)", () => {
    const held = rec({
      type: "download_pending",
      downloadId: ids.asset(11),
      filename: "notes.txt",
      bytes: 28,
    });
    const other = rec({
      type: "download_pending",
      downloadId: ids.asset(12),
      filename: "other.txt",
      bytes: 5,
    });
    const during = applyRunEvents(base(), [held, other]);
    expect(during.heldDownloads.map((d) => d.filename)).toEqual(["notes.txt", "other.txt"]);
    expect(during.downloads).toEqual([]);
    // The hand-back settles them: kept ones arrive as download_ready, the rest are gone.
    const after = applyRunEvents(during, [
      rec({ type: "control", holder: "agent" }),
      rec({
        type: "download_ready",
        downloadId: ids.asset(11),
        assetId: ids.asset(13),
        filename: "notes.txt",
        bytes: 28,
      }),
    ]);
    expect(after.heldDownloads).toEqual([]);
    expect(after.downloads.map((d) => d.filename)).toEqual(["notes.txt"]);
  });

  it("never lets an informational error become the failure reason (A7)", () => {
    const model = applyRunEvents(base(), [
      rec({ type: "error", code: "nav_timeout", message: "The page took too long" }),
      rec({ type: "error", code: "download_blocked", message: "Download cancelled" }),
    ]);
    expect(failureOf(model)?.code).toBe("nav_timeout");
    expect(latestError(model)?.code).toBe("download_blocked");
    const onlyInfo = applyRunEvent(
      base(),
      rec({ type: "error", code: "takeover_failed", message: "x" }),
    );
    expect(failureOf(onlyInfo)).toBeNull();
  });

  it("knows informational error codes, origins and the latest step", () => {
    for (const code of [
      "takeover_failed",
      "idle_hand_back",
      "download_blocked",
      "download_too_large",
    ]) {
      expect(isInformational(code), code).toBe(true);
    }
    expect(isInformational("nav_timeout")).toBe(false);
    expect(originOf("https://learn.example.edu/course/week-2")).toBe("https://learn.example.edu");
    expect(originOf(null)).toBeNull();
    expect(latestStep(base())?.seq).toBe(9);
    expect(latestStep(initRunModel(recordedDetail(), []))).toBeNull();
  });

  it("knows terminal statuses", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("sleeping")).toBe(false);
  });
});

describe("syncRunModel (A6 hand-back resync)", () => {
  it("settles status, controller and slot from a re-read detail and keeps the stream position", () => {
    const model = applyRunEvents(base(), recordedEvents());
    const synced = syncRunModel(
      model,
      recordedDetail({
        controller: "user",
        status: "waiting",
        waitReason: "takeover",
        slotName: "browser-2",
      }),
    );
    expect(synced).toMatchObject({
      controller: "user",
      status: "waiting",
      waitReason: "takeover",
      slotName: "browser-2",
    });
    expect(synced.lastEventId).toBe("20");
    expect(synced.steps).toBe(model.steps);
  });
});

describe("a finished run holds no slot (Phase 7 Task 3)", () => {
  // The agent releases the slot just after the terminal status, but the stream closes at that
  // status, so the release never reaches an open view: the live frame must not outlive the run.
  it("drops the slot with a terminal status, from events, a detail or a re-read", () => {
    const running = applyRunEvent(base(), rec({ type: "slot", slotName: "browser-2" }));
    expect(running.slotName).toBe("browser-2");
    const done = applyRunEvent(
      running,
      rec({ type: "status", status: "cancelled", waitReason: null, reason: null }),
    );
    expect(done.slotName).toBeNull();
    const finished = { ...recordedDetail(), status: "completed" as const, slotName: "browser-1" };
    expect(initRunModel(finished, []).slotName).toBeNull();
    expect(syncRunModel(running, finished).slotName).toBeNull();
  });
});

describe("a finished run's failure, opened later (D35, review M4)", () => {
  it("says why a failed run failed from the detail alone: its stream is never opened", () => {
    const error = { code: "model_request_rejected", message: "The model rejected the request." };
    const failed = initRunModel(
      RunDetail.parse({ ...recordedDetail(), status: "failed", slotName: null, error }),
      [],
    );
    expect(failureOf(failed)).toMatchObject(error);
    expect(
      failureOf(syncRunModel(base(), { ...recordedDetail(), status: "failed", error })),
    ).toMatchObject(error);
  });
});
