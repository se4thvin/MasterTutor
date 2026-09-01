import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLoopback, startFixtureServer } from "./server.ts";

const USER = "u@x.test";
const PASSWORD = "pw-0123456789";
let server: { url: string; close(): Promise<void> };
beforeAll(async () => {
  server = await startFixtureServer({ user: USER, password: PASSWORD, port: 0 });
});
afterAll(async () => server.close());

async function signIn(): Promise<string> {
  const r = await fetch(`${server.url}/signin`, {
    method: "POST",
    body: new URLSearchParams({ email: USER, password: PASSWORD }),
    redirect: "manual",
  });
  expect(r.status).toBe(303);
  return r.headers.get("set-cookie")!.split(";")[0]!;
}

const complete = (cookie: string, id: string) =>
  fetch(`${server.url}/api/complete`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });

describe("bench-activities fixture", () => {
  it("redirects to sign-in without a session and rejects a wrong password", async () => {
    expect((await fetch(`${server.url}/book`, { redirect: "manual" })).status).toBe(303);
    const bad = await fetch(`${server.url}/signin`, {
      method: "POST",
      body: new URLSearchParams({ email: USER, password: "no" }),
      redirect: "manual",
    });
    expect(bad.status).toBe(401);
  });

  it("shows a consent overlay until the consent cookie is set (P10b-6)", async () => {
    const first = await (await fetch(`${server.url}/signin`)).text();
    expect(first).toContain('aria-label="Cookie consent"');
    const accepted = await (
      await fetch(`${server.url}/signin`, { headers: { cookie: "consent=1" } })
    ).text();
    expect(accepted).not.toContain('aria-label="Cookie consent"');
  });

  it("tracks completion server-side across sessions, so a separate verify run sees it", async () => {
    const a = await signIn();
    for (const id of ["a1", "a2", "a3"]) expect((await complete(a, id)).status).toBe(204);
    const b = await signIn();
    const html = await (await fetch(`${server.url}/book`, { headers: { cookie: b } })).text();
    expect(html).toContain("Participation: 3 of 3 activities completed (100%)");
  });

  it("rejects unknown activities and resets from loopback", async () => {
    const a = await signIn();
    expect((await complete(a, "zz")).status).toBe(400);
    expect((await fetch(`${server.url}/__reset`, { method: "POST" })).status).toBe(204);
    const html = await (
      await fetch(`${server.url}/book`, { headers: { cookie: await signIn() } })
    ).text();
    expect(html).toContain("0 of 3");
  });

  it("treats only loopback peers as loopback, so a reset from the agent or a slot gets 403 (P10b-19)", () => {
    for (const ok of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(isLoopback(ok)).toBe(true);
    for (const no of ["10.0.0.5", "172.30.231.10", "::ffff:10.0.0.5", "", undefined])
      expect(isLoopback(no)).toBe(false);
  });
});

describe("consent overlay layout (coordinate scenarios)", () => {
  it("puts Accept where the computer_use scenarios click, whatever the viewport height", async () => {
    const html = await (await fetch(`${server.url}/signin`)).text();
    const bar = /<div style="([^"]*)">\s*<p/.exec(html)![1]!;
    // A bar anchored to the bottom moves with the slot's content height (713px, not 800).
    expect(bar).toMatch(/(?:^|;)top:0(?:;|$)/);
    expect(bar).not.toMatch(/bottom:/);
    const accept =
      /style="left:(\d+)px;top:(\d+)px;width:(\d+)px"\s*onclick="document\.cookie='consent=1/.exec(
        html,
      )!;
    const centre = { x: Number(accept[1]) + Number(accept[3]) / 2, y: Number(accept[2]) + 44 / 2 };
    const { SCENARIOS } = await import("../../llm-mock/src/scenarios/index.ts");
    for (const name of ["bench-activities-computer_use", "bench-verify-computer_use"]) {
      const first = SCENARIOS.find((s) => s.name === name)!.turns[0]!.outputs![0]!;
      expect(first, name).toMatchObject({
        type: "computer",
        actions: [{ type: "click", ...centre }],
      });
    }
  });
});

describe("library: readings with sections and mixed completion (section discovery)", () => {
  const get = async (path: string, cookie: string) =>
    (await fetch(`${server.url}${path}`, { headers: { cookie: `${cookie}; consent=1` } })).text();
  const count = (text: string, pattern: string) => text.split(pattern).length - 1;

  it("lists reading assignments, each reading's sections, and section pages with their activities", async () => {
    const cookie = await signIn();
    const index = await get("/library", cookie);
    for (const n of [1, 2, 3, 4])
      expect(index).toContain(`<a href="/library/reading/${n}">Reading ${n}</a>`);
    expect(await get("/library/reading/2", cookie)).toContain(
      '<a href="/library/chapter/2/section/1">2.1 Loops</a>',
    );
    const loops = await get("/library/chapter/2/section/1", cookie);
    expect([count(loops, "PARTICIPATION ACTIVITY"), count(loops, "Activity completed")]).toEqual([
      2, 1,
    ]);
    const overview = await get("/library/chapter/3/section/1", cookie);
    expect(count(overview, "PARTICIPATION ACTIVITY")).toBe(0);
    expect(
      (await fetch(`${server.url}/library/chapter/9/section/9`, { headers: { cookie } })).status,
    ).toBe(404);
  });
});
