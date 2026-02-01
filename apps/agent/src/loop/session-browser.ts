import { randomBytes } from "node:crypto";
import {
  toOrigin,
  type ComputerAction,
  type FunctionToolName,
  type ScrollPosition,
} from "@mastertutor/contracts";
import type { Page } from "playwright-core";
import { focusTarget, hitTest } from "../browser/hit-test.ts";
import type { MaskSources } from "../browser/masking.ts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import { perceptualHash } from "../browser/phash.ts";
import { captureModelScreenshot, withheldScreenshot } from "../browser/screenshot.ts";
import { BrowserSession } from "../browser/session.ts";
import { settle } from "../browser/settle.ts";
import {
  applyStorageState,
  collectStorageState,
  type BrowserStorageState,
} from "../browser/storage-state.ts";
import { isCaptchaFrameUrl, isChallengePage } from "../guardrails/captcha.ts";
import { HISTORY_TAG } from "../guardrails/policy.ts";
import type { Clock } from "../runtime/clock.ts";
import type { RuntimeConfig } from "../runtime/config.ts";
import type { Log } from "../runtime/types.ts";
import type { SlotPool } from "../slots/pool.ts";
import { matchAccelerator } from "../tools/accelerators.ts";
import { ComputerExecutor, type ActionGate } from "../tools/computer.ts";
import { readPage, readPageTool } from "../tools/read-page.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { register } from "../tools/types.ts";
import type { RunHooks } from "./hooks.ts";
import type { ConnectBrowser, LoopBrowser, Observation } from "./loop-browser.ts";
import type { RunSnapshot } from "./run-state.ts";

function pageStateScript(): {
  title: string;
  scrollX: number;
  scrollY: number;
  videoTime: number | null;
} {
  const video = document.querySelector("video");
  return {
    title: document.title,
    scrollX,
    scrollY,
    videoTime: video && Number.isFinite(video.currentTime) ? video.currentTime : null,
  };
}

function restoreViewScript(arg: { x: number; y: number; videoTime: number | null }): void {
  scrollTo(arg.x, arg.y);
  const video = document.querySelector("video");
  if (video && arg.videoTime !== null) video.currentTime = arg.videoTime;
}

/** A CAPTCHA a person must solve: a challenge page, or a visible (≥ 30×30 px) CAPTCHA frame. */
export async function detectCaptcha(page: Page): Promise<boolean> {
  if (isChallengePage(page.url(), await page.title().catch(() => ""))) return true;
  for (const frame of page.frames()) {
    if (!isCaptchaFrameUrl(frame.url())) continue;
    const element = await frame.frameElement().catch(() => null);
    const box = await element?.boundingBox().catch(() => null);
    if (box && box.width >= 30 && box.height >= 30) return true;
  }
  return false;
}

const OBSERVE_ATTEMPTS = 3;

/**
 * Reload, back and forward land on a history entry. If that entry was made by submitting a form,
 * Chromium sends the form again, so it is described as a form submission and needs approval.
 */
async function historyTarget(
  session: BrowserSession,
  move: "reload" | "back" | "forward",
): Promise<TargetDescription | null> {
  const { currentIndex, entries } = await (await session.cdp()).send("Page.getNavigationHistory");
  const entry = entries[currentIndex + (move === "back" ? -1 : move === "forward" ? 1 : 0)];
  if (entry?.transitionType !== "form_submit") return null;
  return {
    label: `${move === "reload" ? "Reload" : `Go ${move} to`} a page made by submitting a form`,
    tag: HISTORY_TAG,
    path: `history:${move}`,
    context: `history:${move}:${entry.url}`,
    isFormSubmit: true,
    formKind: "other",
    isSecretField: false,
    editable: false,
    interactive: true,
  };
}

/**
 * One observation of one page (review M7). The URL is read first and re-checked last, so a
 * navigation in between never pairs one page's screenshot with another page's URL and DOM hash: the
 * capture is retaken on the new page. If the page is still moving after the last attempt, the
 * observation carries the current URL with the screenshot withheld and no DOM hash or title.
 */
export async function observeOnOnePage(
  readUrl: () => string,
  capture: (url: string) => Promise<Observation>,
): Promise<Observation> {
  let url = readUrl();
  for (let attempt = 1; ; attempt++) {
    const observation = await capture(url);
    const now = readUrl();
    if (now === url) return observation;
    if (attempt >= OBSERVE_ATTEMPTS)
      return {
        ...observation,
        url: now,
        origin: toOrigin(now),
        title: "",
        domHash: "",
        screenshot: await withheldScreenshot(observation.screenshot),
        // A black frame says nothing about the page: a random hash keeps loop detection from
        // treating consecutive withheld frames as the same screen (M8).
        phash: randomBytes(8).readBigUInt64BE(),
      };
    url = now;
  }
}

