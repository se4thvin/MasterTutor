import { describe, expect, it, vi } from "vitest";
import { scheduleFlush } from "./schedule.ts";

describe("scheduleFlush (M5)", () => {
  it("batches per animation frame while the tab is visible", () => {
    const raf = vi.fn(() => 7);
    const timeout = vi.fn();
    scheduleFlush(() => undefined, { hidden: false, raf, timeout });
    expect(raf).toHaveBeenCalledTimes(1);
    expect(timeout).not.toHaveBeenCalled();
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
