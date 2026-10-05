import type { Frame, Page, Request } from "playwright-core";

/** After its response has fully arrived, a navigation that does not commit (a 204, a download) ends this late. */
const NO_COMMIT_GRACE_MS = 1_000;
/** CDP navigation types that keep the document. */
const SAME_DOCUMENT = new Set(["sameDocument", "historySameDocument"]);

/** Where a channel's Page events come from (a CDP channel, frame-watch.ts). */
type FrameEvents = { on(method: string, listener: (params: never) => void): unknown };
type StartedNavigating = { frameId: string; navigationType: string };

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
   * Per CDP channel of a page: the out-of-process frame it belongs to (null for the page's own),
   * the frames (CDP ids) it saw start a navigation not yet ended, and whether it was found late.
   */
  readonly #sessions = new WeakMap<
    Page,
    Map<FrameEvents, { root: string | null; navigating: Set<string>; unknown: boolean }>
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
   * Also tracks the navigations of the frames `events` (a CDP channel of `page`, before Page.enable)
   * hosts, from their start to their end as the browser reports it: committed, the frame detached
   * (a move to another process included, at its commit) or stopped loading (a 204, a download).
   * `root`: the out-of-process frame the channel belongs to (null: the page's own process).
   * `late`: the channel was found after its frames could run, so a navigation it never saw may be
   * under way: until its own frame next commits or stops, it
   * counts as navigating, unless `loaded()` says its document had finished loading by then. Returns
   * `stop` (the channel is gone) and `loaded`.
   */
  watchFrames(
    page: Page,
    events: FrameEvents,
    root: string | null,
    late: boolean,
  ): { stop(): void; loaded(): void } {
    let sessions = this.#sessions.get(page);
    if (!sessions) this.#sessions.set(page, (sessions = new Map()));
    const entry = { root, navigating: new Set<string>(), unknown: late };
    sessions.set(events, entry);
    const ends = (frameId: string, main: boolean) => {
      entry.navigating.delete(frameId);
      if (frameId === root || (root === null && main)) entry.unknown = false;
    };
    events.on("Page.frameStartedNavigating", (({ frameId, navigationType }: StartedNavigating) => {
      if (!SAME_DOCUMENT.has(navigationType)) entry.navigating.add(frameId);
    }) as (params: never) => void);
    events.on("Page.frameNavigated", (({ frame }: { frame: { id: string; parentId?: string } }) =>
      ends(frame.id, frame.parentId === undefined)) as (params: never) => void);
    events.on("Page.frameDetached", (({ frameId }: { frameId: string }) =>
      entry.navigating.delete(frameId)) as (params: never) => void);
    events.on("Page.frameStoppedLoading", (({ frameId }: { frameId: string }) =>
      ends(frameId, false)) as (params: never) => void);
    return {
      stop: () => {
        if (sessions.get(events) === entry) sessions.delete(events);
      },
      loaded: () => {
        entry.unknown = false;
      },
    };
  }

  /** True while a navigation is in flight in any frame of `page`. */
  pending(page: Page): boolean {
    const { mainFrame, frames, unknown } = this.inFlight(page);
    return mainFrame || frames.length > 0 || unknown.length > 0;
  }

  /**
   * What of `page` may be navigating: its main frame (by Playwright's requests); the CDP frame ids
   * the channels reported, each with the out-of-process frame its channel belongs to (null: the
   * page's own process); and the channels found late whose frames may be (their root).
   */
  inFlight(page: Page): {
    mainFrame: boolean;
    frames: Array<{ frameId: string; root: string | null }>;
    unknown: Array<string | null>;
  } {
    const requested = [...(this.#pages.get(page)?.values() ?? [])];
    const mainFrame = requested.includes(page.mainFrame());
    const entries = [...(this.#sessions.get(page)?.values() ?? [])];
    const frames = entries.flatMap(({ root, navigating }) =>
      [...navigating].map((frameId) => ({ frameId, root })),
    );
    const unknown = entries.filter((entry) => entry.unknown).map((entry) => entry.root);
    return { mainFrame, frames, unknown };
  }
}

function withoutFragment(url: string): string {
  const at = url.indexOf("#");
  return at === -1 ? url : url.slice(0, at);
}