/** The loop's view of one slot browser (spec §3.3): observation, targets, tools and navigation. */
export class SessionLoopBrowser implements LoopBrowser {
  readonly #session: BrowserSession;
  readonly #executor: ComputerExecutor;
  readonly #registry: ToolRegistry;
  readonly #mask: MaskSources;
  readonly #run: () => RunSnapshot;
  readonly #log: Log;

  constructor(options: {
    session: BrowserSession;
    executor: ComputerExecutor;
    registry: ToolRegistry;
    mask: MaskSources;
    run: () => RunSnapshot;
    log: Log;
  }) {
    this.#session = options.session;
    this.#executor = options.executor;
    this.#registry = options.registry;
    this.#mask = options.mask;
    this.#run = options.run;
    this.#log = options.log;
  }

  observe(signal: AbortSignal): Promise<Observation> {
    return observeOnOnePage(
      () => this.#session.page.url(),
      (url) => this.#capture(url, signal),
    );
  }

  async #capture(url: string, signal: AbortSignal): Promise<Observation> {
    const session = this.#session;
    const screenshot = await captureModelScreenshot(session, this.#mask, signal);
    const page = await readPage(session, { mode: "interactive", sinceHash: null });
    const state = await (await session.worlds()).evaluate(pageStateScript, null);
    return {
      url,
      title: state.title,
      origin: toOrigin(url),
      domHash: "hash" in page ? page.hash : "",
      screenshot,
      phash: await perceptualHash(screenshot.png),
      captcha: await detectCaptcha(session.page),
      scroll: { x: state.scrollX, y: state.scrollY },
      videoTime: state.videoTime,
    };
  }

  async targetFor(
    action: ComputerAction,
    previous: TargetDescription | null,
  ): Promise<TargetDescription | null> {
    const history =
      action.type === "keypress"
        ? matchAccelerator(action.keys)
        : action.type === "click" && (action.button === "back" || action.button === "forward")
          ? action.button
          : null;
    if (history === "reload" || history === "back" || history === "forward")
      return historyTarget(this.#session, history);
    if (action.type === "click" || action.type === "double_click") {
      const point = await this.#executor.toPage(action.x, action.y);
      return point ? (await hitTest(this.#session, point)).target : null;
    }
    if (action.type === "type" || action.type === "keypress")
      return previous ?? (await focusTarget(this.#session));
    return null;
  }

  runComputer(actions: readonly ComputerAction[], signal: AbortSignal, gate: ActionGate) {
    return this.#executor.run(actions, signal, gate);
  }

  runFunction(name: FunctionToolName, args: unknown, signal: AbortSignal) {
    const run = this.#run();
    return this.#registry.run(name, args, {
      runId: run.id,
      workspaceId: run.workspaceId,
      session: this.#session,
      signal,
      log: this.#log,
    });
  }

  async navigate(url: string, signal: AbortSignal): Promise<boolean> {
    const ok = await this.#session.goto(url, signal);
    if (ok) await settle(this.#session, signal);
    return ok;
  }

  async restoreView(view: {
    scroll: ScrollPosition | null;
    videoTime: number | null;
  }): Promise<void> {
    if (!view.scroll && view.videoTime === null) return;
    await (
      await this.#session.worlds()
    )
      .evaluate(restoreViewScript, {
        x: view.scroll?.x ?? 0,
        y: view.scroll?.y ?? 0,
        videoTime: view.videoTime,
      })
      .catch(() => undefined);
  }

  drainBlockedNavigations() {
    return this.#session.drainBlockedNavigations();
  }

  collectStorage(): Promise<BrowserStorageState> {
    return collectStorageState(this.#session);
  }

  applyStorage(state: BrowserStorageState) {
    return applyStorageState(this.#session, state);
  }
}

/** Connects to a leased slot, remembers its browser id for recycling, and builds the tool registry. */
export function slotBrowserConnector(options: {
  cdpBaseUrl(name: string): Promise<string>;
  pool: SlotPool;
  hooks: RunHooks;
  clock: Clock;
  config: RuntimeConfig;
  testMode: boolean;
  log: Log;
}): ConnectBrowser {
  return async ({ slotName, run, guard }) => {
    const baseUrl = await options.cdpBaseUrl(slotName);
    const session = await BrowserSession.connect({
      cdpBaseUrl: baseUrl,
      allowedOrigins: () => run().allowedOrigins,
      testMode: options.testMode,
      log: options.log,
      guard,
    });
    try {
      await options.pool.rememberBrowser(slotName, baseUrl);
      const executor = new ComputerExecutor(session, {
        clock: options.clock,
        waitActionMs: options.config.waitActionMs,
      });
      const registry = new ToolRegistry(
        [register(readPageTool), ...options.hooks.functionTools],
        options.log,
      );
      const browser = new SessionLoopBrowser({
        session,
        executor,
        registry,
        mask: options.hooks.maskSources(run().id),
        run,
        log: options.log,
      });
      return { browser, close: () => session.close() };
    } catch (error) {
      // Do not leak the CDP connection when setup after connect fails.
      await session.close();
      throw error;
    }
  };
}
