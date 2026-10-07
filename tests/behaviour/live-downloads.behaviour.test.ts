import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunEvent } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import {
  assets,
  createDb,
  downloads,
  requestHandBack,
  runEvents,
  runs,
  type DbHandle,
} from "@mastertutor/db";
import { leaseSlotForTest, releaseSlotForTest, seedMember, seedRun } from "@mastertutor/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { slotDownloadPath } from "../../apps/agent/src/browser/download-gate.ts";
import { BrowserSession } from "../../apps/agent/src/browser/session.ts";
import {
  createDownloadIngestor,
  type DownloadIngestor,
} from "../../apps/agent/src/live/downloads.ts";
import { createMemoryStorage } from "../../apps/agent/src/testing/memory-storage.ts";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { BEHAVIOUR_DOWNLOADS, SITE, SLOT_CDP } from "./constants.ts";
import { behaviourEnv } from "./env.ts";

const SLOT = "browser-2";
const NOTES = `${SITE}/files/live-notes.txt`;
const COPY = `${SITE}/files/live-notes-copy.txt`;
const FIXTURE = fileURLToPath(
  new URL("../fixtures/sites/site/files/live-notes.txt", import.meta.url),
);
const log = createLogger({ service: "behaviour", level: "silent" });
const storage = createMemoryStorage();
let owner: DbHandle;
let agentDb: DbHandle;
let member: { userId: string; workspaceId: string };
/** This test's lease: its session (with B1's gate on the run's folder) and its ingestor. */
let lease: { runId: string; session: BrowserSession; ingestor: DownloadIngestor } | null = null;

beforeAll(async () => {
  const env = behaviourEnv();
  owner = createDb(env.ownerUrl, { max: 2 });
  agentDb = createDb(env.agentUrl, { max: 4 });
  member = await seedMember(owner.db);
});
afterEach(async () => {
  if (lease) {
    await lease.ingestor.userControl(lease.runId, false);
    await lease.ingestor.detach(lease.runId);
    await lease.session.close();
  }
  lease = null;
  await releaseSlotForTest(owner.db, SLOT);
});
afterAll(async () => {
  await Promise.all([owner?.close(), agentDb?.close()]);
});

/**
 * A leased run with the real BrowserSession: B1's gate denies every download on connect. With
 * "user", a member holds control and the live view lets them download (userControl).
 */
async function leasedRun(
  controller: "agent" | "user",
  options: {
    workspace?: { userId: string; workspaceId: string };
    store?: Parameters<typeof createDownloadIngestor>[0]["storage"];
    maxBytes?: number;
    maxCount?: number;
  } = {},
) {
  const workspace = options.workspace ?? member;
  const runId = await seedRun(
    owner.db,
    controller === "user"
      ? { workspaceId: workspace.workspaceId, status: "waiting", waitReason: "takeover" }
      : { workspaceId: workspace.workspaceId },
  );
  if (controller === "user")
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: workspace.userId })
      .where(eq(runs.id, runId));
  await leaseSlotForTest(owner.db, SLOT, runId);
  const session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP[SLOT]!,
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
    downloads: { slotPath: slotDownloadPath(runId), localPath: join(BEHAVIOUR_DOWNLOADS, runId) },
  });
  const ingestor = createDownloadIngestor({
    db: agentDb.db,
    storage: options.store ?? storage,
    log,
    localRoot: BEHAVIOUR_DOWNLOADS,
    dirMode: 0o777,
    ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
    ...(options.maxCount ? { maxCount: options.maxCount } : {}),
  });
  await ingestor.attach({
    runId,
    workspaceId: workspace.workspaceId,
    slotName: SLOT,
    session,
    browserCdp: () => session.browserCdp(),
  });
  lease = { runId, session, ingestor };
  if (controller === "user") await ingestor.userControl(runId, true);
  return lease;
}
async function clickDownload(session: BrowserSession, id: "notes" | "copy") {
  expect(await session.goto(`${SITE}/live-download`, new AbortController().signal)).toBe(true);
  await session.page.click(`#${id}`);
}
const rowsFor = (runId: string) =>
  owner.db.select().from(downloads).where(eq(downloads.runId, runId));
const rowCount = (runId: string, count: number, label: string) =>
  waitFor(
    async () => {
      const rows = await rowsFor(runId);
      return rows.length === count ? rows : null;
    },
    { label, timeoutMs: 15_000 },
  );
const eventsFor = async (runId: string): Promise<RunEvent[]> =>
  (
    await owner.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
  ).map((e) => e.payload);
const errorEvent = (runId: string, code: string) =>
  waitFor(async () => (await eventsFor(runId)).find((e) => e.type === "error" && e.code === code), {
    label: `${code} event`,
    timeoutMs: 15_000,
  });
const localFiles = (runId: string) =>
  readdir(join(BEHAVIOUR_DOWNLOADS, runId)).catch(() => [] as string[]);
