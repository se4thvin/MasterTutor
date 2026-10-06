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
  /** Isolated worlds of out-of-process frames, by CDP frame id (R29-1). */
  readonly #frameWorlds = new Map<string, IsolatedWorlds>();
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
   * The isolated worlds of an out-of-process frame (site isolation), found through its own CDP
   * session; null when no such frame exists. In-process frames are reached through worlds() with
   * their frame id instead (Playwright refuses a separate session for them).
   */
  async frameWorlds(frameId: string): Promise<IsolatedWorlds | null> {
    const cached = this.#frameWorlds.get(frameId);
    if (cached) return cached;
    for (const frame of this.#page.frames()) {
      if (frame === this.#page.mainFrame()) continue;
      const cdp = await this.#context.newCDPSession(frame).catch(() => null);
      if (!cdp) continue;
      const tree = await cdp.send("Page.getFrameTree").catch(() => null);
      if (tree?.frameTree.frame.id === frameId) {
        const worlds = new IsolatedWorlds(cdp);
        this.#frameWorlds.set(frameId, worlds);
        return worlds;
      }
      await cdp.detach().catch(() => undefined);
    }
    return null;
  }

  /** Drops a failed out-of-process frame and closes its CDP session (no leak per failure). */
  async forgetFrame(frameId: string): Promise<void> {
    const worlds = this.#frameWorlds.get(frameId);
    this.#frameWorlds.delete(frameId);
    await worlds?.cdp.detach().catch(() => undefined);
  }

  /**
   * Every document of the page as {worlds, frameId}: the top session's frames (in-process ones
   * included), then each out-of-process frame through its own session with its in-process
   * children, discovered in parallel. Bounded at 32 documents.
   */
  async documents(): Promise<Array<{ worlds: IsolatedWorlds; frameId: string }>> {
    const found: Array<{ worlds: IsolatedWorlds; frameId: string }> = [];
    const add = async (worlds: IsolatedWorlds) => {
      const { frameTree } = await worlds.cdp.send("Page.getFrameTree");
      const walk = (tree: typeof frameTree) => {
        if (found.length >= 32) return;
        found.push({ worlds, frameId: tree.frame.id });
        for (const child of tree.childFrames ?? []) walk(child);
      };
      walk(frameTree);
    };
    await add(await this.worlds()).catch(() => undefined);
    const children = this.#page.frames().filter((frame) => frame !== this.#page.mainFrame());
    await Promise.all(children.map((frame) => this.#addOutOfProcess(frame, found, add)));
    return found;
  }

  /** Adds an out-of-process frame's documents; in-process frames have no session of their own. */
  async #addOutOfProcess(
    frame: Frame,
    found: Array<{ worlds: IsolatedWorlds; frameId: string }>,
    add: (worlds: IsolatedWorlds) => Promise<void>,
  ): Promise<void> {
    const cdp = await this.#context.newCDPSession(frame).catch(() => null);
    if (!cdp) return;
    const id = (await cdp.send("Page.getFrameTree").catch(() => null))?.frameTree.frame.id;
    const cached = id ? this.#frameWorlds.get(id) : undefined;
    if (!id || cached || found.some((doc) => doc.frameId === id)) {
      await cdp.detach().catch(() => undefined);
      if (cached && !found.some((doc) => doc.frameId === id))
        await add(cached).catch(() => undefined);
      return;
    }
    const worlds = new IsolatedWorlds(cdp);
    this.#frameWorlds.set(id, worlds);
    await add(worlds).catch(() => undefined);
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
    for (const worlds of this.#frameWorlds.values())
      void worlds.cdp.detach().catch(() => undefined);
    this.#frameWorlds.clear();
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
