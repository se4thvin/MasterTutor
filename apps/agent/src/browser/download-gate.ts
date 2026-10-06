import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
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

/** Which download was approved: true for the download (its URL and suggested name) to let through. */
export type DownloadMatch = (url: string, filename: string) => boolean;

/** The run's downloads folder, as the slot's Chromium writes it and as this process reads it. */
export interface DownloadFolder {
  slotPath: string;
  /** The same folder on the agent's mount of the volume; null when it has none (tests). */
  localPath: string | null;
}

/** How long an allowance waits for its download to start. */
const ALLOW_WINDOW_MS = 60_000;
type Allowance = { match: DownloadMatch; timer: NodeJS.Timeout };

/**
 * Downloads are denied by default (spec §9): Chromium cancels every download before saving
 * anything, and each attempt is recorded for a `download` approval. allowOnce lets exactly the
 * approved download through into the run's folder, named by its download id (never a page-chosen
 * name). While an allowance is open every other download is cancelled as it begins, until the deny
 * is back in force; once allowances end, any file in the folder that was not approved is deleted.
 */
export class DownloadGate {
  readonly #cdp: CDPSession;
  readonly #folder: DownloadFolder | null;
  readonly #log: Log;
  #blocked: BlockedDownload[] = [];
  #allowances: Allowance[] = [];
  /** Downloads let through (by id) and the ones still saving. */
  readonly #approved = new Set<string>();
  readonly #saving = new Set<string>();
  /** True from the first allowance until the deny is acknowledged again. */
  #open = false;
  #closing: Promise<void> | null = null;

  private constructor(cdp: CDPSession, folder: DownloadFolder | null, log: Log) {
    this.#cdp = cdp;
    this.#folder = folder;
    this.#log = log;
  }

  /** `folder`: null keeps every download denied, approved or not. */
  static async install(
    browser: Browser,
    folder: DownloadFolder | null,
    log: Log,
  ): Promise<DownloadGate> {
    const cdp = await browser.newBrowserCDPSession();
    const gate = new DownloadGate(cdp, folder, log);
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

  /** The ids of the downloads that were let through (the only files B6 may file). */
  approvedDownloads(): string[] {
    return [...this.#approved];
  }

  /** Lets exactly one approved download through: the next one `match` accepts, within ALLOW_WINDOW_MS. */
  async allowOnce(match: DownloadMatch): Promise<void> {
    if (this.#folder === null) return;
    const allowance: Allowance = {
      match,
      timer: setTimeout(() => void this.#end(allowance), ALLOW_WINDOW_MS).unref(),
    };
    this.#allowances.push(allowance);
    await this.#closing;
    this.#open = true;
    await this.#cdp.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: this.#folder.slotPath,
      eventsEnabled: true,
    });
  }

  #onWillBegin(guid: string, url: string, filename: string): void {
    const index = this.#allowances.findIndex(({ match }) => match(url, filename));
    if (index !== -1) {
      const [allowance] = this.#allowances.splice(index, 1);
      clearTimeout(allowance!.timer);
      this.#approved.add(guid);
      this.#saving.add(guid);
      return;
    }
    // Denied by the browser, or (while downloads are let through) cancelled here at once.
    if (this.#open) void this.#cdp.send("Browser.cancelDownload", { guid }).catch(() => undefined);
    this.#blocked.push({ url, filename: filename || null });
  }

  #onProgress(guid: string, state: string): void {
    if (state === "inProgress") return;
    this.#saving.delete(guid);
    if (this.#allowances.length === 0 && this.#saving.size === 0) void this.#close();
  }

  #end(allowance: Allowance): void {
    this.#allowances = this.#allowances.filter((open) => open !== allowance);
    if (this.#allowances.length === 0 && this.#saving.size === 0) void this.#close();
  }

  /** Denies again; until Chromium acknowledges it, every download is still cancelled as it begins. */
  #close(): Promise<void> {
    this.#closing ??= this.#deny()
      .then(() => {
        if (this.#allowances.length === 0) this.#open = false;
      })
      .then(() => this.#sweep())
      .catch(() =>
        this.#log.warn({ errorCode: "download_deny_failed" }, "could not deny downloads again"),
      )
      .finally(() => {
        this.#closing = null;
      });
    return this.#closing;
  }

  /** Deletes every file in the run's folder that was not an approved download. */
  async #sweep(): Promise<void> {
    const local = this.#folder?.localPath;
    if (!local) return;
    const names = await readdir(local).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((name) => !this.#approved.has(name))
        .map((name) => rm(join(local, name), { force: true, recursive: true })),
    );
  }

  #deny(): Promise<unknown> {
    return this.#cdp.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: true });
  }
}
