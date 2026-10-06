import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Uuid, type RunEvent } from "@mastertutor/contracts";
import {
  emitRunEvent,
  findAssetBySha,
  latestDownloadApprover,
  readControlUser,
  recordDownload,
  type Database,
} from "@mastertutor/db";
import { objectKeys, safeFilename, type Storage } from "@mastertutor/storage";
import type { DownloadGate } from "../browser/download-gate.ts";
import type { LeasedSlot } from "../loop/hooks.ts";
import type { Log } from "../runtime/types.ts";

export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
/** Downloads one run may keep from the live view (B1's gate cancels any after this many). */
export const MAX_DOWNLOADS_PER_RUN = 20;

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
  /** Caps the gate enforces on the user's downloads, as they happen (I1). */
  maxBytes?: number;
  maxCount?: number;
}

export interface DownloadIngestor {
  /** Listens on the lease's browser and files what B1's gate let through; changes nothing. */
  attach(slot: LeasedSlot): Promise<void>;
  /**
   * on: the member holding control may download, within the caps (B1's gate saves into the run's
   * folder; the ingestor stores each file). off: the gate denies every download again.
   */
  userControl(runId: string, on: boolean): Promise<void>;
  detach(runId: string): Promise<void>;
}

interface Begun {
  url: string;
  suggested: string;
  /** Who held control when it began (the user's download is approved by that member). */
  controlUser: Promise<string | null>;
}

interface Attached {
  slot: LeasedSlot;
  stop(): void;
}

const NOT_STORED = "could not be saved. Download it again in a moment.";
const HANDED_BACK = "Downloads need you in control: take over, then download it.";

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** B1's gate for the lease, or null for fake browsers (no session). */
const gateOf = (slot: LeasedSlot): DownloadGate | null => slot.session?.downloads ?? null;

/**
 * Spec §10.2.9. B1's download gate is the only code that sets the browser's download behaviour:
 * it denies every download, lets one through after a person approved the agent's request, and,
 * while a member holds control through the live view, lets theirs complete within its caps.
 * This ingestor only files what the gate let through (its userDownloads() and
 * approvedDownloads(), never the folder): it stores each finished file in object storage under
 * the run with a sanitised name, records it, and tells the user (download_ready, or why not).
 */
