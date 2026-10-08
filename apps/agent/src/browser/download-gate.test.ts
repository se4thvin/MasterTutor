import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { DownloadGate } from "./download-gate.ts";

const log = { info() {}, warn() {}, error() {}, debug() {} } as never;

/** A browser CDP session that records commands and can be told to fail them. */
class FakeCdp extends EventEmitter {
  readonly sent: Array<{ method: string; params: unknown }> = [];
  failing = false;
  async send(method: string, params: unknown) {
    this.sent.push({ method, params });
    if (this.failing) throw new Error("Target closed");
    return {};
  }
}

let folder = "";
afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
});

async function gate() {
  folder = await mkdtemp(join(tmpdir(), "gate-"));
  const cdp = new FakeCdp();
  const browser = { newBrowserCDPSession: async () => cdp } as unknown as Browser;
  const installed = await DownloadGate.install(
    browser,
    { slotPath: "/downloads/run", localPath: folder },
    log,
  );
  return { gate: installed, cdp };
}

describe("DownloadGate while a person holds control", () => {
  it("caps a download that is over the size limit when it reports completed (no in-progress tick seen)", async () => {
    const { gate: g, cdp } = await gate();
    const capped: string[] = [];
    const finished: string[] = [];
    g.onFinished((download) => void finished.push(download.id));
    let reported = () => undefined as void;
    const report = new Promise<void>((resolve) => (reported = resolve));
    await g.userControl(true, {
      maxBytes: 1_000,
      onCapped: ({ reason }) => {
        capped.push(reason);
        reported();
      },
    });
    cdp.emit("Browser.downloadWillBegin", {
      guid: "g1",
      url: "https://a.test/f",
      suggestedFilename: "f",
    });
    await writeFile(join(folder, "g1"), Buffer.alloc(5_000));
    // A small file can finish within one progress tick: the only event is `completed`.
    cdp.emit("Browser.downloadProgress", {
      guid: "g1",
      state: "completed",
      receivedBytes: 5_000,
      totalBytes: 5_000,
    });
    // The cap is reported once the cancel is acknowledged and its files are gone.
    await report;
    expect(capped).toEqual(["too_large"]);
    expect(await readdir(folder)).toEqual([]);
    expect(finished).toEqual([]); // never reported for B6 to file
  });

  it("reports failure when the deny cannot be restored at hand-back (the caller fails closed)", async () => {
    const { gate: g, cdp } = await gate();
    await g.userControl(true);
    cdp.failing = true;
    await expect(g.userControl(false)).rejects.toThrow();
  });

  it("restores the deny at hand-back", async () => {
    const { gate: g, cdp } = await gate();
    await g.userControl(true);
    await g.userControl(false);
    expect(cdp.sent.at(-1)).toEqual({
      method: "Browser.setDownloadBehavior",
      params: { behavior: "deny", eventsEnabled: true },
    });
  });
});
