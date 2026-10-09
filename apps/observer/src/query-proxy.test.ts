import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createQueryProxyClient } from "./query-proxy-client.ts";
import { createO2Query } from "./o2.ts";
import { createQueryProxyServer } from "./query-proxy.ts";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function fixture() {
  const calls: unknown[][] = [];
  const server = createQueryProxyServer(
    createO2Query({
      org: "default",
      async call(...args) {
        calls.push(args);
        return (
          args[0] === "search"
            ? { took: 1, hits: [{ body: "safe" }] }
            : {
                status: "success",
                data: { resultType: "matrix", result: [{ metric: {}, values: [[1, "2"]] }] },
              }
        ) as never;
      },
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { calls, url, post };
}
const search = {
  stream: "mastertutor",
  sql: "SELECT body FROM mastertutor",
  range: { startUs: 1, endUs: 2 },
  size: 200,
};
const range = { query: "mt_runs_ended", range: { start: 1, end: 2, step: 1 } };
describe("query proxy read boundary", () => {
  it("executes only validated bounded searches and PromQL, with no admin routes", async () => {
    const { calls, url, post } = await fixture();
    expect((await post("/search", search)).status).toBe(200);
    expect(calls[0]?.[3]).toMatchObject({ timeout: 10, query: { size: 200, from: 0 } });
    expect((await post("/query_range", range)).status).toBe(200);
    expect((await post("/query", { query: "mt_runs_ended", time: 1 })).status).toBe(200);
    expect((await fetch(url + "/api/default/users", { method: "DELETE" })).status).toBe(404);
    expect((await fetch(url + "/search")).status).toBe(404);
    expect(calls).toHaveLength(3);
  });
  it("uses the credential-free client and validates the proxy's bounded result", async () => {
    const { url } = await fixture();
    const result = await createQueryProxyClient(url).search(
      "mastertutor",
      search.sql,
      search.range,
      200,
      new AbortController().signal,
    );
    expect(result.rows).toEqual([["safe"]]);
    expect(result.columns).toEqual(["body"]);
  });
  it("propagates cancellation through the process boundary and hides upstream errors", async () => {
    let began!: () => void;
    let stopped!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    const server = createQueryProxyServer({
      async search(_stream, _sql, _range, _size, signal) {
        began();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              stopped();
              reject(new Error("upstream-private-content"));
            },
            { once: true },
          ),
        );
        throw new Error("unreachable");
      },
      async range() {
        throw new Error("upstream-private-content");
      },
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const controller = new AbortController();
    const pending = createQueryProxyClient(url).search(
      "mastertutor",
      search.sql,
      search.range,
      1,
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow();
    await started;
    controller.abort();
    await rejected;
    await aborted;
    const reply = await fetch(url + "/query_range", {
      method: "POST",
      body: JSON.stringify(range),
    });
    expect(reply.status).toBe(502);
    expect(await reply.text()).toBe('{"error":"query_failed"}');
  });
  it("rejects the SQL exploit, unallowed streams, invalid metrics and excessive ranges before O2", async () => {
    const { calls, post } = await fixture();
    for (const body of [
      {
        ...search,
        sql: 'SELECT containers.body AS "from mastertutor where" FROM mastertutor, containers LIMIT 1',
      },
      { ...search, stream: "private" },
      { ...search, size: 201 },
      { ...search, range: { startUs: 1, endUs: 8 * 86400 * 1e6 } },
      { ...search, range: { startUs: 2, endUs: 1 } },
      { ...search, url: "http://evil.test" },
    ])
      expect((await post("/search", body)).status).toBe(400);
    for (const body of [
      { ...range, query: "arbitrary_metric" },
      { ...range, range: { start: 1, end: 91 * 86400, step: 86400 } },
      { ...range, range: { start: 1, end: 301, step: 1 } },
      { ...range, range: { start: 1, end: 2, step: 0 } },
    ])
      expect((await post("/query_range", body)).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it("bounds request bodies and returns errors without reflecting input", async () => {
    const { url } = await fixture();
    const reply = await fetch(url + "/search", { method: "POST", body: "x".repeat(20000) });
    expect(reply.status).toBe(413);
    expect(await reply.text()).not.toContain("xxxxx");
  });
});
