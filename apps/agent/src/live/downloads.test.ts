import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@mastertutor/contracts/server";
import type { Database } from "@mastertutor/db";
import type { CDPSession } from "playwright-core";
import { describe, expect, it } from "vitest";
import type { UserDownloadLimits } from "../browser/download-gate.ts";
import type { BrowserSession } from "../browser/session.ts";
import type { LeasedSlot } from "../loop/hooks.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { createDownloadIngestor, downloadMime } from "./downloads.ts";

describe("downloadMime", () => {
  it("serves only inert types under their real MIME type", () => {
    expect(downloadMime("Report.PDF")).toBe("application/pdf");
    expect(downloadMime("chart.png")).toBe("image/png");
    expect(downloadMime("data.csv")).toBe("text/csv");
  });
  it("never lets active content render from storage", () => {
    for (const name of ["page.html", "x.htm", "img.svg", "feed.xml", "app.js", "noext"]) {
      expect(downloadMime(name), name).toBe("application/octet-stream");
    }
  });
});

const RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const log = createLogger({ service: "test", level: "silent" });

/** A browser-level CDP session that records what it is sent and can emit Browser.* events. */
function fakeCdp() {
  const events = new EventEmitter();
  const sent: string[] = [];
  const cdp = {
    on: (name: string, listener: (event: unknown) => void) => events.on(name, listener),
    off: (name: string, listener: (event: unknown) => void) => events.off(name, listener),
    send: async (method: string) => {
      sent.push(method);
      return {};
    },
  } as unknown as CDPSession;
  return { cdp, sent, emit: (name: string, event: unknown) => events.emit(name, event) };
}

async function setup(options: { maxBytes?: number; maxCount?: number } = {}) {
  const { cdp, sent, emit } = fakeCdp();
  const gateCalls: Array<{ on: boolean; limits?: Partial<UserDownloadLimits> }> = [];
  const session = {
    downloads: {
      async userControl(on: boolean, limits?: Partial<UserDownloadLimits>) {
        gateCalls.push({ on, ...(limits ? { limits } : {}) });
      },
      userDownloads: () => [],
      approvedDownloads: () => [],
    },
  } as unknown as BrowserSession;
  const slot: LeasedSlot = {
    runId: RUN,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    slotName: "browser-1",
    session,
    browserCdp: async () => cdp,
  };
  const ingestor = createDownloadIngestor({
    // Never reached: these cases decide nothing against the database.
    db: {} as Database,
    storage: createMemoryStorage(),
    log,
    localRoot: await mkdtemp(join(tmpdir(), "downloads-")),
    ...options,
  });
  return { ingestor, slot, sent, emit, gateCalls };
}

describe("DownloadIngestor over B1's download gate (spec §9, §10.2.9)", () => {
  it("never sends the browser a download command: the gate is the only owner (C1)", async () => {
    const { ingestor, slot, sent, emit } = await setup();
    await ingestor.attach(slot);
    await ingestor.userControl(RUN, true);
    emit("Browser.downloadWillBegin", {
      guid: "not-a-uuid",
      url: "https://x.test/a",
      suggestedFilename: "a",
    });
    emit("Browser.downloadProgress", { guid: "not-a-uuid", state: "completed" });
    await ingestor.userControl(RUN, false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
  });

  it("switches the gate to the user with its caps, and back (I1)", async () => {
    const { ingestor, slot, gateCalls } = await setup({ maxBytes: 1_000, maxCount: 3 });
    await ingestor.attach(slot);
    await ingestor.userControl(RUN, true);
    await ingestor.userControl(RUN, false);
    expect(gateCalls).toEqual([
      { on: true, limits: { maxBytes: 1_000, maxCount: 3, onCapped: expect.any(Function) } },
      { on: false },
    ]);
  });

  it("cannot offer downloads for a run it is not attached to, and has nothing to deny there", async () => {
    const { ingestor, gateCalls } = await setup();
    await expect(ingestor.userControl(RUN, true)).rejects.toThrow(/not attached/);
    await ingestor.userControl(RUN, false);
    expect(gateCalls).toEqual([]);
  });
});
