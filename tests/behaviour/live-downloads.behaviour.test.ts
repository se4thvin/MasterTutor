import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunEvent } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { assets, createDb, downloads, runEvents, runs, type DbHandle } from "@mastertutor/db";
import { leaseSlotForTest, releaseSlotForTest, seedMember, seedRun } from "@mastertutor/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
const FIXTURE = fileURLToPath(
  new URL("../fixtures/sites/site/files/live-notes.txt", import.meta.url),
);
const log = createLogger({ service: "behaviour", level: "silent" });
const storage = createMemoryStorage();
let owner: DbHandle;
let agentDb: DbHandle;
let session: BrowserSession;
let ingestor: DownloadIngestor;
let member: { userId: string; workspaceId: string };
let current: string | null = null;

beforeAll(async () => {
  const env = behaviourEnv();
  owner = createDb(env.ownerUrl, { max: 2 });
  agentDb = createDb(env.agentUrl, { max: 4 });
  member = await seedMember(owner.db);
  // The real BrowserSession: Playwright connects first and B1's download gate denies every
  // download; the ingestor never changes that while the agent holds control (spec §9).
  session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP[SLOT]!,
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
  });
  ingestor = createDownloadIngestor({
    db: agentDb.db,
    storage,
    log,
    localRoot: BEHAVIOUR_DOWNLOADS,
    dirMode: 0o777,
  });
});
afterEach(async () => {
  if (current) {
    await ingestor.userControl(current, false);
    await ingestor.detach(current);
  }
  current = null;
  session.downloads.drainBlocked();
  gateBlocked.length = 0;
  await releaseSlotForTest(owner.db, SLOT);
});
afterAll(async () => {
  await session?.close();
  await Promise.all([owner?.close(), agentDb?.close()]);
});

/** A leased run; with "user", a member holds control and the live view lets them download. */
async function leasedRun(controller: "agent" | "user"): Promise<string> {
  const runId = await seedRun(
    owner.db,
    controller === "user"
      ? { workspaceId: member.workspaceId, status: "waiting", waitReason: "takeover" }
      : { workspaceId: member.workspaceId },
  );
  if (controller === "user")
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: member.userId })
      .where(eq(runs.id, runId));
  await leaseSlotForTest(owner.db, SLOT, runId);
  await ingestor.attach({
    runId,
    workspaceId: member.workspaceId,
    slotName: SLOT,
    session,
    browserCdp: () => session.browserCdp(),
  });
  current = runId;
  if (controller === "user") await ingestor.userControl(runId, true);
  return runId;
}
async function clickDownload(id: "notes" | "copy") {
  expect(await session.goto(`${SITE}/live-download`, new AbortController().signal)).toBe(true);
  await session.page.click(`#${id}`);
}
const rowsFor = (runId: string) =>
  owner.db.select().from(downloads).where(eq(downloads.runId, runId));
const eventsFor = async (runId: string): Promise<RunEvent[]> =>
  (
    await owner.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id))
  ).map((e) => e.payload);
const localFiles = (runId: string) =>
  readdir(join(BEHAVIOUR_DOWNLOADS, runId)).catch(() => [] as string[]);
/** Downloads B1's gate cancelled (each becomes an approval card for the agent's next step). */
const gateBlocked: string[] = [];
const collectGate = () => {
  for (const blocked of session.downloads.drainBlocked()) gateBlocked.push(blocked.url);
  return gateBlocked.length;
};

