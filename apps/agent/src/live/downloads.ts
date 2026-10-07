import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_USER_DOWNLOADS_PER_RUN, Uuid, type RunEvent } from "@mastertutor/contracts";
import {
  discardDownload,
  emitRunEvent,
  fileKeptDownload,
  findAssetBySha,
  latestDownloadApprover,
  pendingDownloads,
  readControlUser,
  recordDownload,
  recordPendingDownload,
  type Database,
  type DbTx,
} from "@mastertutor/db";
import { objectKeys, safeFilename, type Storage } from "@mastertutor/storage";
import type { DownloadGate, FinishedDownload } from "../browser/download-gate.ts";
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
  /** Caps the gate enforces on the person's downloads, as they happen (I1). */
  maxBytes?: number;
  maxCount?: number;
}

export interface DownloadIngestor {
  /** Listens on the lease's browser and files what B1's gate let through; changes nothing. */
  attach(slot: LeasedSlot): Promise<void>;
  /**
   * on: the member holding control may download, within the caps; each download is held for
   * them (download_pending), never stored. off: resolves once the gate denies again (fails only
   * if it cannot); then, in the background, the downloads the person kept are stored
   * (download_ready) and every other held one is discarded.
   */
  userControl(runId: string, on: boolean): Promise<void>;
  detach(runId: string): Promise<void>;
}

interface Attached {
  slot: LeasedSlot;
  /** True while a person holds control: their downloads are held, not filed. */
  userMode: boolean;
  /** Where each held download came from (asset.sourceUrl once kept). */
  sources: Map<string, string>;
  stop(): void;
}

interface Stored {
  filename: string;
  sourceUrl: string | null;
}

const NOT_STORED = "could not be saved. Download it again in a moment.";

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
 * This ingestor files only what the gate let through (userDownloads(), approvedDownloads(),
 * never the folder). A download made during control may not be the person's (a request sent
 * before the takeover, or the page's own script), so it is only held: at hand-back the person
 * keeps or discards each one, and only a kept one is stored or shown to the agent.
 */
