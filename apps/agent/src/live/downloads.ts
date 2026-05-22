import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { RunEvent } from "@mastertutor/contracts";
import {
  emitRunEvent,
  findAssetBySha,
  readControlUser,
  recordDownload,
  type Database,
} from "@mastertutor/db";
import { objectKeys, safeFilename, type Storage } from "@mastertutor/storage";
import type { CDPSession } from "playwright-core";
import { slotDownloadPath } from "../browser/download-gate.ts";
import type { LeasedSlot } from "../loop/hooks.ts";
import type { Log } from "../runtime/types.ts";

export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/** Inert types only; anything that could render as active content is served as a plain download. */
const SAFE_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function downloadMime(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return (
    (dot > 0 && SAFE_MIME[filename.slice(dot + 1).toLowerCase()]) || "application/octet-stream"
  );
}

export interface DownloadIngestorDeps {
  db: Database;
  storage: Storage;
  log: Log;
  /** The slots' downloads volume as mounted in this process. */
  localRoot?: string;
  /** Mode for /downloads/<runId>; tests whose host user differs from the slot's need 0o777. */
  dirMode?: number;
  maxBytes?: number;
}

export interface DownloadIngestor {
  /** Listens on the lease's browser; changes nothing until the user takes control. */
  attach(slot: LeasedSlot): Promise<void>;
  /**
   * on: the member holding control may download (Chromium saves into the run's folder, the
   * ingestor stores each file). off: every download is denied again, as B1's gate requires.
   */
  userControl(runId: string, on: boolean): Promise<void>;
  detach(runId: string): Promise<void>;
}

interface Approved {
  filename: string;
  url: string;
  approvedBy: string;
}

interface Attached {
  slot: LeasedSlot;
  cdp: CDPSession;
  userMode: boolean;
  stop(): void;
}

const BLOCKED = "Downloads need you in control: take over, then download it.";

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Spec §10.2.9, v1 (F6): only the member holding control downloads, through the live view;
 * taking over is the approval. B1's download gate owns the browser's download behaviour: it
 * denies every download and lets one through only after a person approved the agent's request.
 * This ingestor never touches that while the agent holds control. While the user does, it lets
 * Chromium save into the run's folder (named by download id, never by the page), stores each
 * finished file in object storage under the run with a sanitised name, and denies again when
 * control goes back. Downloads that began under the agent are never ingested here.
 */