export function createDownloadIngestor(deps: DownloadIngestorDeps): DownloadIngestor {
  const localRoot = deps.localRoot ?? "/downloads";
  const maxBytes = deps.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const maxCount = deps.maxCount ?? MAX_DOWNLOADS_PER_RUN;
  const attached = new Map<string, Attached>();
  const localFile = (runId: string, guid: string) => path.join(localRoot, runId, guid);
  const emit = (runId: string, event: RunEvent) =>
    deps.db.transaction((tx) => emitRunEvent(tx, runId, event));

  const failed = (runId: string, errorCode: string) => (error: unknown) =>
    deps.log.error(
      { runId, errorCode, err: error instanceof Error ? error.name : "unknown" },
      "download handling failed",
    );

  async function ingest(slot: LeasedSlot, guid: string, approved: Approved): Promise<void> {
    const file = localFile(slot.runId, guid);
    try {
      const { size } = await stat(file);
      // The gate cancels a larger one as it grows; this is defence in depth.
      if (size > maxBytes) {
        await emit(slot.runId, tooLarge(approved.filename));
        return;
      }
      const sha256 = await sha256Of(file);
      const mime = downloadMime(approved.filename);
      // Assets are unique per workspace and sha256 (assets_workspace_sha256_uq), so identical
      // content reuses the first run's object (downloads/<thatRunId>/…). Deleting a run's
      // objects must therefore never delete an object an asset row still references.
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

  const tooLarge = (filename: string): RunEvent => ({
    type: "error",
    code: "download_too_large",
    message:
      `${filename} is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB and was not saved.`.slice(
        0,
        500,
      ),
  });

  /** A finished download: filed if the gate let it through as the user's or as approved. */
  async function file(slot: LeasedSlot, gate: DownloadGate, guid: string, begun: Begun) {
    const filename = safeFilename(begun.suggested || "download");
    let approvedBy: string | null;
    if (gate.userDownloads().includes(guid))
      approvedBy = (await begun.controlUser) ?? (await readControlUser(deps.db, slot.runId));
    else if (gate.approvedDownloads().includes(guid))
      approvedBy = (await latestDownloadApprover(deps.db, slot.runId)) ?? "policy";
    else return; // Not let through: the gate deletes what it did not approve.
    if (!approvedBy) {
      await rm(localFile(slot.runId, guid), { force: true });
      await emit(slot.runId, {
        type: "error",
        code: "download_blocked",
        message: `${filename}: ${HANDED_BACK}`.slice(0, 500),
      });
      return;
    }
    const approved: Approved = { filename, url: begun.url.slice(0, 4_096), approvedBy };
    await ingest(slot, guid, approved).catch(async (error: unknown) => {
      failed(slot.runId, "download_ingest_failed")(error);
      // The download happened: say it was not kept rather than drop it silently.
      await emit(slot.runId, {
        type: "error",
        code: "download_failed",
        message: `${filename} ${NOT_STORED}`.slice(0, 500),
      });
    });
  }

  return {
    async attach(slot) {
      const gate = gateOf(slot);
      if (!gate) return;
      const dir = path.join(localRoot, slot.runId);
      await mkdir(dir, { recursive: true, mode: deps.dirMode ?? 0o700 });
      if (deps.dirMode !== undefined) await chmod(dir, deps.dirMode);
      const cdp = await slot.browserCdp();
      const begun = new Map<string, Begun>();
      const onBegin = (event: { guid: string; url: string; suggestedFilename: string }) => {
        // The id names a file under the run's folder: only a UUID may (defence in depth).
        if (!Uuid.safeParse(event.guid).success) return;
        const controlUser = readControlUser(deps.db, slot.runId).catch(() => null);
        begun.set(event.guid, { url: event.url, suggested: event.suggestedFilename, controlUser });
      };
      const onProgress = (event: {
        guid: string;
        state: "inProgress" | "completed" | "canceled";
      }) => {
        if (event.state === "inProgress") return;
        const started = begun.get(event.guid);
        begun.delete(event.guid);
        if (!started || event.state !== "completed") return;
        void file(slot, gate, event.guid, started).catch(
          failed(slot.runId, "download_ingest_failed"),
        );
      };
      cdp.on("Browser.downloadWillBegin", onBegin);
      cdp.on("Browser.downloadProgress", onProgress);
      attached.set(slot.runId, {
        slot,
        stop: () => {
          cdp.off("Browser.downloadWillBegin", onBegin);
          cdp.off("Browser.downloadProgress", onProgress);
        },
      });
    },
    async userControl(runId, on) {
      const entry = attached.get(runId);
      const gate = entry ? gateOf(entry.slot) : null;
      if (!gate) {
        // Never allowed here, so there is nothing to deny again.
        if (on) throw new Error(`downloads are not attached for run ${runId}`);
        return;
      }
      if (!on) return gate.userControl(false);
      // Each cap is enforced as it happens (B1's gate cancels and deletes); the user hears why.
      const onCapped = ({ reason }: { id: string; reason: "too_large" | "too_many" }) =>
        void emit(
          runId,
          reason === "too_large"
            ? tooLarge("A download")
            : {
                type: "error",
                code: "download_too_many",
                message: `This run already kept ${maxCount} downloads; that one was not saved.`,
              },
        ).catch(failed(runId, "download_cap_notice_failed"));
      await gate.userControl(true, { maxBytes, maxCount, onCapped });
    },
    async detach(runId) {
      // The CDP session belongs to the lease (BrowserSession); B1's release deletes the folder.
      attached.get(runId)?.stop();
      attached.delete(runId);
    },
  };
}

interface Approved {
  filename: string;
  url: string;
  approvedBy: string;
}
