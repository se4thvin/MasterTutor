import { createHash } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Frame,
  type Page,
} from "playwright-core";
import { abortable } from "../runtime/abortable.ts";
import type { Log } from "../runtime/types.ts";
import { DownloadGate, type DownloadFolder } from "./download-gate.ts";
import { NEAR_FRAME_MARGIN_PX, ownerBoxCovers } from "./frame-owner-box.ts";
import { sessionChannel, watchFrameTargets } from "./frame-watch.ts";
import { PendingNavigations } from "./pending-navigations.ts";
import { ControlGuard } from "./guard.ts";
import { IsolatedWorlds, type WorldOptions } from "./isolated-world.ts";
import { NavigationTracker } from "./navigation.ts";
import {
  installNetworkPolicy,
  isAllowedNavigationScheme,
  isFixtureHost,
  type BlockedNavigation,
  type HostResolver,
  type NetworkPolicy,
  type PrivateConnection,
} from "./network-policy.ts";

export interface Layout {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

/** A main-frame response kept for a later Network.getResponseBody (newest last). */
export interface LoggedResponse {
  requestId: string;
  url: string;
  status: number;
  frameId: string;
  /** Encoded body size once loading finished; null while in flight. */
  bytes: number | null;
}

const RESPONSE_LOG_SIZE = 8;
/** Chromium's body buffers while the response log is on: caption tracks are small (M8). */
export const RESPONSE_LOG_BUFFERS = {
  maxTotalBufferSize: 16 * 1024 * 1024,
  maxResourceBufferSize: 4 * 1024 * 1024,
} as const;

export interface BrowserSessionOptions {
  cdpBaseUrl: string;
  allowedOrigins(): readonly string[];
  testMode: boolean;
  log: Log;
  guard?: ControlGuard;
  resolveHost?: HostResolver;
  /** The run's downloads folder (`/downloads/<runId>`). Without it downloads stay denied even when approved. */
  downloads?: DownloadFolder;
  /** Keeps matching main-frame responses so a tool can read a body the page fetched earlier (B4). */
  responseLog?: (url: URL) => boolean;
  /** Applied to every URL the response log keeps (the run's vault redactor), before any copy (M12). */
  redactUrl?: (url: string) => string;
}

/** A navigation check that takes longer than this counts as near the point (fail closed). */
const NAVIGATION_CHECK_BUDGET_MS = 250;
/** Playwright refuses a separate CDP session for a frame in its parent's process with this. */
const IN_PROCESS_FRAME = /does not have a separate CDP session/;

/**
 * One leased slot's Chromium over CDP (spec §3.3 `browser`): the default context, no emulated
 * viewport, so the agent and the live view see the same window. Follows tabs the page opens.
 */
export class BrowserSession {
  readonly guard: ControlGuard;
  readonly navigations = new NavigationTracker();
  /** Screenshot pixels per CSS pixel of the last model screenshot (≤ 1); read_page and computer use it. */
  lastScale = 1;
  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #log: Log;
  #page: Page;
  #cdp: Promise<CDPSession> | null = null;
  #browserCdp: Promise<CDPSession> | null = null;
  #worlds: Promise<IsolatedWorlds> | null = null;
  /** Out-of-process frames (R29-1): their own CDP session's worlds and CDP frame id. */
  readonly #outOfProcess = new Map<Frame, Promise<{ id: string; worlds: IsolatedWorlds } | null>>();
  /** In-process frames and the URL they were found at: not re-probed until they navigate (M9). */
  #inProcess = new WeakMap<Frame, string>();
  #blocked: BlockedNavigation[] = [];
  #privateHits: PrivateConnection[] = [];
  #policy: NetworkPolicy | null = null;
  #adopting: Promise<void> | null = null;
  #downloads: DownloadGate | null = null;
  /** Resolves once the slot's browser is gone (closed or the connection dropped). */
  readonly disconnected: Promise<void>;
  readonly #pendingNavigations = new PendingNavigations();
  /** The current page's out-of-process frames (CDP ids), each with the one it lies in (null: none). */
  #frameParents = new Map<string, string | null>();
  /** Resolves once the current page's frames are followed (a navigation after it is observed). */
  #framesWatched: Promise<void> = Promise.resolve();
  readonly #testMode: boolean;
  readonly #responseLog: ((url: URL) => boolean) | null;
  readonly #redactUrl: (url: string) => string;
  #responses: LoggedResponse[] = [];
  readonly #named = new Map<string, Promise<IsolatedWorlds>>();
  readonly #responseWaiters = new Set<(entry: LoggedResponse) => void>();

