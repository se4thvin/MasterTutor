import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

export interface LocalChromium {
  cdpBaseUrl: string;
  stop(): Promise<void>;
}

/**
 * A full Chromium with a CDP port, standing in for a slot (R-E2): B1's BrowserSession connects to
 * it exactly as to a slot. Test only (`--no-sandbox` for CI runners).
 */
export async function startChromium(args: readonly string[]): Promise<LocalChromium> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "vault-chromium-"));
  const child = spawn(
    chromium.executablePath(),
    [
      "--headless=new",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,800",
      ...args,
      "about:blank",
    ],
    // Its own process group, so stop() takes the renderers and helpers down with it: on Linux they
    // outlive a killed browser process and keep writing to the profile while it is removed.
    { stdio: ["ignore", "ignore", "pipe"], detached: true },
  );
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit").catch(() => undefined);
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      await exited;
    }
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    const cdpBaseUrl = await new Promise<string>((resolve, reject) => {
      let seen = "";
      const timer = setTimeout(() => reject(new Error("Chromium did not start")), 20_000);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        seen += chunk;
        const match = /DevTools listening on ws:\/\/([^/\s]+)\//.exec(seen);
        if (match) {
          clearTimeout(timer);
          resolve(`http://${match[1]}`);
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Chromium exited during start"));
      });
    });
    return { cdpBaseUrl, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
