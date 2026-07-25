import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { MAX_USER_DOWNLOAD_BYTES, MAX_USER_DOWNLOADS_PER_RUN, Uuid } from "@mastertutor/contracts";
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

/** After a deny, the folder is swept again this much later, for writes that finished late. */
const LATE_SWEEP_MS = 1_000;
/** How long an allowance waits for its download to start. */
const ALLOW_WINDOW_MS = 60_000;
type Allowance = { match: DownloadMatch; approvedBy: string | null; timer: NodeJS.Timeout };

/** Caps on the downloads a person starts while holding control through the live view (B6). */
export interface UserDownloadLimits {
  /** A download is cancelled (and its partial file deleted) once it passes this many bytes. */
  maxBytes: number;
  /** Downloads per run: any after this many is cancelled as it begins. */
  maxCount: number;
  /** Told when a download was cancelled for a cap (B6 emits download_too_large and the like). */
  onCapped?: (download: { id: string; reason: "too_large" | "too_many" }) => void;
}

/** A download this gate let through that finished writing into the run's folder (B6 files it). */
export interface FinishedDownload {
  /** The download id, also its file name in the run's folder. */
  id: string;
  url: string;
  /** The name the page suggested (unsanitised). */
  filename: string;
  /** "user": a person started it while holding control; "approved": the agent's, approved. */
  by: "user" | "approved";
  /** For "approved": who approved that very allowance (allowOnce); null if nobody did. */
  approvedBy: string | null;
}

