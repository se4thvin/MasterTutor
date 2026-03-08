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
import { ControlGuard } from "./guard.ts";
import { IsolatedWorlds } from "./isolated-world.ts";
import { NavigationTracker } from "./navigation.ts";
import {
  installNetworkPolicy,
  isAllowedNavigationScheme,
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

export interface BrowserSessionOptions {
  cdpBaseUrl: string;
  allowedOrigins(): readonly string[];
  testMode: boolean;
  log: Log;
  guard?: ControlGuard;
  resolveHost?: HostResolver;
}

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
  #worlds: Promise<IsolatedWorlds> | null = null;
  /** Out-of-process frames (R29-1): their own CDP session's worlds and CDP frame id. */
  readonly #outOfProcess = new Map<Frame, Promise<{ id: string; worlds: IsolatedWorlds } | null>>();
  /** In-process frames and the URL they were found at: not re-probed until they navigate (M9). */
  #inProcess = new WeakMap<Frame, string>();
  #blocked: BlockedNavigation[] = [];
  #privateHits: PrivateConnection[] = [];
  #policy: NetworkPolicy | null = null;
  #adopting: Promise<void> | null = null;

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
  }

  static async connect(options: BrowserSessionOptions): Promise<BrowserSession> {
    const browser = await chromium.connectOverCDP(options.cdpBaseUrl, { timeout: 20_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("the slot browser has no default context");
    const page = context.pages().at(-1) ?? (await context.newPage());
    const session = new BrowserSession(browser, context, page, options);
    try {
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

  cdp(): Promise<CDPSession> {
    if (this.#cdp === null) {
      const attempt = this.#context.newCDPSession(this.#page).then(async (cdp) => {
        await cdp.send("DOM.enable");
        // Frame events (Page.frameAttached/frameNavigated) for the typing guard.
        await cdp.send("Page.enable");
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
    this.#cdp = null;
    this.#worlds = null;
    for (const entry of this.#outOfProcess.values())
      void entry.then((found) => found?.worlds.cdp.detach().catch(() => undefined));
    this.#outOfProcess.clear();
    this.#inProcess = new WeakMap();
    this.navigations.attach(page);
    page.once("close", () => this.#onClose(page));
    void page.bringToFront().catch(() => undefined);
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
