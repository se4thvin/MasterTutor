import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@mastertutor/contracts/server";
import type { Database } from "@mastertutor/db";
import type { CDPSession } from "playwright-core";
import { describe, expect, it } from "vitest";
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
  const sent: Array<{ method: string; params: unknown }> = [];
  const cdp = {
    on: (name: string, listener: (event: unknown) => void) => events.on(name, listener),
    off: (name: string, listener: (event: unknown) => void) => events.off(name, listener),
    send: async (method: string, params: unknown) => {
      sent.push({ method, params });
      return {};
    },
  } as unknown as CDPSession;
  return { cdp, sent, emit: (name: string, event: unknown) => events.emit(name, event) };
}

async function setup() {
  const { cdp, sent, emit } = fakeCdp();
  const drained: string[] = [];
  const session = {
    downloads: {
      drainBlocked: () => {
        drained.push("drained");
        return [];
      },
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
  });
  return { ingestor, slot, sent, emit, drained };
}

describe("DownloadIngestor and B1's download gate (spec §9, §10.2.9)", () => {
  it("attaching never changes the browser's download behaviour: agent downloads stay gated", async () => {
    const { ingestor, slot, sent } = await setup();
    await ingestor.attach(slot);
    expect(sent.filter((call) => call.method === "Browser.setDownloadBehavior")).toEqual([]);
  });

  it("ignores downloads that begin while the agent holds control (the gate's to approve)", async () => {
    const { ingestor, slot, sent, emit } = await setup();
    await ingestor.attach(slot);
    emit("Browser.downloadWillBegin", {
      guid: "g1",
      url: "https://x.test/a.pdf",
      suggestedFilename: "a.pdf",
    });
    emit("Browser.downloadProgress", { guid: "g1", state: "canceled" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.map((call) => call.method)).not.toContain("Browser.cancelDownload");
  });

  it("allows downloads into the run's folder only while the user holds control, then denies again", async () => {
    const { ingestor, slot, sent, drained } = await setup();
    await ingestor.attach(slot);
    await ingestor.userControl(RUN, true);
    expect(sent.at(-1)).toEqual({
      method: "Browser.setDownloadBehavior",
      params: { behavior: "allowAndName", downloadPath: `/downloads/${RUN}`, eventsEnabled: true },
    });
    await ingestor.userControl(RUN, false);
    expect(sent.at(-1)).toEqual({
      method: "Browser.setDownloadBehavior",
      params: { behavior: "deny", eventsEnabled: true },
    });
    // What the user downloaded must never come back to the agent as a download to approve.
    expect(drained).toEqual(["drained"]);
  });

  it("cannot allow downloads for a run it is not attached to, and has nothing to deny there", async () => {
    const { ingestor, sent } = await setup();
    await expect(ingestor.userControl(RUN, true)).rejects.toThrow(/not attached/);
    await ingestor.userControl(RUN, false);
    expect(sent).toEqual([]);
  });
});
