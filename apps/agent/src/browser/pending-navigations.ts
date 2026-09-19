import type { CDPSession, Frame, Page, Request } from "playwright-core";

/** After its response has fully arrived, a navigation that does not commit (a 204, a download) ends this late. */
const NO_COMMIT_GRACE_MS = 1_000;
/** CDP navigation types that keep the document. */
const SAME_DOCUMENT = new Set(["sameDocument", "historySameDocument"]);

/**
 * The navigation requests in flight in a page's frames: any that replaces a document (a link, a
 * `src` or `location` change, a form, a reload, a redirect, a history move to another entry),
 * in every frame including out-of-process ones (Playwright attaches each before it runs).
 * Same-document moves (pushState, a fragment) send no request and never count. A click arms only
 * the documents that exist, and a navigation already under way is never held for the guard, so
 * while one is pending the page counts as changed and the click is refused. Nothing is dropped
 * for taking long: a request the server holds back stays pending until it commits, fails, or
 * its frame goes away.
 *
 * The browser's own account backs this up (watchFrames): Playwright can report a frame detached
 * while it only moves to another process, before its new document commits.
 */
export class PendingNavigations {
  readonly #pages = new WeakMap<Page, Map<Request, Frame>>();
  /**
   * Per CDP session of a page: the out-of-process frame it belongs to (null for the page's own),
   * and the frames (CDP ids) it saw start a navigation not yet ended.
   */
  readonly #sessions = new WeakMap<
    Page,
    Map<CDPSession, { root: string | null; navigating: Set<string> }>
  >();

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

  /**
   * Also tracks the navigations of the frames `cdp` (a CDP session of `page`, before Page.enable)
   * hosts, from their start to their end as the browser reports it: committed, the frame detached
   * (a move to another process included, at its commit) or stopped loading (a 204, a download).
   */
  watchFrames(page: Page, cdp: CDPSession, root: string | null): void {
    let sessions = this.#sessions.get(page);
    if (!sessions) this.#sessions.set(page, (sessions = new Map()));
    if (sessions.has(cdp)) return;
    const navigating = new Set<string>();
    sessions.set(cdp, { root, navigating });
    cdp.on("Page.frameStartedNavigating", ({ frameId, navigationType }) => {
      if (!SAME_DOCUMENT.has(navigationType)) navigating.add(frameId);
    });
    cdp.on("Page.frameNavigated", ({ frame }) => navigating.delete(frame.id));
    cdp.on("Page.frameDetached", ({ frameId }) => navigating.delete(frameId));
    cdp.on("Page.frameStoppedLoading", ({ frameId }) => navigating.delete(frameId));
    cdp.once("close", () => sessions.delete(cdp));
  }

  /** True while a navigation is in flight in any frame of `page`. */
  pending(page: Page): boolean {
    const { frames, frameIds } = this.inFlight(page);
    return frames.length > 0 || frameIds.length > 0;
  }

  /**
   * The frames of `page` with a navigation in flight: Playwright's frames (by their requests), and
   * the CDP frame ids the sessions reported, each with the out-of-process frame its session belongs
   * to (null: the page's own session).
   */
  inFlight(page: Page): {
    frames: Frame[];
    frameIds: Array<{ frameId: string; root: string | null }>;
  } {
    const frames = [...new Set(this.#pages.get(page)?.values() ?? [])];
    const frameIds = [...(this.#sessions.get(page)?.values() ?? [])].flatMap(
      ({ root, navigating }) => [...navigating].map((frameId) => ({ frameId, root })),
    );
    return { frames, frameIds };
  }
}

function withoutFragment(url: string): string {
  const at = url.indexOf("#");
  return at === -1 ? url : url.slice(0, at);
}
