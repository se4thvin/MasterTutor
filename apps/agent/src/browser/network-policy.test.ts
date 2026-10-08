import type { BrowserContext, Route } from "playwright-core";
import { describe, expect, it } from "vitest";
import {
  PrivateHostCheck,
  installNetworkPolicy,
  isAllowedNavigationScheme,
  isFixtureHost,
  isPrivateAddress,
} from "./network-policy.ts";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:10.0.0.1",
    // The WHATWG URL parser emits IPv4-mapped IPv6 in hex form ([::ffff:a00:1]).
    "::ffff:a00:1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:a00:1",
    // Reserved IPv4 ranges.
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6 forms that embed an IPv4 address or are documentation space.
    "64:ff9b::a00:1",
    "2002:a00:1::1",
    "2001:db8::1",
  ])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each([
    "8.8.8.8",
    "172.32.0.1",
    "1.1.1.1",
    "198.20.0.1",
    "2606:4700::1111",
    "::ffff:808:808",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("PrivateHostCheck", () => {
  it("checks literals, localhost and resolved names, caching lookups", async () => {
    let lookups = 0;
    const check = new PrivateHostCheck(async (host) => {
      lookups += 1;
      return host === "rebind.example" ? ["10.0.0.5"] : ["93.184.216.34"];
    });
    expect(await check.isPrivate("169.254.169.254")).toBe(true);
    expect(await check.isPrivate("localhost")).toBe(true);
    expect(await check.isPrivate("[::ffff:a00:1]")).toBe(true);
    expect(await check.isPrivate("rebind.example")).toBe(true);
    expect(await check.isPrivate("example.com")).toBe(false);
    expect(await check.isPrivate("example.com")).toBe(false);
    expect(lookups).toBe(2);
  });
  it("fails closed when the lookup errors", async () => {
    const check = new PrivateHostCheck(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await check.isPrivate("nowhere.invalid")).toBe(true);
  });
  it("bounds its cache", async () => {
    let lookups = 0;
    const check = new PrivateHostCheck(async () => {
      lookups += 1;
      return ["93.184.216.34"];
    });
    for (let i = 0; i < 600; i++) await check.isPrivate(`h${i}.example`);
    expect(lookups).toBe(600);
    await check.isPrivate("h599.example"); // recent: cached
    expect(lookups).toBe(600);
    await check.isPrivate("h0.example"); // evicted: looked up again
    expect(lookups).toBe(601);
  });
});

describe("isFixtureHost", () => {
  it("matches only *.fixtures.test and the fixture sites *.fixtures-isolated.test, *.fixtures-hung.test", () => {
    expect(isFixtureHost("site.fixtures.test")).toBe(true);
    expect(isFixtureHost("fixtures.test")).toBe(true);
    expect(isFixtureHost("other.fixtures-isolated.test")).toBe(true);
    expect(isFixtureHost("ads.fixtures-hung.test")).toBe(true);
    expect(isFixtureHost("fixtures.test.evil.com")).toBe(false);
    expect(isFixtureHost("fixtures-other.test")).toBe(false);
  });
});

describe("isAllowedNavigationScheme", () => {
  it.each(["http://a.test/", "https://a.test/", "about:blank"])("allows %s", (url) =>
    expect(isAllowedNavigationScheme(url)).toBe(true),
  );
  it.each([
    "file:///etc/hosts",
    "view-source:http://a.test/",
    "chrome://settings",
    "data:text/html,x",
    "javascript:1",
    "about:srcdoc",
    "nonsense",
  ])("refuses %s", (url) => expect(isAllowedNavigationScheme(url)).toBe(false));
});

describe("installNetworkPolicy routing", () => {
  type Handler = (route: Route) => Promise<void>;
  async function harness(allowed: string[] = ["http://ok.test"]) {
    let handler: Handler | undefined;
    const context = {
      route: async (_glob: string, h: Handler) => void (handler = h),
      on: () => undefined,
    } as unknown as BrowserContext;
    const blocked: unknown[] = [];
    await installNetworkPolicy(context, {
      allowedOrigins: () => allowed,
      testMode: false,
      onBlockedNavigation: (b) => blocked.push(b),
      resolveHost: async () => ["93.184.216.34"],
    });
    const run = async (
      url: string,
      request: { navigation: boolean; main: boolean; throws?: boolean },
    ) => {
      const result: string[] = [];
      const route = {
        request: () => ({
          url: () => url,
          isNavigationRequest: () => {
            if (request.throws) throw new Error("frame detached");
            return request.navigation;
          },
          frame: () => ({ parentFrame: () => (request.main ? null : {}) }),
        }),
        abort: async () => void result.push("abort"),
        continue: async () => void result.push("continue"),
      } as unknown as Route;
      await handler!(route);
      return result[0];
    };
    return { run, blocked };
  }

  it.each([
    "file:///etc/hosts",
    "view-source:http://ok.test/",
    "chrome://settings",
    "data:text/html,hi",
  ])("aborts a top-level navigation to %s", async (url) => {
    const { run } = await harness();
    expect(await run(url, { navigation: true, main: true })).toBe("abort");
  });
  it("stops a top-level redirect hop to an origin outside the allowlist and reports it", async () => {
    const listeners: Record<string, (value: unknown) => void> = {};
    const context = {
      route: async () => undefined,
      on: (event: string, listener: (value: unknown) => void) => void (listeners[event] = listener),
    } as unknown as BrowserContext;
    const blocked: unknown[] = [];
    await installNetworkPolicy(context, {
      allowedOrigins: () => ["http://ok.test"],
      testMode: false,
      onBlockedNavigation: (b) => blocked.push(b),
      resolveHost: async () => ["93.184.216.34"],
    });
    const gotos: string[] = [];
    const hop = (url: string, options: { redirected?: boolean; main?: boolean } = {}) =>
      listeners["request"]!({
        url: () => url,
        redirectedFrom: () => (options.redirected === false ? null : {}),
        isNavigationRequest: () => true,
        frame: () => ({
          parentFrame: () => (options.main === false ? {} : null),
          goto: async (target: string) => void gotos.push(target),
        }),
      });
    hop("http://ok.test/next");
    hop("http://evil.test/landing", { main: false });
    hop("http://evil.test/first", { redirected: false });
    expect(gotos).toEqual([]);
    hop("http://evil.test/landing?x=1");
    expect(blocked).toEqual([{ url: "http://evil.test/landing?x=1", origin: "http://evil.test" }]);
    expect(gotos).toEqual(["about:blank"]);
  });
  it("lets about:blank and non-navigation non-http requests through", async () => {
    const { run } = await harness();
    expect(await run("about:blank", { navigation: true, main: true })).toBe("continue");
    expect(await run("data:image/png;base64,AAAA", { navigation: false, main: true })).toBe(
      "continue",
    );
  });
  it("fails closed when the request cannot be inspected", async () => {
    const { run, blocked } = await harness();
    expect(await run("http://evil.test/", { navigation: true, main: true, throws: true })).toBe(
      "abort",
    );
    expect(await run("file:///etc/hosts", { navigation: true, main: true, throws: true })).toBe(
      "abort",
    );
    expect(blocked).toEqual([{ url: "http://evil.test/", origin: "http://evil.test" }]);
  });
  it("exposes its host check, so the session's fetch policy shares one DNS cache (Task 0 review M9)", async () => {
    let lookups = 0;
    let handler: Handler | undefined;
    const context = {
      route: async (_glob: string, h: Handler) => void (handler = h),
      on: () => undefined,
    } as unknown as BrowserContext;
    const policy = await installNetworkPolicy(context, {
      allowedOrigins: () => ["http://ok.test"],
      testMode: false,
      onBlockedNavigation: () => undefined,
      resolveHost: async () => {
        lookups += 1;
        return ["93.184.216.34"];
      },
    });
    const route = {
      request: () => ({
        url: () => "http://ok.test/a.png",
        isNavigationRequest: () => false,
        frame: () => ({ parentFrame: () => null }),
      }),
      abort: async () => undefined,
      continue: async () => undefined,
    } as unknown as Route;
    await handler!(route);
    expect(lookups).toBe(1);
    expect(await policy.privateHosts.isPrivate("ok.test")).toBe(false);
    expect(lookups).toBe(1);
  });
});
