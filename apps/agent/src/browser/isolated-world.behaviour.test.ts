import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import type { BrowserSession } from "./session.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
beforeAll(async () => {
  session = await openTestSession();
});
afterAll(async () => {
  await session?.close();
});

describe("named isolated worlds", () => {
  it("runs the prelude in every new context and keeps globals out of read_page's world", async () => {
    await session.goto(`${FIXTURES}/index.html`, signal);
    const probe = await session.namedWorlds({
      name: "mastertutor-probe",
      prelude: async () => "globalThis.__probe = 41;",
    });
    expect(
      await probe.call((x: number) => (globalThis as { __probe?: number }).__probe! + x, [1]),
    ).toBe(42);
    expect(
      await (
        await session.worlds()
      ).call(() => typeof (globalThis as { __probe?: number }).__probe, []),
    ).toBe("undefined");
    await session.goto(`${FIXTURES}/page2.html`, signal);
    expect(
      await probe.call((x: number) => (globalThis as { __probe?: number }).__probe! + x, [1]),
    ).toBe(42);
  });
  it("exposes a context id for CDP calls", async () => {
    const worlds = await session.namedWorlds({ name: "mastertutor-probe" });
    expect(await worlds.inWorld(async (id) => id)).toEqual(expect.any(Number));
  });
});

describe("allowsFetch", () => {
  it("allows only http(s) to public or fixture hosts", async () => {
    expect(await session.allowsFetch(`${FIXTURES}/x.png`)).toBe(true);
    for (const url of [
      "http://169.254.169.254/latest",
      "http://127.0.0.1/",
      "http://localhost/",
      "http://10.0.0.1/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://garage:3900/x",
    ])
      expect(await session.allowsFetch(url)).toBe(false);
  });
});

describe("named world cache (Task 0 review M6)", () => {
  it("gives a different prelude its own world, even under the same name", async () => {
    await session.goto(`${FIXTURES}/index.html`, signal);
    const one = await session.namedWorlds({
      name: "mastertutor-m6",
      prelude: async () => "globalThis.__v = 1;",
    });
    const two = await session.namedWorlds({
      name: "mastertutor-m6",
      prelude: async () => "globalThis.__v = 2;",
    });
    expect(await one.call(() => (globalThis as { __v?: number }).__v, [])).toBe(1);
    expect(await two.call(() => (globalThis as { __v?: number }).__v, [])).toBe(2);
    const again = await session.namedWorlds({
      name: "mastertutor-m6",
      prelude: async () => "globalThis.__v = 1;",
    });
    expect(again).toBe(one);
  });
});

describe("allowsFetch with an injected resolver (Task 0 review M11)", () => {
  it("refuses the internal object store even where its name resolves, and allows a public host", async () => {
    const resolving = await openTestSession({
      resolveHost: async (host) => (host === "garage" ? ["172.18.0.5"] : ["93.184.216.34"]),
    });
    try {
      expect(await resolving.allowsFetch("http://garage:3900/bucket/key")).toBe(false);
      expect(await resolving.allowsFetch("https://cdn.example.com/x.png")).toBe(true);
    } finally {
      await resolving.close();
    }
  });
});
