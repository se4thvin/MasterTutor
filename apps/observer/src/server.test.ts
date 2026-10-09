import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "@mastertutor/contracts/server";
import { createObserverServer, type ObserverRoutes } from "./server.ts";

const TOKEN = "t".repeat(48);
const APP = "https://mt.example.com";
const WS = "6f2c8a3e-0000-4000-8000-00000000000a";
const routes: ObserverRoutes = {
  async ask(_caller, _body, emit) {
    emit({ type: "text", delta: "Hi" });
    emit({ type: "done", citations: [], removed: [], usd: 0 });
  },
  threads: async () => [],
  thread: async () => null,
  deleteThread: async () => undefined,
  result: async () => null,
};
let base: string;
const server = createObserverServer({
  token: TOKEN,
  appOrigin: APP,
  routes,
  log: createLogger({ service: "test", level: "silent" }),
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
const auth = { authorization: `Bearer ${TOKEN}`, "x-mt-user": "user_abc", "x-mt-workspace": WS };

describe("observer routes (spec §7.1)", () => {
  it("refuses a request that did not pass ForwardAuth", async () => {
    expect((await fetch(`${base}/api/observer/threads`)).status).toBe(401);
  });
  it("refuses a cross-site write", async () => {
    const res = await fetch(`${base}/api/observer/threads/ask`, {
      method: "POST",
      headers: { ...auth, origin: "https://evil.test", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
  it("streams an answer as SSE, never cached", async () => {
    const res = await fetch(`${base}/api/observer/threads/ask`, {
      method: "POST",
      headers: { ...auth, origin: APP, "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain('"type":"done"');
  });
  it("returns 413 for a chunked oversized body while the sender is still writing", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `${base}/api/observer/threads/ask`,
        { method: "POST", headers: { ...auth, origin: APP } },
        (res) => {
          res.resume();
          res.on("end", () => {
            req.end();
            resolve(res.statusCode);
          });
        },
      );
      req.on("error", reject);
      req.write("x".repeat(20_000));
    });
    expect(status).toBe(413);
  });
  it("aborts the answer when the browser closes its stream", async () => {
    const previous = routes.ask;
    let aborted!: () => void;
    const closed = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    routes.ask = async (_caller, _body, emit, signal) => {
      emit({ type: "text", delta: "Starting" });
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted();
            resolve();
          },
          { once: true },
        ),
      );
    };
    try {
      const res = await fetch(`${base}/api/observer/threads/ask`, {
        method: "POST",
        headers: { ...auth, origin: APP },
        body: "{}",
      });
      await res.body!.cancel();
      await closed;
    } finally {
      routes.ask = previous;
    }
  });
  it("refuses a body over 16 KiB and unknown paths", async () => {
    const big = await fetch(`${base}/api/observer/threads/ask`, {
      method: "POST",
      headers: { ...auth, origin: APP, "content-type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(20_000) }),
    });
    expect(big.status).toBe(413);
    expect((await fetch(`${base}/api/observer/nope`, { headers: auth })).status).toBe(404);
  });
});