  private constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    options: BrowserSessionOptions,
  ) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#log = options.log;
    this.guard = options.guard ?? new ControlGuard();
    this.#testMode = options.testMode;
    this.#responseLog = options.responseLog ?? null;
    this.#redactUrl = options.redactUrl ?? ((url) => url);
    this.disconnected = new Promise((resolve) => browser.once("disconnected", () => resolve()));
  }

  static async connect(options: BrowserSessionOptions): Promise<BrowserSession> {
    const browser = await chromium.connectOverCDP(options.cdpBaseUrl, { timeout: 20_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("the slot browser has no default context");
    const page = context.pages().at(-1) ?? (await context.newPage());
    const session = new BrowserSession(browser, context, page, options);
    try {
      // Before anything else runs on this connection: downloads are denied (spec §9).
      session.#downloads = await DownloadGate.install(
        browser,
        options.downloads ?? null,
        options.log,
      );
      session.#policy = await installNetworkPolicy(context, {
        allowedOrigins: options.allowedOrigins,
        testMode: options.testMode,
        onBlockedNavigation: (block) => session.#blocked.push(block),
        onPrivateConnection: (hit) => session.#onPrivateConnection(hit),
        resolveHost: options.resolveHost,
      });
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
    session.#adopt(page);
    context.on("page", (opened) => {
      // From the moment it exists: a navigation it starts before adoption is still tracked.
      session.#pendingNavigations.watch(opened);
      session.#adopting = session.#onNewPage(opened).finally(() => {
        session.#adopting = null;
      });
    });
    return session;
  }

  get page(): Page {
    return this.#page;
  }

  get context(): BrowserContext {
    return this.#context;
  }

  /** Every download is denied until a person approves it (spec §9). */
  get downloads(): DownloadGate {
    if (!this.#downloads) throw new Error("not connected");
    return this.#downloads;
  }

  /** True while any frame of the page has a document-replacing navigation in flight. */
  navigationPending(): boolean {
    return this.#pendingNavigations.pending(this.#page);
  }

  /**
   * Whether a navigation in flight could put a new document under `point` (top viewport CSS px):
   * one in the main frame always can; one in a subframe when the box of its frame (or of the
   * out-of-process frame it lies in), 8 px around, holds the point, or that box cannot be read
   * (in time: NAVIGATION_CHECK_BUDGET_MS).
   */
  navigationNear(point: { x: number; y: number }): Promise<boolean> {
    return Promise.race([
      this.#navigationNear(point).catch(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(true), NAVIGATION_CHECK_BUDGET_MS).unref(),
      ),
    ]);
  }

  async #navigationNear(point: { x: number; y: number }): Promise<boolean> {
    const { mainFrame, frames, unknown } = this.#pendingNavigations.inFlight(this.#page);
    if (mainFrame || unknown.includes(null)) return true;
    // A frame inside an out-of-process frame lies within that frame's box.
    const near = await Promise.all([
      ...frames.map(({ frameId, root }) => this.frameNear(root ?? frameId, point)),
      ...unknown.map((root) => this.frameNear(root!, point)),
    ]);
    return near.includes(true);
  }

  /**
   * Whether frame `frameId` (CDP id) could be under `point` (top viewport CSS px): the main frame
   * always; another when the box of its owner, 8 px around, holds the point. The box is read in
   * the page's own session; a frame nested in an out-of-process frame counts as that frame's box
   * (which bounds it). A box that cannot be read counts as near (fail closed).
   */
  async frameNear(frameId: string, point: { x: number; y: number }): Promise<boolean> {
    const top = await this.worlds();
    if (frameId === (await top.mainFrameId())) return true;
    const parent = this.#frameParents.get(frameId);
    if (parent) return this.frameNear(parent, point);
    return ownerBoxCovers(top.cdp, frameId, point, NEAR_FRAME_MARGIN_PX);
  }

  /**
   * Follows the page's frames for its lifetime (frame-watch.ts): every out-of-process frame is held
   * until its navigations are tracked, so none starts unobserved. The page's own frames are
   * tracked from adoption (late: what was already loading counts as navigating, see
   * PendingNavigations.watchFrames).
   */
  async #watchFrames(page: Page, parents: Map<string, string | null>): Promise<void> {
    const cdp = await this.#context.newCDPSession(page).catch(() => null);
    if (!cdp) return;
    const root = sessionChannel(cdp);
    const unwatchTop = this.#pendingNavigations.watchFrames(page, root, null, true);
    const unwatch = new Map<string, () => void>();
    cdp.once("close", () => {
      unwatchTop();
      for (const stop of unwatch.values()) stop();
    });
    await root.send("Page.enable").catch(() => undefined);
    await watchFrameTargets(root, {
      attached: (channel, targetId, parent, late) => {
        parents.set(targetId, parent);
        unwatch.get(targetId)?.();
        unwatch.set(targetId, this.#pendingNavigations.watchFrames(page, channel, targetId, late));
      },
      detached: (targetId) => {
        unwatch.get(targetId)?.();
        unwatch.delete(targetId);
        parents.delete(targetId);
      },
    });
  }

  cdp(): Promise<CDPSession> {
    if (this.#cdp === null) {
      const attempt = this.#context.newCDPSession(this.#page).then(async (cdp) => {
        await cdp.send("DOM.enable");
        // Frame events (Page.frameAttached/frameNavigated) for the typing guard.
        await cdp.send("Page.enable");
        const page = this.#page;
        // Current only while this tab is followed through this very session: a re-adopted opener
        // gets a new session, and its old one must not log a second copy (N2).
        await this.#watchResponses(cdp, () => page === this.#page && this.#cdp === attempt);
        return cdp;
      });
      this.#cdp = attempt;
      // A failed attempt must not be cached forever.
      attempt.catch(() => {
        if (this.#cdp === attempt) this.#cdp = null;
      });
    }
    return this.#cdp;
  }

  /** A browser-level CDP session (the Browser.* domain, e.g. downloads), opened once per lease. */
  browserCdp(): Promise<CDPSession> {
    if (this.#browserCdp === null) {
      const attempt = this.#browser.newBrowserCDPSession();
      this.#browserCdp = attempt;
      attempt.catch(() => {
        if (this.#browserCdp === attempt) this.#browserCdp = null;
      });
    }
    return this.#browserCdp;
  }

  /**
   * The isolated worlds of every out-of-process frame (site isolation), by CDP frame id, each on the
   * frame's own CDP session. In-process frames are reached through worlds() with their frame id
   * instead (Playwright refuses a separate session for them). Only browser-side calls are made, so
   * a hung frame cannot stall this; sessions of frames that are gone are closed.
   */
  async outOfProcessFrames(): Promise<Map<string, IsolatedWorlds>> {
    return (await this.frameCoverage()).outOfProcess;
  }

  /**
   * outOfProcessFrames(), plus how many live child frames are in neither set: their attach failed
   * for another reason than sharing the parent's process (a transient CDP error, a process swap).
   * Such a frame may be out of process yet unreadable, so a secret scan must fail closed on it.
   */
  async frameCoverage(): Promise<{
    outOfProcess: Map<string, IsolatedWorlds>;
    unattached: number;
  }> {
    const live = new Set(this.#page.frames());
    for (const [frame, entry] of this.#outOfProcess) {
      if (live.has(frame)) continue;
      this.#outOfProcess.delete(frame);
      void entry.then((found) => found?.worlds.cdp.detach().catch(() => undefined));
    }
    for (const frame of live)
      if (
        frame !== this.#page.mainFrame() &&
        !this.#outOfProcess.has(frame) &&
        this.#inProcess.get(frame) !== frame.url()
      )
        this.#outOfProcess.set(frame, this.#attach(frame));
    const found = new Map<string, IsolatedWorlds>();
    let unattached = 0;
    await Promise.all(
      [...this.#outOfProcess].map(async ([frame, entry]) => {
        const attached = await entry;
        if (attached) found.set(attached.id, attached.worlds);
        else {
          // Not kept here (retried next call): a frame can move to another process when it navigates.
          if (this.#outOfProcess.get(frame) === entry) this.#outOfProcess.delete(frame);
          if (this.#inProcess.get(frame) !== frame.url()) unattached += 1;
        }
      }),
    );
    return { outOfProcess: found, unattached };
  }

  async #attach(frame: Frame): Promise<{ id: string; worlds: IsolatedWorlds } | null> {
    const url = frame.url();
    const cdp = await this.#context.newCDPSession(frame).catch((error: unknown) => {
      // Playwright's answer for a frame that shares its parent's process: remember it at this URL.
      if (error instanceof Error && IN_PROCESS_FRAME.test(error.message))
        this.#inProcess.set(frame, url);
      return null;
    });
    if (!cdp) return null;
    // An out-of-process frame's target id is its frame id; the browser answers, not the frame.
    const info = await cdp.send("Target.getTargetInfo").catch(() => null);
    if (!info) {
      await cdp.detach().catch(() => undefined);
      return null;
    }
    void cdp.send("Page.enable").catch(() => undefined);
    return { id: info.targetInfo.targetId, worlds: new IsolatedWorlds(cdp) };
  }

  /**
   * The CDP session of an out-of-process frame (site isolation), by CDP frame id; null when the
   * frame is in process or gone. In-process frames are reached through the page session instead.
   */
  async frameCdp(frameId: string): Promise<CDPSession | null> {
    return (await this.outOfProcessFrames()).get(frameId)?.cdp ?? null;
  }

  /** The worlds of one out-of-process frame; null when the frame is in process or gone. */
  async frameWorlds(frameId: string): Promise<IsolatedWorlds | null> {
    return (await this.outOfProcessFrames()).get(frameId) ?? null;
  }

  /** Drops a failed out-of-process frame and closes its CDP session (no leak per failure). */
  async forgetFrame(frameId: string): Promise<void> {
    for (const [frame, entry] of this.#outOfProcess) {
      const found = await entry;
      if (found?.id !== frameId) continue;
      this.#outOfProcess.delete(frame);
      await found.worlds.cdp.detach().catch(() => undefined);
    }
  }

  worlds(): Promise<IsolatedWorlds> {
    if (this.#worlds === null) {
      const attempt = this.cdp().then((cdp) => new IsolatedWorlds(cdp));
      this.#worlds = attempt;
      attempt.catch(() => {
        if (this.#worlds === attempt) this.#worlds = null;
      });
    }
    return this.#worlds;
  }

  /** A further isolated world on the foreground tab with its own name and prelude; cached per tab. */
  /**
   * A further isolated world on the foreground tab with its own name and prelude; cached per tab
   * by name and prelude source, so a caller with another prelude never gets this one (M6).
   */
  async namedWorlds(options: WorldOptions & { name: string }): Promise<IsolatedWorlds> {
    const source = options.prelude ? await options.prelude() : "";
    const key = `${options.name}\u0000${createHash("sha256").update(source).digest("hex")}`;
    const cached = this.#named.get(key);
    if (cached) return cached;
    const attempt = this.cdp().then(
      (cdp) =>
        new IsolatedWorlds(cdp, {
          name: options.name,
          ...(options.prelude ? { prelude: async () => source } : {}),
        }),
    );
    this.#named.set(key, attempt);
    attempt.catch(() => {
      if (this.#named.get(key) === attempt) this.#named.delete(key);
    });
    return attempt;
  }

  /**
   * Whether a page-supplied URL may be fetched through this browser (spec §5.5): http(s) only, never
   * a private, loopback, link-local or reserved host. `Network.loadNetworkResource` bypasses
   * context.route, so every resource fetch asks here first (preflight S1). Fixture hosts pass in
   * test mode only. The slot's iptables rules stay the boundary for redirects.
   */
  async allowsFetch(raw: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (this.#testMode && isFixtureHost(url.hostname)) return true;
    if (!this.#policy) return false;
    return !(await this.#policy.privateHosts.isPrivate(url.hostname));
  }

  /** Responses `responseLog` accepted on this tab's main frame, oldest first. */
  recentResponses(): readonly LoggedResponse[] {
    return [...this.#responses];
  }

  /** The next logged response that finishes loading and passes `test`; null at the timeout (event-driven). */
  nextResponse(
    test: (entry: LoggedResponse) => boolean,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<LoggedResponse | null> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.#responseWaiters.delete(waiter);
        signal.removeEventListener("abort", onAbort);
      };
      const waiter = (entry: LoggedResponse) => {
        if (!test(entry)) return;
        finish();
        resolve(entry);
      };
      const onAbort = () => {
        finish();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        finish();
        resolve(null);
      }, timeoutMs);
      this.#responseWaiters.add(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Logs the followed tab's matching main-frame responses. A tab the session no longer follows (an
   * opener after a popup was adopted) keeps its CDP session, so `current()` drops its events: they
   * are another document's (I3), or a second copy once the opener is re-adopted (N2).
   */
  async #watchResponses(cdp: CDPSession, current: () => boolean): Promise<void> {
    const match = this.#responseLog;
    if (!match) return;
    const redact = this.#redactUrl;
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const mainFrame = frameTree.frame.id;
    cdp.on("Network.responseReceived", (event) => {
      if (!current() || event.frameId !== mainFrame) return;
      let url: URL;
      try {
        url = new URL(event.response.url);
      } catch {
        return;
      }
      if (!match(url)) return;
      this.#responses.push({
        requestId: event.requestId,
        // Redacted before any copy exists: a later note or log stores this string (M12).
        url: redact(url.href),
        status: event.response.status,
        frameId: event.frameId,
        bytes: null,
      });
      if (this.#responses.length > RESPONSE_LOG_SIZE) this.#responses.shift();
    });
    cdp.on("Network.loadingFinished", (event) => {
      if (!current()) return;
      const entry = this.#responses.find((logged) => logged.requestId === event.requestId);
      if (!entry) return;
      entry.bytes = event.encodedDataLength;
      for (const waiter of [...this.#responseWaiters]) waiter(entry);
    });
    // Bounded: Chromium keeps bodies for Network.getResponseBody only up to these sizes (M8).
    await cdp.send("Network.enable", RESPONSE_LOG_BUFFERS);
  }

  async layout(): Promise<Layout> {
    const metrics = await (await this.cdp()).send("Page.getLayoutMetrics");
    const viewport = metrics.cssVisualViewport;
    return {
      width: Math.round(viewport.clientWidth),
      height: Math.round(viewport.clientHeight),
      scrollX: viewport.pageX,
      scrollY: viewport.pageY,
    };
  }

  /** Navigates the active tab; false when blocked or failed (never throws for network errors). */
  async goto(url: string, signal: AbortSignal): Promise<boolean> {
    this.guard.assertAgent(signal);
    if (!isAllowedNavigationScheme(url)) return false;
    const hitsBefore = this.#privateHits.length;
    try {
      // The new document's frames are followed from its commit on (their navigations observed).
      await abortable(this.#framesWatched, signal);
      await abortable(
        this.#page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
        signal,
      );
      await abortable(this.#policy?.settled() ?? Promise.resolve(), signal);
      return this.#privateHits.length === hitsBefore;
    } catch {
      if (signal.aborted) throw signal.reason;
      this.#log.debug({ errorCode: "navigation_failed" }, "navigation failed");
      return false;
    }
  }

  pendingAdoption(): Promise<void> {
    return this.#adopting ?? Promise.resolve();
  }

  drainPrivateConnections(): PrivateConnection[] {
    return this.#privateHits.splice(0);
  }

  drainBlockedNavigations(): BlockedNavigation[] {
    return this.#blocked.splice(0);
  }

  /** Disconnects Playwright only. Recycling the browser is the slot pool's job (Browser.close). */
  async close(): Promise<void> {
    await this.#browser.close().catch(() => undefined);
  }

  /** A response came from a private address: record it and leave the page (iptables is the boundary; this is defence in depth). */
  #onPrivateConnection(hit: PrivateConnection): void {
    this.#privateHits.push(hit);
    this.#log.warn({ errorCode: "private_connection" }, "response from a private address");
    if (hit.topLevel) void this.#page.goto("about:blank").catch(() => undefined);
  }

  #adopt(page: Page): void {
    this.#page = page;
    this.#frameParents = new Map();
    this.#framesWatched = this.#watchFrames(page, this.#frameParents).catch(() => undefined);
    this.#cdp = null;
    this.#worlds = null;
    for (const entry of this.#outOfProcess.values())
      void entry.then((found) => found?.worlds.cdp.detach().catch(() => undefined));
    this.#outOfProcess.clear();
    this.#inProcess = new WeakMap();
    this.#named.clear();
    this.#responses = [];
    // A logged response belongs to the document that fetched it: a new main-frame URL (including
    // same-document SPA navigations) starts a fresh log.
    page.on("framenavigated", (frame) => {
      if (page === this.#page && frame === page.mainFrame()) this.#responses = [];
    });
    // The log covers the adopted tab from here on; requests it made before adoption (a popup is
    // adopted after domcontentloaded) are not in it.
    if (this.#responseLog) void this.cdp().catch(() => undefined);
    this.navigations.attach(page);
    // F2: a frame that navigates, even to the same URL (a reload after a crash), may come back in
    // another process: probe it again rather than trust the cache.
    page.on("framenavigated", (frame) => this.#inProcess.delete(frame));
    page.once("close", () => this.#onClose(page));
    void page.bringToFront().catch(() => undefined);
    // From adoption on, every frame's navigations (Playwright attaches each frame before it runs),
    // and those the page's own CDP session reports.
    this.#pendingNavigations.watch(page);
    void this.cdp().catch(() => undefined);
  }

  async #onNewPage(page: Page): Promise<void> {
    const opener = await page.opener().catch(() => null);
    if (opener !== this.#page) return;
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    this.#adopt(page);
  }

  #onClose(page: Page): void {
    if (page !== this.#page) return;
    const next = this.#context
      .pages()
      .filter((candidate) => !candidate.isClosed())
      .at(-1);
    if (next) this.#adopt(next);
  }
}
