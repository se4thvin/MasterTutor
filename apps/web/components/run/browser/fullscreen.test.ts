import { describe, expect, it, vi } from "vitest";
import { enterFullscreen, exitFullscreen } from "./fullscreen.ts";

describe("full screen with keyboard lock", () => {
  it("requests full screen, then locks the keyboard so ⌘T/⌘W/⌘N reach the page", async () => {
    const order: string[] = [];
    const el = { requestFullscreen: vi.fn(async () => void order.push("fullscreen")) };
    const keyboard = { lock: vi.fn(async () => void order.push("lock")), unlock: vi.fn() };
    await expect(enterFullscreen(el, keyboard)).resolves.toBe(true);
    expect(order).toEqual(["fullscreen", "lock"]);
  });

  it("still succeeds where keyboard.lock is missing or refused", async () => {
    const el = { requestFullscreen: vi.fn(async () => undefined) };
    await expect(enterFullscreen(el, undefined)).resolves.toBe(true);
    await expect(
      enterFullscreen(el, { lock: async () => Promise.reject(new Error("no")) }),
    ).resolves.toBe(true);
  });

  it("reports failure when full screen is refused", async () => {
    const el = { requestFullscreen: vi.fn(async () => Promise.reject(new Error("denied"))) };
    await expect(enterFullscreen(el, undefined)).resolves.toBe(false);
  });

  it("unlocks and exits", () => {
    const keyboard = { unlock: vi.fn() };
    const doc = { fullscreenElement: {} as Element, exitFullscreen: vi.fn(async () => undefined) };
    exitFullscreen(doc, keyboard);
    expect(keyboard.unlock).toHaveBeenCalled();
    expect(doc.exitFullscreen).toHaveBeenCalled();
  });
});
