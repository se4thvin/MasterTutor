import { Uuid } from "@mastertutor/contracts";
import type { Browser, CDPSession } from "playwright-core";
import type { Log } from "../runtime/types.ts";

/** Where the shared `downloads` volume is mounted in every slot (compose.yml, slot entrypoint). */
const SLOT_DOWNLOADS_ROOT = "/downloads";

/** A run's downloads folder as the slot's Chromium sees it; the id is checked before it is a path. */
export function slotDownloadPath(runId: string): string {
  return `${SLOT_DOWNLOADS_ROOT}/${Uuid.parse(runId)}`;
}

/** A download the page tried to start, cancelled before anything was saved. */
export interface BlockedDownload {
  url: string;
  /** The name the page suggested (unsanitised: the approval request cleans it). */
  filename: string | null;
}

/** How long an approved download may take to start before downloads are denied again. */
const ALLOW_WINDOW_MS = 60_000;

/**
 * Downloads are denied by default (spec §9): Chromium cancels every download before saving
 * anything, and each attempt is recorded for a `download` approval. Once a person approved one,
 * allowOnce lets exactly that URL's next download through into the run's downloads folder, named
 * by its download id (never a page-chosen name), then denies again.
 */
export class DownloadGate {
  readonly #cdp: CDPSession;
  readonly #downloadPath: string | null;
  readonly #log: Log;
  #blocked: BlockedDownload[] = [];
  /** The approved URL waiting for its download, and the download once it began. */
  #allowed: { url: string; guid: string | null; timer: NodeJS.Timeout } | null = null;

  private constructor(cdp: CDPSession, downloadPath: string | null, log: Log) {
    this.#cdp = cdp;
    this.#downloadPath = downloadPath;
    this.#log = log;
  }

  /**
   * `downloadPath`: the run's folder as the slot's Chromium sees it (`/downloads/<runId>`); null
   * keeps every download denied, approved or not.
   */
  static async install(
    browser: Browser,
    downloadPath: string | null,
    log: Log,
  ): Promise<DownloadGate> {
    const cdp = await browser.newBrowserCDPSession();
    const gate = new DownloadGate(cdp, downloadPath, log);
    cdp.on("Browser.downloadWillBegin", (event) =>
      gate.#onWillBegin(event.guid, event.url, event.suggestedFilename),
    );
    cdp.on("Browser.downloadProgress", (event) => gate.#onProgress(event.guid, event.state));
    await gate.#deny();
    return gate;
  }

  /** Download attempts since the last call (each needs its own approval). */
  drainBlocked(): BlockedDownload[] {
    return this.#blocked.splice(0);
  }

  /** Lets the next download of exactly `url` be saved (a person approved it); then denies again. */
  async allowOnce(url: string): Promise<void> {
    this.#endAllowance();
    if (this.#downloadPath === null) return;
    const timer = setTimeout(() => void this.#reset(), ALLOW_WINDOW_MS).unref();
    this.#allowed = { url, guid: null, timer };
    await this.#cdp.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: this.#downloadPath,
      eventsEnabled: true,
    });
  }

  #onWillBegin(guid: string, url: string, filename: string): void {
    const allowed = this.#allowed;
    if (allowed && allowed.guid === null && allowed.url === url) {
      allowed.guid = guid;
      return;
    }
    // Denied by the browser, or (while one is allowed) cancelled here before it saves anything.
    if (allowed) void this.#cdp.send("Browser.cancelDownload", { guid }).catch(() => undefined);
    this.#blocked.push({ url, filename: filename || null });
  }

  #onProgress(guid: string, state: string): void {
    if (this.#allowed?.guid === guid && state !== "inProgress") void this.#reset();
  }

  #endAllowance(): void {
    if (this.#allowed) clearTimeout(this.#allowed.timer);
    this.#allowed = null;
  }

  async #reset(): Promise<void> {
    this.#endAllowance();
    await this.#deny().catch(() =>
      this.#log.warn({ errorCode: "download_deny_failed" }, "could not deny downloads again"),
    );
  }

  #deny(): Promise<unknown> {
    return this.#cdp.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: true });
  }
}