const noLocalFiles = (runId: string) =>
  waitFor(async () => (await localFiles(runId)).length === 0, { label: "nothing on disk" });
/** The gate's record of cancelled downloads (each becomes an approval card for the agent). */
const blocked = (session: BrowserSession) => session.downloads.drainBlocked().map((b) => b.url);
/** The download made during control, held for the person's decision (download_pending). */
const pendingIn = (runId: string, count = 1) =>
  waitFor(
    async () => {
      const ids = (await eventsFor(runId)).flatMap((e) =>
        e.type === "download_pending" ? [e.downloadId] : [],
      );
      return ids.length >= count ? ids : null;
    },
    { label: "download pending", timeoutMs: 15_000 },
  );
/** The web's hand-back with the person's keep list, then the agent's side of it (A12). */
async function handBack(runId: string, keep: string[], userId = member.userId) {
  const result = await requestHandBack(owner.db, { runId, userId, note: null, keep });
  expect(result.ok).toBe(true);
  await lease!.ingestor.userControl(runId, false);
  // The agent settles in the background: wait until nothing of this run is held any more.
  await waitFor(async () => (await rowsFor(runId)).every((row) => !row.pending), {
    label: "hand-back settled",
    timeoutMs: 15_000,
  });
}
const storedAssets = () => storage.objects.size;

