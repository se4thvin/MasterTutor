import type { Page, Request } from "playwright-core";

/** Counts in-flight main-frame navigations per page so settle() can wait for them. */
export class NavigationTracker {
  readonly #pending = new WeakMap<Page, Set<Request>>();

  attach(page: Page): void {
    if (this.#pending.has(page)) return;
    const inFlight = new Set<Request>();
    this.#pending.set(page, inFlight);
    const isMain = (request: Request) => {
      try {
        return request.isNavigationRequest() && request.frame() === page.mainFrame();
      } catch {
        return false;
      }
    };
    page.on("request", (request) => {
      if (isMain(request)) inFlight.add(request);
    });
    page.on("requestfinished", (request) => inFlight.delete(request));
    page.on("requestfailed", (request) => inFlight.delete(request));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) inFlight.clear();
    });
  }

  pending(page: Page): number {
    return this.#pending.get(page)?.size ?? 0;
  }
}
