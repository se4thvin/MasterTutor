import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ComputerAction } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  BEHAVIOUR_DOWNLOADS,
  COMPOSE_FILE,
  SITE,
  SLOT_CDP,
} from "../../../../tests/behaviour/constants.ts";
import { instantClock } from "../runtime/clock.ts";
import { ControlHeld } from "../runtime/errors.ts";
import { waitFor } from "../testing/wait.ts";
import { ComputerExecutor } from "../tools/computer.ts";
import { slotDownloadPath } from "./download-gate.ts";
import { hitTest } from "./hit-test.ts";
import { NO_MASK_SOURCES } from "./masking.ts";
import { captureModelScreenshot } from "./screenshot.ts";
import { BrowserSession } from "./session.ts";

const log = createLogger({ service: "test", level: "silent" });
const signal = new AbortController().signal;
const ISOLATED = "http://other.fixtures-isolated.test";
const run = promisify(execFile);
let session: BrowserSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

/** Every file a download could have written anywhere in the slot (a default download, Playwright's folder, the volume). */
async function savedFiles(): Promise<string[]> {
  const { stdout } = await run("docker", [
    "compose",
    "-f",
    COMPOSE_FILE,
    "exec",
    "-T",
    "browser-1",
    "sh",
    "-c",
    "find / /downloads -xdev -type f \\( -path '/downloads/*' -o -path '*playwright-artifacts*' -o -path '/home/neko/Downloads/*' -o -name '*.csv' -o -name '*.txt' -newer /proc/1 \\) 2>/dev/null | grep -v -E '^/(proc|sys|usr|etc|var|opt|lib)' || true",
  ]);
  return stdout.split("\n").filter(Boolean);
}

/** Native "Save File" windows open on the slot's display. */
async function saveDialogs(): Promise<number> {
  const { stdout } = await run("docker", [
    "compose",
    "-f",
    COMPOSE_FILE,
    "exec",
    "-T",
    "browser-1",
    "sh",
    "-c",
    "DISPLAY=:99.0 xwininfo -root -tree 2>/dev/null | grep -i -c 'save file' || true",
  ]);
  return Number(stdout.trim());
}

/** The run's folder as the agent sees it (the behaviour stack mounts the volume on the host). */
const localFolder = (runId: string) => join(BEHAVIOUR_DOWNLOADS, runId);
const localFiles = (runId: string) => readdir(localFolder(runId)).catch(() => [] as string[]);

async function setup(page = "/download.html") {
  const runId = randomUUID();
  session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP["browser-1"] ?? "",
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
    downloads: { slotPath: slotDownloadPath(runId), localPath: localFolder(runId) },
  });
  await session.goto(`${SITE}${page}`, signal);
  await waitFor(
    () => session!.page.frames().some((frame) => frame.url().includes("download-frame")),
    {
      label: "partner frame",
    },
  );
  await captureModelScreenshot(session, NO_MASK_SOURCES, signal);
  const executor = new ComputerExecutor(session, { clock: instantClock(), waitActionMs: 1_000 });
  return { s: session, executor, runId, before: await savedFiles() };
}

const click = (x: number, y: number) =>
  ({ type: "click", x, y, button: "left" }) satisfies ComputerAction;
/** download.html: the attachment link, the `download` link, the script export, the partner frame. */
const AT = {
  link: click(80, 30),
  attr: click(80, 80),
  script: click(80, 140),
  frame: click(80, 240),
};

/** The page's download attempts the gate saw, once it saw `count` of them. */
async function blocked(s: BrowserSession, count = 1) {
  const seen: Array<{ url: string; filename: string | null }> = [];
  await waitFor(
    () => {
      seen.push(...s.downloads.drainBlocked());
      return seen.length >= count;
    },
    { label: "download attempt", timeoutMs: 5_000 },
  );
  return seen;
}

