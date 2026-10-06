import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ComputerAction } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { COMPOSE_FILE, SITE, SLOT_CDP } from "../../../../tests/behaviour/constants.ts";
import { instantClock } from "../runtime/clock.ts";
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

/** Every file a download could have written in the slot: the downloads volume and Playwright's own folder. */
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
    "find /downloads /tmp -type f 2>/dev/null | grep -E '^/downloads/|playwright-artifacts' || true",
  ]);
  return stdout.split("\n").filter(Boolean);
}

async function setup() {
  const runId = randomUUID();
  session = await BrowserSession.connect({
    cdpBaseUrl: SLOT_CDP["browser-1"] ?? "",
    allowedOrigins: () => [SITE],
    testMode: true,
    log,
    downloadPath: slotDownloadPath(runId),
  });
  await session.goto(`${SITE}/download.html`, signal);
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
    await s.downloads.allowOnce(`${SITE}/files/report.csv`);
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
});