export function createDownloadIngestor(deps: DownloadIngestorDeps): DownloadIngestor {
  const localRoot = deps.localRoot ?? "/downloads";
  const maxBytes = deps.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const attached = new Map<string, Attached>();
  const localFile = (runId: string, guid: string) => path.join(localRoot, runId, guid);
  const emit = (runId: string, event: RunEvent) =>
    deps.db.transaction((tx) => emitRunEvent(tx, runId, event));

  async function removeFile(runId: string, guid: string): Promise<void> {
    await rm(localFile(runId, guid), { force: true });
    await rm(`${localFile(runId, guid)}.crdownload`, { force: true });
  }

  /** At begin: the member holding control approves it; control already back with the agent cancels it. */
  async function decide(
    entry: Attached,
    guid: string,
    url: string,
    suggested: string,
  ): Promise<Approved | null> {
    const { slot, cdp } = entry;
    const filename = safeFilename(suggested || "download");
    const approvedBy = await readControlUser(deps.db, slot.runId);
    if (approvedBy) return { filename, url: url.slice(0, 4_096), approvedBy };
    await cdp.send("Browser.cancelDownload", { guid }).catch(() => undefined);
    await removeFile(slot.runId, guid);
    await emit(slot.runId, {
      type: "error",
      code: "download_blocked",
      message: `${filename}: ${BLOCKED}`.slice(0, 500),
    });
    return null;
  }

  async function ingest(slot: LeasedSlot, guid: string, approved: Approved): Promise<void> {
    const file = localFile(slot.runId, guid);
    try {
      const { size } = await stat(file);
      if (size > maxBytes) {
        await emit(slot.runId, {
          type: "error",
          code: "download_too_large",
          message:
            `${approved.filename} is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB`.slice(
              0,
              500,
            ),
        });
        return;
      }
      const sha256 = await sha256Of(file);
      const mime = downloadMime(approved.filename);
      const existing = await findAssetBySha(deps.db, slot.workspaceId, sha256);
      const key =
        existing?.key ??
        objectKeys.download(slot.runId, `${sha256.slice(0, 12)}-${approved.filename}`);
      if (!existing) await deps.storage.putFile(key, file, { contentType: mime, sha256 });
      await deps.db.transaction(async (tx) => {
        const record = await recordDownload(tx, {
          runId: slot.runId,
          workspaceId: slot.workspaceId,
          filename: approved.filename,
          sha256,
          bucket: deps.storage.bucket,
          key,
          mime,
          bytes: size,
          sourceUrl: approved.url,
          approvedBy: approved.approvedBy,
        });
        await emitRunEvent(tx, slot.runId, {
          type: "download_ready",
          downloadId: record.downloadId,
          assetId: record.assetId,
          filename: approved.filename,
          bytes: size,
        });
      });
    } finally {
      await rm(file, { force: true });
    }
  }

  const failed = (runId: string, errorCode: string) => (error: unknown) =>
    deps.log.error(
      { runId, errorCode, err: error instanceof Error ? error.name : "unknown" },
      "download handling failed",
    );

  return {
    async attach(slot) {
      const dir = path.join(localRoot, slot.runId);
      await mkdir(dir, { recursive: true, mode: deps.dirMode ?? 0o700 });
      if (deps.dirMode !== undefined) await chmod(dir, deps.dirMode);
      const cdp = await slot.browserCdp();
      const decisions = new Map<string, Promise<Approved | null>>();
      const entry: Attached = { slot, cdp, userMode: false, stop: () => undefined };
      const onBegin = (event: { guid: string; url: string; suggestedFilename: string }) => {
        // Under the agent, the download is B1's gate's to deny or approve.
        if (!entry.userMode) return;
        decisions.set(
          event.guid,
          decide(entry, event.guid, event.url, event.suggestedFilename).catch((error) => {
            failed(slot.runId, "download_decision_failed")(error);
            return null;
          }),
        );
      };
      const onProgress = (event: {
        guid: string;
        state: "inProgress" | "completed" | "canceled";
      }) => {
        const decision = decisions.get(event.guid);
        if (event.state === "inProgress" || !decision) return;
        decisions.delete(event.guid);
        void decision
          .then((approved) =>
            event.state === "completed" && approved
              ? ingest(slot, event.guid, approved)
              : removeFile(slot.runId, event.guid),
          )
          .catch(failed(slot.runId, "download_ingest_failed"));
      };
      cdp.on("Browser.downloadWillBegin", onBegin);
      cdp.on("Browser.downloadProgress", onProgress);
      entry.stop = () => {
        cdp.off("Browser.downloadWillBegin", onBegin);
        cdp.off("Browser.downloadProgress", onProgress);
      };
      attached.set(slot.runId, entry);
    },
    async userControl(runId, on) {
      const entry = attached.get(runId);
      if (!entry) {
        // Never allowed here, so there is nothing to deny again.
        if (on) throw new Error(`downloads are not attached for run ${runId}`);
        return;
      }
      if (on) {
        entry.userMode = true;
        await entry.cdp.send("Browser.setDownloadBehavior", {
          behavior: "allowAndName",
          downloadPath: slotDownloadPath(runId),
          eventsEnabled: true,
        });
        return;
      }
      entry.userMode = false;
      // B1's default, restored before the agent acts again (spec §9).
      await entry.cdp.send("Browser.setDownloadBehavior", {
        behavior: "deny",
        eventsEnabled: true,
      });
      // B1's gate saw the user's downloads begin too: they are not the agent's to approve.
      entry.slot.session?.downloads.drainBlocked();
    },
    async detach(runId) {
      // The CDP session belongs to the lease (BrowserSession); B1's release deletes the folder.
      attached.get(runId)?.stop();
      attached.delete(runId);
    },
  };
}