describe("download gate (spec §9): denied unless a person approved it", () => {
  it.each([
    [
      "a same-origin link the server answers as an attachment",
      AT.link,
      `${SITE}/files/report.csv`,
      "report.csv",
    ],
    ["a link with a download attribute", AT.attr, `${SITE}/files/notes.txt`, "Notes 1.txt"],
    ["a script-made blob download", AT.script, "blob:", "export.csv"],
    ["a link inside a cross-site frame", AT.frame, `${ISOLATED}/files/report.csv`, "report.csv"],
  ] as const)("%s saves nothing and is reported for approval", async (_case, action, url, name) => {
    const { s, executor, before } = await setup();
    expect(await executor.execute(action, signal)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await savedFiles()).toEqual(before);
    const [attempt] = await blocked(s);
    expect(attempt!.url.startsWith(url)).toBe(true);
    // Chromium's suggestion; the loop cleans it again for the card.
    expect(attempt!.filename).toContain(name);
  });

  it("knows a download link before the click, so it can be approved before any request", async () => {
    const { s } = await setup();
    const { target } = await hitTest(s, { x: AT.attr.x, y: AT.attr.y });
    expect(target?.download).toEqual({
      url: `${SITE}/files/notes.txt`,
      filename: "../../Notes 1.txt",
    });
    expect((await hitTest(s, { x: AT.link.x, y: AT.link.y })).target?.download).toBeUndefined();
  });

  it("saves an approved download once, into the run's folder under its download id, then denies again", async () => {
    const { s, executor, runId, before } = await setup();
    await s.downloads.allowOnce((url) => url === `${SITE}/files/report.csv`);
    expect(await executor.execute(AT.link, signal)).toBeNull();
    const folder = slotDownloadPath(runId);
    const saved = await waitFor(
      async () => {
        const files = (await savedFiles()).filter((file) => !before.includes(file));
        return files.length > 0 ? files : null;
      },
      { label: "saved", timeoutMs: 10_000 },
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(new RegExp(`^${folder}/[0-9a-f-]{36}$`));
    expect(s.downloads.drainBlocked()).toEqual([]);
    // The approval is spent: the same download again is denied.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await executor.execute(AT.link, signal)).toBeNull();
    await blocked(s);
    expect((await savedFiles()).filter((file) => !before.includes(file))).toEqual(saved);
    await run("docker", [
      "compose",
      "-f",
      COMPOSE_FILE,
      "exec",
      "-T",
      "browser-1",
      "rm",
      "-rf",
      folder,
    ]);
  });

  it("while one download is approved, a page spamming its own downloads saves none of them: exactly one file", async () => {
    const { s, executor, runId } = await setup("/download.html?spam");
    await new Promise((resolve) => setTimeout(resolve, 200)); // the spam is under way
    await s.downloads.allowOnce((url) => url === `${SITE}/files/report.csv`);
    expect(await executor.execute(AT.link, signal)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 2_500)); // spam ends; the allowance closes
    const approved = s.downloads.approvedDownloads();
    expect(approved).toHaveLength(1);
    expect(await localFiles(runId)).toEqual(approved);
    expect(s.downloads.drainBlocked().length).toBeGreaterThan(10); // each spam attempt reported
  });

  it("a page left behind when the gate's connection goes saves nothing: the slot's own policy denies", async () => {
    const { s, before } = await setup();
    await s.close();
    session = undefined;
    // A bare CDP client (not Playwright, which sets its own download behaviour) on the page.
    const targets = (await (await fetch(`${SLOT_CDP["browser-1"]}/json/list`)).json()) as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
    const target = targets.find((entry) => entry.type === "page")!;
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
    try {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Page.navigate",
          params: { url: `${SITE}/files/report.csv` },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(await savedFiles()).toEqual(before);
      // ...and no native "Save File" dialog a person in the live view could use instead (I3).
      expect(await saveDialogs()).toBe(0);
    } finally {
      socket.close();
    }
  });

  describe("while a person holds control (live view, B6)", () => {
    it("lets the person's download complete and keeps it; after hand-back the agent gate is back", async () => {
      const { s, runId } = await setup();
      await s.downloads.userControl(true);
      await s.page.mouse.click(AT.link.x, AT.link.y); // the person's click (n.eko input)
      const saved = await waitFor(
        async () => {
          const files = await localFiles(runId);
          return files.length > 0 && !files.some((file) => file.endsWith(".crdownload"))
            ? files
            : null;
        },
        { label: "user download", timeoutMs: 10_000 },
      );
      expect(saved).toHaveLength(1);
      expect(s.downloads.userDownloads()).toEqual(saved);
      expect(s.downloads.drainBlocked()).toEqual([]);
      await s.downloads.userControl(false);
      await new Promise((resolve) => setTimeout(resolve, 1_500)); // past the late sweep
      expect(await localFiles(runId)).toEqual(saved); // never swept
      // Hand-back: the agent gate is back, so the same download is denied and reported.
      await s.page.mouse.click(AT.link.x, AT.link.y);
      await blocked(s);
      expect(await localFiles(runId)).toEqual(saved);
    });

    it("cancels a person's download past the byte cap or past the per-run count cap", async () => {
      const { s, runId } = await setup();
      await s.context.route(`${SITE}/files/big.bin`, (route) =>
        route.fulfill({
          headers: {
            "content-disposition": "attachment",
            "content-type": "application/octet-stream",
          },
          body: Buffer.alloc(3 * 1024 * 1024, 7),
        }),
      );
      const capped: string[] = [];
      await s.downloads.userControl(true, {
        maxBytes: 1024 * 1024,
        maxCount: 1,
        onCapped: ({ reason }) => capped.push(reason),
      });
      await s.page.evaluate(() => {
        const link = document.createElement("a");
        link.href = "/files/big.bin";
        document.body.append(link);
        link.click();
      });
      await waitFor(() => capped.includes("too_large"), { label: "too large", timeoutMs: 10_000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await localFiles(runId)).toEqual([]);
      // The count: that one counted; a second download is over the cap of 1.
      await s.page.mouse.click(AT.link.x, AT.link.y);
      await waitFor(() => capped.includes("too_many"), { label: "too many", timeoutMs: 10_000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await localFiles(runId)).toEqual([]);
      await s.downloads.userControl(false);
      await s.context.unrouteAll({ behavior: "ignoreErrors" });
    });

    it("the agent cannot start a download while the person holds control: it cannot act at all", async () => {
      const { s, executor, runId } = await setup();
      s.guard.hold();
      await s.downloads.userControl(true);
      await expect(executor.execute(AT.link, signal)).rejects.toBeInstanceOf(ControlHeld);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(await localFiles(runId)).toEqual([]);
      await s.downloads.userControl(false);
      s.guard.release();
    });
  });
});
