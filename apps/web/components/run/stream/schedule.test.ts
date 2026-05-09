import { describe, expect, it, vi } from "vitest";
import { scheduleFlush } from "./schedule.ts";

describe("scheduleFlush (M5)", () => {
  it("batches per animation frame while the tab is visible", () => {
    const raf = vi.fn(() => 7);
    const timeout = vi.fn();
    const flush = () => undefined;
    scheduleFlush(flush, { hidden: false, raf, timeout });
    expect(raf).toHaveBeenCalledWith(flush);
    // Only the frame fallback: nothing runs on the next task while frames still come.
    expect(timeout).not.toHaveBeenCalledWith(flush, 0);
  });

  it("falls back to a timeout in a hidden tab, where frames never fire", () => {
    const raf = vi.fn();
    const timeout = vi.fn();
    const flush = () => undefined;
    scheduleFlush(flush, { hidden: true, raf, timeout });
    expect(raf).not.toHaveBeenCalled();
    expect(timeout).toHaveBeenCalledWith(flush, 0);
  });
});

describe("scheduleFlush: a tab hidden after scheduling (M5 gap)", () => {
  it("also sets a timeout, so a frame that never comes cannot hold the batch", () => {
    const raf = vi.fn();
    const timeout = vi.fn();
    const flush = () => undefined;
    scheduleFlush(flush, { hidden: false, raf, timeout });
    expect(raf).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(flush, expect.any(Number));
  });
});
