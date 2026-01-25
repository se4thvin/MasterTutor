import { describe, expect, it } from "vitest";
import { PrivateHostCheck, isFixtureHost, isPrivateAddress } from "./network-policy.ts";

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
  it("treats unresolvable names as not private (the slot's iptables is the second layer)", async () => {
    const check = new PrivateHostCheck(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await check.isPrivate("nowhere.invalid")).toBe(false);
  });
});

describe("isFixtureHost", () => {
  it("matches only *.fixtures.test", () => {
    expect(isFixtureHost("site.fixtures.test")).toBe(true);
    expect(isFixtureHost("fixtures.test")).toBe(true);
    expect(isFixtureHost("fixtures.test.evil.com")).toBe(false);
  });
});