export function createDownloadIngestor(deps: DownloadIngestorDeps): DownloadIngestor {
  const localRoot = deps.localRoot ?? "/downloads";
  const maxBytes = deps.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const maxCount = deps.maxCount ?? MAX_USER_DOWNLOADS_PER_RUN;
  const attached = new Map<string, Attached>();
  const localFile = (runId: string, guid: string) => path.join(localRoot, runId, guid);
  const emit = (runId: string, event: RunEvent) =>
    deps.db.transaction((tx) => emitRunEvent(tx, runId, event));

  const failed = (runId: string, errorCode: string) => (error: unknown) =>
    deps.log.error(
      { runId, errorCode, err: error instanceof Error ? error.name : "unknown" },
      "download handling failed",
    );

  const tooLarge = (filename: string): RunEvent => ({
    type: "error",
    code: "download_too_large",
    message:
      `${filename} is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB and was not saved.`.slice(
        0,
        500,
      ),
  });

  /**
   * Hashes and stores a finished download, then records it (in the caller's transaction) and
   * announces it. Throws if the file is over the cap or cannot be stored.
   */
  async function store(
    slot: LeasedSlot,
    guid: string,
    stored: Stored,
    record: (
      tx: DbTx,
      object: { sha256: string; key: string; mime: string; bytes: number },
    ) => Promise<{ downloadId: string; assetId: string }>,
  ): Promise<void> {
    const file = localFile(slot.runId, guid);
    const { size } = await stat(file);
    // The gate cancels a larger one as it grows; this is defence in depth.
    if (size > maxBytes) throw new RangeError("download over the size cap");
    const sha256 = await sha256Of(file);
    const mime = downloadMime(stored.filename);
    // Assets are unique per workspace and sha256 (assets_workspace_sha256_uq), so identical
    // content reuses the first run's object (downloads/<thatRunId>/…). Deleting a run's
    // objects must therefore never delete an object an asset row still references.
    const existing = await findAssetBySha(deps.db, slot.workspaceId, sha256);
    const key =
      existing?.key ?? objectKeys.download(slot.runId, `${sha256.slice(0, 12)}-${stored.filename}`);
    if (!existing) await deps.storage.putFile(key, file, { contentType: mime, sha256 });
    await deps.db.transaction(async (tx) => {
      const { downloadId, assetId } = await record(tx, { sha256, key, mime, bytes: size });
      await emitRunEvent(tx, slot.runId, {
        type: "download_ready",
        downloadId,
        assetId,
        filename: stored.filename,
        bytes: size,
      });
    });
  }

  /** A download a person approved for the agent (B1's approval card): stored at once. */
  async function fileApproved(
    slot: LeasedSlot,
    guid: string,
    begun: FinishedDownload,
  ): Promise<void> {
    const filename = safeFilename(begun.filename || "download");
    const approvedBy = (await latestDownloadApprover(deps.db, slot.runId)) ?? "policy";
    try {
      await store(slot, guid, { filename, sourceUrl: begun.url }, (tx, object) =>
        recordDownload(tx, {
          runId: slot.runId,
          workspaceId: slot.workspaceId,
          filename,
          sha256: object.sha256,
          bucket: deps.storage.bucket,
          key: object.key,
          mime: object.mime,
          bytes: object.bytes,
          sourceUrl: begun.url.slice(0, 4_096),
          approvedBy,
        }),
      );
    } catch (error) {
      failed(slot.runId, "download_ingest_failed")(error);
      await emit(slot.runId, {
        type: "error",
        code: "download_failed",
        message: `${filename} ${NOT_STORED}`.slice(0, 500),
      });
    } finally {
      await rm(localFile(slot.runId, guid), { force: true });
    }
  }

  /** A download made during control: held (row pending, file kept) for the person to decide. */
  async function hold(entry: Attached, guid: string, begun: FinishedDownload): Promise<void> {
    const { slot } = entry;
    const file = localFile(slot.runId, guid);
    const approvedBy = await readControlUser(deps.db, slot.runId);
    // Control already went back (it finished after the hand-back was settled): never held.
    if (!entry.userMode || !approvedBy) {
      await rm(file, { force: true });
      return;
    }
    const filename = safeFilename(begun.filename || "download");
    const { size } = await stat(file);
    entry.sources.set(guid, begun.url.slice(0, 4_096));
    await deps.db.transaction(async (tx) => {
      await recordPendingDownload(tx, {
        id: guid,
        runId: slot.runId,
        filename,
        bytes: size,
        approvedBy,
      });
      await emitRunEvent(tx, slot.runId, {
        type: "download_pending",
        downloadId: guid,
        filename,
        bytes: size,
      });
    });
  }

  /** The hand-back: kept downloads are stored, every other held one is discarded. */
  async function settle(entry: Attached): Promise<void> {
    const { slot } = entry;
    for (const held of await pendingDownloads(deps.db, slot.runId)) {
      const sourceUrl = entry.sources.get(held.id) ?? null;
      entry.sources.delete(held.id);
      try {
        if (held.keptAt)
          await store(slot, held.id, { filename: held.filename, sourceUrl }, (tx, object) =>
            fileKeptDownload(tx, {
              downloadId: held.id,
              runId: slot.runId,
              workspaceId: slot.workspaceId,
              sha256: object.sha256,
              bucket: deps.storage.bucket,
              key: object.key,
              mime: object.mime,
              sourceUrl,
            }).then(({ assetId }) => ({ downloadId: held.id, assetId })),
          );
        else await deps.db.transaction((tx) => discardDownload(tx, slot.runId, held.id));
      } catch (error) {
        failed(slot.runId, "download_ingest_failed")(error);
        // Kept but not stored: say so, and keep nothing half-filed.
        await deps.db
          .transaction((tx) => discardDownload(tx, slot.runId, held.id))
          .then(() =>
            emit(slot.runId, {
              type: "error",
              code: "download_failed",
              message: `${held.filename} ${NOT_STORED}`.slice(0, 500),
            }),
          )
          .catch(failed(slot.runId, "download_discard_failed"));
      } finally {
        await rm(localFile(slot.runId, held.id), { force: true });
      }
    }
  }

  return {
    async attach(slot) {
      const gate = gateOf(slot);
      if (!gate) return;
      const dir = path.join(localRoot, slot.runId);
      await mkdir(dir, { recursive: true, mode: deps.dirMode ?? 0o700 });
      if (deps.dirMode !== undefined) await chmod(dir, deps.dirMode);
      const entry: Attached = { slot, userMode: false, sources: new Map(), stop: () => undefined };
      // Only the gate's CDP session receives download events: it tells the ingestor what to file.
      gate.onFinished((download) => {
        // The id names a file under the run's folder: only a UUID may (defence in depth).
        if (!Uuid.safeParse(download.id).success) return;
        const work =
          download.by === "user"
            ? hold(entry, download.id, download)
            : fileApproved(slot, download.id, download);
        void work.catch(failed(slot.runId, "download_ingest_failed"));
      });
      entry.stop = () => gate.onFinished(null);
      attached.set(slot.runId, entry);
    },
    async userControl(runId, on) {
      const entry = attached.get(runId);
      const gate = entry ? gateOf(entry.slot) : null;
      if (!entry || !gate) {
        // Never allowed here, so there is nothing to deny again.
        if (on) throw new Error(`downloads are not attached for run ${runId}`);
        return;
      }
      if (!on) {
        entry.userMode = false;
        // Only the deny is awaited (the agent may act next); storing kept files can take long.
        await gate.userControl(false);
        void settle(entry).catch(failed(runId, "download_settle_failed"));
        return;
      }
      // Each cap is enforced as it happens (B1's gate cancels and deletes); the person hears why.
      const onCapped = ({ reason }: { id: string; reason: "too_large" | "too_many" }) =>
        void emit(
          runId,
          reason === "too_large"
            ? tooLarge("A download")
            : {
                type: "error",
                code: "download_too_many",
                message: `This run already has ${maxCount} downloads; that one was not saved.`,
              },
        ).catch(failed(runId, "download_cap_notice_failed"));
      entry.userMode = true;
      await gate.userControl(true, { maxBytes, maxCount, onCapped });
    },
    async detach(runId) {
      // The CDP session belongs to the lease (BrowserSession); B1's release deletes the folder.
      attached.get(runId)?.stop();
      attached.delete(runId);
    },
  };
}
