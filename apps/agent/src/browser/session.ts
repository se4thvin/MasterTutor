import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright-core";
import { abortable } from "../runtime/abortable.ts";
import type { Log } from "../runtime/types.ts";
import { ControlGuard } from "./guard.ts";
import { IsolatedWorlds } from "./isolated-world.ts";
import { NavigationTracker } from "./navigation.ts";
import {
  installNetworkPolicy,
  type BlockedNavigation,
  type HostResolver,
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
  #blocked: BlockedNavigation[] = [];
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
    await installNetworkPolicy(context, {
      allowedOrigins: options.allowedOrigins,
      testMode: options.testMode,
      onBlockedNavigation: (block) => session.#blocked.push(block),
      resolveHost: options.resolveHost,
    });
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
    this.#cdp ??= this.#context.newCDPSession(this.#page).then(async (cdp) => {
      await cdp.send("DOM.enable");
      return cdp;
    });
    return this.#cdp;
  }

  worlds(): Promise<IsolatedWorlds> {
    this.#worlds ??= this.cdp().then((cdp) => new IsolatedWorlds(cdp));
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
    try {
      await abortable(
        this.#page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
        signal,
      );
      return true;
    } catch {
      if (signal.aborted) throw signal.reason;
      this.#log.debug({ errorCode: "navigation_failed" }, "navigation failed");
      return false;
    }
  }

  pendingAdoption(): Promise<void> {
    return this.#adopting ?? Promise.resolve();
  }

  drainBlockedNavigations(): BlockedNavigation[] {
    return this.#blocked.splice(0);
  }

  /** Disconnects Playwright only. Recycling the browser is the slot pool's job (Browser.close). */
  async close(): Promise<void> {
    await this.#browser.close().catch(() => undefined);
  }

  #adopt(page: Page): void {
    this.#page = page;
    this.#cdp = null;
    this.#worlds = null;
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