describe("downloads through B1's gate (spec §9, §10.2.9; v1: the member in control downloads)", () => {
  it("stores a download made during control only once the person keeps it, under the run, with a safe name", async () => {
    const before = storedAssets();
    const { runId, session } = await leasedRun("user");
    await clickDownload(session, "notes");
    const [id] = await pendingIn(runId);
    // Held for the person's decision: nothing stored, nothing filed for the agent.
    expect(storedAssets()).toBe(before);
    expect(await rowsFor(runId)).toEqual([
      expect.objectContaining({ id, pending: true, assetId: null, keptAt: null }),
    ]);
    await handBack(runId, [id!]);
    const [row] = await rowsFor(runId);
    expect(row).toMatchObject({
      id,
      pending: false,
      filename: "live-notes.txt",
      approvedBy: member.userId,
    });
    const [asset] = await owner.db.select().from(assets).where(eq(assets.id, row!.assetId!));
    expect(asset!.key).toMatch(new RegExp(`^downloads/${runId}/[0-9a-f]{12}-live-notes\\.txt$`));
    expect(asset!.mime).toBe("text/plain");
    expect(Buffer.from(storage.objects.get(asset!.key)!)).toEqual(await readFile(FIXTURE));
    expect(await eventsFor(runId)).toContainEqual({
      type: "download_ready",
      downloadId: id,
      assetId: row!.assetId,
      filename: "live-notes.txt",
      bytes: (await readFile(FIXTURE)).length,
    });
    await noLocalFiles(runId);
  });

  it("discards a download the person did not keep: nothing stored, nothing on disk", async () => {
    const before = storedAssets();
    const { runId, session } = await leasedRun("user");
    await clickDownload(session, "notes");
    await pendingIn(runId);
    await handBack(runId, []);
    expect(await rowsFor(runId)).toEqual([]);
    expect(storedAssets()).toBe(before);
    expect((await eventsFor(runId)).some((e) => e.type === "download_ready")).toBe(false);
    await noLocalFiles(runId);
  });

  it("a download the page set off before the takeover that lands during control is not stored unless kept", async () => {
    const before = storedAssets();
    const { runId, session, ingestor } = await leasedRun("agent");
    expect(await session.goto(`${SITE}/live-download`, new AbortController().signal)).toBe(true);
    // Under the agent, the page arms a download for later (a slow answer, or the page's own script).
    await session.page.evaluate(() =>
      setTimeout(() => (document.querySelector("#notes") as HTMLAnchorElement).click(), 1_500),
    );
    await owner.db
      .update(runs)
      .set({
        controller: "user",
        controlUserId: member.userId,
        status: "waiting",
        waitReason: "takeover",
      })
      .where(eq(runs.id, runId));
    await ingestor.userControl(runId, true);
    // It lands during control, so the gate lets it through as the person's: held, not stored.
    await pendingIn(runId);
    expect(storedAssets()).toBe(before);
    await handBack(runId, []);
    expect(await rowsFor(runId)).toEqual([]);
    expect(storedAssets()).toBe(before);
    await noLocalFiles(runId);
  });

  it("leaves a download made while the agent holds control to the gate: denied, nothing stored (Review Focus 4)", async () => {
    const before = storage.objects.size;
    const { runId, session } = await leasedRun("agent");
    await clickDownload(session, "notes");
    const urls = await waitFor(
      () => {
        const drained = blocked(session);
        return drained.length > 0 ? drained : null;
      },
      { label: "the gate cancelled it", timeoutMs: 15_000 },
    );
    expect(urls).toEqual([NOTES]);
    await new Promise((resolve) => setTimeout(resolve, 1_500)); // past the gate's late sweep
    expect(await localFiles(runId)).toEqual([]);
    expect(await rowsFor(runId)).toHaveLength(0);
    expect(storage.objects.size).toBe(before);
    expect((await eventsFor(runId)).filter((e) => e.type === "error")).toEqual([]);
  });

  it("stores identical content once and records both kept downloads", async () => {
    const { runId, session } = await leasedRun("user");
    await clickDownload(session, "notes");
    await pendingIn(runId, 1);
    await clickDownload(session, "copy");
    const ids = await pendingIn(runId, 2);
    await handBack(runId, ids);
    const rows = await rowsFor(runId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.assetId).not.toBeNull();
    expect(rows[0]!.assetId).toBe(rows[1]!.assetId);
  });

  it("hand-back keeps the agent's blocked downloads and never adds the user's (review minor)", async () => {
    const { runId, session, ingestor } = await leasedRun("agent");
    await clickDownload(session, "copy"); // the agent's, blocked: an approval card to come
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await owner.db
      .update(runs)
      .set({
        controller: "user",
        controlUserId: member.userId,
        status: "waiting",
        waitReason: "takeover",
      })
      .where(eq(runs.id, runId));
    await ingestor.userControl(runId, true);
    await clickDownload(session, "notes"); // the user's
    await pendingIn(runId);
    await handBack(runId, []);
    expect(blocked(session)).toEqual([COPY]);
  });

  it("cancels a download over the size cap or over the count cap as it happens, and tells the user (I1)", async () => {
    const big = await leasedRun("user", { maxBytes: 5 });
    await clickDownload(big.session, "notes");
    expect(await errorEvent(big.runId, "download_too_large")).toBeDefined();
    await noLocalFiles(big.runId);
    expect(await rowsFor(big.runId)).toHaveLength(0);
    await big.ingestor.userControl(big.runId, false);
    await big.ingestor.detach(big.runId);
    await big.session.close();
    lease = null;
    await releaseSlotForTest(owner.db, SLOT);

    const many = await leasedRun("user", { maxCount: 1 });
    await clickDownload(many.session, "notes");
    await pendingIn(many.runId, 1);
    await clickDownload(many.session, "copy");
    expect(await errorEvent(many.runId, "download_too_many")).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await rowsFor(many.runId)).toHaveLength(1);
  });

  it("tells the user when a download cannot be stored, and keeps nothing (review minor)", async () => {
    // A fresh workspace: dedupe must not find this file already stored by an earlier case.
    const other = await seedMember(owner.db);
    const failing = { ...createMemoryStorage(), putFile: () => Promise.reject(new Error("down")) };
    const { runId, session } = await leasedRun("user", { workspace: other, store: failing });
    await clickDownload(session, "notes");
    const [id] = await pendingIn(runId);
    await handBack(runId, [id!], other.userId);
    expect(await errorEvent(runId, "download_failed")).toBeDefined();
    expect(await rowsFor(runId)).toHaveLength(0);
    await noLocalFiles(runId);
  });

  it("files a download approved for the agent under the person who approved that very allowance (N3)", async () => {
    const { runId, session } = await leasedRun("agent");
    await session.downloads.allowOnce((url) => url === NOTES, member.userId);
    await clickDownload(session, "notes");
    const [row] = await rowCount(runId, 1, "approved download filed");
    expect(row).toMatchObject({
      filename: "live-notes.txt",
      approvedBy: member.userId,
      pending: false,
    });
    await noLocalFiles(runId);
  });

  it("stores nothing for a let-through download that no approval names (N3: never 'policy')", async () => {
    const before = storedAssets();
    const { runId, session } = await leasedRun("agent");
    await session.downloads.allowOnce((url) => url === NOTES);
    await clickDownload(session, "notes");
    expect(await errorEvent(runId, "download_failed")).toBeDefined();
    expect(await rowsFor(runId)).toEqual([]);
    expect(storedAssets()).toBe(before);
    await noLocalFiles(runId);
  });

  it("an inline PDF the agent opens is not a download (B5 capture path)", async () => {
    const before = storage.objects.size;
    const { runId, session } = await leasedRun("agent");
    await session.goto(`${SITE}/pdf/doc.pdf`, new AbortController().signal);
    await waitFor(() => session.page.url().endsWith("/doc.pdf"), { label: "PDF shown inline" });
    // Sentinel: a real download after the PDF. Exactly one cancelled download (the sentinel's)
    // proves the inline PDF never started one.
    await clickDownload(session, "notes");
    const urls = await waitFor(
      () => {
        const drained = blocked(session);
        return drained.length > 0 ? drained : null;
      },
      { label: "sentinel blocked", timeoutMs: 15_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect([...urls, ...blocked(session)]).toEqual([NOTES]);
    expect(await localFiles(runId)).toEqual([]);
    expect(storage.objects.size).toBe(before);
  });
});
