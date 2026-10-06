import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { toOrigin } from "@mastertutor/contracts";
import type { BrowserContext, Route } from "playwright-core";

export interface BlockedNavigation {
  url: string;
  origin: string;
}

export type HostResolver = (host: string) => Promise<string[]>;
export const dnsResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

/** [base, prefix length]: "this" network, RFC1918, CGNAT, loopback, link-local, IETF/documentation/benchmarking, multicast, reserved. */
const V4_BLOCKS: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function isPrivateV4(value: number): boolean {
  return V4_BLOCKS.some(([base, bits]) => value >>> (32 - bits) === base >>> (32 - bits));
}

/** Parses an IPv6 literal (with `::`, an optional dotted-quad tail and no brackets) into eight 16-bit groups. */
function parseV6(raw: string): number[] | null {
  let text = raw.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const tail = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail?.[1] && tail[2]) {
    if (isIP(tail[2]) !== 4) return null;
    const value = v4ToInt(tail[2]);
    text = `${tail[1]}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ].map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
  return groups.length === 8 && groups.every((group) => !Number.isNaN(group)) ? groups : null;
}

function isPrivateV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embedded = (hi: number, lo: number) => isPrivateV4(((hi << 16) | lo) >>> 0);
  // ::/96 covers :: and ::1 (and deprecated IPv4-compatible forms); ::ffff:0:0/96 is IPv4-mapped.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    return g5 === 0xffff ? embedded(g6, g7) : g5 === 0;
  }
  if (g0 === 0x64 && g1 === 0xff9b) {
    // NAT64: 64:ff9b::/96 embeds an IPv4 address; 64:ff9b:1::/48 is local-use.
    return g2 === 1
      ? true
      : g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0
        ? embedded(g6, g7)
        : false;
  }
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true; // Teredo, documentation
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only
  return (
    (g0 & 0xfe00) === 0xfc00 ||
    (g0 & 0xffc0) === 0xfe80 ||
    (g0 & 0xffc0) === 0xfec0 ||
    (g0 & 0xff00) === 0xff00
  );
}

/** Loopback, RFC1918, CGNAT, link-local (metadata), reserved ranges and their IPv6 / mapped forms (spec §5.5). */
export function isPrivateAddress(rawIp: string): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) return isPrivateV4(v4ToInt(ip));
  const groups = parseV6(ip);
  // Anything that is not a valid literal is refused rather than trusted.
  return groups === null ? true : isPrivateV6(groups);
}

export function isFixtureHost(host: string): boolean {
  // fixtures-isolated.test is a second site, for out-of-process (site-isolated) frames.
  return /(^|\.)fixtures(-isolated)?\.test$/i.test(host);
}

const DNS_CACHE_MAX = 500;
const DNS_CACHE_TTL_MS = 60_000;

/**
 * Name-based private-range check. This is defence in depth, not the boundary: the slot's iptables
 * rules (Phase 0) are the real egress control. Node resolves here and Chromium resolves again, so
 * a rebinding answer can differ; the post-response serverAddr() check in installNetworkPolicy
 * closes most of that gap, and iptables closes the rest. A lookup error fails closed.
 */
export class PrivateHostCheck {
  readonly #resolve: HostResolver;
  readonly #cache = new Map<string, { privateHost: boolean; expires: number }>();

  constructor(resolve: HostResolver = dnsResolver) {
    this.#resolve = resolve;
  }

  async isPrivate(rawHost: string): Promise<boolean> {
    const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
    if (isIP(host)) return isPrivateAddress(host);
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    const cached = this.#cache.get(host);
    if (cached && cached.expires > Date.now()) {
      this.#cache.delete(host); // refresh recency (LRU)
      this.#cache.set(host, cached);
      return cached.privateHost;
    }
    let privateHost: boolean;
    try {
      privateHost = (await this.#resolve(host)).some(isPrivateAddress);
    } catch {
      privateHost = true;
    }
    this.#cache.delete(host);
    this.#cache.set(host, { privateHost, expires: Date.now() + DNS_CACHE_TTL_MS });
    while (this.#cache.size > DNS_CACHE_MAX) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    return privateHost;
  }
}

export interface PrivateConnection {
  url: string;
  ip: string;
  topLevel: boolean;
}

export interface NetworkPolicyOptions {
  allowedOrigins(): readonly string[];
  testMode: boolean;
  onBlockedNavigation(block: BlockedNavigation): void;
  /** A response arrived from a private address although the pre-request check passed (rebinding). */
  onPrivateConnection?(hit: PrivateConnection): void;
  resolveHost?: HostResolver;
}

export interface NetworkPolicy {
  /** Resolves once every response seen so far has been checked against its connected address. */
  settled(): Promise<void>;
}

/** Only http(s) documents, plus about:blank, may be loaded at top level. */
export function isAllowedNavigationScheme(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" || url.href === "about:blank";
  } catch {
    return false;
  }
}

/** Fails closed: when the request cannot be inspected it is treated as a top-level navigation. */
function isTopLevelNavigation(route: Route): boolean {
  try {
    const request = route.request();
    if (!request.isNavigationRequest()) return false;
    return request.frame().parentFrame() === null;
  } catch {
    return true;
  }
}

/**
 * Domain allowlist in code (spec §5.5): top-level documents outside allowed_origins, and every
 * top-level non-http(s) scheme (file:, view-source:, chrome:, data:, ...) except about:blank, are
 * aborted and reported; private ranges are blocked for every request. Fixture hosts bypass only the
 * private-range check, and only when AGENT_TEST_MODE=1. WebSockets and service workers are not
 * covered by context.route; the slot's iptables egress rules are the real boundary for those.
 */
export async function installNetworkPolicy(
  context: BrowserContext,
  options: NetworkPolicyOptions,
): Promise<NetworkPolicy> {
  const privateHosts = new PrivateHostCheck(options.resolveHost);
  const pending = new Set<Promise<void>>();
  await context.route("**/*", async (route) => {
    let url: URL;
    try {
      url = new URL(route.request().url());
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    const topLevel = isTopLevelNavigation(route);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      if (topLevel && url.href !== "about:blank") await route.abort("blockedbyclient");
      else await route.continue();
      return;
    }
    const fixture = options.testMode && isFixtureHost(url.hostname);
    if (!fixture && (await privateHosts.isPrivate(url.hostname))) {
      await route.abort("blockedbyclient");
      return;
    }
    if (topLevel) {
      const origin = toOrigin(url.href);
      if (origin === null || !options.allowedOrigins().includes(origin)) {
        if (origin !== null) options.onBlockedNavigation({ url: url.href, origin });
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.continue();
  });
  context.on("response", (response) => {
    const check = (async () => {
      try {
        const address = await response.serverAddr();
        if (!address) return;
        const url = new URL(response.url());
        if (options.testMode && isFixtureHost(url.hostname)) return;
        if (!isPrivateAddress(address.ipAddress)) return;
        const request = response.request();
        options.onPrivateConnection?.({
          url: url.href,
          ip: address.ipAddress,
          topLevel: request.isNavigationRequest() && request.frame().parentFrame() === null,
        });
      } catch {
        // The response or its page is gone; there is nothing left to flag.
      }
    })();
    pending.add(check);
    void check.finally(() => pending.delete(check));
  });
  return { settled: async () => void (await Promise.all([...pending])) };
}
