import type { Frame, Page, Request } from "playwright-core";

/** After its response has fully arrived, a navigation that does not commit (a 204, a download) ends this late. */
const NO_COMMIT_GRACE_MS = 1_000;

/**
 * The navigation requests in flight in a page's frames: any that replaces a document (a link, a
 * `src` or `location` change, a form, a reload, a redirect, a history move to another entry),
 * in every frame including out-of-process ones (Playwright attaches each before it runs).
 * Same-document moves (pushState, a fragment) send no request and never count. A click arms only
 * the documents that exist, and a navigation already under way is never held for the guard, so
 * while one is pending the page counts as changed and the click is refused. Nothing is dropped
 * for taking long: a request the server holds back stays pending until it commits, fails, or
 * its frame goes away.
 */
export class PendingNavigations {
  readonly #pages = new WeakMap<Page, Map<Request, Frame>>();

  watch(page: Page): void {
    if (this.#pages.has(page)) return;
    const inFlight = new Map<Request, Frame>();
    this.#pages.set(page, inFlight);
    // Requests whose response has arrived: only those can have committed. A same-document move
    // (replaceState, a fragment) to the request's own URL while it is held must not clear it.
    const answered = new WeakSet<Request>();
    const detached = (frame: Frame) => {
      for (const [request, owner] of inFlight) if (owner === frame) inFlight.delete(request);
    };
    // Playwright also reports same-document moves as navigations: only an answered request whose
    // URL the frame now shows has committed.
    const committed = (frame: Frame) => {
      const url = withoutFragment(frame.url());
      for (const [request, owner] of inFlight)
        if (owner === frame && answered.has(request) && withoutFragment(request.url()) === url)
          for (let hop: Request | null = request; hop; hop = hop.redirectedFrom())
            inFlight.delete(hop);
    };
    page.on("request", (request) => {
      try {
        if (request.isNavigationRequest()) inFlight.set(request, request.frame());
      } catch {
        // A service worker's request has no frame: not a document navigation.
      }
    });
    page.on("response", (response) => answered.add(response.request()));
    page.on("requestfailed", (request) => inFlight.delete(request));
    page.on("requestfinished", (request) => {
      if (!inFlight.has(request)) return;
      setTimeout(() => inFlight.delete(request), NO_COMMIT_GRACE_MS).unref();
    });
    page.on("framenavigated", committed);
    page.on("framedetached", detached);
  }

  /** True while a navigation is in flight in any frame of `page`. */
  pending(page: Page): boolean {
    return (this.#pages.get(page)?.size ?? 0) > 0;
  }
}

function withoutFragment(url: string): string {
  const at = url.indexOf("#");
  return at === -1 ? url : url.slice(0, at);
}