/** The contracts' caps (one source); B6 passes what is left of the run's count. */
const DEFAULT_USER_LIMITS: UserDownloadLimits = {
  maxBytes: MAX_USER_DOWNLOAD_BYTES,
  maxCount: MAX_USER_DOWNLOADS_PER_RUN,
};

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
  /** While a person holds control (live view): their downloads complete, within the caps. */
  #user = false;
  #userLimits: UserDownloadLimits = DEFAULT_USER_LIMITS;
  /** The person's downloads (by id): never cancelled for the gate, never swept. */
  readonly #userDownloads = new Set<string>();
  readonly #capped = new Set<string>();
  #userCount = 0;
  #closing: Promise<void> | null = null;
  /** Where each let-through download came from, until it finishes. */
  readonly #letThrough = new Map<
    string,
    { url: string; filename: string; approvedBy: string | null }
  >();
  #finished: ((download: FinishedDownload) => void) | null = null;

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
    cdp.on("Browser.downloadProgress", (event) =>
      gate.#onProgress(event.guid, event.state, event.receivedBytes, event.totalBytes),
    );
    await gate.#deny();
    return gate;
  }

  /** Download attempts since the last call (each needs its own approval). */
  drainBlocked(): BlockedDownload[] {
    return this.#blocked.splice(0);
  }

  /**
   * A person takes (`true`) or hands back (`false`) control through the live view. This gate is
   * the only code that sets the browser's download behaviour. While on, every download the person
   * starts completes into the run's folder (B6 stores it), within `limits`; the agent cannot act
   * meanwhile. Off: downloads are denied again and the agent gate resumes (its open allowances end);
   * rejects when the deny cannot be restored (the caller must fail closed).
   * The person's files are never swept; `onFinished` reports each one. `maxCount` counts the
   * downloads started from this call on (B6 passes what the run has left across its leases).
   */
  async userControl(on: boolean, limits?: Partial<UserDownloadLimits>): Promise<void> {
    if (limits) this.#userLimits = { ...this.#userLimits, ...limits };
    if (on) this.#userCount = 0;
    for (const allowance of this.#allowances.splice(0)) clearTimeout(allowance.timer);
    this.#user = on;
    await this.#closing;
    if (on && this.#folder) {
      this.#open = true;
      await this.#cdp.send("Browser.setDownloadBehavior", {
        behavior: "allowAndName",
        downloadPath: this.#folder.slotPath,
        eventsEnabled: true,
      });
    } else if (!on) {
      // The deny must be back before the agent acts again: if it cannot be restored this rejects,
      // and the caller fails closed (ends the run with the control lock still held).
      await this.#deny();
      if (this.#allowances.length === 0) this.#open = false;
      void this.#close();
    }
  }

  /**
   * B6: told of each download this gate let through once it finished writing (and was not
   * capped). Only this gate's CDP session receives download events, so it is the one to say.
   * One listener; null removes it.
   */
  onFinished(listener: ((download: FinishedDownload) => void) | null): void {
    this.#finished = listener;
  }

  /** Lets exactly one approved download through: the next one `match` accepts, within ALLOW_WINDOW_MS. */
  async allowOnce(match: DownloadMatch, approvedBy: string): Promise<void> {
    if (this.#folder === null || this.#user) return;
    const allowance: Allowance = {
      match,
      approvedBy,
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
    if (this.#user) {
      this.#userDownloads.add(guid);
      this.#letThrough.set(guid, { url, filename, approvedBy: null });
      // Every download the person started counts, including one later cancelled for its size.
      if (++this.#userCount > this.#userLimits.maxCount) this.#cap(guid, "too_many");
      return;
    }
    const index = this.#allowances.findIndex(({ match }) => match(url, filename));
    if (index !== -1) {
      const [allowance] = this.#allowances.splice(index, 1);
      clearTimeout(allowance!.timer);
      this.#approved.add(guid);
      this.#saving.add(guid);
      this.#letThrough.set(guid, { url, filename, approvedBy: allowance!.approvedBy });
      return;
    }
    // Denied by the browser, or (while downloads are let through) cancelled here at once.
    if (this.#open) void this.#cdp.send("Browser.cancelDownload", { guid }).catch(() => undefined);
    this.#blocked.push({ url, filename: filename || null });
  }

  #onProgress(guid: string, state: string, receivedBytes: number, totalBytes: number): void {
    if (this.#userDownloads.has(guid)) {
      const { maxBytes } = this.#userLimits;
      // Checked at completion too: a small file can finish without an in-progress event.
      if (state !== "canceled" && (receivedBytes > maxBytes || totalBytes > maxBytes))
        this.#cap(guid, "too_large");
      else if (state === "completed") this.#announce(guid, "user");
      if (state !== "inProgress") this.#letThrough.delete(guid);
      return;
    }
    if (state === "completed" && this.#approved.has(guid)) this.#announce(guid, "approved");
    if (state !== "inProgress") this.#letThrough.delete(guid);
    // A download it did not let through that still finished writing (its cancel lost the race):
    // delete it now, whenever that is.
    if (state === "completed" && !this.#approved.has(guid)) void this.#removeFile(guid);
    // Only the downloads this gate let through end an allowance; anything else is not its own.
    if (state === "inProgress" || !this.#saving.delete(guid)) return;
    if (this.#allowances.length === 0 && this.#saving.size === 0 && !this.#user) void this.#close();
  }

  #announce(guid: string, by: FinishedDownload["by"]): void {
    const source = this.#letThrough.get(guid);
    if (source) this.#finished?.({ id: guid, ...source, by });
  }

  /** Cancels a person's download for a cap; Chromium removes its partial file. */
  #cap(guid: string, reason: "too_large" | "too_many"): void {
    if (this.#capped.has(guid)) return;
    this.#capped.add(guid);
    this.#userDownloads.delete(guid);
    void this.#cdp.send("Browser.cancelDownload", { guid }).catch(() => undefined);
    void this.#removeFile(guid);
    this.#userLimits.onCapped?.({ id: guid, reason });
  }

  async #removeFile(name: string): Promise<void> {
    const local = this.#folder?.localPath;
    if (local) await rm(join(local, name), { force: true });
  }

  #end(allowance: Allowance): void {
    this.#allowances = this.#allowances.filter((open) => open !== allowance);
    if (this.#allowances.length === 0 && this.#saving.size === 0 && !this.#user) void this.#close();
  }

  /** Denies again; until Chromium acknowledges it, every download is still cancelled as it begins. */
  #close(): Promise<void> {
    this.#closing ??= this.#deny()
      .then(() => {
        if (this.#allowances.length === 0) this.#open = false;
      })
      .then(() => this.#sweep())
      // A download cancelled at the last moment can still finish writing after that sweep.
      .then(() => {
        setTimeout(() => void this.#sweep(), LATE_SWEEP_MS).unref();
      })
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
        .filter((name) => {
          // A download still saving is `<id>.crdownload` until it completes.
          const id = name.replace(/\.crdownload$/, "");
          return !this.#approved.has(id) && !this.#userDownloads.has(id);
        })
        .map((name) => rm(join(local, name), { force: true, recursive: true })),
    );
  }

  #deny(): Promise<unknown> {
    return this.#cdp.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: true });
  }
}
