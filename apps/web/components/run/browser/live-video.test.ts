import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_VIDEO_MS, watchVideo } from "./live-video.ts";

/** An embed whose n.eko video has `width` decoded pixels (0 = no frame yet). */
const embed = (width: () => number) =>
  ({
    contentDocument: { querySelector: () => ({ videoWidth: width() }) },
  }) as unknown as HTMLIFrameElement;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchVideo (I1: a WebRTC session that never decodes)", () => {
  it("without a timeout, waits for a late first frame and reports only that", () => {
    let width = 0;
    const seen: string[] = [];
    watchVideo(
      () => embed(() => width),
      (result) => seen.push(result),
      Infinity,
    );
    vi.advanceTimersByTime(NO_VIDEO_MS * 10);
    expect(seen).toEqual([]);
    width = 1280;
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(["video"]);
  });

  it("reports video as soon as a frame is decoded", () => {
    let width = 0;
    const seen: string[] = [];
    watchVideo(
      () => embed(() => width),
      (result) => seen.push(result),
    );
    vi.advanceTimersByTime(1_000);
    width = 1280;
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(["video"]);
  });

  it("reports no video once NO_VIDEO_MS passes without a frame, and only once", () => {
    const seen: string[] = [];
    watchVideo(
      () => embed(() => 0),
      (result) => seen.push(result),
    );
    vi.advanceTimersByTime(NO_VIDEO_MS - 300);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(600);
    vi.advanceTimersByTime(NO_VIDEO_MS * 3);
    expect(seen).toEqual(["no_video"]);
  });

  it("never judges an embed it cannot inspect, and stops when asked", () => {
    const seen: string[] = [];
    const opaque = { contentDocument: null } as unknown as HTMLIFrameElement;
    watchVideo(
      () => opaque,
      (result) => seen.push(result),
    );
    vi.advanceTimersByTime(NO_VIDEO_MS * 2);
    expect(seen).toEqual(["video"]);
    const later: string[] = [];
    const stop = watchVideo(
      () => embed(() => 0),
      (result) => later.push(result),
    );
    stop();
    vi.advanceTimersByTime(NO_VIDEO_MS * 2);
    expect(later).toEqual([]);
  });
});
