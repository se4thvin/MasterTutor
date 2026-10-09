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
  it("keeps O2 secrets and direct O2 access out of the observer", () => {
    const result = compose([
      "exec",
      "-T",
      "observer",
      "node",
      "--input-type=module",
      "-e",
      `
      const noSecret = !Object.keys(process.env).some(k => /^OBSERVE_/.test(k));
      let direct = false;
      try { await fetch('http://openobserve:5080/healthz', {signal: AbortSignal.timeout(1500)}); direct = true; } catch {}
      const proxy = await fetch(process.env.OBSERVER_QUERY_URL + '/search', {
        method: 'POST', headers: {'content-type':'application/json',authorization:'Bearer '+process.env.OBSERVER_QUERY_TOKEN},
        body: JSON.stringify({stream:'mastertutor', sql:'SELECT * FROM mastertutor LIMIT 1', size:1,
          range:{startUs:Date.now()*1000-3600000000,endUs:Date.now()*1000}})
      });
      const denied = await fetch(process.env.OBSERVER_QUERY_URL + '/search', {
        method:'POST', headers:{'content-type':'application/json',authorization:'Bearer '+process.env.OBSERVER_QUERY_TOKEN},
        body:JSON.stringify({stream:'mastertutor',sql:'SELECT containers.body AS "from mastertutor where" FROM mastertutor, containers LIMIT 1',size:1,range:{startUs:1,endUs:2}})
      });
      const unauthorized = await fetch(process.env.OBSERVER_QUERY_URL + '/search', {method:'POST',body:'invalid'});
      const wrong = await fetch(process.env.OBSERVER_QUERY_URL + '/query_range', {method:'POST',headers:{authorization:'Bearer wrong'},body:'invalid'});
      const admin = await fetch(process.env.OBSERVER_QUERY_URL + '/api/default/users', {method:'DELETE'});
      console.log(JSON.stringify({noSecret,direct,search:proxy.status,denied:denied.status,admin:admin.status,unauthorized:unauthorized.status,wrong:wrong.status}));
    `,
    ]);
    expect(JSON.parse(result)).toEqual({
      noSecret: true,
      direct: false,
      search: 200,
      denied: 400,
      admin: 404,
      unauthorized: 401,
      wrong: 401,
    });
  });
  it("does not accept proxy requests on its OpenObserve-facing interface", () => {
    const result = compose([
      "exec",
      "-T",
      "web",
      "node",
      "--input-type=module",
      "-e",
      `
      let reachable = false;
      try { await fetch('http://observer-query:4001/healthz', {signal:AbortSignal.timeout(1500)}); reachable = true; } catch {}
      console.log(JSON.stringify({reachable}));
    `,
    ]);
    expect(JSON.parse(result)).toEqual({ reachable: false });
  });
});
