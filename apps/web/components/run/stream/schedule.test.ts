import { describe, expect, it, vi } from "vitest";
import { scheduleFlush } from "./schedule.ts";

describe("scheduleFlush (M5)", () => {
  it("batches per animation frame while the tab is visible", () => {
    const raf = vi.fn((_cb: () => void) => 7);
    const timeout = vi.fn((_cb: () => void, _ms: number) => undefined);
    const flush = vi.fn();
    scheduleFlush(flush, { hidden: false, raf, timeout });
    expect(raf).toHaveBeenCalledTimes(1);
    // Only the frame fallback: nothing runs on the next task while frames still come.
    expect(timeout.mock.calls.every(([, ms]) => ms > 0)).toBe(true);
    raf.mock.calls[0]?.[0]();
    expect(flush).toHaveBeenCalledTimes(1);
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
    const raf = vi.fn((_cb: () => void) => 1);
    const timeout = vi.fn((_cb: () => void, _ms: number) => undefined);
    const flush = vi.fn();
    scheduleFlush(flush, { hidden: false, raf, timeout });
    expect(raf).toHaveBeenCalledTimes(1);
    // The frame never comes: the backstop flushes the batch on its own.
    timeout.mock.calls[0]?.[0]();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleFlush: one flush per schedule (final M10)", () => {
  it("never lets the leftover backstop flush the next batch early", () => {
    let frame: (() => void) | undefined;
    let backstop: (() => void) | undefined;
    const flush = vi.fn();
    scheduleFlush(flush, {
      hidden: false,
      raf: (cb) => {
        frame = cb;
        return 1;
      },
      timeout: (cb) => {
        backstop = cb;
        return 1;
      },
    });
    frame?.();
    backstop?.();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
