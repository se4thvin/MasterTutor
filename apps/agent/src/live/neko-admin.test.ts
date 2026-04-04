import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { deriveNekoPassword } from "@mastertutor/contracts/server";
import { afterEach, describe, expect, it } from "vitest";
import { NekoApiError, createNekoAdmin } from "./neko-admin.ts";

const adminSecret = "neko-admin-secret-for-tests-0123456789";
let server: Server | undefined;
afterEach(() => server?.close());

async function fakeNeko() {
  const state = { logins: 0, token: "", calls: [] as string[] };
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      state.calls.push(`${req.method} ${req.url}`);
      if (req.url === "/api/login") {
        const { username, password } = JSON.parse(body) as { username: string; password: string };
        if (username !== "agent" || password !== deriveNekoPassword(adminSecret, "browser-1")) {
          res.writeHead(401).end('{"message":"invalid password"}');
          return;
        }
        state.logins += 1;
        state.token = `token${state.logins}`;
        res
          .writeHead(200, { "set-cookie": `NEKO_SESSION=${state.token}; Path=/; HttpOnly` })
          .end('{"id":"agent"}');
        return;
      }
      if (req.headers.authorization !== `Bearer ${state.token}`) {
        res.writeHead(401).end();
        return;
      }
      if (req.url === "/api/room/control") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end('{"has_host":true,"host_id":"agent"}');
        return;
      }
      if (req.url === "/api/room/control/take") {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(500).end("stack trace with internal detail");
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { state, baseUrl: `http://127.0.0.1:${(server!.address() as AddressInfo).port}` };
}

describe("createNekoAdmin", () => {
  it("logs in once as the agent member and reuses the bearer token", async () => {
    const { state, baseUrl } = await fakeNeko();
    const admin = createNekoAdmin({ adminSecret, baseUrl: () => baseUrl });
    expect(await admin.request("browser-1", "GET", "/api/room/control")).toEqual({
      has_host: true,
      host_id: "agent",
    });
    expect(await admin.request("browser-1", "POST", "/api/room/control/take")).toBeNull();
    expect(state.logins).toBe(1);
  });

  it("re-logs in once when the slot restarted and the token is stale", async () => {
    const { state, baseUrl } = await fakeNeko();
    const admin = createNekoAdmin({ adminSecret, baseUrl: () => baseUrl });
    await admin.request("browser-1", "GET", "/api/room/control");
    state.token = "rotated-by-restart";
    expect(await admin.request("browser-1", "GET", "/api/room/control")).toMatchObject({
      host_id: "agent",
    });
    expect(state.logins).toBe(2);
  });

  it("raises status and path only, never the response body", async () => {
    const { baseUrl } = await fakeNeko();
    const admin = createNekoAdmin({ adminSecret, baseUrl: () => baseUrl });
    const error = await admin.request("browser-1", "GET", "/api/unknown").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NekoApiError);
    expect((error as NekoApiError).status).toBe(500);
    expect((error as Error).message).toBe("n.eko /api/unknown answered HTTP 500");
  });
});
