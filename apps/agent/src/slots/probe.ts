import { lookup } from "node:dns/promises";
import { CDP_PROXY_PORT, SlotName } from "@mastertutor/contracts";
import { z } from "zod";

const CdpVersion = z.object({
  Browser: z.string().min(1),
  "Protocol-Version": z.string(),
  webSocketDebuggerUrl: z.string(),
});

export interface ProbeOptions {
  resolveHost?: (host: string) => Promise<string>;
  port?: number;
  timeoutMs?: number;
}

export interface SlotProbe {
  name: string;
  baseUrl: string;
  browser: string;
  protocolVersion: string;
}

const resolveIpv4 = async (host: string) => (await lookup(host, { family: 4 })).address;

/**
 * Chrome rejects DevTools HTTP requests whose Host header is a hostname ("Host header is
 * specified and is not an IP address or localhost"), so slots are always addressed by IP.
 * B1 must use this URL for chromium.connectOverCDP.
 */
export async function slotCdpBaseUrl(name: string, options: ProbeOptions = {}): Promise<string> {
  const slot = SlotName.parse(name);
  const ip = await (options.resolveHost ?? resolveIpv4)(slot);
  return `http://${ip}:${options.port ?? CDP_PROXY_PORT}`;
}

export async function probeSlot(name: string, options: ProbeOptions = {}): Promise<SlotProbe> {
  const baseUrl = await slotCdpBaseUrl(name, options);
  const response = await fetch(`${baseUrl}/json/version`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
  });
  if (!response.ok) throw new Error(`Slot ${name} answered HTTP ${response.status}`);
  const version = CdpVersion.parse(await response.json());
  return { name, baseUrl, browser: version.Browser, protocolVersion: version["Protocol-Version"] };
}
