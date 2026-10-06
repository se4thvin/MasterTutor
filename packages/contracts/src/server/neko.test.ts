import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { NekoLoginError, deriveNekoPassword, loginNeko, nekoTokenFromSetCookie } from "./neko.ts";

describe("deriveNekoPassword", () => {
  it("matches the slot entrypoint (openssl dgst -sha256 -hmac)", () => {
    // printf '%s' browser-1 | openssl dgst -sha256 -hmac 'neko-admin-secret-for-tests-0123456789' -r
    expect(deriveNekoPassword("neko-admin-secret-for-tests-0123456789", "browser-1")).toBe(
      "a35f74afd3da16d9602bfa17a0637d2a482e320a6d90af6600987626cd6c9ef6",
    );
  });
  it("rejects bad slot names and short secrets", () => {
    expect(() => deriveNekoPassword("neko-admin-secret-for-tests-0123456789", "web")).toThrow();
    expect(() => deriveNekoPassword("short", "browser-1")).toThrow();
  });
});

describe("nekoTokenFromSetCookie", () => {
  it("finds the NEKO_SESSION value and ignores other cookies", () => {
    expect(
      nekoTokenFromSetCookie(["a=1; Path=/", "NEKO_SESSION=abcDEF123; Path=/; HttpOnly"]),
    ).toBe("abcDEF123");
    expect(nekoTokenFromSetCookie(["NEKO_SESSIONX=abc"])).toBeNull();
    expect(nekoTokenFromSetCookie(["NEKO_SESSION=bad value"])).toBeNull();
  });
});

describe("loginNeko", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function fakeNeko(
    handler: (body: string) => { status: number; headers?: Record<string, string>; body?: string },
  ) {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const answer =
          req.url === "/api/login" && req.method === "POST" ? handler(body) : { status: 404 };
        res.writeHead(answer.status, answer.headers ?? {}).end(answer.body ?? "");
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it("returns the token from Set-Cookie", async () => {
    const baseUrl = await fakeNeko((body) => {
      expect(JSON.parse(body)).toEqual({ username: "user", password: "p4ss" });
      return {
        status: 200,
        headers: { "set-cookie": "NEKO_SESSION=tok123; Path=/; HttpOnly" },
        body: '{"id":"user"}',
      };
    });
    expect(await loginNeko({ baseUrl, username: "user", password: "p4ss" })).toBe("tok123");
  });

  it("falls back to the body token when cookies are disabled", async () => {
    const baseUrl = await fakeNeko(() => ({
      status: 200,
      body: '{"id":"agent","token":"body456"}',
    }));
    expect(await loginNeko({ baseUrl, username: "agent", password: "x" })).toBe("body456");
  });

  it("reports the status without echoing the password or the body", async () => {
    const baseUrl = await fakeNeko(() => ({ status: 422, body: "session already connected p4ss" }));
    const error = await loginNeko({ baseUrl, username: "user", password: "p4ss" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NekoLoginError);
    expect((error as NekoLoginError).status).toBe(422);
    expect((error as Error).message).not.toContain("p4ss");
  });

  it("never re-sends the password to a redirect target", async () => {
    const hits: string[] = [];
    server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/api/login") res.writeHead(307, { location: "/elsewhere" }).end();
      else res.writeHead(200, { "set-cookie": "NEKO_SESSION=stolen; Path=/" }).end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // A redirect is a login failure like any other: never a raw fetch TypeError (A6/A7).
    const error = await loginNeko({ baseUrl, username: "user", password: "p4ss" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NekoLoginError);
    expect((error as Error).message).not.toContain("p4ss");
    expect(hits).toEqual(["/api/login"]);
  });
});
