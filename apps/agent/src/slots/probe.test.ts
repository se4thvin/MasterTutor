import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeSlot, slotCdpBaseUrl } from "./probe.ts";

let server: Server | undefined;
afterEach(() => server?.close());

async function fakeCdp(body: string, status = 200): Promise<number> {
  server = createServer((req, res) => {
    expect(req.headers.host).toMatch(/^127\.0\.0\.1:/);
    res.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as AddressInfo).port;
}

describe("probeSlot", () => {
  it("addresses the slot by IP and reads the browser version", async () => {
    const port = await fakeCdp(
      JSON.stringify({
        Browser: "Chrome/154.0.8037.57",
        "Protocol-Version": "1.3",
        webSocketDebuggerUrl: "ws://x",
      }),
    );
    const result = await probeSlot("browser-1", { resolveHost: async () => "127.0.0.1", port });
    expect(result).toEqual({
      name: "browser-1",
      baseUrl: `http://127.0.0.1:${port}`,
      browser: "Chrome/154.0.8037.57",
      protocolVersion: "1.3",
    });
  });
  it("rejects invalid slot names before resolving", async () => {
    await expect(
      slotCdpBaseUrl("postgres", { resolveHost: async () => "127.0.0.1" }),
    ).rejects.toThrow();
  });
  it("rejects non-CDP answers", async () => {
    const port = await fakeCdp(
      "Host header is specified and is not an IP address or localhost.",
      500,
    );
    await expect(
      probeSlot("browser-1", { resolveHost: async () => "127.0.0.1", port }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
