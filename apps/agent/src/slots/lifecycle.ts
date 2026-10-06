import { z } from "zod";

const CdpVersion = z.object({ webSocketDebuggerUrl: z.string().min(1) });

/** The two CDP calls slot recycling needs. Swapped for a fake in unit tests. */
export interface BrowserControl {
  /** The browser GUID from /json/version, which changes on every Chromium launch; null when unreachable. */
  readBrowserId(baseUrl: string): Promise<string | null>;
  /** Sends CDP Browser.close; the slot supervisor then exits and Compose restarts it fresh. */
  closeBrowser(baseUrl: string): Promise<void>;
}

async function readVersion(baseUrl: string): Promise<z.infer<typeof CdpVersion> | null> {
  try {
    const response = await fetch(`${baseUrl}/json/version`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return null;
    return CdpVersion.parse(await response.json());
  } catch {
    return null;
  }
}

export const cdpBrowserControl: BrowserControl = {
  async readBrowserId(baseUrl) {
    const version = await readVersion(baseUrl);
    return version?.webSocketDebuggerUrl.split("/").pop() ?? null;
  },
  async closeBrowser(baseUrl) {
    const version = await readVersion(baseUrl);
    if (!version) return;
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(version.webSocketDebuggerUrl);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        socket.close();
        resolve();
      }, 3_000);
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ id: 1, method: "Browser.close" })),
      );
      socket.addEventListener("message", () => socket.close());
      socket.addEventListener("close", finish);
      socket.addEventListener("error", finish);
    });
  },
};
