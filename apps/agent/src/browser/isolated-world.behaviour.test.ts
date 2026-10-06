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
