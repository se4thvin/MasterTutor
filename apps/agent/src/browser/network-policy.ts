import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { toOrigin, isPrivateAddress, isLocalhost } from "@mastertutor/contracts";
import type { BrowserContext, Route } from "playwright-core";

export { isPrivateAddress } from "@mastertutor/contracts";

export interface BlockedNavigation {
  url: string;
  origin: string;
  /** The blocked request was not a GET (a form post): opening its URL would not redo it. */
  formPost?: true;
}

export type HostResolver = (host: string) => Promise<string[]>;
export const dnsResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

export function isFixtureHost(host: string): boolean {
  // fixtures-isolated.test and fixtures-hung.test are other sites, for out-of-process frames (the
  // second for a frame that hangs, so it never shares a process with the others).
  return /(^|\.)fixtures(-isolated|-hung)?\.test$/i.test(host);
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
    if (isLocalhost(host)) return true;
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
  /** Whether a top-level document may load from `origin` without asking (navigation-scope.ts). */
  allowsNavigation(origin: string): boolean;
  testMode: boolean;
  onBlockedNavigation(block: BlockedNavigation): void;
  /** A response arrived from a private address although the pre-request check passed (rebinding). */
  onPrivateConnection?(hit: PrivateConnection): void;
  resolveHost?: HostResolver;
}

export interface NetworkPolicy {
  /** Resolves once every response seen so far has been checked against its connected address. */
  settled(): Promise<void>;
  /** The policy's private-host check: other fetch decisions share it and its DNS cache (M9). */
  readonly privateHosts: PrivateHostCheck;
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

function requestMethod(route: Route): string {
  try {
    return route.request().method();
  } catch {
    return "GET";
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

function blockedNavigation(url: string, origin: string, method: string): BlockedNavigation {
  return method === "GET" ? { url, origin } : { url, origin, formPost: true };
}

/**
 * Domain allowlist in code (spec §5.5, D51): top-level documents the run's scope does not allow
 * (redirect hops included), and every
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
      if (origin === null || !options.allowsNavigation(origin)) {
        if (origin !== null)
          options.onBlockedNavigation(blockedNavigation(url.href, origin, requestMethod(route)));
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.continue();
  });
  // A redirect hop never reaches context.route (Playwright routes only a navigation's first URL),
  // so a top-level redirect to an origin outside the allowlist is caught here: it is reported
  // like any blocked navigation (the new_origin approval) and the frame is moved to about:blank
  // before the redirect target can commit.
  context.on("request", (request) => {
    try {
      if (request.redirectedFrom() === null || !request.isNavigationRequest()) return;
      const frame = request.frame();
      if (frame.parentFrame() !== null) return;
      const origin = toOrigin(request.url());
      if (origin !== null && options.allowsNavigation(origin)) return;
      if (origin !== null)
        options.onBlockedNavigation(blockedNavigation(request.url(), origin, request.method()));
      void frame.goto("about:blank").catch(() => undefined);
    } catch {
      // The request or its frame is gone: nothing was loaded.
    }
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
  return { privateHosts, settled: async () => void (await Promise.all([...pending])) };
}
