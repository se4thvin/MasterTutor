import type { CDPSession } from "playwright-core";

/** A navigation that never reports its end stops counting after this long (never wedges clicks). */
const STALE_MS = 30_000;

/**
 * Frames of the page with a document-replacing navigation in flight, across every CDP session
 * the browser session watches (the page's and each out-of-process frame's). A click arms only the
 * documents that exist; a navigation already under way when it arms is never held for the guard,
 * so while one is pending the page counts as changed (the click is refused and looked at again).
 */
export class PendingNavigations {
  readonly #started = new Map<string, number>();

  watch(cdp: CDPSession): void {
    cdp.on("Page.frameStartedNavigating", (event) => {
      if (event.navigationType === "differentDocument")
        this.#started.set(event.frameId, Date.now());
    });
    const end = (frameId: string) => this.#started.delete(frameId);
    cdp.on("Page.frameNavigated", (event) => end(event.frame.id));
    cdp.on("Page.frameDetached", (event) => end(event.frameId));
    cdp.on("Page.frameStoppedLoading", (event) => end(event.frameId));
  }

  /** True while any watched frame has a navigation in flight. */
  any(): boolean {
    const now = Date.now();
    for (const [frameId, at] of this.#started)
      if (now - at > STALE_MS) this.#started.delete(frameId);
    return this.#started.size > 0;
  }
}