describe("downloads (spec §10.2.9; v1: only the member in control downloads)", () => {
  it("ingests a download made while the user holds control, under the run, with a safe name", async () => {
    const runId = await leasedRun("user");
    await clickDownload("notes");
    const [row] = await waitFor(
      async () => {
        const rows = await rowsFor(runId);
        return rows.length === 1 ? rows : null;
      },
      { label: "download recorded", timeoutMs: 15_000 },
    );
    expect(row).toMatchObject({ filename: "live-notes.txt", approvedBy: member.userId });
    const [asset] = await owner.db.select().from(assets).where(eq(assets.id, row!.assetId!));
    expect(asset!.key).toMatch(new RegExp(`^downloads/${runId}/[0-9a-f]{12}-live-notes\\.txt$`));
    expect(asset!.mime).toBe("text/plain");
    expect(Buffer.from(storage.objects.get(asset!.key)!)).toEqual(await readFile(FIXTURE));
    expect(await eventsFor(runId)).toContainEqual({
      type: "download_ready",
      downloadId: row!.id,
      assetId: row!.assetId,
      filename: "live-notes.txt",
      bytes: (await readFile(FIXTURE)).length,
    });
    await waitFor(async () => (await localFiles(runId)).length === 0, {
      label: "local copy deleted",
    });
  });

  it("leaves a download made while the agent holds control to B1's gate: denied, nothing stored (Review Focus 4)", async () => {
    const before = storage.objects.size;
    const runId = await leasedRun("agent");
    await clickDownload("notes");
    await waitFor(async () => collectGate() > 0, {
      label: "the gate cancelled it",
      timeoutMs: 15_000,
    });
    expect(gateBlocked).toEqual([`${SITE}/files/live-notes.txt`]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await localFiles(runId)).toEqual([]);
    expect(await rowsFor(runId)).toHaveLength(0);
    expect(storage.objects.size).toBe(before);
    // The gate's approval card is the agent's path; the live view adds no event of its own.
    expect((await eventsFor(runId)).filter((e) => e.type === "error")).toEqual([]);
  });

  it("stores identical content once and records both downloads", async () => {
    const runId = await leasedRun("user");
    await clickDownload("notes");
    await waitFor(async () => (await rowsFor(runId)).length === 1, {
      label: "first",
      timeoutMs: 15_000,
    });
    await clickDownload("copy");
    const rows = await waitFor(
      async () => {
        const all = await rowsFor(runId);
        return all.length === 2 ? all : null;
      },
      { label: "second", timeoutMs: 15_000 },
    );
    expect(rows[0]!.assetId).toBe(rows[1]!.assetId);
  });

  it("hands downloads back to the gate when the user hands back, without leaving the user's downloads to approve", async () => {
    const runId = await leasedRun("user");
    await clickDownload("notes");
    await waitFor(async () => (await rowsFor(runId)).length === 1, {
      label: "user download",
      timeoutMs: 15_000,
    });
    await ingestor.userControl(runId, false);
    collectGate();
    expect(gateBlocked).toEqual([]);
    await clickDownload("copy");
    await waitFor(async () => collectGate() > 0, {
      label: "denied again after hand-back",
      timeoutMs: 15_000,
    });
    expect(gateBlocked).toEqual([`${SITE}/files/live-notes-copy.txt`]);
    expect(await rowsFor(runId)).toHaveLength(1);
  });

  it("tells the user when a download cannot be stored, and keeps nothing (review minor)", async () => {
    const failing = createDownloadIngestor({
      db: agentDb.db,
      storage: {
        ...createMemoryStorage(),
        putFile: () => Promise.reject(new Error("Garage unavailable")),
      },
      log,
      localRoot: BEHAVIOUR_DOWNLOADS_DIR,
      dirMode: 0o777,
    });
    // A fresh workspace: dedupe must not find this file already stored by an earlier case.
    const other = await seedMember(owner.db);
    const runId = await seedRun(owner.db, {
      workspaceId: other.workspaceId,
      status: "waiting",
      waitReason: "takeover",
    });
    await owner.db
      .update(runs)
      .set({ controller: "user", controlUserId: other.userId })
      .where(eq(runs.id, runId));
    await leaseSlotForTest(owner.db, SLOT, runId);
    await failing.attach({
      runId,
      workspaceId: other.workspaceId,
      slotName: SLOT,
      session,
      browserCdp: () => session.browserCdp(),
    });
    try {
      await failing.userControl(runId, true);
      await clickDownload("notes");
      await waitFor(
        async () =>
          (await eventsFor(runId)).some((e) => e.type === "error" && e.code === "download_failed"),
        { label: "download_failed event", timeoutMs: 15_000 },
      );
      expect(await rowsFor(runId)).toHaveLength(0);
      await waitFor(async () => (await localFiles(runId)).length === 0, {
        label: "local copy deleted",
      });
    } finally {
      await failing.userControl(runId, false);
      await failing.detach(runId);
    }
  });

  it("an inline PDF the agent opens is not a download (B5 capture path)", async () => {
    const before = storage.objects.size;
    const runId = await leasedRun("agent");
    await session.goto(`${SITE}/pdf/doc.pdf`, new AbortController().signal);
    await waitFor(() => session.page.url().endsWith("/doc.pdf"), { label: "PDF shown inline" });
    // Sentinel: a real download after the PDF. Exactly one cancelled download (the sentinel's)
    // proves the inline PDF never started one.
    await clickDownload("notes");
    await waitFor(async () => collectGate() > 0, {
      label: "sentinel blocked",
      timeoutMs: 15_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    collectGate();
    expect(gateBlocked).toEqual([`${SITE}/files/live-notes.txt`]);
    expect(await localFiles(runId)).toEqual([]);
    expect(storage.objects.size).toBe(before);
  });
});
