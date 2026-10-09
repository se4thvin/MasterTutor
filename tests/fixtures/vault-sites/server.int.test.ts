import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_HOSTS, startVaultFixtures, type VaultFixtures } from "./server.ts";

let fx: VaultFixtures;
const account = {
  email: "me@example.test",
  password: "fixture-password-1",
  totpSeed: "JBSWY3DPEHPK3PXP",
  pin: "739146",
};

function request(
  host: string,
  path: string,
  init: { method?: string; body?: string; type?: string } = {},
) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>(
    (resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: fx.port,
          path,
          method: init.method ?? "GET",
          headers: { host, "content-type": init.type ?? "text/plain" },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
        },
      );
      req.on("error", reject);
      req.end(init.body);
    },
  );
}

beforeAll(async () => {
  fx = await startVaultFixtures({ account, mail: null, fixedOtp: "246810" });
});
afterAll(async () => fx?.close());

describe("vault fixture server", () => {
  it("serves the login site on the pinned and lookalike hosts", async () => {
    expect((await request("login.fixtures.test", "/password")).body).toContain('id="password"');
    expect((await request("log1n.fixtures.test", "/password")).body).toContain('id="password"');
    expect(fx.origin("login")).toBe(`http://login.fixtures.test:${fx.port}`);
  });

  it("signs in with the right credentials and sets a session cookie", async () => {
    const ok = await request("login.fixtures.test", "/password", {
      method: "POST",
      type: "application/x-www-form-urlencoded",
      body: `email=${encodeURIComponent(account.email)}&password=${account.password}`,
    });
    expect(ok.status).toBe(303);
    expect(String(ok.headers["set-cookie"])).toMatch(/sid=/);
    const bad = await request("login.fixtures.test", "/password", {
      method: "POST",
      type: "application/x-www-form-urlencoded",
      body: "email=x&password=y",
    });
    expect(bad.status).toBe(401);
  });

  it("serves the React bundle and the evil host, recording every request", async () => {
    expect((await request(FIXTURE_HOSTS.login, "/react-login.js")).body).toContain("createRoot");
    await request(FIXTURE_HOSTS.evil, "/collect", { method: "POST", body: "leak" });
    expect(
      fx.requests
        .filter((r) => r.host === FIXTURE_HOSTS.evil && r.path === "/collect")
        .map((r) => r.body),
    ).toEqual(["leak"]);
    expect(fx.origins).toEqual(
      (["login", "lookalike", "other", "evil"] as const).map((host) => fx.origin(host)),
    );
  });

  it("serves an echo page that reflects a typed password (W7)", async () => {
    const page = await request(FIXTURE_HOSTS.login, "/echo");
    expect(page.body).toContain('id="password"');
    expect(page.body).toContain('id="echo"');
  });

  it("sizes the PIN boxes from the account's PIN", async () => {
    const page = await request("login.fixtures.test", "/pin");
    expect(page.body.match(/id="pin\d"/g)).toHaveLength(6);
  });

  it("accepts only the fixed one-time code on /otp-fixed (E2E: the person types it)", async () => {
    expect((await request("login.fixtures.test", "/otp-fixed")).body).toContain(
      'autocomplete="one-time-code"',
    );
    const post = (code: string) =>
      request("login.fixtures.test", "/otp-fixed", {
        method: "POST",
        type: "application/x-www-form-urlencoded",
        body: `code=${code}`,
      });
    expect((await post("246810")).body).toContain("Code accepted");
    expect((await post("246811")).status).toBe(401);
  });
});
