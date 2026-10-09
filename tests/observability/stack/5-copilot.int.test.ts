import { describe, expect, it } from "vitest";
import { APP, compose, enabled, request, state } from "./stack.ts";

describe.runIf(enabled)("Copilot routing (spec §7.2)", () => {
  it("lets the owner in through ForwardAuth", async () => {
    const reply = await request(APP, "/api/observer/threads", { cookie: state().owner });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual([]);
  });
  it("a non-owner member is refused by ForwardAuth", async () => {
    expect((await request(APP, "/api/observer/threads", { cookie: state().member })).status).toBe(
      403,
    );
  });
  it("a signed-out request is refused and never reaches the service", async () => {
    expect((await request(APP, "/api/observer/threads")).status).toBe(401);
  });
  it("does not expose ForwardAuth on the public host", async () => {
    expect((await request(APP, "/api/observer-auth", { cookie: state().owner })).status).toBe(404);
  });
  it("permits same-origin owner writes and refuses a foreign origin before any model call", async () => {
    const options = {
      method: "POST",
      cookie: state().owner,
      headers: { "content-type": "application/json", origin: APP },
      // Deliberately invalid: it exercises auth + SSE without calling even the mock provider.
      body: "{}",
    };
    const reply = await request(APP, "/api/observer/threads/ask", options);
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toContain("text/event-stream");
    expect(reply.body).toContain('"code":"internal"');
    expect(
      (
        await request(APP, "/api/observer/threads/ask", {
          ...options,
          headers: { ...options.headers, origin: "https://foreign.test" },
        })
      ).status,
    ).toBe(403);
  });
  it("refuses a request inside the network that skipped ForwardAuth", () => {
    const status = compose([
      "exec",
      "-T",
      "web",
      "node",
      "-e",
      "fetch('http://observer:4000/api/observer/threads').then((r) => console.log(r.status))",
    ]).trim();
    expect(status).toBe("401");
  });
});
